import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { ftcscoutQuery } from '../lib/ftcscout'
import Navbar from '../components/Navbar'

const SEASON = 2025
const A_PARAM = 2.1482
const P_PARAM = 0.6543
const MEAN_TEAM_EPA = 113.30 / 2  // fallback when no pre-match EPA entry exists

const MATCHES_QUERY = `
  query TeamMatches($number: Int!, $season: Int!) {
    teamByNumber(number: $number) {
      events(season: $season) {
        matches {
          alliance
          eventCode
          match {
            teams {
              teamNumber
              alliance
              onField
            }
            matchNum
            scheduledStartTime
            postResultTime
            hasBeenPlayed
            scores {
              ... on MatchScores2025 {
                red { totalPoints autoPoints }
                blue { totalPoints autoPoints }
              }
            }
          }
        }
      }
    }
  }
`

// ── Math ─────────────────────────────────────────────────────────────────────

// Abramowitz & Stegun approximation, max error 1.5e-7
function erf(x) {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * ax)
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
  return sign * (1 - poly * Math.exp(-ax * ax))
}

function normalCDF(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2))
}

// ── EPA helpers ───────────────────────────────────────────────────────────────

function buildEpaLookup(epaJsonb) {
  if (!epaJsonb) return []
  return Object.entries(epaJsonb)
    .map(([ts, value]) => ({ ms: new Date(ts).getTime(), value }))
    .filter(({ ms }) => !isNaN(ms))
    .sort((a, b) => a.ms - b.ms)
}

function getEpaBeforeTime(sortedEntries, matchMs) {
  let result = null
  for (const { ms, value } of sortedEntries) {
    if (ms <= matchMs) result = value
    else break
  }
  return result
}

function calcRedWinProb(r1, r2, b1, b2) {
  const red = (r1 ?? 0) + (r2 ?? 0)
  const blue = (b1 ?? 0) + (b2 ?? 0)
  const redStd = A_PARAM * Math.pow(Math.max(1, red), P_PARAM)
  const blueStd = A_PARAM * Math.pow(Math.max(1, blue), P_PARAM)
  const z = (0 - (red - blue)) / Math.sqrt(redStd ** 2 + blueStd ** 2)
  return 1-normalCDF(z)
}

function getMatchPredictions(matchTeams, postResultTime, teamEpas) {
  if (Object.keys(teamEpas).length === 0) return null
  const resultMs = postResultTime ? new Date(postResultTime).getTime() : null
  const red = matchTeams.filter((t) => t.alliance === 'Red' && t.onField)
  const blue = matchTeams.filter((t) => t.alliance === 'Blue' && t.onField)

  const getEpa = (num) => {
    const entries = teamEpas[num]
    if (!entries || entries.length === 0) return MEAN_TEAM_EPA
    if (resultMs == null) return entries[entries.length - 1].value
    return getEpaBeforeTime(entries, resultMs) ?? MEAN_TEAM_EPA
  }

  const r1 = getEpa(red[0]?.teamNumber)
  const r2 = getEpa(red[1]?.teamNumber)
  const b1 = getEpa(blue[0]?.teamNumber)
  const b2 = getEpa(blue[1]?.teamNumber)

  return {
    winProb: calcRedWinProb(r1, r2, b1, b2),
    redPred: r1 + r2,
    bluePred: b1 + b2,
  }
}

// ── Data helpers ──────────────────────────────────────────────────────────────

function buildChartData(epa, autoEpa, telepEpa) {
  const allTimestamps = new Set([
    ...Object.keys(epa ?? {}),
    ...Object.keys(autoEpa ?? {}),
    ...Object.keys(telepEpa ?? {}),
  ])
  const sorted = [...allTimestamps].sort()
  return sorted.map((ts, idx) => ({
    index: idx + 1,
    timestamp: new Date(ts).toLocaleTimeString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    total: epa?.[ts] ?? null,
    auto: autoEpa?.[ts] ?? null,
    teleop: telepEpa?.[ts] ?? null,
  }))
}

function groupMatchesByEvent(events) {
  const byEvent = {}
  for (const event of events) {
    for (const m of event.matches) {
      if (!byEvent[m.eventCode]) byEvent[m.eventCode] = []
      byEvent[m.eventCode].push(m)
    }
  }
  for (const code of Object.keys(byEvent)) {
    byEvent[code].sort(
      (a, b) =>
        new Date(a.match.scheduledStartTime) - new Date(b.match.scheduledStartTime),
    )
  }
  return Object.entries(byEvent).sort(
    (a, b) =>
      new Date(a[1][0].match.scheduledStartTime) -
      new Date(b[1][0].match.scheduledStartTime),
  )
}

function formatTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// ── Components ────────────────────────────────────────────────────────────────

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const ts = payload[0]?.payload?.timestamp
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-sm shadow-xl">
      {ts && <p className="text-gray-400 mb-2 text-xs">{ts}</p>}
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2 mb-0.5">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: entry.color }} />
          <span className="text-gray-300 capitalize">{entry.name}:</span>
          <span className="font-medium text-white tabular-nums">
            {entry.value != null ? entry.value.toFixed(3) : '—'}
          </span>
        </div>
      ))}
    </div>
  )
}

function AllianceTeams({ teams, alliance, highlightNumber }) {
  const isRed = alliance === 'Red'
  const side = teams
    .filter((t) => t.alliance === alliance)
    .sort((a, b) => (b.onField ? 1 : 0) - (a.onField ? 1 : 0))
  return (
    <div className="flex gap-1.5 flex-wrap">
      {side.map((t) => {
        const hi = t.teamNumber === highlightNumber
        const surrogate = !t.onField
        return (
          <span
            key={t.teamNumber}
            className={[
              'px-2 py-0.5 rounded text-xs font-medium tabular-nums',
              surrogate
                ? 'opacity-40'
                : '',
              hi
                ? isRed ? 'bg-red-500 text-white' : 'bg-blue-500 text-white'
                : isRed ? 'bg-red-950 text-red-300' : 'bg-blue-950 text-blue-300',
            ].join(' ')}
            title={surrogate ? 'Surrogate (not on field)' : undefined}
          >
            {t.teamNumber}
          </span>
        )
      })}
    </div>
  )
}

function ScoreCell({ scores, teamAlliance }) {
  let outcome = null
  if (scores) {
    const r = scores.red?.totalPoints
    const b = scores.blue?.totalPoints
    if (typeof r === 'number' && typeof b === 'number') {
      if (teamAlliance === 'Red') outcome = r > b ? 'W' : r < b ? 'L' : 'T'
      else outcome = b > r ? 'W' : b < r ? 'L' : 'T'
    }
  }

  return (
    <div className="flex items-center gap-1.5 text-sm">
      {outcome && (
        <span
          className={`text-xs font-bold w-3 ${
            outcome === 'W'
              ? 'text-emerald-400'
              : outcome === 'L'
              ? 'text-red-400'
              : 'text-yellow-400'
          }`}
        >
          {outcome}
        </span>
      )}
      {scores ? (
        <>
          <span className="text-red-300 tabular-nums">
            {scores.red?.totalPoints ?? '?'}
          </span>
          <span className="text-gray-600">–</span>
          <span className="text-blue-300 tabular-nums">
            {scores.blue?.totalPoints ?? '?'}
          </span>
        </>
      ) : (
        <span className="text-gray-600">—</span>
      )}
    </div>
  )
}

function PredCell({ winProb, redPred, bluePred, teamAlliance }) {
  if (winProb == null) return <span className="text-gray-600 text-sm">—</span>
  const redPct = Math.round(winProb * 100)
  const bluePct = 100 - redPct

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1 text-sm">
        <span className="text-red-300 tabular-nums">{redPred.toFixed(1)}</span>
        <span className="text-gray-600">–</span>
        <span className="text-blue-300 tabular-nums">{bluePred.toFixed(1)}</span>
      </div>
      <div className="space-y-0.5">
        <div className="flex h-1.5 w-28 rounded-full overflow-hidden">
          <div className="bg-red-500/70" style={{ width: `${redPct}%` }} />
          <div className="bg-blue-500/70" style={{ width: `${bluePct}%` }} />
        </div>
        <div className="flex justify-between w-28 text-xs">
          <span className={teamAlliance === 'Red' ? 'text-red-400 font-medium' : 'text-red-700'}>
            R {redPct}%
          </span>
          <span className={teamAlliance === 'Blue' ? 'text-blue-400 font-medium' : 'text-blue-700'}>
            B {bluePct}%
          </span>
        </div>
      </div>
    </div>
  )
}

