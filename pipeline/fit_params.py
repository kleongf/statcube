from __future__ import annotations

import argparse
import logging
import math
import os
import sys
import traceback
from dataclasses import dataclass
from datetime import date, datetime, timezone
from enum import Enum, auto
from functools import partial
from statistics import fmean
from typing import Callable, Mapping, Sequence

import epa
import ftcscout
from store import InvalidEnv, MissingEnv, SeasonReadFailed, Store, SupabaseStore, UnknownSeason, WriteFailed, redact

MIN_BINS = 6
MIN_BIN_ALLIANCES = 50
LOG_BIN_WIDTH = 0.1
TOLERANCE = 0.001
MAX_ROUNDS = 10
DECIMALS = 4
MAX_P = 1.5

Fetch = Callable[[epa.Season], epa.SeasonMatches]


class NoMatches(Exception):
    pass


@dataclass(frozen=True)
class Window:
    start: date | None = None
    end: date | None = None

    def __contains__(self, day: date) -> bool:
        return (self.start is None or self.start <= day) and (self.end is None or day <= self.end)

    def __str__(self) -> str:
        return f"{self.start or 'season start'}..{self.end or 'latest'}"


@dataclass(frozen=True)
class Bin:
    index: int
    rating: float
    alliances: float
    std: float


class Outcome(Enum):
    KEPT_PRIOR_SPREAD = auto()
    CONVERGED = auto()
    HIT_CAP = auto()


@dataclass(frozen=True)
class Fit:
    params: epa.EpaParams
    matches: int
    total_bins: tuple[Bin, ...]
    auto_bins: tuple[Bin, ...]
    outcome: Outcome
    rounds: int
    move: float


NAMES = ("mean", "a", "p", "mean_auto", "a_auto", "p_auto")


def values(params: epa.EpaParams) -> tuple[float, float, float, float, float, float]:
    return params.total.mean, params.total.a, params.total.p, params.auto.mean, params.auto.a, params.auto.p


def bin_residuals(pairs: Sequence[tuple[float, float]]) -> tuple[Bin, ...]:
    groups: dict[int, list[tuple[float, float, float]]] = {}
    for predicted, actual in pairs:
        rating = epa.model_rating(predicted)
        position = math.log(rating) / LOG_BIN_WIDTH - 0.5
        below = math.floor(position)
        share = position - below
        for index, weight in ((below, 1 - share), (below + 1, share)):
            if weight > 0:
                groups.setdefault(index, []).append((weight, rating, actual - predicted))
    return tuple(_weighted_bin(index, group) for index, group in sorted(groups.items()))


def _weighted_bin(index: int, group: Sequence[tuple[float, float, float]]) -> Bin:
    weights = [w for w, _, _ in group]
    residuals = [e for _, _, e in group]
    centre = fmean(residuals, weights)
    spread = fmean([(e - centre) ** 2 for e in residuals], weights)
    return Bin(index, fmean([r for _, r, _ in group], weights), sum(weights), math.sqrt(spread))


def full_bins(bins: Sequence[Bin]) -> list[Bin]:
    return [b for b in bins if b.alliances >= MIN_BIN_ALLIANCES and b.std > 0]


def fit_spread(bins: Sequence[Bin], mean: float) -> epa.RatingParams:
    usable = [b for b in bins if b.std > 0]
    weights = [b.alliances for b in usable]
    xs = [math.log(b.rating) for b in usable]
    ys = [math.log(b.std) for b in usable]
    mx, my = fmean(xs, weights), fmean(ys, weights)
    p = sum(w * (x - mx) * (y - my) for w, x, y in zip(weights, xs, ys)) / sum(w * (x - mx) ** 2 for w, x in zip(weights, xs))
    return epa.RatingParams(mean, math.exp(my - p * mx), p)


