from __future__ import annotations

import json
from functools import partial
from typing import Sequence

import pytest

import epa
import ftcscout
import refresh
import store
from conftest import FakePost


class RecordingStore:
    def __init__(self) -> None:
        self.writes: list[tuple[int, Sequence[epa.TeamRow]]] = []

    def season(self, number: int) -> epa.Season:
        return store.builtin_season(number)

    def write_ratings(self, season: int, rows: Sequence[epa.TeamRow]) -> None:
        self.writes.append((season, rows))


def fetch_from(post: FakePost):
    return partial(ftcscout.fetch_season, post=post, retry_delay=0)


def test_one_event_failing_twice_exits_1_names_it_and_writes_nothing(raw_events, capsys):
    post = FakePost(raw_events, failures={"KZASSQ": 2})
    sink = RecordingStore()

    code = refresh.main(["run", "--season", "2025"], fetch=fetch_from(post), store=sink)

    assert code == 1
    assert sink.writes == []
    assert post.requests_for("KZASSQ") == 2
    assert "KZASSQ" in capsys.readouterr().err


def test_a_clean_run_writes_every_team_once_and_ends_with_the_summary_line(raw_events, capsys):
    sink = RecordingStore()

    code = refresh.main(["run", "--season", "2025"], fetch=fetch_from(FakePost(raw_events)), store=sink)

    assert code == 0
    assert capsys.readouterr().out.splitlines()[-1] == "refreshed season=2025 teams=14 matches=21 events=2"
    [(season, rows)] = sink.writes
    assert season == 2025
    assert len(rows) == 14


def test_a_transient_failure_that_clears_on_retry_still_succeeds(raw_events):
    sink = RecordingStore()

    code = refresh.main(["run", "--season", "2025"], fetch=fetch_from(FakePost(raw_events, failures={"KZKAQ": 1})), store=sink)

    assert code == 0
    assert len(sink.writes) == 1


def test_missing_credentials_exit_2_naming_them_before_any_network_call(capsys, no_network):
    code = refresh.main(["run", "--season", "2025"], env={})

    assert code == 2
    assert "SUPABASE_URL, SUPABASE_SECRET_KEY" in capsys.readouterr().err
    assert no_network == []


KEY = "sb_secret_CANARY0123456789"
URL = "https://example.supabase.co"


@pytest.mark.parametrize(
    ("name", "url", "key"),
    [
        ("SUPABASE_SECRET_KEY", URL, "sb_secret_\u2022\u2022\u2022"),
        ("SUPABASE_SECRET_KEY", URL, KEY + "\n"),
        ("SUPABASE_SECRET_KEY", URL, KEY + "\r\n"),
        ("SUPABASE_SECRET_KEY", URL, " " + KEY),
        ("SUPABASE_URL", "example.supabase.co", KEY),
        ("SUPABASE_URL", URL + "\n", KEY),
    ],
)
def test_a_malformed_credential_exits_2_naming_it_without_echoing_the_key_or_calling_out(name, url, key, capsys, no_network):
    code = refresh.main(["run", "--season", "2025"], env={"SUPABASE_URL": url, "SUPABASE_SECRET_KEY": key})

    out = capsys.readouterr()
    assert code == 2
    assert name in out.err
    assert KEY not in out.out + out.err
    assert no_network == []


def test_a_season_without_parameters_exits_2_naming_it_and_fetches_nothing(capsys):
    def fetch_must_not_run(season: epa.Season) -> epa.SeasonMatches:
        raise AssertionError("fetched")

    code = refresh.main(["run", "--season", "2026"], fetch=fetch_must_not_run, store=RecordingStore())

    assert code == 2
    assert "season 2026 has no parameters" in capsys.readouterr().err


def test_a_season_without_parameters_exits_2_with_credentials_set(capsys, no_network):
    env = {"SUPABASE_URL": "https://example.supabase.co", "SUPABASE_SECRET_KEY": "placeholder-key"}

    code = refresh.main(["run", "--season", "2026"], env=env)

    assert code == 2
    assert "season 2026 has no parameters" in capsys.readouterr().err
    assert no_network == []


def test_a_failed_write_exits_1(raw_events, capsys):
    class FailingStore(RecordingStore):
        def write_ratings(self, season, rows):
            raise store.WriteFailed("batch 1/1 failed on attempt 3: boom")

    code = refresh.main(["run", "--season", "2025"], fetch=fetch_from(FakePost(raw_events)), store=FailingStore())

    assert code == 1
    assert "boom" in capsys.readouterr().err


def test_dry_run_needs_no_credentials_and_writes_the_rows_to_the_given_path(raw_events, tmp_path, capsys):
    path = tmp_path / "rows.json"

    code = refresh.main(["run", "--season", "2025", "--dry-run", str(path)], env={}, fetch=fetch_from(FakePost(raw_events)))

    assert code == 0
    assert capsys.readouterr().out.splitlines()[-1].startswith("refreshed season=2025 teams=14")
    rows = json.loads(path.read_text())
    assert len(rows) == 14
    assert {"rank_epa", "rank_auto_epa", "rank_teleop_epa", "current_epa"} <= set(rows[0])
