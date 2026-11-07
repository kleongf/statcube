from __future__ import annotations

import math
import random
from datetime import date, datetime, timedelta, timezone
from statistics import fmean, pstdev

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


def z_spread_by_bin(data: epa.SeasonMatches, params: epa.EpaParams, side: str) -> dict[int, tuple[int, float]]:
    spread: epa.RatingParams = getattr(params, side)
    zs: dict[int, list[float]] = {}

    def observe(m: epa.Match, red: epa.Prediction, blue: epa.Prediction) -> None:
        for predicted, alliance in ((getattr(red, side), m.red), (getattr(blue, side), m.blue)):
            rating = epa.model_rating(predicted)
            z = (getattr(alliance, side) - predicted) / (spread.a * rating ** spread.p)
            zs.setdefault(math.floor(math.log(rating) / fit_params.LOG_BIN_WIDTH), []).append(z)

    epa.rate_season(data, params, observe)
    return {k: (len(v), pstdev(v)) for k, v in zs.items()}


@pytest.fixture(scope="module")
def season_4000() -> epa.SeasonMatches:
    return synthetic_season(4000)


@pytest.fixture(scope="module")
def fit_4000(season_4000) -> fit_params.Fit:
    return fit_params.fit_season(season_4000, PRIOR)


def test_fit_spread_recovers_a_and_p_from_scores_drawn_with_a_known_spread():
    rng = random.Random(7)
    pairs = []
    for _ in range(160_000):
        predicted = rng.uniform(20, 300)
        pairs.append((predicted, rng.gauss(predicted, 2.0 * predicted ** 0.6)))

    fitted = fit_params.fit_spread(fit_params.full_bins(fit_params.bin_residuals(pairs)), mean=50)

    assert fitted.a == pytest.approx(2.0, rel=0.03)
    assert fitted.p == pytest.approx(0.6, rel=0.03)


def test_fit_spread_weights_each_bin_by_its_alliance_count():
    on_curve = [fit_params.Bin(i, math.exp(3 + i / 10), 1000, 2.0 * math.exp(3 + i / 10) ** 0.6) for i in range(6)]
    sparse_outliers = [fit_params.Bin(6 + i, math.exp(3.6 + i / 10), 50, 3.0 * math.exp(3.6 + i / 10) ** 0.6) for i in range(2)]

    fitted = fit_params.fit_spread(on_curve + sparse_outliers, mean=50)

    assert fitted.p == pytest.approx(0.6, abs=0.15)


def test_a_prediction_below_1_bins_at_rating_1_with_its_residual_measured_from_the_prediction():
    bins = fit_params.bin_residuals([(0.2, 0.2), (0.8, 0.8)])

    assert [b.rating for b in bins] == [1.0, 1.0]
    assert [b.std for b in bins] == [0.0, 0.0]


def test_ratings_moving_across_a_bin_edge_move_the_bin_counts_only_slightly():
    before = {b.index: b.alliances for b in fit_params.bin_residuals([(math.exp(3.099), 1.0)] * 100)}
    after = {b.index: b.alliances for b in fit_params.bin_residuals([(math.exp(3.101), 1.0)] * 100)}

    assert before.keys() == after.keys()
    for index in before:
        assert after[index] == pytest.approx(before[index], abs=3)


def test_a_season_whose_bins_pass_the_gate_refits_a_and_p_however_few_matches_it_has():
    fit = fit_params.fit_season(synthetic_season(1500), PRIOR)

    assert fit.matches == 1500
    assert fit.outcome is fit_params.Outcome.CONVERGED
    assert (fit.params.total.a, fit.params.total.p) != (PRIOR.total.a, PRIOR.total.p)


def test_too_few_full_rating_bins_keeps_the_prior_a_and_p_and_refits_only_the_means():
    data = synthetic_season(2500, a=0.3, strength=(30, 32))

    fit = fit_params.fit_season(data, PRIOR)

    mean, mean_auto = half_mean_alliance_score(data, fit_params.Window())
    assert len(fit_params.full_bins(fit.total_bins)) < fit_params.MIN_BINS
    assert fit.outcome is fit_params.Outcome.KEPT_PRIOR_SPREAD
    assert fit.params == epa.EpaParams(
        epa.RatingParams(round(mean, 4), PRIOR.total.a, PRIOR.total.p),
        epa.RatingParams(round(mean_auto, 4), PRIOR.auto.a, PRIOR.auto.p),
    )


def test_the_fit_converges_to_a_fixed_point_that_refitting_does_not_move(season_4000, fit_4000):
    again = fit_params.fit_season(season_4000, fit_4000.params)

    assert fit_4000.outcome is fit_params.Outcome.CONVERGED
    assert fit_4000.move <= 0.001
    assert again.outcome is fit_params.Outcome.CONVERGED
    assert again.rounds == 1
    for first, second in ((fit_4000.params.total, again.params.total), (fit_4000.params.auto, again.params.auto)):
        assert second.a == pytest.approx(first.a, rel=0.001)
        assert second.p == pytest.approx(first.p, rel=0.001)


