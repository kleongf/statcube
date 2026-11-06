from __future__ import annotations

import json
import socket
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Mapping

import pytest

import ftcscout
import store
from epa import EpaParams, RatingParams, Season

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="session")
def raw_events() -> dict[str, list[dict[str, Any]]]:
    return json.loads((FIXTURES / "matches_2025.json").read_text())["events"]


class FakePost:

    def __init__(self, events: Mapping[str, list[dict[str, Any]]], failures: Mapping[str, int] | None = None) -> None:
        self.events = events
        self.failures = dict(failures or {})
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def __call__(self, query: str, variables: Mapping[str, Any]) -> Mapping[str, Any]:
        self.calls.append((query, dict(variables)))
        if "eventsSearch" in query:
            return {"eventsSearch": [{"code": code} for code in self.events]}
        code = variables["eventByCodeCode"]
        if self.failures.get(code, 0) > 0:
            self.failures[code] -= 1
            raise ftcscout.GraphQLFailure("HTTP 502")
        return {"eventByCode": {"matches": self.events[code]}}

    def requests_for(self, code: str) -> int:
        return sum(1 for _, v in self.calls if v.get("eventByCodeCode") == code)


@pytest.fixture
def no_network(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    attempts: list[str] = []

    def refuse(*args: Any, **kwargs: Any) -> Any:
        attempts.append(repr(args[:2]))
        raise OSError("network disabled by the test")

    monkeypatch.setattr(socket, "getaddrinfo", refuse)
    monkeypatch.setattr(socket.socket, "connect", refuse)
    return attempts


SEASON_2025 = Season(2025, EpaParams(RatingParams(113.30 / 2, 2.1482, 0.6543), RatingParams(25.33 / 2, 2.4555, 0.5535)))


def read_seasons(number: int) -> Season:
    if number != SEASON_2025.number:
        raise store.UnknownSeason(number)
    return SEASON_2025


class FakeClient:
    def __init__(self, errors: list[Exception] | None = None, seasons: list[dict] | None = None) -> None:
        self.errors = list(errors or [])
        self.seasons = list(seasons or [])
        self.upserts: list[tuple[str, list[dict], dict]] = []
        self.selects: list[tuple[str, dict]] = []
        self._table = ""
        self._pending: tuple[list[dict], dict] = ([], {})
        self._filters: dict[str, Any] = {}
        self._selecting = False
        self._columns: list[str] = []

    def table(self, name: str) -> FakeClient:
        self._table = name
        self._filters = {}
        self._selecting = False
        return self

    def upsert(self, records: list[dict], **kwargs) -> FakeClient:
        self._pending = (records, kwargs)
        return self

    def select(self, columns: str) -> FakeClient:
        self._selecting = True
        self._columns = [c.strip() for c in columns.split(",")]
        return self

    def eq(self, column: str, value: Any) -> FakeClient:
        self._filters[column] = value
        return self

    def execute(self) -> Any:
        if self.errors:
            raise self.errors.pop(0)
        if self._selecting:
            self.selects.append((self._table, dict(self._filters)))
            matching = [r for r in self.seasons if all(r[k] == v for k, v in self._filters.items())]
            rows = [{c: r[c] for c in self._columns} for r in matching]
            return SimpleNamespace(data=rows)
        self.upserts.append((self._table, *self._pending))
        return None