def _replay(
    history: epa.SeasonMatches, params: epa.EpaParams, window: Window,
) -> tuple[int, tuple[Bin, ...], tuple[Bin, ...]]:
    total: list[tuple[float, float]] = []
    auto: list[tuple[float, float]] = []

    def observe(m: epa.Match, red: epa.Prediction, blue: epa.Prediction) -> None:
        if m.posted_at.date() in window:
            total.extend(((red.total, m.red.total), (blue.total, m.blue.total)))
            auto.extend(((red.auto, m.red.auto), (blue.auto, m.blue.auto)))

    epa.rate_season(history, params, observe)
    return len(total) // 2, bin_residuals(total), bin_residuals(auto)


def _move(old: epa.RatingParams, new: epa.RatingParams) -> float:
    return max(abs(new.a - old.a) / abs(old.a), abs(new.p - old.p) / abs(old.p))


def _rounded(params: epa.EpaParams) -> epa.EpaParams:
    def r(p: epa.RatingParams) -> epa.RatingParams:
        return epa.RatingParams(round(p.mean, DECIMALS), round(p.a, DECIMALS), round(p.p, DECIMALS))

    return epa.EpaParams(r(params.total), r(params.auto))


def fit_season(data: epa.SeasonMatches, prior: epa.EpaParams, window: Window = Window()) -> Fit:
    rated = [m for m in epa.order_matches(data.matches) if m.posted_at.date() in window]
    if not rated:
        raise NoMatches(f"no rated matches in {window}")
    mean = fmean(s for m in rated for s in (m.red.total, m.blue.total)) / 2
    mean_auto = fmean(s for m in rated for s in (m.red.auto, m.blue.auto)) / 2
    history = epa.SeasonMatches(
        tuple(m for m in data.matches if window.end is None or m.posted_at.date() <= window.end),
        data.names, data.events, data.skipped,
    )
    params = epa.EpaParams(
        epa.RatingParams(mean, prior.total.a, prior.total.p),
        epa.RatingParams(mean_auto, prior.auto.a, prior.auto.p),
    )
    matches, total_bins, auto_bins = _replay(history, params, window)
    held_total = {b.index for b in full_bins(total_bins)}
    held_auto = {b.index for b in full_bins(auto_bins)}
    if min(len(held_total), len(held_auto)) < MIN_BINS:
        return Fit(_rounded(params), matches, total_bins, auto_bins, Outcome.KEPT_PRIOR_SPREAD, rounds=0, move=0.0)

    for rounds in range(1, MAX_ROUNDS + 1):
        fitted = epa.EpaParams(
            fit_spread([b for b in total_bins if b.index in held_total], mean),
            fit_spread([b for b in auto_bins if b.index in held_auto], mean_auto),
        )
        move = max(_move(params.total, fitted.total), _move(params.auto, fitted.auto))
        params = fitted
        if move <= TOLERANCE:
            return Fit(_rounded(params), matches, total_bins, auto_bins, Outcome.CONVERGED, rounds, move)
        if rounds < MAX_ROUNDS:
            matches, total_bins, auto_bins = _replay(history, params, window)
    return Fit(_rounded(params), matches, total_bins, auto_bins, Outcome.HIT_CAP, MAX_ROUNDS, move)


def refusal(fit: Fit) -> str | None:
    if fit.outcome is Outcome.HIT_CAP:
        return f"a or p still moved {fit.move:.3%} after the {MAX_ROUNDS}-round cap, so the fit is not a fixed point"
    for name, value in zip(NAMES, values(fit.params)):
        if not math.isfinite(value):
            return f"{name} is {value}"
    for side in (fit.params.total, fit.params.auto):
        if side.mean <= 0 or side.a <= 0:
            return f"mean and a must be positive, got {side}"
        if not 0 < side.p < MAX_P:
            return f"p must be in (0, {MAX_P}), got {side}"
    return None


def _format_params(params: epa.EpaParams) -> str:
    return " ".join(f"{n}={v:.{DECIMALS}f}" for n, v in zip(NAMES, values(params)))


def _format_bins(bins: Sequence[Bin]) -> str:
    full = len(full_bins(bins))
    counts = " ".join(f"{b.rating:.3g}:{b.alliances:.0f}" for b in bins)
    return f"{full} of {len(bins)} bins have >= {MIN_BIN_ALLIANCES} alliances (need {MIN_BINS}); rating:alliances {counts}"


