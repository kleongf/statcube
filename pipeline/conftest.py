from __future__ import annotations

import json
import socket
from pathlib import Path
from typing import Any, Mapping

import pytest

import ftcscout

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