function EventMatchTable({ eventCode, matches, teamNumber, teamEpas }) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-800 flex items-center gap-3">
        <h3 className="font-semibold text-white text-sm">{eventCode}</h3>
        <span className="text-gray-500 text-xs">{matches.length} matches</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wider text-gray-500 border-b border-gray-800">
            <th className="text-left px-5 py-2.5 w-10">#</th>
            <th className="text-left px-5 py-2.5">Time</th>
            <th className="text-left px-5 py-2.5">Red Alliance</th>
            <th className="text-left px-5 py-2.5">Blue Alliance</th>
            <th className="text-left px-5 py-2.5">Result</th>
            <th className="text-left px-5 py-2.5">Predicted / Win Prob</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m, i) => {
            const preds = getMatchPredictions(
              m.match.teams,
              m.match.postResultTime,
              teamEpas,
            )
            return (
              <tr
                key={i}
                className="border-b border-gray-800/50 last:border-0 hover:bg-gray-800/30 transition-colors"
              >
                <td className="px-5 py-3 text-gray-500 tabular-nums">{m.match.matchNum}</td>
                <td className="px-5 py-3 text-gray-400 text-xs whitespace-nowrap">
                  {formatTime(m.match.scheduledStartTime)}
                </td>
                <td className="px-5 py-3">
                  <AllianceTeams
                    teams={m.match.teams}
                    alliance="Red"
                    highlightNumber={teamNumber}
                  />
                </td>
                <td className="px-5 py-3">
                  <AllianceTeams
                    teams={m.match.teams}
                    alliance="Blue"
                    highlightNumber={teamNumber}
                  />
                </td>
                <td className="px-5 py-3">
                  <ScoreCell scores={m.match.scores} teamAlliance={m.alliance} />
                </td>
                <td className="px-5 py-3">
                  <PredCell
                    winProb={preds?.winProb ?? null}
                    redPred={preds?.redPred ?? null}
                    bluePred={preds?.bluePred ?? null}
                    teamAlliance={m.alliance}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TeamPage() {
  const { teamNumber } = useParams()
  const navigate = useNavigate()
  const teamNum = parseInt(teamNumber, 10)

  const [team, setTeam] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [matchEvents, setMatchEvents] = useState([])
  const [matchesLoading, setMatchesLoading] = useState(true)
  const [matchesError, setMatchesError] = useState(null)

  // teamNumber -> sorted [{ms, value}] EPA lookup
  const [teamEpas, setTeamEpas] = useState({})
  const [ranks, setRanks] = useState(null)

  useEffect(() => {
    async function fetchTeam() {
      const { data, error } = await supabase
        .from('epa_snapshots')
        .select('*')
        .eq('team_number', teamNumber)
        .single()
      if (error) setError(error.message)
      else setTeam(data)
      setLoading(false)
    }
    fetchTeam()
  }, [teamNumber])

  useEffect(() => {
    if (!team) return
    async function fetchRanks() {
      const [epaRes, autoRes, telepRes] = await Promise.all([
        supabase.from('epa_snapshots').select('*', { count: 'exact', head: true }).gt('current_epa', team.current_epa),
        supabase.from('epa_snapshots').select('*', { count: 'exact', head: true }).gt('current_auto_epa', team.current_auto_epa),
        supabase.from('epa_snapshots').select('*', { count: 'exact', head: true }).gt('current_teleop_epa', team.current_teleop_epa),
      ])
      setRanks({
        epa: (epaRes.count ?? 0) + 1,
        auto: (autoRes.count ?? 0) + 1,
        teleop: (telepRes.count ?? 0) + 1,
      })
    }
    fetchRanks()
  }, [team])

  useEffect(() => {
    async function fetchMatches() {
      try {
        const data = await ftcscoutQuery(MATCHES_QUERY, { number: teamNum, season: SEASON })
        const events = data?.teamByNumber?.events ?? []
        setMatchEvents(groupMatchesByEvent(events))
      } catch (e) {
        setMatchesError(e.message)
      }
      setMatchesLoading(false)
    }
    fetchMatches()
  }, [teamNum])

  // Once match events are loaded, fetch EPA history for every team that appears
  useEffect(() => {
    if (matchEvents.length === 0) return

    async function fetchTeamEpas() {
      const teamNumbers = new Set()
      for (const [, matches] of matchEvents) {
        for (const m of matches) {
          for (const t of m.match.teams) teamNumbers.add(t.teamNumber)
        }
      }

      const { data, error } = await supabase
        .from('epa_snapshots')
        .select('team_number, epa')
        .in('team_number', [...teamNumbers])

      if (error) {
        console.error('Failed to fetch team EPAs for win probability:', error)
        return
      }

      const map = {}
      for (const row of data) map[row.team_number] = buildEpaLookup(row.epa)
      setTeamEpas(map)
    }

    fetchTeamEpas()
  }, [matchEvents])

  const chartData = team
    ? buildChartData(team.epa, team.auto_epa, team.teleop_epa)
    : []

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Navbar />
      <div className="max-w-5xl mx-auto p-6">
        <button
          onClick={() => navigate('/')}
          className="text-gray-400 hover:text-white text-sm mb-6 flex items-center gap-1.5 transition-colors"
        >
          ← All Teams
        </button>

        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded-lg p-4 text-red-300 mb-4">
            {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-20 text-gray-500">
            Loading team…
          </div>
        )}

        {!loading && team && (
          <>
            {/* Header */}
            <div className="mb-8">
              <div className="flex items-baseline gap-3 mb-1">
                <h1 className="text-3xl font-bold text-white">{team.team_number}</h1>
                <span className="text-xl text-gray-400">{team.team_name}</span>
              </div>
              <div className="grid grid-cols-3 gap-4 mt-5">
                <StatCard label="Total EPA" value={team.current_epa} color="text-blue-400" rank={ranks?.epa} />
                <StatCard label="Auto EPA" value={team.current_auto_epa} color="text-emerald-400" rank={ranks?.auto} />
                <StatCard label="Teleop EPA" value={team.current_teleop_epa} color="text-violet-400" rank={ranks?.teleop} />
              </div>
            </div>

            {/* EPA Chart */}
            {chartData.length > 0 ? (
              <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 mb-8">
                <h2 className="text-lg font-semibold text-white mb-5">EPA Over Time</h2>
                <ResponsiveContainer width="100%" height={380}>
                  <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis
                      dataKey="index"
                      tick={{ fill: '#6b7280', fontSize: 12 }}
                      axisLine={{ stroke: '#374151' }}
                      tickLine={false}
                      label={{
                        value: 'Match / Event',
                        position: 'insideBottom',
                        offset: -2,
                        fill: '#6b7280',
                        fontSize: 12,
                      }}
                    />
                    <YAxis
                      tick={{ fill: '#6b7280', fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                      width={52}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ paddingTop: 16, fontSize: 13, color: '#9ca3af' }} />
                    <Line type="monotone" dataKey="total" name="Total" stroke="#60a5fa" strokeWidth={2} dot={false} activeDot={{ r: 5 }} connectNulls />
                    <Line type="monotone" dataKey="auto" name="Auto" stroke="#34d399" strokeWidth={2} dot={false} activeDot={{ r: 5 }} connectNulls />
                    <Line type="monotone" dataKey="teleop" name="Teleop" stroke="#a78bfa" strokeWidth={2} dot={false} activeDot={{ r: 5 }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="bg-gray-900 rounded-xl border border-gray-800 p-10 text-center text-gray-500 mb-8">
                No historical EPA data available.
              </div>
            )}

            {/* Match History */}
            <div>
              <h2 className="text-lg font-semibold text-white mb-4">
                Match History
                <span className="text-gray-500 text-sm font-normal ml-2">
                  {SEASON}/{SEASON + 1} season
                </span>
              </h2>

              {matchesLoading && (
                <div className="text-gray-500 text-sm py-6">Loading matches…</div>
              )}

              {matchesError && (
                <div className="bg-red-900/40 border border-red-700 rounded-lg p-4 text-red-300 text-sm">
                  {matchesError}
                </div>
              )}

              {!matchesLoading && !matchesError && matchEvents.length === 0 && (
                <div className="bg-gray-900 rounded-xl border border-gray-800 p-10 text-center text-gray-500">
                  No matches found for this season.
                </div>
              )}

              {!matchesLoading && matchEvents.length > 0 && (
                <div className="flex flex-col gap-5">
                  {matchEvents.map(([eventCode, matches]) => (
                    <EventMatchTable
                      key={eventCode}
                      eventCode={eventCode}
                      matches={matches}
                      teamNumber={teamNum}
                      teamEpas={teamEpas}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, color, rank }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4">
      <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${color}`}>
        {value != null ? value.toFixed(2) : '—'}
      </p>
      {rank != null && (
        <p className="text-gray-600 text-xs mt-1 tabular-nums">Rank #{rank}</p>
      )}
    </div>
  )
}