def report(season: int, window: Window, fit: Fit, prior_season: int) -> str:
    if fit.outcome is Outcome.KEPT_PRIOR_SPREAD:
        verdict = f"kept season {prior_season}'s a and p; refit only mean and mean_auto"
    elif fit.outcome is Outcome.CONVERGED:
        verdict = f"refit a and p (fixed point after {fit.rounds} round(s); last round moved {fit.move:.3%})"
    else:
        verdict = f"refit a and p but stopped at the {MAX_ROUNDS}-round cap; last round moved {fit.move:.3%}"
    return "\n".join((
        f"season {season} window {window}",
        f"rated matches {fit.matches}",
        f"total: {_format_bins(fit.total_bins)}",
        f"auto: {_format_bins(fit.auto_bins)}",
        verdict,
        f"values {_format_params(fit.params)}",
    ))


def _prior(store: Store, season: int) -> epa.Season:
    try:
        return store.season(season - 1)
    except UnknownSeason:
        return store.season(season)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="fit_params.py", description="Fit a season's EPA parameters from match data.")
    parser.add_argument("--season", type=int, required=True)
    parser.add_argument("--from", dest="start", type=date.fromisoformat, metavar="DATE")
    parser.add_argument("--to", dest="end", type=date.fromisoformat, metavar="DATE")
    parser.add_argument("--write", action="store_true", help="write the fitted values to the season's seasons row")
    parser.add_argument(
        "--min-new-matches",
        type=int,
        default=0,
        metavar="N",
        help="with --write, skip the write (exit 0) unless the fit rates at least N more matches than the last recorded refit",
    )
    parser.add_argument(
        "--if-open",
        action="store_true",
        help="exit 0 without fitting unless today (UTC) is before the season's params_refit_until; a null date means frozen",
    )
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    env: Mapping[str, str] = os.environ,
    fetch: Fetch | None = None,
    store: Store | None = None,
    today: date | None = None,
) -> int:
    args = _parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stderr)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    secret = env.get("SUPABASE_SECRET_KEY", "")

    def fail(text: str) -> None:
        print(redact(text, secret), file=sys.stderr)

    try:
        store = store or SupabaseStore.from_env(env)
        fetch = fetch or partial(ftcscout.fetch_season, post=ftcscout.http_post(env.get("FTCSCOUT_GRAPHQL_URL", ftcscout.DEFAULT_URL)))
        if args.write:
            store.season(args.season)
        if args.if_open:
            until = store.season(args.season).refit_until
            if until is None or (today or datetime.now(timezone.utc).date()) >= until:
                print(f"season {args.season} parameters are frozen (params_refit_until {until}); not refitting")
                return 0
        prior = _prior(store, args.season)
        data = fetch(epa.Season(args.season, prior.params))
        window = Window(args.start, args.end)
        fit = fit_season(data, prior.params, window)
        print(report(args.season, window, fit, prior.number))
        if not args.write:
            print("dry run; pass --write to update the seasons row")
            return 0
        if reason := refusal(fit):
            fail(f"error: refusing to write seasons row {args.season}: {reason}")
            return 1
        if args.min_new_matches:
            last = store.last_run(args.season, "refit")
            new = fit.matches - (last.matches if last else 0)
            if new < args.min_new_matches:
                print(f"skipped refit: {new} new matches (need {args.min_new_matches})")
                return 0
        store.update_season_params(args.season, fit.params)
        store.record_run(args.season, fit.matches, data.events, "refit")
        print(f"wrote seasons row {args.season}")
    except (MissingEnv, InvalidEnv, UnknownSeason) as exc:
        fail(f"error: {exc}")
        return 2
    except ftcscout.FetchFailed as exc:
        fail(f"error: {exc}")
        for code, message in sorted(exc.failures.items()):
            fail(f"  {code}: {message}")
        return 1
    except (NoMatches, SeasonReadFailed, WriteFailed) as exc:
        fail(f"error: {exc}")
        return 1
    except Exception:
        fail(traceback.format_exc().rstrip())
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
