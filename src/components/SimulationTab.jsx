import { useMemo, useState } from 'react'
import { rankingRulesFor, replayRankings } from '../lib/rankings'
import { mulberry32, runSimulations, topNProbability, upcomingMatches } from '../lib/simulate'

const RUN_OPTIONS = [100, 1000, 10000]
const UNRANKED = '–'

function Th({ children, align = 'right', className = '' }) {
  return (
    <th className={`px-4 py-3 ${align === 'left' ? 'text-left' : 'text-right'} text-xs uppercase tracking-wider text-gray-400 ${className}`}>
      {children}
    </th>
  )
}

function TeamCell({ teamNumber, name }) {
  return (
    <td className="px-4 py-3">
      <span className="font-medium text-white">{teamNumber}</span>
      <span className="text-gray-400 ml-2">{name}</span>
    </td>
  )
}

function Table({ head, children }) {
  return (
    <div className="bg-gray-900 rounded-xl overflow-hidden border border-gray-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800">{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

const rowClass = 'border-b border-gray-800/60 last:border-0 hover:bg-gray-800/30 transition-colors'
const numCell = 'px-4 py-3 text-right tabular-nums'

function StandingsTable({ standings, names }) {
  return (
    <Table
      head={
        <>
          <Th align="left" className="w-16">Rank</Th>
          <Th align="left">Team</Th>
          <Th>Played</Th>
          <Th>RP</Th>
        </>
      }
    >
      {standings.map((row) => (
        <tr key={row.teamNumber} className={rowClass}>
          <td className="px-4 py-3 tabular-nums font-medium text-gray-300">{row.rank ?? UNRANKED}</td>
          <TeamCell teamNumber={row.teamNumber} name={names.get(row.teamNumber)} />
          <td className={`${numCell} text-gray-400`}>{row.matchesPlayed}</td>
          <td className={`${numCell} font-medium text-gray-200`}>{row.rank === null ? UNRANKED : row.rp.toFixed(2)}</td>
        </tr>
      ))}
    </Table>
  )
}

function ResultsTable({ result, names, topN }) {
  const rows = [...result.teams].sort((a, b) => a.meanRank - b.meanRank)
  return (
    <Table
      head={
        <>
          <Th align="left" className="w-16">Now</Th>
          <Th align="left">Team</Th>
          <Th>RP now</Th>
          <Th>Avg final RP</Th>
          <Th>Avg final rank</Th>
          <Th>Rank range</Th>
          <Th>Top {topN}</Th>
        </>
      }
    >
      {rows.map((t) => (
        <tr key={t.teamNumber} className={rowClass}>
          <td className="px-4 py-3 tabular-nums font-medium text-gray-300">{t.startRank ?? UNRANKED}</td>
          <TeamCell teamNumber={t.teamNumber} name={names.get(t.teamNumber)} />
          <td className={`${numCell} text-gray-400`}>{t.startRank === null ? UNRANKED : t.startRp.toFixed(2)}</td>
          <td className={`${numCell} font-medium text-gray-200`}>{t.meanRp.toFixed(2)}</td>
          <td className={`${numCell} font-medium text-blue-300`}>{t.meanRank.toFixed(1)}</td>
          <td className={`${numCell} text-gray-400`}>{t.p10Rank}–{t.p90Rank}</td>
          <td className={`${numCell} text-gray-200`}>{Math.round(topNProbability(t, topN, result.runs) * 100)}%</td>
        </tr>
      ))}
    </Table>
  )
}

function ReplayCheck({ standings, officialTeams }) {
  const byTeam = new Map(standings.map((row) => [row.teamNumber, row]))
  const official = officialTeams.filter((t) => t.stats)
  if (official.length === 0) return null
  const differing = official.filter((t) => {
    const row = byTeam.get(t.teamNumber)
    return !row || row.rank !== t.stats.rank || Math.abs(row.rp - t.stats.rp) > 1e-9
  })
  return differing.length === 0 ? (
    <p className="text-emerald-400 text-sm">
      Replayed standings match ftcscout's rank and RP for all {official.length} ranked teams.
    </p>
  ) : (
    <p className="text-amber-400 text-sm">
      Replayed standings differ from ftcscout for {differing.length} of {official.length} ranked teams.
    </p>
  )
}

function matchCount(count) {
  return `${count.toLocaleString()} ${count === 1 ? 'match' : 'matches'}`
}

function Notice({ children }) {
  return <div className="bg-gray-900 rounded-xl border border-gray-800 px-5 py-4 text-gray-300 text-sm">{children}</div>
}

function modelNote(rules, ratings, playedQuals) {
  const rating = ratings.size > 0 ? 'Teams rated by EPA.' : 'No EPA ratings loaded, so every team is rated average.'
  const bonus =
    rules.bonusRps.length === 0
      ? ''
      : playedQuals === 0
        ? ' Bonus RPs not modeled yet.'
        : " Each bonus RP is drawn at the alliance's average rate of earning it in the quals played so far."
  return `${rating}${bonus} Teams still playing break RP ties at random. Finished teams keep their order.`
}

function leaderSummary(result, names) {
  const leader = result.teams.reduce((best, t) => (t.rankCounts[0] > best.rankCounts[0] ? t : best))
  const name = names.get(leader.teamNumber)
  const share = Math.round((leader.rankCounts[0] / result.runs) * 100)
  return `${result.runs.toLocaleString()} simulations. Team ${leader.teamNumber}${name ? ` ${name}` : ''} finishes first most often, in ${share}% of runs.`
}

export default function SimulationTab({ event, season, ratings, seasonState, settings, onSettingsChange }) {
  const { params } = seasonState
  const rules = rankingRulesFor(season)
  const { runs, seed } = settings
  const [topNText, setTopNText] = useState(String(settings.topN))
  const [topNScope, setTopNScope] = useState(event.matches)
  const update = (patch) => onSettingsChange((current) => ({ ...current, ...patch }))

  const names = useMemo(() => new Map(event.teams.map((t) => [t.teamNumber, t.team?.name ?? ''])), [event.teams])
  const standings = useMemo(() => (rules ? replayRankings(event.matches, rules) : []), [event.matches, rules])
  const upcoming = useMemo(() => upcomingMatches(event), [event])
  const result = useMemo(
    () =>
      ratings && params && upcoming.length > 0 && standings.length > 0
        ? runSimulations({ standings, upcoming, ratings, params, rules, runs, rng: mulberry32(seed) })
        : null,
    [rules, standings, upcoming, ratings, params, runs, seed],
  )

  if (topNScope !== event.matches) {
    setTopNScope(event.matches)
    setTopNText(String(Math.min(settings.topN, standings.length)))
  }

  if (!rules) {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-800 px-5 py-10 text-center text-gray-500">
        Ranking rules for the {season} season are not available, so this event cannot be simulated.
      </div>
    )
  }
  if (standings.length === 0) {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-800 px-5 py-10 text-center text-gray-500">
        This event has no qualification matches scheduled.
      </div>
    )
  }

  const quals = event.matches.filter((m) => m.tournamentLevel === 'Quals')
  const playedQuals = quals.filter((m) => m.hasBeenPlayed).length
  const neverPlayed = upcoming.length === 0 ? quals.length - playedQuals : 0
  const topN = Math.min(settings.topN, standings.length)
  const commitTopN = (text) => {
    const value = Number(text)
    if (text.trim() !== '' && Number.isFinite(value)) update({ topN: Math.min(standings.length, Math.max(1, Math.round(value))) })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-gray-300 text-sm">
          {playedQuals} of {quals.length} qualification matches played. Starting standings are replayed from the match results.
        </p>
        <ReplayCheck standings={standings} officialTeams={event.teams} />
      </div>

      {upcoming.length === 0 && (
        <>
          <Notice>
            {neverPlayed > 0
              ? `The event is over, so these are the final standings. ${neverPlayed === 1 ? '1 scheduled qualification match was' : `${neverPlayed} scheduled qualification matches were`} not played.`
              : 'All qualification matches are played, so there is nothing to simulate. These are the final standings.'}
          </Notice>
          <StandingsTable standings={standings} names={names} />
        </>
      )}

      {upcoming.length > 0 && seasonState.error && <Notice>{seasonState.error}. The simulation is unavailable.</Notice>}
      {upcoming.length > 0 && !seasonState.error && !(ratings && params) && <Notice>Loading EPA ratings…</Notice>}

      {result && (
        <>
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-300">
            <label className="flex items-center gap-2">
              Simulations
              <select
                value={runs}
                onChange={(e) => update({ runs: Number(e.target.value) })}
                className="bg-gray-900 border border-gray-700 rounded-md px-2 py-1 text-white"
              >
                {RUN_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n.toLocaleString()}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              Top
              <input
                type="number"
                min={1}
                max={standings.length}
                step={1}
                value={topNText}
                onChange={(e) => {
                  setTopNText(e.target.value)
                  commitTopN(e.target.value)
                }}
                onBlur={() => setTopNText(String(topN))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
                className="bg-gray-900 border border-gray-700 rounded-md px-2 py-1 w-16 text-white"
              />
            </label>
            <button
              onClick={() => update({ seed: Math.floor(Math.random() * 2 ** 32) })}
              className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors"
            >
              Run again
            </button>
            <span className="text-gray-500">
              {matchCount(upcoming.length)} left. {modelNote(rules, ratings, playedQuals)}
            </span>
          </div>
          <p aria-live="polite" className="text-gray-300 text-sm">{leaderSummary(result, names)}</p>
          <ResultsTable result={result} names={names} topN={topN} />
        </>
      )}
    </div>
  )
}
