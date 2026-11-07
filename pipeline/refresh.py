from __future__ import annotations

import argparse
import logging
import os
import sys
import traceback
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import Callable, Mapping, Sequence

import epa
import ftcscout
from store import (
    DryRunStore, InvalidEnv, MissingEnv, RatedFewerMatches, SeasonReadFailed, Store, SupabaseStore, UnknownSeason, WriteFailed, redact,
)

Fetch = Callable[[epa.Season], epa.SeasonMatches]

logger = logging.getLogger("refresh")


@dataclass(frozen=True)
class RefreshSummary:
    season: int
    teams: int
    matches: int
    events: int

    def __str__(self) -> str:
        return f"refreshed season={self.season} teams={self.teams} matches={self.matches} events={self.events}"


def refresh_season(season: int, store: Store, *, fetch: Fetch = ftcscout.fetch_season) -> RefreshSummary:
    spec = store.season(season)
    data = fetch(spec)
    logger.info("fetched events=%d matches=%d skipped=%d", data.events, len(data.matches), data.skipped)
    rows = epa.rate_season(data, spec.params)
    matches = len(epa.order_matches(data.matches))
    last = store.last_run(season)
    if last and matches < last.matches:
        raise RatedFewerMatches(season, matches, last)
    store.write_ratings(season, rows)
    store.record_run(season, matches, data.events)
    return RefreshSummary(season, len(rows), matches, data.events)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="refresh.py")
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run", help="refresh one season's ratings")
    run.add_argument("--season", type=int, required=True)
    run.add_argument(
        "--dry-run",
        nargs="?",
        const="",
        metavar="PATH",
        help="read the season parameters from Supabase, but write the rows to PATH (default epa_<season>.dry.json) instead",
    )
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    env: Mapping[str, str] = os.environ,
    fetch: Fetch | None = None,
    store: Store | None = None,
) -> int:
    """0 on success. 1 on FetchFailed, a failed read or write, or any other error. 2 on usage, MissingEnv, InvalidEnv, or UnknownSeason."""
    args = _parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stderr)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    secret = env.get("SUPABASE_SECRET_KEY", "")

    def fail(text: str) -> None:
        print(redact(text, secret), file=sys.stderr)

    try:
        if store is None:
            if args.dry_run is None:
                store = SupabaseStore.from_env(env)
            else:
                live = SupabaseStore.from_env(env)
                store = DryRunStore(Path(args.dry_run or f"epa_{args.season}.dry.json"), live.season, live.last_run)
        if fetch is None:
            fetch = partial(ftcscout.fetch_season, post=ftcscout.http_post(env.get("FTCSCOUT_GRAPHQL_URL", ftcscout.DEFAULT_URL)))
        summary = refresh_season(args.season, store, fetch=fetch)
    except (MissingEnv, InvalidEnv, UnknownSeason) as exc:
        fail(f"error: {exc}")
        return 2
    except ftcscout.FetchFailed as exc:
        fail(f"error: {exc}")
        for code, message in sorted(exc.failures.items()):
            fail(f"  {code}: {message}")
        return 1
    except (SeasonReadFailed, WriteFailed, RatedFewerMatches) as exc:
        fail(f"error: {exc}")
        return 1
    except Exception:
        fail(traceback.format_exc().rstrip())
        return 1
    print(summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
