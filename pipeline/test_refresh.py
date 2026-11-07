from __future__ import annotations

import json
from functools import partial
from typing import Sequence

import httpx
import pytest
from postgrest.exceptions import APIError

import epa
import ftcscout
import refresh
import store
from conftest import FakeClient, FakePost, read_seasons


class RecordingStore:
    def __init__(self, last: store.Run | None = None) -> None:
        self.writes: list[tuple[int, Sequence[epa.TeamRow]]] = []
        self.last = last
        self.recorded: list[tuple[int, int, int]] = []

    def last_run(self, season: int, kind: store.RunKind = "refresh") -> store.Run | None:
        return self.last

    def record_run(self, season: int, matches: int, events: int, kind: store.RunKind = "refresh") -> None:
        self.recorded.append((season, matches, events))

    def season(self, number: int) -> epa.Season:
        return read_seasons(number)

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
        ("SUPABASE_URL", "https://x.supabase.co:99999", KEY),
        ("SUPABASE_URL", "http://127.0.0.1:abc/ok", KEY),
        ("SUPABASE_URL", "http://[::1/ok", KEY),
    ],
)
def test_a_malformed_credential_exits_2_naming_it_without_echoing_the_key_or_calling_out(name, url, key, capsys, no_network):
    code = refresh.main(["run", "--season", "2025"], env={"SUPABASE_URL": url, "SUPABASE_SECRET_KEY": key})

    out = capsys.readouterr()
    assert code == 2
    assert name in out.err
    assert KEY not in out.out + out.err
    assert no_network == []


def test_a_season_missing_from_the_seasons_table_exits_2_naming_it_and_fetches_nothing(capsys):
    def fetch_must_not_run(season: epa.Season) -> epa.SeasonMatches:
        raise AssertionError("fetched")

    sink = store.SupabaseStore(FakeClient(seasons=[]))

    code = refresh.main(["run", "--season", "2019"], fetch=fetch_must_not_run, store=sink)

    assert code == 2
    assert "season 2019 has no parameters" in capsys.readouterr().err


def test_a_failed_season_read_exits_1_with_one_error_line_and_fetches_nothing(capsys):
    def fetch_must_not_run(season: epa.Season) -> epa.SeasonMatches:
        raise AssertionError("fetched")

    denied = APIError({"message": "permission denied for table seasons", "code": "42501"})
    sink = store.SupabaseStore(FakeClient([denied]))

    code = refresh.main(["run", "--season", "2025"], fetch=fetch_must_not_run, store=sink)

    assert code == 1
    assert capsys.readouterr().err.splitlines() == ["error: could not read season 2025 from the seasons table: " + str(denied)]


def test_a_failed_write_exits_1(raw_events, capsys):
    class FailingStore(RecordingStore):
        def write_ratings(self, season, rows):
            raise store.WriteFailed("batch 1/1 failed on attempt 3: boom")

    code = refresh.main(["run", "--season", "2025"], fetch=fetch_from(FakePost(raw_events)), store=FailingStore())

    assert code == 1
    assert "boom" in capsys.readouterr().err


def test_dry_run_reads_parameters_through_the_store_and_writes_the_rows_to_the_given_path(raw_events, tmp_path, capsys):
    path = tmp_path / "rows.json"
    sink = store.DryRunStore(path, read_seasons)

    code = refresh.main(["run", "--season", "2025", "--dry-run", str(path)], fetch=fetch_from(FakePost(raw_events)), store=sink)

    assert code == 0
    assert capsys.readouterr().out.splitlines()[-1].startswith("refreshed season=2025 teams=14")
    rows = json.loads(path.read_text())
    assert len(rows) == 14
    assert {"rank_epa", "rank_auto_epa", "rank_teleop_epa", "current_epa"} <= set(rows[0])


def test_dry_run_reads_the_parameters_from_supabase_not_from_a_constant(raw_events, tmp_path, monkeypatch):
    params_2025 = {"season": 2025, "mean": 50.0, "a": 2.0, "p": 0.6, "mean_auto": 10.0, "a_auto": 2.0, "p_auto": 0.5}
    client = FakeClient(seasons=[params_2025])
    monkeypatch.setattr(store.SupabaseStore, "from_env", classmethod(lambda cls, env: cls(client)))
    path = tmp_path / "rows.json"

    code = refresh.main(["run", "--season", "2025", "--dry-run", str(path)], env={}, fetch=fetch_from(FakePost(raw_events)))

    assert code == 0
    assert client.selects == [("seasons", {"season": 2025}), ("refresh_runs", {"season": 2025, "kind": "refresh"})]
    assert client.upserts == []
    assert len(json.loads(path.read_text())) == 14


