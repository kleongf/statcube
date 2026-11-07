from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any, Callable, Mapping

import httpx

from epa import Alliance, Match, Season, SeasonMatches

DEFAULT_URL = "https://api.ftcscout.org/graphql"
USER_AGENT = "ftc-stats-pipeline"
REQUEST_TIMEOUT_S = 120

EVENTS_QUERY = """
query GetEvents($eventsSearchSeason: Int!) {
  eventsSearch(season: $eventsSearchSeason, hasMatches: true) {
    code
  }
}
"""

Post = Callable[[str, Mapping[str, Any]], Mapping[str, Any]]


class GraphQLFailure(Exception):
    pass


class FetchFailed(Exception):

    def __init__(self, failures: Mapping[str, str]) -> None:
        self.failures = dict(failures)
        super().__init__(
            f"{len(self.failures)} event(s) failed to fetch: {', '.join(sorted(self.failures))}"
        )


def http_post(url: str = DEFAULT_URL) -> Post:
    """A Post backed by one shared httpx.Client, safe to call from worker threads."""
    client = httpx.Client(timeout=REQUEST_TIMEOUT_S, headers={"User-Agent": USER_AGENT})

    def post(query: str, variables: Mapping[str, Any]) -> Mapping[str, Any]:
        try:
            response = client.post(url, json={"query": query, "variables": dict(variables)})
            response.raise_for_status()
            body = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise GraphQLFailure(f"{type(exc).__name__}: {exc}") from exc
        if body.get("errors"):
            raise GraphQLFailure(f"GraphQL errors: {body['errors']}")
        return body.get("data") or {}

    return post


def matches_query(season: Season) -> str:
    return f"""
query GetEventMatches($eventByCodeSeason: Int!, $eventByCodeCode: String!) {{
  eventByCode(season: $eventByCodeSeason, code: $eventByCodeCode) {{
    matches {{
      postResultTime
      scores {{
        ... on MatchScores{season.number} {{
          red {{ totalPoints autoPoints }}
          blue {{ totalPoints autoPoints }}
        }}
      }}
      hasBeenPlayed
      teams {{
        teamNumber
        onField
        alliance
        team {{
          name
        }}
      }}
    }}
  }}
}}
"""


def _alliance(fielded: list[Mapping[str, Any]], colour: str, scores: Mapping[str, Any] | None) -> Alliance | None:
    teams = tuple(t["teamNumber"] for t in fielded if t.get("alliance") == colour)
    side = (scores or {}).get(colour.lower()) or {}
    total, auto = side.get("totalPoints"), side.get("autoPoints")
    if len(teams) != 2 or total is None or auto is None:
        return None
    return Alliance(teams=teams, total=total, auto=auto)


def parse_event(event_code: str, raw_matches: list[Mapping[str, Any]]) -> tuple[list[Match], dict[int, str], int]:
    matches: list[Match] = []
    names: dict[int, str] = {}
    skipped = 0
    for raw in raw_matches:
        if not (raw.get("hasBeenPlayed") and raw.get("postResultTime")):
            continue
        raw_teams = raw.get("teams") or []
        # Some events (2026 KZASN1) mark every team onField=false; then the listed teams played.
        fielded = [t for t in raw_teams if t.get("onField")] or raw_teams
        scores = raw.get("scores")
        red = _alliance(fielded, "Red", scores)
        blue = _alliance(fielded, "Blue", scores)
        if red is None or blue is None or len({*red.teams, *blue.teams}) < 4:
            skipped += 1
            continue
        for t in fielded:
            name = (t.get("team") or {}).get("name")
            if name:
                names.setdefault(t["teamNumber"], name)
        matches.append(Match(
            event_code=event_code,
            posted_at=datetime.fromisoformat(raw["postResultTime"]),
            posted_key=raw["postResultTime"],
            red=red,
            blue=blue,
        ))
    return matches, names, skipped


def _fetch_event(
    post: Post, query: str, season: int, code: str, retry_delay: float,
) -> tuple[list[Match], dict[int, str], int]:

    def attempt() -> tuple[list[Match], dict[int, str], int]:
        data = post(query, {"eventByCodeSeason": season, "eventByCodeCode": code})
        return parse_event(code, (data.get("eventByCode") or {}).get("matches") or [])

    try:
        return attempt()
    except Exception:
        time.sleep(retry_delay)
        return attempt()


def fetch_season(
    season: Season, *, post: Post | None = None, workers: int = 16, retry_delay: float = 1.0,
) -> SeasonMatches:
    post = post or http_post()
    try:
        codes = [e["code"] for e in post(EVENTS_QUERY, {"eventsSearchSeason": season.number})["eventsSearch"]]
    except Exception as exc:
        raise FetchFailed({"<eventsSearch>": str(exc)}) from exc

    query = matches_query(season)
    with ThreadPoolExecutor(workers) as pool:
        futures = {code: pool.submit(_fetch_event, post, query, season.number, code, retry_delay) for code in codes}

    matches: list[Match] = []
    names: dict[int, str] = {}
    skipped = 0
    failures: dict[str, str] = {}
    for code in codes:
        try:
            event_matches, event_names, event_skipped = futures[code].result()
        except Exception as exc:
            failures[code] = str(exc)
            continue
        matches.extend(event_matches)
        for number, name in event_names.items():
            names.setdefault(number, name)
        skipped += event_skipped
    if failures:
        raise FetchFailed(failures)
    return SeasonMatches(matches=tuple(matches), names=names, events=len(codes), skipped=skipped)
