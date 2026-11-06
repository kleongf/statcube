"""Season rating domain: types and pure rating math. No I/O.

Every other pipeline module imports its domain types from here. ftcscout.py
parses wire JSON into `Match`; store.py serializes `TeamRow` into table rows.
"""
from __future__ import annotations

import math
from bisect import bisect_right
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from statistics import NormalDist
from typing import Mapping, Sequence

_NORMAL = NormalDist()


@dataclass(frozen=True)
class RatingParams:
    """Prior mean and noise curve for one rated quantity (total or auto)."""

    mean: float
    a: float
    p: float

    @property
    def k_max(self) -> float:
        return 0.4 * abs(self.mean)

    @property
    def k_min(self) -> float:
        return 0.2 * abs(self.mean)


@dataclass(frozen=True)
class EpaParams:
    total: RatingParams
    auto: RatingParams


@dataclass(frozen=True)
class Season:
    """Everything the pipeline needs to know about one season."""

    number: int
    params: EpaParams


@dataclass(frozen=True)
class Alliance:
    """Two distinct on-field teams and their alliance's scores.

    Invariant, enforced by ftcscout.parse_event: exactly two teams, both
    distinct from the opposing alliance's teams, and both scores present.
    """

    teams: tuple[int, int]
    total: int
    auto: int


@dataclass(frozen=True)
class Match:
    """One played, ratable match."""

    event_code: str
    posted_at: datetime
    posted_key: str      # raw postResultTime, the history jsonb key the frontend reads
    red: Alliance
    blue: Alliance

    @property
    def dedupe_key(self) -> tuple[datetime, frozenset[int]]:
        """Same match listed under two events (divisions, combined events)."""
        return self.posted_at, frozenset(self.red.teams + self.blue.teams)


@dataclass(frozen=True)
class SeasonMatches:
    """A complete fetch. Only constructed when every event fetched."""

    matches: tuple[Match, ...]
    names: Mapping[int, str]
    events: int
    skipped: int  # played matches that failed the Alliance invariant


@dataclass(frozen=True)
class Point:
    """One team's ratings right after one match, rounded to 4 decimals."""

    posted_key: str
    epa: float
    auto_epa: float
    teleop_epa: float  # round(total - auto, 4), from the unrounded values


@dataclass(frozen=True)
class Ranks:
    """Competition ranks, starting at 1: one plus the teams strictly ahead."""

    epa: int
    auto_epa: int
    teleop_epa: int


@dataclass(frozen=True)
class TeamRow:
    """One team's season. `history` is chronological and never empty.

    `current` is derived from `history`, never stored separately, so the
    current_* columns cannot drift from the history maps.
    """

    team_number: int
    team_name: str
    history: tuple[Point, ...]
    ranks: Ranks

    @property
    def current(self) -> Point:
        return self.history[-1]


def calculate_k_factor(n: int, kmax: float, kmin: float) -> float:
    if n <= 6:
        return kmax
    elif 7 <= n <= 12:
        return kmax - (n - 6) * (kmax - kmin) / 6
    return kmin


def calculate_epa_update(
    r1: float, r2: float, b1: float, b2: float,
    r_actual: float, b_actual: float,
    r1k: float, r2k: float, b1k: float, b2k: float,
    a_param: float, p_param: float,
) -> tuple[float, float, float, float]:
    red_rating = r1 + r2
    blue_rating = b1 + b2

    red_std = a_param * math.pow(max(1, red_rating), p_param)
    blue_std = a_param * math.pow(max(1, blue_rating), p_param)

    margin_z = ((r_actual - b_actual) - (red_rating - blue_rating)) / math.sqrt(red_std**2 + blue_std**2)
    result_prob = _NORMAL.cdf(margin_z) - 0.5

    red_bonus = _NORMAL.cdf((r_actual - red_rating) / red_std) - 0.5
    blue_bonus = _NORMAL.cdf((b_actual - blue_rating) / blue_std) - 0.5

    return (
        r1 + r1k * (result_prob + red_bonus),
        r2 + r2k * (result_prob + red_bonus),
        b1 + b1k * (-result_prob + blue_bonus),
        b2 + b2k * (-result_prob + blue_bonus),
    )


def order_matches(matches: Sequence[Match]) -> list[Match]:
    """Sort by a total key, then drop duplicates by `dedupe_key`, keeping the first.

    Deterministic for any input order, so the same fetch always replays the same
    way, whichever thread delivered a duplicate or a same-second tie first.
    """
    ordered = sorted(
        matches,
        key=lambda m: (m.posted_at, m.event_code, sorted(m.red.teams), sorted(m.blue.teams)),
    )
    seen: set[tuple[datetime, frozenset[int]]] = set()
    unique = []
    for m in ordered:
        if m.dedupe_key not in seen:
            seen.add(m.dedupe_key)
            unique.append(m)
    return unique


class _TeamState:
    __slots__ = ("total", "auto", "played", "history")

    def __init__(self, params: EpaParams) -> None:
        self.total = params.total.mean
        self.auto = params.auto.mean
        self.played = 0
        self.history: list[Point] = []


def _k(state: _TeamState, p: RatingParams) -> float:
    return calculate_k_factor(state.played, p.k_max, p.k_min)


def _competition_ranks(values: Mapping[int, float]) -> dict[int, int]:
    ascending = sorted(values.values())
    n = len(ascending)
    return {team: 1 + n - bisect_right(ascending, v) for team, v in values.items()}


def rate_season(data: SeasonMatches, params: EpaParams) -> list[TeamRow]:
    """Replay the season and return one row per team that played a rated match, by team number.

    Pure and deterministic: the same `data` and `params` give equal rows, which
    is what makes a rerun converge. Ranks are computed on the rounded current
    values, the ones the table stores.
    """
    states: defaultdict[int, _TeamState] = defaultdict(lambda: _TeamState(params))

    for m in order_matches(data.matches):
        r1, r2 = (states[t] for t in m.red.teams)
        b1, b2 = (states[t] for t in m.blue.teams)
        four = (r1, r2, b1, b2)

        total = calculate_epa_update(
            r1.total, r2.total, b1.total, b2.total,
            m.red.total, m.blue.total,
            *(_k(s, params.total) for s in four),
            params.total.a, params.total.p,
        )
        auto = calculate_epa_update(
            r1.auto, r2.auto, b1.auto, b2.auto,
            m.red.auto, m.blue.auto,
            *(_k(s, params.auto) for s in four),
            params.auto.a, params.auto.p,
        )
        for s, new_total, new_auto in zip(four, total, auto):
            s.total, s.auto = new_total, new_auto
            s.played += 1
            s.history.append(Point(
                m.posted_key,
                round(new_total, 4),
                round(new_auto, 4),
                round(new_total - new_auto, 4),
            ))

    current = {n: s.history[-1] for n, s in states.items()}
    rank_epa = _competition_ranks({n: p.epa for n, p in current.items()})
    rank_auto = _competition_ranks({n: p.auto_epa for n, p in current.items()})
    rank_teleop = _competition_ranks({n: p.teleop_epa for n, p in current.items()})

    return [
        TeamRow(
            team_number=n,
            team_name=data.names.get(n, f"Team {n}"),
            history=tuple(states[n].history),
            ranks=Ranks(rank_epa[n], rank_auto[n], rank_teleop[n]),
        )
        for n in sorted(states)
    ]