def test_dry_run_needs_the_supabase_variables_because_it_reads_the_parameters(capsys, no_network):
    code = refresh.main(["run", "--season", "2025", "--dry-run"], env={})

    assert code == 2
    assert "SUPABASE_URL, SUPABASE_SECRET_KEY" in capsys.readouterr().err
    assert no_network == []


def test_an_unexpected_store_error_exits_1_without_printing_the_key(capsys):
    class LeakyStore(RecordingStore):
        def season(self, number):
            raise RuntimeError(f"upstream said: Authorization: Bearer {KEY}")

    code = refresh.main(["run", "--season", "2025"], env={"SUPABASE_SECRET_KEY": KEY}, store=LeakyStore())

    err = capsys.readouterr().err
    assert code == 1
    assert "RuntimeError" in err
    assert "Bearer ***" in err
    assert KEY not in err


def test_an_html_page_on_a_200_seasons_read_exits_1_with_one_line(capsys):
    transport = httpx.MockTransport(lambda request: httpx.Response(200, text="<html>portal</html>", headers={"content-type": "text/html"}))
    sink = store.SupabaseStore.from_env({"SUPABASE_URL": URL, "SUPABASE_SECRET_KEY": KEY}, transport=transport)

    code = refresh.main(["run", "--season", "2025"], env={"SUPABASE_SECRET_KEY": KEY}, store=sink)

    assert code == 1
    assert capsys.readouterr().err.splitlines() == ["error: could not read season 2025 from the seasons table: expected a JSON array, got str"]


def run_of(matches: int) -> store.Run:
    return store.Run(matches, 2, "2026-11-06T09:00:00+00:00")


def test_a_clean_run_records_its_season_matches_and_events(raw_events):
    sink = RecordingStore(last=run_of(21))

    code = refresh.main(["run", "--season", "2025"], fetch=fetch_from(FakePost(raw_events)), store=sink)

    assert code == 0
    assert sink.recorded == [(2025, 21, 2)]


def test_a_run_that_rates_fewer_matches_than_the_last_one_exits_1_and_writes_nothing(raw_events, capsys):
    sink = RecordingStore(last=run_of(22))

    code = refresh.main(["run", "--season", "2025"], fetch=fetch_from(FakePost(raw_events)), store=sink)

    assert code == 1
    assert sink.writes == []
    assert sink.recorded == []
    err = capsys.readouterr().err
    assert "rated 21 matches, fewer than the 22" in err
    assert "refresh_runs" in err


def test_a_failed_write_records_no_run(raw_events):
    class FailingStore(RecordingStore):
        def write_ratings(self, season, rows):
            raise store.WriteFailed("boom")

    sink = FailingStore()

    assert refresh.main(["run", "--season", "2025"], fetch=fetch_from(FakePost(raw_events)), store=sink) == 1
    assert sink.recorded == []


def test_supabase_store_reads_the_latest_run_and_records_a_new_one():
    client = FakeClient(runs=[
        {"season": 2025, "kind": "refresh", "matches": 10, "events": 1, "finished_at": "2026-11-05T00:00:00+00:00"},
        {"season": 2025, "kind": "refresh", "matches": 21, "events": 2, "finished_at": "2026-11-06T00:00:00+00:00"},
        {"season": 2025, "kind": "refit", "matches": 77, "events": 2, "finished_at": "2026-11-07T00:00:00+00:00"},
        {"season": 2024, "kind": "refresh", "matches": 99, "events": 9, "finished_at": "2026-11-07T00:00:00+00:00"},
    ])
    sut = store.SupabaseStore(client)

    assert sut.last_run(2025) == store.Run(21, 2, "2026-11-06T00:00:00+00:00")
    assert sut.last_run(2023) is None
    sut.record_run(2025, 30, 3)
    assert client.inserts == [("refresh_runs", {"season": 2025, "kind": "refresh", "matches": 30, "events": 3})]


def test_dry_run_reads_the_last_run_but_records_nothing(raw_events, tmp_path):
    sut = store.DryRunStore(tmp_path / "rows.json", read_seasons, lambda season, kind: run_of(99))

    code = refresh.main(["run", "--season", "2025"], fetch=fetch_from(FakePost(raw_events)), store=sut)

    assert code == 1
    assert not (tmp_path / "rows.json").exists()