@pytest.mark.parametrize("side", ["total", "auto"])
def test_the_fitted_spread_matches_the_spread_of_the_residuals_in_every_well_filled_bin(season_4000, fit_4000, side):
    spreads = z_spread_by_bin(season_4000, fit_4000.params, side)

    well_filled = {k: sd for k, (n, sd) in spreads.items() if n >= 300}
    assert len(well_filled) >= 6
    assert all(sd == pytest.approx(1, abs=0.06) for sd in well_filled.values()), well_filled


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


def fit_with(**changes: float) -> fit_params.Fit:
    total = {"mean": 50.0, "a": 2.0, "p": 0.6} | {k: v for k, v in changes.items() if not k.endswith("_auto")}
    auto = {"mean": 10.0, "a": 2.0, "p": 0.6} | {k.removesuffix("_auto"): v for k, v in changes.items() if k.endswith("_auto")}
    params = epa.EpaParams(epa.RatingParams(**total), epa.RatingParams(**auto))
    return fit_params.Fit(params, 3000, (), (), fit_params.Outcome.CONVERGED, rounds=3, move=0.0)


@pytest.mark.parametrize("changes", [
    {"a": 0.0}, {"a_auto": -1.0}, {"p": 0.0}, {"p_auto": 1.5}, {"p": 2.0},
    {"mean": math.nan}, {"a_auto": math.inf}, {"mean_auto": 0.0},
])
def test_refusal_rejects_values_the_rating_model_cannot_use(changes):
    assert fit_params.refusal(fit_with(**changes)) is not None


def test_refusal_accepts_a_converged_fit_with_sane_values(fit_4000):
    assert fit_params.refusal(fit_with()) is None
    assert fit_params.refusal(fit_4000) is None


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

    code = cli(seeded_client, synthetic_season(2500, a=0.3, strength=(30, 32)))

    out = capsys.readouterr().out
    assert code == 0
    assert seeded_client.seasons == before
    assert "rated matches 2500" in out
    assert "bins have >= 50 alliances" in out
    assert "kept season 2024's a and p" in out
    assert "dry run" in out


def test_cli_write_twice_leaves_the_same_rounded_row_as_writing_once(seeded_client, season_4000, fit_4000):
    assert cli(seeded_client, season_4000, "--write") == 0
    once = dict(seeded_client.seasons[1])
    assert cli(seeded_client, season_4000, "--write") == 0

    assert seeded_client.seasons[1] == once == seasons_row(2025, fit_4000.params)
    assert seeded_client.seasons[0] == seasons_row(2024, PRIOR)
    written = [once[name] for name in fit_params.NAMES]
    assert written == [round(v, 4) for v in written]


def test_cli_write_refuses_a_fit_stopped_by_the_round_cap(seeded_client, season_4000, monkeypatch, capsys):
    before = [dict(r) for r in seeded_client.seasons]
    monkeypatch.setattr(fit_params, "MAX_ROUNDS", 1)

    code = cli(seeded_client, season_4000, "--write")

    assert code == 1
    assert seeded_client.seasons == before
    assert "round cap" in capsys.readouterr().err


def test_cli_write_refuses_values_the_rating_model_cannot_use(seeded_client, monkeypatch, capsys):
    before = [dict(r) for r in seeded_client.seasons]
    monkeypatch.setattr(fit_params, "fit_season", lambda *_: fit_with(p=2.0))

    code = cli(seeded_client, synthetic_season(100), "--write")

    assert code == 1
    assert seeded_client.seasons == before
    assert "refusing to write seasons row 2025" in capsys.readouterr().err


def test_cli_exits_1_and_writes_nothing_for_a_window_with_no_matches(seeded_client, capsys):
    before = [dict(r) for r in seeded_client.seasons]

    code = cli(seeded_client, synthetic_season(100), "--from", "2026-03-01", "--to", "2026-03-14", "--write")

    assert code == 1
    assert seeded_client.seasons == before
    assert "no rated matches" in capsys.readouterr().err


def test_cli_write_for_a_season_without_a_row_exits_2_before_fetching(capsys):
    client = FakeClient(seasons=[seasons_row(2024, PRIOR)])

    def fetch(_: epa.Season) -> epa.SeasonMatches:
        raise AssertionError("fetched a season that has no row to write")

    code = fit_params.main(["--season", "2025", "--write"], store=store.SupabaseStore(client), fetch=fetch)

    assert code == 2
    assert client.seasons == [seasons_row(2024, PRIOR)]
    assert "season 2025" in capsys.readouterr().err
