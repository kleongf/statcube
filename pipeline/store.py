from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any, Callable, Mapping, Protocol, Sequence

import httpx
from postgrest.exceptions import APIError
from supabase import ClientOptions, create_client

from epa import EpaParams, RatingParams, Season, TeamRow

logger = logging.getLogger(__name__)

REQUIRED_ENV = ("SUPABASE_URL", "SUPABASE_SECRET_KEY")
BATCH_ROWS = 500
ATTEMPTS = 3
REQUEST_TIMEOUT_S = 120

SEASON_COLUMNS = "season, mean, a, p, mean_auto, a_auto, p_auto"


class MissingEnv(Exception):
    def __init__(self, names: Sequence[str]) -> None:
        self.names = tuple(names)
        super().__init__(f"missing environment variable(s): {', '.join(self.names)}")


class MaskedKey(Exception):
    def __init__(self, name: str) -> None:
        super().__init__(
            f"{name} has non-ASCII characters, so it is probably a masked copy. "
            "Copy it again with `supabase projects api-keys --reveal`."
        )


class UnknownSeason(Exception):
    def __init__(self, season: int) -> None:
        super().__init__(f"season {season} has no parameters")


class SeasonReadFailed(Exception):
    def __init__(self, season: int, cause: Exception) -> None:
        super().__init__(f"could not read season {season} from the seasons table: {cause}")


class WriteFailed(Exception):
    pass


class Store(Protocol):
    def season(self, number: int) -> Season: ...

    def write_ratings(self, season: int, rows: Sequence[TeamRow]) -> None: ...


def season_from_row(row: Mapping[str, Any]) -> Season:
    return Season(
        row["season"],
        EpaParams(
            RatingParams(row["mean"], row["a"], row["p"]),
            RatingParams(row["mean_auto"], row["a_auto"], row["p_auto"]),
        ),
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


def _is_retryable(exc: Exception) -> bool:
    if isinstance(exc, httpx.TransportError):
        return True
    # APIError.code is the HTTP status for non-JSON replies and a 5-character
    # Postgres code ("42501") or PGRST code otherwise.
    return isinstance(exc, APIError) and exc.code is not None and len(exc.code) == 3 and exc.code.startswith("5")


class SupabaseStore:
    def __init__(self, client: Any, *, sleep: Callable[[float], None] = time.sleep) -> None:
        self._client = client
        self._sleep = sleep

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> SupabaseStore:
        missing = [name for name in REQUIRED_ENV if not env.get(name)]
        if missing:
            raise MissingEnv(missing)
        if not env["SUPABASE_SECRET_KEY"].isascii():
            raise MaskedKey("SUPABASE_SECRET_KEY")
        http_client = httpx.Client(http2=False, timeout=REQUEST_TIMEOUT_S)
        client = create_client(
            env["SUPABASE_URL"], env["SUPABASE_SECRET_KEY"], options=ClientOptions(httpx_client=http_client),
        )
        return cls(client)

    def season(self, number: int) -> Season:
        try:
            rows = self._client.table("seasons").select(SEASON_COLUMNS).eq("season", number).execute().data
        except (APIError, httpx.TransportError) as exc:
            raise SeasonReadFailed(number, exc) from exc
        if not rows:
            raise UnknownSeason(number)
        return season_from_row(rows[0])

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
                    if attempt == ATTEMPTS or not _is_retryable(exc):
                        raise WriteFailed(f"{label} failed on attempt {attempt}: {exc}") from exc
                    logger.warning("%s attempt %d failed (%s), retrying", label, attempt, exc)
                    self._sleep(2 ** (attempt - 1))
            logger.info("%s written in %.1fs", label, time.monotonic() - started)


class DryRunStore:

    def __init__(self, path: Path, read: Callable[[int], Season]) -> None:
        self._path = path
        self._read = read

    def season(self, number: int) -> Season:
        return self._read(number)

    def write_ratings(self, season: int, rows: Sequence[TeamRow]) -> None:
        records = [to_record(r) for r in sorted(rows, key=lambda r: r.team_number)]
        self._path.write_text(json.dumps(records))
