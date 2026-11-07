from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Callable, Literal, Mapping, Protocol, Sequence

import httpx
from postgrest.exceptions import APIError
from supabase import ClientOptions, SupabaseException, create_client

from epa import EpaParams, RatingParams, Season, TeamRow

logger = logging.getLogger(__name__)

REQUIRED_ENV = ("SUPABASE_URL", "SUPABASE_SECRET_KEY")
BATCH_ROWS = 500
ATTEMPTS = 3
REQUEST_TIMEOUT_S = 120
PRINTABLE_ASCII = re.compile(r"[!-~]+")

IDEMPOTENT_READS = ("GET", "HEAD")
SEASON_COLUMNS = "season, mean, a, p, mean_auto, a_auto, p_auto, params_refit_until"
RUN_COLUMNS = "matches, events, finished_at"


class MissingEnv(Exception):
    def __init__(self, names: Sequence[str]) -> None:
        self.names = tuple(names)
        super().__init__(f"missing environment variable(s): {', '.join(self.names)}")


class InvalidEnv(Exception):
    pass


class ServerError(Exception):
    """A 5xx reply to a write. Raised from the HTTP layer because postgrest-py drops the status when the body is JSON."""


class UnknownSeason(Exception):
    def __init__(self, season: int) -> None:
        super().__init__(f"season {season} has no parameters")


class SeasonReadFailed(Exception):
    def __init__(self, season: int, cause: Exception | str) -> None:
        super().__init__(f"could not read season {season} from the seasons table: {cause}")


class WriteFailed(Exception):
    pass


RunKind = Literal["refresh", "refit"]


class RatedFewerMatches(Exception):
    def __init__(self, season: int, matches: int, last: Run) -> None:
        super().__init__(
            f"refusing to write season {season}: rated {matches} matches, fewer than the {last.matches} "
            f"of the last successful run ({last.finished_at}). The upstream fetch may have dropped events. "
            f"Delete that row from refresh_runs to accept the lower count."
        )


@dataclass(frozen=True)
class Run:
    matches: int
    events: int
    finished_at: str


class Store(Protocol):
    def season(self, number: int) -> Season: ...

    def last_run(self, season: int, kind: RunKind = "refresh") -> Run | None: ...

    def record_run(self, season: int, matches: int, events: int, kind: RunKind = "refresh") -> None: ...

    def update_season_params(self, season: int, params: EpaParams) -> None: ...

    def write_ratings(self, season: int, rows: Sequence[TeamRow]) -> None: ...


def season_from_row(row: Mapping[str, Any]) -> Season:
    return Season(
        row["season"],
        EpaParams(
            RatingParams(row["mean"], row["a"], row["p"]),
            RatingParams(row["mean_auto"], row["a_auto"], row["p_auto"]),
        ),
        date.fromisoformat(row["params_refit_until"]) if row.get("params_refit_until") else None,
    )


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
    if not PRINTABLE_ASCII.fullmatch(env["SUPABASE_URL"]):
        raise InvalidEnv("SUPABASE_URL has spaces, line breaks, or non-ASCII characters. Copy it again exactly.")
    if not PRINTABLE_ASCII.fullmatch(env["SUPABASE_SECRET_KEY"]):
        raise InvalidEnv(
            "SUPABASE_SECRET_KEY has spaces, line breaks, or non-ASCII characters. "
            "Copy it again exactly; `supabase projects api-keys --reveal` prints it unmasked."
        )
    scheme, separator, rest = env["SUPABASE_URL"].partition("://")
    if not separator or scheme.lower() not in ("http", "https"):
        raise InvalidEnv("SUPABASE_URL must start with http:// or https://")
    return f"{scheme.lower()}://{rest}", env["SUPABASE_SECRET_KEY"]


def _raise_server_error(response: httpx.Response) -> None:
    if response.is_server_error and response.request.method not in IDEMPOTENT_READS:
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
        try:
            client = create_client(url, secret, options=ClientOptions(httpx_client=http_client))
        except (ValueError, SupabaseException) as exc:
            raise InvalidEnv(f"SUPABASE_URL is not a valid URL: {exc}") from exc
        return cls(client, secret=secret, sleep=sleep)

    def season(self, number: int) -> Season:
        try:
            rows = self._client.table("seasons").select(SEASON_COLUMNS).eq("season", number).execute().data
        except (APIError, httpx.HTTPError) as exc:
            raise SeasonReadFailed(number, exc) from exc
        if not isinstance(rows, list):
            raise SeasonReadFailed(number, f"expected a JSON array, got {type(rows).__name__}")
        if not rows:
            raise UnknownSeason(number)
        try:
            return season_from_row(rows[0])
        except (TypeError, KeyError) as exc:
            raise SeasonReadFailed(number, f"malformed row ({exc!r})") from exc

    def last_run(self, season: int, kind: RunKind = "refresh") -> Run | None:
        try:
            rows = (
                self._client.table("refresh_runs").select(RUN_COLUMNS).eq("season", season).eq("kind", kind)
                .order("finished_at", desc=True).limit(1).execute().data
            )
        except (APIError, httpx.HTTPError) as exc:
            raise SeasonReadFailed(season, f"refresh_runs: {exc}") from exc
        if not isinstance(rows, list):
            raise SeasonReadFailed(season, f"refresh_runs: expected a JSON array, got {type(rows).__name__}")
        return Run(rows[0]["matches"], rows[0]["events"], rows[0]["finished_at"]) if rows else None

    def record_run(self, season: int, matches: int, events: int, kind: RunKind = "refresh") -> None:
        try:
            self._client.table("refresh_runs").insert(
                {"season": season, "kind": kind, "matches": matches, "events": events},
            ).execute()
        except Exception as exc:
            raise WriteFailed(f"refresh_runs row for season {season}: {redact(str(exc), self._secret)}") from exc

    def update_season_params(self, season: int, params: EpaParams) -> None:
        values = {
            "mean": params.total.mean, "a": params.total.a, "p": params.total.p,
            "mean_auto": params.auto.mean, "a_auto": params.auto.a, "p_auto": params.auto.p,
        }
        try:
            rows = self._client.table("seasons").update(values).eq("season", season).execute().data
        except Exception as exc:
            raise WriteFailed(f"seasons row {season}: {redact(str(exc), self._secret)}") from exc
        if not rows:
            raise UnknownSeason(season)

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

    def __init__(
        self, path: Path, read: Callable[[int], Season], read_last_run: Callable[[int, RunKind], Run | None] = lambda *_: None,
    ) -> None:
        self._path = path
        self._read = read
        self._read_last_run = read_last_run
        self.season_params: dict[int, EpaParams] = {}

    def season(self, number: int) -> Season:
        return self._read(number)

    def last_run(self, season: int, kind: RunKind = "refresh") -> Run | None:
        return self._read_last_run(season, kind)

    def record_run(self, season: int, matches: int, events: int, kind: RunKind = "refresh") -> None:
        logger.info("dry run: would record season %d %s run: matches=%d events=%d", season, kind, matches, events)

    def update_season_params(self, season: int, params: EpaParams) -> None:
        self._read(season)
        self.season_params[season] = params
        logger.info("dry run: would write seasons row %d: %s", season, params)

    def write_ratings(self, season: int, rows: Sequence[TeamRow]) -> None:
        records = [to_record(r) for r in sorted(rows, key=lambda r: r.team_number)]
        self._path.write_text(json.dumps(records))
