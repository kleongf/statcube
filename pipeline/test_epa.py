from __future__ import annotations

import json
import random
from datetime import datetime, timezone
from pathlib import Path

import pytest

import epa
import ftcscout
from store import builtin_season

FIXTURES = Path(__file__).parent / "fixtures"
PARAMS = builtin_season(2025).params


def season_matches(raw_events) -> epa.SeasonMatches:
    matches, names, skipped = [], {}, 0
    for code, raw in raw_events.items():
        event_matches, event_names, event_skipped = ftcscout.parse_event(code, raw)
        matches += event_matches
        for number, name in event_names.items():
            names.setdefault(number, name)
        skipped += event_skipped
    return epa.SeasonMatches(tuple(matches), names, events=len(raw_events), skipped=skipped)


def alliance(a: int, b: int, total: int = 100, auto: int = 20) -> epa.Alliance:
    return epa.Alliance((a, b), total, auto)


def match(red: epa.Alliance, blue: epa.Alliance, minute: int = 0, event: str = "EV") -> epa.Match:
    at = datetime(2025, 12, 1, 10, minute, tzinfo=timezone.utc)
    return epa.Match(event, at, at.isoformat(), red, blue)


def test_replay_matches_reference_math_on_fixture(raw_events):
    expected = json.loads((FIXTURES / "epa_expected.json").read_text())
    data = season_matches(raw_events)

    rows = epa.rate_season(data, PARAMS)

    assert len(epa.order_matches(data.matches)) == expected["matches_rated"]
    assert {str(r.team_number) for r in rows} == set(expected["teams"])
    for row in rows:
        want = expected["teams"][str(row.team_number)]
        assert row.team_name == want["team_name"]
        assert row.current.epa == pytest.approx(want["current_epa"], abs=1e-4)
        assert row.current.auto_epa == pytest.approx(want["current_auto_epa"], abs=1e-4)
        assert row.current.teleop_epa == pytest.approx(want["current_teleop_epa"], abs=1e-4)
        for field in ("epa", "auto_epa", "teleop_epa"):
            history = {p.posted_key: getattr(p, field) for p in row.history}
            assert history == pytest.approx(want[field], abs=1e-4)


def test_ranks_are_one_plus_strictly_greater_rounded_value(raw_events):
    rows = epa.rate_season(season_matches(raw_events), PARAMS)

    for column in ("epa", "auto_epa", "teleop_epa"):
        values = {r.team_number: getattr(r.current, column) for r in rows}
        for r in rows:
            ahead = sum(1 for v in values.values() if v > values[r.team_number])
            assert getattr(r.ranks, column) == 1 + ahead


def test_teams_with_equal_ratings_share_a_rank_and_the_next_rank_skips():
    data = epa.SeasonMatches((match(alliance(1, 2, 150), alliance(3, 4, 60)),), {}, events=1, skipped=0)

    by_team = {r.team_number: r.ranks.epa for r in epa.rate_season(data, PARAMS)}

    assert by_team == {1: 1, 2: 1, 3: 3, 4: 3}


def test_result_is_independent_of_input_order(raw_events):
    data = season_matches(raw_events)
    baseline = epa.rate_season(data, PARAMS)
    for seed in range(5):
        shuffled = list(data.matches)
        random.Random(seed).shuffle(shuffled)
        again = epa.rate_season(epa.SeasonMatches(tuple(shuffled), data.names, data.events, data.skipped), PARAMS)
        assert again == baseline


def test_a_match_listed_under_two_events_is_rated_once_and_the_first_event_code_wins(raw_events):
    data = season_matches(raw_events)
    duplicates = [m for m in data.matches if m.posted_key == raw_events["KZKAQ"][2]["postResultTime"]]
    assert {m.event_code for m in duplicates} == {"KZKAQ", "KZASSQ"}

    kept = [m for m in epa.order_matches(data.matches) if m.dedupe_key == duplicates[0].dedupe_key]

    assert [m.event_code for m in kept] == ["KZASSQ"]


def test_same_second_matches_are_ordered_by_event_code_then_teams():
    at = datetime(2025, 12, 1, 10, 0, tzinfo=timezone.utc)
    late_event = epa.Match("ZZ", at, "k", alliance(1, 2), alliance(3, 4))
    early_event = epa.Match("AA", at, "k", alliance(5, 6), alliance(7, 8))
    same_event_b = epa.Match("AA", at, "k", alliance(9, 10), alliance(11, 12))

    ordered = epa.order_matches([late_event, same_event_b, early_event])

    assert ordered == [early_event, same_event_b, late_event]


@pytest.mark.parametrize(
    "n, expected",
    [(0, 40.0), (6, 40.0), (7, 40 - 20 / 6), (9, 30.0), (12, 20.0), (13, 20.0), (50, 20.0)],
)
def test_k_factor_schedule(n, expected):
    assert epa.calculate_k_factor(n, 40.0, 20.0) == pytest.approx(expected)
