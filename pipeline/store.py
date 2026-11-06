from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path
from typing import Any, Callable, Mapping, Protocol, Sequence

import httpx
from supabase import ClientOptions, create_client

from epa import EpaParams, RatingParams, Season, TeamRow

logger = logging.getLogger(__name__)

REQUIRED_ENV = ("SUPABASE_URL", "SUPABASE_SECRET_KEY")
BATCH_ROWS = 500
ATTEMPTS = 3
REQUEST_TIMEOUT_S = 120
PRINTABLE_ASCII = re.compile(r"[!-~]+")

BUILTIN_SEASONS: Mapping[int, EpaParams] = {
    2025: EpaParams(RatingParams(113.30 / 2, 2.1482, 0.6543), RatingParams(25.33 / 2, 2.4555, 0.5535)),
    2024: EpaParams(RatingParams(86.08 / 2, 3.5888, 0.5686), RatingParams(13.37 / 2, 2.2793, 0.6143)),
    2023: EpaParams(RatingParams(72.08 / 2, 3.4415, 0.5729), RatingParams(21.38 / 2, 4.1423, 0.4741)),
    2022: EpaParams(RatingParams(60.25 / 2, 5.0015, 0.4623), RatingParams(19.70 / 2, 5.0384, 0.3443)),
}


class MissingEnv(Exception):
    def __init__(self, names: Sequence[str]) -> None:
        self.names = tuple(names)
        super().__init__(f"missing environment variable(s): {', '.join(self.names)}")


class InvalidEnv(Exception):
    pass


class ServerError(Exception):
    """A 5xx reply. Raised from the HTTP layer because postgrest-py drops the status when the body is JSON."""


class UnknownSeason(Exception):
    def __init__(self, season: int) -> None:
        super().__init__(f"season {season} has no parameters")


class WriteFailed(Exception):
    pass


class Store(Protocol):
    def season(self, number: int) -> Season: ...

    def write_ratings(self, season: int, rows: Sequence[TeamRow]) -> None: ...


def builtin_season(number: int) -> Season:
    params = BUILTIN_SEASONS.get(number)
    if params is None:
        raise UnknownSeason(number)
    return Season(number, params)


def to_record(row: TeamRow) -> dict[str, Any]:
    return {
        "team_number": row.team_number,
        "team_name": row.team_name,
        "epa": {p.posted_key: p.epa for p in row.history},
        "auto_epa": {p.posted_key: p.auto_epa for p in row.history},
        "teleop_epa": {p.posted_key: p.teleop_epa for p in row.history},
        "current_epa": row.current.epa,
        "current_auto_epa": row.current.auto_epa,
        "current_teleop_epa": row.current.teleop_epa,
        "rank_epa": row.ranks.epa,
        "rank_auto_epa": row.ranks.auto_epa,
        "rank_teleop_epa": row.ranks.teleop_epa,
    }


def redact(text: str, secret: str) -> str:
    secret = secret.strip()
    return text.replace(secret, "***") if secret else text


def _parse_env(env: Mapping[str, str]) -> tuple[str, str]:
    missing = [name for name in REQUIRED_ENV if not env.get(name)]
    if missing:
        raise MissingEnv(missing)
    for name in REQUIRED_ENV:
        if not PRINTABLE_ASCII.fullmatch(env[name]):
            raise InvalidEnv(
                f"{name} has spaces, line breaks, or non-ASCII characters. "
                "Copy it again exactly; for the key, `supabase projects api-keys --reveal` prints it unmasked."
            )
    if not env["SUPABASE_URL"].startswith(("http://", "https://")):
        raise InvalidEnv("SUPABASE_URL must start with http:// or https://")
    return env["SUPABASE_URL"], env["SUPABASE_SECRET_KEY"]


def _raise_server_error(response: httpx.Response) -> None:
    if response.is_server_error:
        response.read()
        raise ServerError(f"HTTP {response.status_code}: {response.text}")


def _is_retryable(exc: Exception) -> bool:
    return isinstance(exc, (httpx.TransportError, ServerError))


class SupabaseStore:
    def __init__(self, client: Any, *, secret: str = "", sleep: Callable[[float], None] = time.sleep) -> None:
        self._client = client
        self._secret = secret
        self._sleep = sleep

    @classmethod
    def from_env(
        cls,
        env: Mapping[str, str],
        *,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> SupabaseStore:
        url, secret = _parse_env(env)
        http_client = httpx.Client(
            http2=False, timeout=REQUEST_TIMEOUT_S, transport=transport, event_hooks={"response": [_raise_server_error]},
        )
        client = create_client(url, secret, options=ClientOptions(httpx_client=http_client))
        return cls(client, secret=secret, sleep=sleep)

    def season(self, number: int) -> Season:
        return builtin_season(number)

    def write_ratings(self, season: int, rows: Sequence[TeamRow]) -> None:
        ordered = sorted(rows, key=lambda r: r.team_number)
        batches = [ordered[i:i + BATCH_ROWS] for i in range(0, len(ordered), BATCH_ROWS)]
        for number, batch in enumerate(batches, start=1):
            records = [to_record(r) for r in batch]
            label = f"batch {number}/{len(batches)} (teams {batch[0].team_number}..{batch[-1].team_number})"
            started = time.monotonic()
            for attempt in range(1, ATTEMPTS + 1):
                try:
                    self._client.table(f"epa_{season}").upsert(records, on_conflict="team_number").execute()
                    break
                except Exception as exc:
                    reason = redact(str(exc), self._secret)
                    if attempt == ATTEMPTS or not _is_retryable(exc):
                        raise WriteFailed(f"{label} failed on attempt {attempt}: {reason}") from exc
                    logger.warning("%s attempt %d failed (%s), retrying", label, attempt, reason)
                    self._sleep(2 ** (attempt - 1))
            logger.info("%s written in %.1fs", label, time.monotonic() - started)


class DryRunStore:

    def __init__(self, path: Path, read: Callable[[int], Season] = builtin_season) -> None:
        self._path = path
        self._read = read

    def season(self, number: int) -> Season:
        return self._read(number)

    def write_ratings(self, season: int, rows: Sequence[TeamRow]) -> None:
        records = [to_record(r) for r in sorted(rows, key=lambda r: r.team_number)]
        self._path.write_text(json.dumps(records))
