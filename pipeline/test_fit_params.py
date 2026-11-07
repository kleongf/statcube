from __future__ import annotations

import math
import random
from datetime import date, datetime, timedelta, timezone
from statistics import fmean

import pytest

import epa
import fit_params
import store
from conftest import FakeClient

PRIOR = epa.EpaParams(epa.RatingParams(43.04, 3.5888, 0.5686), epa.RatingParams(6.685, 2.2793, 0.6143))
START = datetime(2025, 12, 1, tzinfo=timezone.utc)
AUTO_SHARE = 0.2


def synthetic_season(
    matches: int, *, seed: int = 1, a: float = 2.0, p: float = 0.6, strength: tuple[float, float] = (10, 90),
) -> epa.SeasonMatches:
    rng = random.Random(seed)
    strengths = {team: rng.uniform(*strength) for team in range(1, 301)}

    def alliance(pair: list[int]) -> epa.Alliance:
        mu = sum(strengths[t] for t in pair)
        total = rng.gauss(mu, a * mu ** p)
        auto = rng.gauss(mu * AUTO_SHARE, a * (mu * AUTO_SHARE) ** p)
        return epa.Alliance((pair[0], pair[1]), round(max(0, total)), round(max(0, auto)))

    played = []
    for i in range(matches):
        teams = rng.sample(sorted(strengths), 4)
        at = START + timedelta(minutes=10 * i)
        played.append(epa.Match("SYN", at, at.isoformat(), alliance(teams[:2]), alliance(teams[2:])))
    return epa.SeasonMatches(tuple(played), {}, events=1, skipped=0)


def half_mean_alliance_score(data: epa.SeasonMatches, window: fit_params.Window) -> tuple[float, float]:
    rated = [m for m in data.matches if m.posted_at.date() in window]
    return (
        fmean(s for m in rated for s in (m.red.total, m.blue.total)) / 2,
        fmean(s for m in rated for s in (m.red.auto, m.blue.auto)) / 2,
    )


def test_fit_spread_recovers_a_and_p_from_scores_drawn_with_a_known_spread():
    rng = random.Random(7)
    pairs = []
    for _ in range(160_000):
        predicted = rng.uniform(20, 300)
        pairs.append((predicted, rng.gauss(predicted, 2.0 * predicted ** 0.6)))

    fitted = fit_params.fit_spread(fit_params.bin_residuals(pairs), mean=50)

    assert fitted.a == pytest.approx(2.0, rel=0.03)
    assert fitted.p == pytest.approx(0.6, rel=0.03)


def test_a_season_below_2000_matches_keeps_the_prior_a_and_p_and_refits_only_the_means():
    data = synthetic_season(1500)

    fit = fit_params.fit_season(data, PRIOR)

    mean, mean_auto = half_mean_alliance_score(data, fit_params.Window())
    assert fit.matches == 1500
    assert not fit.refit_spread
    assert fit.params == epa.EpaParams(
        epa.RatingParams(round(mean, 4), PRIOR.total.a, PRIOR.total.p),
        epa.RatingParams(round(mean_auto, 4), PRIOR.auto.a, PRIOR.auto.p),
    )


def test_enough_matches_in_too_few_full_rating_bins_still_keeps_the_prior_a_and_p():
    data = synthetic_season(2500, a=0.3, strength=(30, 32))

    fit = fit_params.fit_season(data, PRIOR)

    assert fit.matches == 2500
    assert len(fit_params.full_bins(fit.total_bins)) < fit_params.MIN_BINS
    assert not fit.refit_spread
    assert (fit.params.total.a, fit.params.total.p) == (PRIOR.total.a, PRIOR.total.p)


def test_a_season_with_enough_data_refits_a_and_p_to_a_fixed_point():
    data = synthetic_season(4000)

    fit = fit_params.fit_season(data, PRIOR)
    again = fit_params.fit_season(data, fit.params)

    assert fit.refit_spread
    assert 1 <= fit.rounds <= fit_params.MAX_ROUNDS
    for first, second in ((fit.params.total, again.params.total), (fit.params.auto, again.params.auto)):
        assert math.isfinite(first.a) and first.a > 0 and first.p > 0
        assert second.a == pytest.approx(first.a, rel=0.005)
        assert second.p == pytest.approx(first.p, rel=0.005)


