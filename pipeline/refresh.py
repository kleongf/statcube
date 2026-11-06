"""Refresh one season's ratings. The core every scheduler calls, plus its CLI.

    python pipeline/refresh.py run --season 2025
    python pipeline/refresh.py run --season 2025 --dry-run [epa_2025.dry.json]
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import Callable, Mapping, Sequence

import epa
import ftcscout
from store import DryRunStore, MaskedKey, MissingEnv, Store, SupabaseStore, UnknownSeason, WriteFailed

Fetch = Callable[[epa.Season], epa.SeasonMatches]

logger = logging.getLogger("refresh")


@dataclass(frozen=True)
class RefreshSummary:
    season: int
    teams: int
    matches: int  # matches rated, after dedupe and the Alliance invariant
    events: int

    def __str__(self) -> str:
        return f"refreshed season={self.season} teams={self.teams} matches={self.matches} events={self.events}"


def refresh_season(season: int, store: Store, *, fetch: Fetch = ftcscout.fetch_season) -> RefreshSummary:
    """Fetch every event, replay the whole season, write every row.

    Full recompute on every run. Raises before any write when a fetch fails,
    so the table only ever holds rows computed from a complete season.
    Running it twice, or rerunning after a crash at any point, converges to
    the rows rate_season returns for the current upstream data.
    """
    spec = store.season(season)
    data = fetch(spec)
    logger.info("fetched events=%d matches=%d skipped=%d", data.events, len(data.matches), data.skipped)
    rows = epa.rate_season(data, spec.params)
    store.write_ratings(season, rows)
    return RefreshSummary(season, len(rows), len(epa.order_matches(data.matches)), data.events)


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
        help="write the rows to PATH (default epa_<season>.dry.json) instead of Supabase",
    )
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    env: Mapping[str, str] = os.environ,
    fetch: Fetch | None = None,
    store: Store | None = None,
) -> int:
    """0 on success. 1 on FetchFailed or a failed write. 2 on usage, MissingEnv, MaskedKey, or UnknownSeason.

    Builds the store first, so a missing variable exits before any network call.
    `fetch` and `store` are test seams. Production builds them from argv and env:
    fetch from FTCSCOUT_GRAPHQL_URL (default ftcscout.DEFAULT_URL), store as
    DryRunStore under --dry-run, else SupabaseStore.from_env(env).
    Prints str(summary) as the last line on success.
    """
    args = _parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stderr)
    logging.getLogger("httpx").setLevel(logging.WARNING)  # one INFO line per request, about 1,500 a run
    try:
        if store is None:
            if args.dry_run is None:
                store = SupabaseStore.from_env(env)
            else:
                store = DryRunStore(Path(args.dry_run or f"epa_{args.season}.dry.json"))
        if fetch is None:
            fetch = partial(ftcscout.fetch_season, post=ftcscout.http_post(env.get("FTCSCOUT_GRAPHQL_URL", ftcscout.DEFAULT_URL)))
        summary = refresh_season(args.season, store, fetch=fetch)
    except (MissingEnv, MaskedKey, UnknownSeason) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except ftcscout.FetchFailed as exc:
        print(f"error: {exc}", file=sys.stderr)
        for code, message in sorted(exc.failures.items()):
            print(f"  {code}: {message}", file=sys.stderr)
        return 1
    except WriteFailed as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
