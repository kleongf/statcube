from __future__ import annotations

import json

import httpx
import pytest
from postgrest.exceptions import APIError

import epa
import store


def team_row(number: int) -> epa.TeamRow:
    history = (epa.Point("2025-12-01T10:00:00.000Z", 40.5, 10.25, 30.25), epa.Point("2025-12-01T11:00:00.000Z", 44.0, 11.0, 33.0))
    return epa.TeamRow(number, f"Team {number}", history, epa.Ranks(7, 8, 9))


class FakeClient:
    """Records upserts. `errors` are raised, in order, by successive execute() calls."""

    def __init__(self, errors: list[Exception] | None = None) -> None:
        self.errors = list(errors or [])
        self.upserts: list[tuple[str, list[dict], dict]] = []
        self._table = ""
        self._pending: tuple[list[dict], dict] = ([], {})

    def table(self, name: str) -> FakeClient:
        self._table = name
        return self

    def upsert(self, records: list[dict], **kwargs) -> FakeClient:
        self._pending = (records, kwargs)
        return self

    def execute(self) -> None:
        if self.errors:
            raise self.errors.pop(0)
        self.upserts.append((self._table, *self._pending))


def make_store(client: FakeClient) -> tuple[store.SupabaseStore, list[float]]:
    sleeps: list[float] = []
    return store.SupabaseStore(client, sleep=sleeps.append), sleeps


def test_record_carries_history_maps_current_values_and_ranks():
    record = store.to_record(team_row(11115))

    assert record == {
        "team_number": 11115,
        "team_name": "Team 11115",
        "epa": {"2025-12-01T10:00:00.000Z": 40.5, "2025-12-01T11:00:00.000Z": 44.0},
        "auto_epa": {"2025-12-01T10:00:00.000Z": 10.25, "2025-12-01T11:00:00.000Z": 11.0},
        "teleop_epa": {"2025-12-01T10:00:00.000Z": 30.25, "2025-12-01T11:00:00.000Z": 33.0},
        "current_epa": 44.0,
        "current_auto_epa": 11.0,
        "current_teleop_epa": 33.0,
        "rank_epa": 7,
        "rank_auto_epa": 8,
        "rank_teleop_epa": 9,
    }


def test_builtin_seasons_cover_2022_to_2025_and_nothing_else():
    assert [builtin for builtin in range(2021, 2028) if builtin in store.BUILTIN_SEASONS] == [2022, 2023, 2024, 2025]
    with pytest.raises(store.UnknownSeason, match="2026"):
        store.builtin_season(2026)


def test_write_ratings_upserts_in_batches_of_500_in_team_order():
    client = FakeClient()
    sut, _ = make_store(client)
    rows = [team_row(n) for n in range(1200, 0, -1)]

    sut.write_ratings(2025, rows)

    assert [(table, len(records)) for table, records, _ in client.upserts] == [("epa_2025", 500), ("epa_2025", 500), ("epa_2025", 200)]
    sent = [r["team_number"] for _, records, _ in client.upserts for r in records]
    assert sent == list(range(1, 1201))
    assert all(kwargs == {"on_conflict": "team_number"} for _, _, kwargs in client.upserts)


def test_write_ratings_retries_a_transport_error_with_backoff_and_rewrites_the_same_batch():
    client = FakeClient([httpx.ReadError("ssl"), httpx.ConnectError("reset")])
    sut, sleeps = make_store(client)

    sut.write_ratings(2024, [team_row(1)])

    assert [r["team_number"] for _, records, _ in client.upserts for r in records] == [1]
    assert sleeps == [1, 2]


def test_write_ratings_raises_write_failed_after_three_attempts():
    client = FakeClient([httpx.ReadError("a"), httpx.ReadError("b"), httpx.ReadError("c")])
    sut, sleeps = make_store(client)

    with pytest.raises(store.WriteFailed, match=r"batch 1/1 \(teams 1\.\.1\) failed on attempt 3"):
        sut.write_ratings(2025, [team_row(1)])

    assert client.upserts == []
    assert sleeps == [1, 2]


def test_write_ratings_does_not_retry_a_client_error():
    rls = APIError({"message": "new row violates row-level security policy", "code": "42501"})
    client = FakeClient([rls])
    sut, sleeps = make_store(client)

    with pytest.raises(store.WriteFailed, match="row-level security"):
        sut.write_ratings(2025, [team_row(1)])

    assert sleeps == []


def test_write_ratings_retries_a_5xx_from_the_gateway():
    client = FakeClient([APIError({"message": "Bad Gateway", "code": "502"})])
    sut, sleeps = make_store(client)

    sut.write_ratings(2025, [team_row(1)])

    assert len(client.upserts) == 1
    assert sleeps == [1]


def test_from_env_names_every_missing_variable():
    with pytest.raises(store.MissingEnv) as caught:
        store.SupabaseStore.from_env({"SUPABASE_URL": ""})

    assert caught.value.names == ("SUPABASE_URL", "SUPABASE_SECRET_KEY")
    assert "SUPABASE_URL, SUPABASE_SECRET_KEY" in str(caught.value)


def test_from_env_builds_a_store_without_touching_the_network(no_network):
    env = {"SUPABASE_URL": "https://example.supabase.co", "SUPABASE_SECRET_KEY": "placeholder-key"}

    sut = store.SupabaseStore.from_env(env)

    assert isinstance(sut, store.SupabaseStore)
    assert no_network == []


def test_dry_run_store_writes_the_records_the_upsert_would_send(tmp_path):
    path = tmp_path / "rows.json"
    sut = store.DryRunStore(path)

    sut.write_ratings(2025, [team_row(2), team_row(1)])

    written = json.loads(path.read_text())
    assert [r["team_number"] for r in written] == [1, 2]
    assert written[0] == store.to_record(team_row(1))
