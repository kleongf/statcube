from __future__ import annotations

import argparse
import logging
import math
import os
import sys
import traceback
from dataclasses import dataclass
from datetime import date, timedelta
from functools import partial
from statistics import fmean, pstdev
from typing import Callable, Mapping, NamedTuple, Protocol, Sequence

import epa
import ftcscout
from store import InvalidEnv, MissingEnv, SeasonReadFailed, SupabaseStore, UnknownSeason, WriteFailed, redact

MIN_MATCHES = 2000
MIN_BINS = 6
MIN_BIN_ALLIANCES = 50
LOG_BIN_WIDTH = 0.1
TOLERANCE = 0.001
MAX_ROUNDS = 10
SCAN_DAYS = 14
DECIMALS = 4

Fetch = Callable[[epa.Season], epa.SeasonMatches]


class NoMatches(Exception):
    pass


class ParamStore(Protocol):
    def season(self, number: int) -> epa.Season: ...

    def update_season_params(self, season: int, params: epa.EpaParams) -> None: ...


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
    rating: float
    alliances: int
    std: float


@dataclass(frozen=True)
class Fit:
    params: epa.EpaParams
    matches: int
    total_bins: tuple[Bin, ...]
    auto_bins: tuple[Bin, ...]
    refit_spread: bool
    rounds: int
    converged: bool


NAMES = ("mean", "a", "p", "mean_auto", "a_auto", "p_auto")


def values(params: epa.EpaParams) -> tuple[float, float, float, float, float, float]:
    return params.total.mean, params.total.a, params.total.p, params.auto.mean, params.auto.a, params.auto.p


def relative_errors(fitted: epa.EpaParams, seeded: epa.EpaParams) -> tuple[float, ...]:
    return tuple((f - s) / abs(s) for f, s in zip(values(fitted), values(seeded)))


def largest_relative_error(fitted: epa.EpaParams, seeded: epa.EpaParams) -> float:
    return max(map(abs, relative_errors(fitted, seeded)))


def bin_residuals(pairs: Sequence[tuple[float, float]]) -> tuple[Bin, ...]:
    groups: dict[int, list[tuple[float, float]]] = {}
    for predicted, actual in pairs:
        rating = epa.model_rating(predicted)
        groups.setdefault(math.floor(math.log(rating) / LOG_BIN_WIDTH), []).append((rating, actual - predicted))
    return tuple(
        Bin(fmean(r for r, _ in group), len(group), pstdev(e for _, e in group))
        for _, group in sorted(groups.items())
    )


def full_bins(bins: Sequence[Bin]) -> list[Bin]:
    return [b for b in bins if b.alliances >= MIN_BIN_ALLIANCES and b.std > 0]


def fit_spread(bins: Sequence[Bin], mean: float) -> epa.RatingParams:
    usable = full_bins(bins)
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


def _moved(old: epa.RatingParams, new: epa.RatingParams) -> bool:
    return abs(new.a - old.a) > TOLERANCE * abs(old.a) or abs(new.p - old.p) > TOLERANCE * abs(old.p)


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
    if matches < MIN_MATCHES or min(len(full_bins(total_bins)), len(full_bins(auto_bins))) < MIN_BINS:
        return Fit(_rounded(params), matches, total_bins, auto_bins, refit_spread=False, rounds=0, converged=False)

    for rounds in range(1, MAX_ROUNDS + 1):
        fitted = epa.EpaParams(fit_spread(total_bins, mean), fit_spread(auto_bins, mean_auto))
        moved = _moved(params.total, fitted.total) or _moved(params.auto, fitted.auto)
        params = fitted
        if not moved or rounds == MAX_ROUNDS:
            break
        matches, total_bins, auto_bins = _replay(history, params, window)
    return Fit(_rounded(params), matches, total_bins, auto_bins, refit_spread=True, rounds=rounds, converged=not moved)


class ScanRow(NamedTuple):
    window: Window
    fit: Fit
    error: float

    @property
    def rank(self) -> tuple[bool, float]:
        return not self.fit.refit_spread, self.error


