from __future__ import annotations

import copy

import pytest

import epa
import ftcscout
from conftest import FakePost

SEASON = epa.Season(2025, epa.EpaParams(epa.RatingParams(50, 2, 0.6), epa.RatingParams(10, 2, 0.6)))


def wire_match(red=(1, 2), blue=(3, 4), scores=((100, 20), (80, 10)), *, played=True, at="2025-12-01T10:00:00.000Z"):
    teams = [
        {"teamNumber": n, "onField": True, "alliance": colour, "team": {"name": f"Name {n}"}}
        for colour, side in (("Red", red), ("Blue", blue))
        for n in side
    ]
    return {
        "postResultTime": at if played else None,
        "hasBeenPlayed": played,
        "scores": {
            "red": {"totalPoints": scores[0][0], "autoPoints": scores[0][1]},
            "blue": {"totalPoints": scores[1][0], "autoPoints": scores[1][1]},
        } if scores else None,
        "teams": teams,
    }


def test_query_uses_the_score_fragment_for_the_requested_season():
    query = ftcscout.matches_query(epa.Season(2023, SEASON.params))

    assert "... on MatchScores2023" in query
    assert "MatchScores2025" not in query


def test_parse_event_keeps_a_played_match_with_its_raw_time_key():
    matches, names, skipped = ftcscout.parse_event("EV", [wire_match()])

    assert skipped == 0
    assert matches[0].event_code == "EV"
    assert matches[0].posted_key == "2025-12-01T10:00:00.000Z"
    assert matches[0].red == epa.Alliance((1, 2), 100, 20)
    assert matches[0].blue == epa.Alliance((3, 4), 80, 10)
    assert names == {1: "Name 1", 2: "Name 2", 3: "Name 3", 4: "Name 4"}


def test_parse_event_ignores_unplayed_matches_without_counting_them():
    matches, _, skipped = ftcscout.parse_event("EV", [wire_match(played=False)])

    assert (matches, skipped) == ([], 0)


@pytest.mark.parametrize(
    "bad",
    [
        wire_match(red=(1, 1)),
        wire_match(red=(1, 2), blue=(2, 3)),
        wire_match(scores=None),
        wire_match(scores=((100, None), (80, 10))),
    ],
    ids=["repeated team in one alliance", "team on both alliances", "no scores", "missing auto score"],
)
def test_parse_event_skips_and_counts_a_played_match_it_cannot_rate(bad):
    matches, _, skipped = ftcscout.parse_event("EV", [bad, wire_match()])

    assert len(matches) == 1
    assert skipped == 1


def test_parse_event_skips_a_match_with_a_third_team_on_the_field():
    crowded = wire_match()
    crowded["teams"].append({"teamNumber": 9, "onField": True, "alliance": "Red", "team": None})

    assert ftcscout.parse_event("EV", [crowded])[2] == 1


def test_parse_event_ignores_teams_that_are_not_on_the_field():
    benched = wire_match()
    benched["teams"].append({"teamNumber": 9, "onField": False, "alliance": "Red", "team": {"name": "Bench"}})

    matches, names, skipped = ftcscout.parse_event("EV", [benched])

    assert (len(matches), skipped) == (1, 0)
    assert 9 not in names


def test_fetch_season_merges_every_event_in_event_order(raw_events):
    post = FakePost(raw_events)

    data = ftcscout.fetch_season(SEASON, post=post, retry_delay=0)

    assert data.events == 2
    assert [m.event_code for m in data.matches] == ["KZKAQ"] * 20 + ["KZASSQ"] * 2
    assert len(post.calls) == 1 + 2


def test_fetch_season_retries_an_event_once_and_then_succeeds(raw_events):
    post = FakePost(raw_events, failures={"KZKAQ": 1})

    data = ftcscout.fetch_season(SEASON, post=post, retry_delay=0)

    assert len(data.matches) == 22
    assert post.requests_for("KZKAQ") == 2


def test_fetch_season_names_every_event_that_fails_twice(raw_events):
    events = {**raw_events, "ZZBAD": copy.deepcopy(raw_events["KZASSQ"]), "AABAD": []}
    post = FakePost(events, failures={"ZZBAD": 2, "AABAD": 5})

    with pytest.raises(ftcscout.FetchFailed) as caught:
        ftcscout.fetch_season(SEASON, post=post, retry_delay=0)

    assert set(caught.value.failures) == {"ZZBAD", "AABAD"}
    assert "AABAD" in str(caught.value) and "ZZBAD" in str(caught.value)
    assert post.requests_for("ZZBAD") == 2


def test_fetch_season_fails_when_the_event_list_cannot_be_fetched():
    def down(query, variables):
        raise ftcscout.GraphQLFailure("HTTP 503")

    with pytest.raises(ftcscout.FetchFailed, match="eventsSearch"):
        ftcscout.fetch_season(SEASON, post=down, retry_delay=0)