def test_only_matches_inside_the_window_count_toward_the_means_and_the_match_count():
    data = synthetic_season(3000)
    window = fit_params.Window(date(2025, 12, 5), date(2025, 12, 10))

    fit = fit_params.fit_season(data, PRIOR, window)

    inside = sum(1 for m in data.matches if m.posted_at.date() in window)
    mean, mean_auto = half_mean_alliance_score(data, window)
    assert 0 < inside < 3000
    assert fit.matches == inside
    assert (fit.params.total.mean, fit.params.auto.mean) == (round(mean, 4), round(mean_auto, 4))


def test_a_window_with_no_matches_raises_no_matches():
    with pytest.raises(fit_params.NoMatches):
        fit_params.fit_season(synthetic_season(100), PRIOR, fit_params.Window(date(2026, 3, 1), date(2026, 3, 14)))


def test_scan_december_ranks_the_window_that_reproduces_the_seeded_row_first():
    data = synthetic_season(4000)
    target = fit_params.Window(date(2025, 12, 3), date(2025, 12, 16))
    seeded = fit_params.fit_season(data, PRIOR, target).params

    scanned = fit_params.scan_december(data, PRIOR, seeded, 2025)

    assert scanned[0].window == target
    assert scanned[0].error == 0
    refits = [row.fit.refit_spread for row in scanned]
    assert False in refits
    assert refits == sorted(refits, reverse=True)


def seasons_row(season: int, params: epa.EpaParams) -> dict:
    return {
        "season": season, "game_name": "G",
        "mean": params.total.mean, "a": params.total.a, "p": params.total.p,
        "mean_auto": params.auto.mean, "a_auto": params.auto.a, "p_auto": params.auto.p,
    }


def cli(client: FakeClient, data: epa.SeasonMatches, *args: str) -> int:
    return fit_params.main(["--season", "2025", *args], store=store.SupabaseStore(client), fetch=lambda _: data)


@pytest.fixture
def seeded_client() -> FakeClient:
    return FakeClient(seasons=[seasons_row(2024, PRIOR), seasons_row(2025, PRIOR)])


def test_cli_without_write_prints_the_counts_and_values_and_leaves_the_row_alone(seeded_client, capsys):
    before = [dict(r) for r in seeded_client.seasons]

    code = cli(seeded_client, synthetic_season(1500))

    out = capsys.readouterr().out
    assert code == 0
    assert seeded_client.seasons == before
    assert "rated matches 1500" in out
    assert "kept season 2024's a and p" in out
    assert "dry run" in out


def test_cli_write_twice_leaves_the_same_row_as_writing_once(seeded_client):
    data = synthetic_season(4000)

    assert cli(seeded_client, data, "--write") == 0
    once = dict(seeded_client.seasons[1])
    assert cli(seeded_client, data, "--write") == 0

    fit = fit_params.fit_season(data, PRIOR)
    assert seeded_client.seasons[1] == once == seasons_row(2025, fit.params)
    assert seeded_client.seasons[0] == seasons_row(2024, PRIOR)


def test_cli_exits_1_and_writes_nothing_for_a_window_with_no_matches(seeded_client, capsys):
    before = [dict(r) for r in seeded_client.seasons]

    code = cli(seeded_client, synthetic_season(100), "--from", "2026-03-01", "--to", "2026-03-14", "--write")

    assert code == 1
    assert seeded_client.seasons == before
    assert "no rated matches" in capsys.readouterr().err


def test_cli_write_for_a_season_without_a_row_exits_2_naming_it(capsys):
    client = FakeClient(seasons=[seasons_row(2024, PRIOR)])

    code = cli(client, synthetic_season(100), "--write")

    assert code == 2
    assert client.seasons == [seasons_row(2024, PRIOR)]
    assert "season 2025" in capsys.readouterr().err


def test_cli_scan_december_prints_the_best_window_and_its_largest_error(seeded_client, capsys):
    code = cli(seeded_client, synthetic_season(3000), "--scan-december")

    out = capsys.readouterr().out
    assert code == 0
    assert "best window 2025-12-" in out
    assert "relative errors mean=" in out