def december_windows(year: int) -> list[Window]:
    first = date(year, 12, 1)
    return [Window(first + timedelta(days=d), first + timedelta(days=d + SCAN_DAYS - 1)) for d in range(31)]


def scan_december(
    data: epa.SeasonMatches, prior: epa.EpaParams, seeded: epa.EpaParams, year: int,
) -> list[ScanRow]:
    scanned = []
    for window in december_windows(year):
        try:
            fit = fit_season(data, prior, window)
        except NoMatches:
            continue
        scanned.append(ScanRow(window, fit, largest_relative_error(fit.params, seeded)))
    return sorted(scanned, key=lambda row: row.rank)


def _format_params(params: epa.EpaParams) -> str:
    return " ".join(f"{n}={v:.{DECIMALS}f}" for n, v in zip(NAMES, values(params)))


def _format_bins(bins: Sequence[Bin]) -> str:
    full = len(full_bins(bins))
    counts = " ".join(f"{b.rating:.3g}:{b.alliances}" for b in bins)
    return f"{full} of {len(bins)} bins have >= {MIN_BIN_ALLIANCES} alliances (need {MIN_BINS}); rating:alliances {counts}"


def report(season: int, window: Window, fit: Fit, prior_season: int) -> str:
    if fit.converged:
        verdict = f"refit a and p (fixed point after {fit.rounds} round(s))"
    elif fit.refit_spread:
        verdict = f"refit a and p (stopped at the {MAX_ROUNDS}-round cap; a or p still moved more than {TOLERANCE:.1%})"
    else:
        verdict = f"kept season {prior_season}'s a and p; refit only mean and mean_auto"
    return "\n".join((
        f"season {season} window {window}",
        f"rated matches {fit.matches} (need {MIN_MATCHES} to refit a and p)",
        f"total: {_format_bins(fit.total_bins)}",
        f"auto: {_format_bins(fit.auto_bins)}",
        verdict,
        f"values {_format_params(fit.params)}",
    ))


def _prior(store: ParamStore, season: int) -> epa.Season:
    try:
        return store.season(season - 1)
    except UnknownSeason:
        return store.season(season)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="fit_params.py", description="Fit a season's EPA parameters from match data.")
    parser.add_argument("--season", type=int, required=True)
    parser.add_argument("--from", dest="start", type=date.fromisoformat, metavar="DATE")
    parser.add_argument("--to", dest="end", type=date.fromisoformat, metavar="DATE")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--write", action="store_true", help="write the fitted values to the season's seasons row")
    mode.add_argument(
        "--scan-december", action="store_true",
        help="fit every 14-day window starting in December and print the one closest to the seeded row",
    )
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    env: Mapping[str, str] = os.environ,
    fetch: Fetch | None = None,
    store: ParamStore | None = None,
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
        prior = _prior(store, args.season)
        data = fetch(epa.Season(args.season, prior.params))
        if args.scan_december:
            seeded = store.season(args.season).params
            scanned = scan_december(data, prior.params, seeded, args.season)
            if not scanned:
                raise NoMatches(f"no rated matches in any December {args.season} window")
            for window, fit, error in reversed(scanned):
                print(f"window {window} matches={fit.matches} refit_spread={fit.refit_spread} largest_error={error:.1%} {_format_params(fit.params)}")
            window, fit, error = scanned[0]
            if not fit.refit_spread:
                print(f"no December window passed the data gate; the closest kept season {prior.number}'s a and p")
            print(f"best window {window} largest relative error {error:.1%}")
            print("relative errors " + " ".join(f"{n}={e:+.1%}" for n, e in zip(NAMES, relative_errors(fit.params, seeded))))
            print(report(args.season, window, fit, prior.number))
            return 0
        window = Window(args.start, args.end)
        fit = fit_season(data, prior.params, window)
        print(report(args.season, window, fit, prior.number))
        if args.write:
            store.update_season_params(args.season, fit.params)
            print(f"wrote seasons row {args.season}")
        else:
            print("dry run; pass --write to update the seasons row")
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
