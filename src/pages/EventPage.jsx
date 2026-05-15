import { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { ftcscoutQuery } from '../lib/ftcscout'
import { supabase } from '../lib/supabase'

const SEASON = 2025
const A_PARAM = 2.1482
const P_PARAM = 0.6543
const MEAN_TEAM_EPA = 113.30 / 2

const EVENT_QUERY = `
  query EventByCode($season: Int!, $code: String!) {
    eventByCode(season: $season, code: $code) {
      location { city country state }
      start
      end
      code
      matches {
        matchNum
        scheduledStartTime
        postResultTime
        teams {
          teamNumber
          onField
          alliance
        }
        scores {
          ... on MatchScores2025 {
            red { totalPoints }
            blue { totalPoints }
          }
        }
      }
      teams {
        team { name number }
      }
    }
  }
`

// ── Math ─────────────────────────────────────────────────────────────────────

function erf(x) {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * ax)
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
  return sign * (1 - poly * Math.exp(-ax * ax))
}
function normalCDF(x) { return 0.5 * (1 + erf(x / Math.SQRT2)) }

// ── EPA helpers ───────────────────────────────────────────────────────────────

function buildEpaLookup(epaJsonb) {
  if (!epaJsonb) return []
  return Object.entries(epaJsonb)
    .map(([ts, value]) => ({ ms: new Date(ts).getTime(), value }))
    .filter(({ ms }) => !isNaN(ms))
    .sort((a, b) => a.ms - b.ms)
}

function getEpaBeforeTime(entries, matchMs) {
  let result = null
  for (const { ms, value } of entries) {
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
  return 1 - normalCDF(z)
}

function getMatchPredictions(matchTeams, postResultTime, epaLookups) {
  if (Object.keys(epaLookups).length === 0) return null
  const resultMs = postResultTime ? new Date(postResultTime).getTime() : null
  const red = matchTeams.filter((t) => t.alliance === 'Red' && t.onField)
  const blue = matchTeams.filter((t) => t.alliance === 'Blue' && t.onField)

  const getEpa = (num) => {
    const entries = epaLookups[num]
    if (!entries || entries.length === 0) return MEAN_TEAM_EPA
    if (resultMs == null) return entries[entries.length - 1].value
    return getEpaBeforeTime(entries, resultMs) ?? MEAN_TEAM_EPA
  }

  const r1 = getEpa(red[0]?.teamNumber)
  const r2 = getEpa(red[1]?.teamNumber)
  const b1 = getEpa(blue[0]?.teamNumber)
  const b2 = getEpa(blue[1]?.teamNumber)

  return { winProb: calcRedWinProb(r1, r2, b1, b2), redPred: r1 + r2, bluePred: b1 + b2 }
}

// ── Formatting ────────────────────────────────────────────────────────────────

function formatDateRange(start, end) {
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
  const fmt = (d, opts) => d.toLocaleDateString(undefined, opts)
  const s = parse(start), e = parse(end)
  if (start === end) return fmt(s, { month: 'short', day: 'numeric', year: 'numeric' })
  const sameYear = s.getFullYear() === e.getFullYear()
  const sameMonth = sameYear && s.getMonth() === e.getMonth()
  if (sameMonth) return `${fmt(s, { month: 'short', day: 'numeric' })}–${fmt(e, { day: 'numeric', year: 'numeric' })}`
  if (sameYear) return `${fmt(s, { month: 'short', day: 'numeric' })} – ${fmt(e, { month: 'short', day: 'numeric', year: 'numeric' })}`
  return `${fmt(s, { month: 'short', day: 'numeric', year: 'numeric' })} – ${fmt(e, { month: 'short', day: 'numeric', year: 'numeric' })}`
}

function formatTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

// ── Components ────────────────────────────────────────────────────────────────

function TabButton({ label, count, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
        active ? 'border-blue-500 text-white' : 'border-transparent text-gray-400 hover:text-white'
      }`}
    >
      {label}
      {count != null && (
        <span className={`text-xs px-1.5 py-0.5 rounded-full ${active ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400'}`}>
          {count}
        </span>
      )}
    </button>
  )
}

function AllianceTeams({ teams, alliance }) {
  const side = teams
    .filter((t) => t.alliance === alliance)
    .sort((a, b) => (b.onField ? 1 : 0) - (a.onField ? 1 : 0))
  const isRed = alliance === 'Red'
  return (
    <div className="flex gap-1.5 flex-wrap">
      {side.map((t) => (
        <span
          key={t.teamNumber}
          className={[
            'px-2 py-0.5 rounded text-xs font-medium tabular-nums',
            !t.onField ? 'opacity-40' : '',
            isRed ? 'bg-red-950 text-red-300' : 'bg-blue-950 text-blue-300',
          ].join(' ')}
          title={!t.onField ? 'Surrogate (not on field)' : undefined}
        >
          {t.teamNumber}
        </span>
      ))}
    </div>
  )
}

function ScoreCell({ scores }) {
  if (!scores) return <span className="text-gray-600 text-sm">—</span>
  const r = scores.red?.totalPoints
  const b = scores.blue?.totalPoints
  if (r == null && b == null) return <span className="text-gray-600 text-sm">—</span>
  const redWon = typeof r === 'number' && typeof b === 'number' && r > b
  const blueWon = typeof r === 'number' && typeof b === 'number' && b > r
  return (
    <div className="flex items-center gap-1 text-sm">
      <span className={`tabular-nums ${redWon ? 'text-red-300 font-semibold' : 'text-red-300/60'}`}>{r ?? '?'}</span>
      <span className="text-gray-600">–</span>
      <span className={`tabular-nums ${blueWon ? 'text-blue-300 font-semibold' : 'text-blue-300/60'}`}>{b ?? '?'}</span>
    </div>
  )
}

function PredCell({ winProb, redPred, bluePred }) {
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
          <span className="text-red-500">R {redPct}%</span>
          <span className="text-blue-500">B {bluePct}%</span>
        </div>
      </div>
    </div>
  )
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function TeamsTab({ teams, supabaseData, navigate }) {
  const merged = teams
    .map(({ team }) => ({ number: team.number, name: team.name, ...(supabaseData[team.number] ?? {}) }))
    .sort((a, b) => (b.current_epa ?? -Infinity) - (a.current_epa ?? -Infinity))

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wider text-gray-500 border-b border-gray-800">
            <th className="text-left px-5 py-3 w-8">#</th>
            <th className="text-left px-5 py-3">Team</th>
            <th className="text-right px-5 py-3">Total EPA</th>
            <th className="text-right px-5 py-3">Auto EPA</th>
            <th className="text-right px-5 py-3">Teleop EPA</th>
          </tr>
        </thead>
        <tbody>
          {merged.map((team, i) => (
            <tr
              key={team.number}
              onClick={() => navigate(`/team/${team.number}`)}
              className="border-b border-gray-800/60 last:border-0 hover:bg-gray-800/50 cursor-pointer transition-colors"
            >
              <td className="px-5 py-3.5 text-gray-500 tabular-nums">{i + 1}</td>
              <td className="px-5 py-3.5">
                <span className="font-medium text-white">{team.number}</span>
                <span className="text-gray-400 ml-2">{team.name}</span>
              </td>
              <td className="px-5 py-3.5 text-right tabular-nums font-medium text-blue-300">
                {team.current_epa?.toFixed(2) ?? '—'}
              </td>
              <td className="px-5 py-3.5 text-right tabular-nums text-gray-400">
                {team.current_auto_epa?.toFixed(2) ?? '—'}
              </td>
              <td className="px-5 py-3.5 text-right tabular-nums text-gray-400">
                {team.current_teleop_epa?.toFixed(2) ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MatchesTab({ matches, epaLookups }) {
  const sorted = [...matches].sort(
    (a, b) => new Date(a.scheduledStartTime) - new Date(b.scheduledStartTime),
  )

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wider text-gray-500 border-b border-gray-800">
            <th className="text-left px-5 py-2.5 w-10">#</th>
            <th className="text-left px-5 py-2.5">Time</th>
            <th className="text-left px-5 py-2.5">Red Alliance</th>
            <th className="text-left px-5 py-2.5">Blue Alliance</th>
            <th className="text-left px-5 py-2.5">Score</th>
            <th className="text-left px-5 py-2.5">Predicted / Win Prob</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((m, i) => {
            const preds = getMatchPredictions(m.teams, m.postResultTime, epaLookups)
            return (
              <tr
                key={i}
                className="border-b border-gray-800/50 last:border-0 hover:bg-gray-800/30 transition-colors"
              >
                <td className="px-5 py-3 text-gray-500 tabular-nums">{m.matchNum}</td>
                <td className="px-5 py-3 text-gray-400 text-xs whitespace-nowrap">
                  {formatTime(m.scheduledStartTime)}
                </td>
                <td className="px-5 py-3">
                  <AllianceTeams teams={m.teams} alliance="Red" />
                </td>
                <td className="px-5 py-3">
                  <AllianceTeams teams={m.teams} alliance="Blue" />
                </td>
                <td className="px-5 py-3">
                  <ScoreCell scores={m.scores} />
                </td>
                <td className="px-5 py-3">
                  <PredCell
                    winProb={preds?.winProb ?? null}
                    redPred={preds?.redPred ?? null}
                    bluePred={preds?.bluePred ?? null}
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

export default function EventPage() {
  const { eventCode } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const eventName = location.state?.name

  const [event, setEvent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // team_number -> { current_epa, current_auto_epa, current_teleop_epa }
  const [supabaseData, setSupabaseData] = useState({})
  // team_number -> sorted [{ms, value}] for win probability
  const [epaLookups, setEpaLookups] = useState({})

  const [activeTab, setActiveTab] = useState('teams')

  useEffect(() => {
    async function fetchEvent() {
      try {
        const data = await ftcscoutQuery(EVENT_QUERY, { season: SEASON, code: eventCode })
        setEvent(data?.eventByCode ?? null)
      } catch (e) {
        setError(e.message)
      }
      setLoading(false)
    }
    fetchEvent()
  }, [eventCode])

  useEffect(() => {
    if (!event) return

    async function fetchTeamData() {
      const numbers = new Set()
      event.teams.forEach(({ team }) => numbers.add(team.number))
      event.matches.forEach((m) => m.teams.forEach((t) => numbers.add(t.teamNumber)))

      const { data, error } = await supabase
        .from('epa_snapshots')
        .select('team_number, current_epa, current_auto_epa, current_teleop_epa, epa')
        .in('team_number', [...numbers])

      if (error) return

      const sb = {}, lookups = {}
      for (const row of data) {
        sb[row.team_number] = {
          current_epa: row.current_epa,
          current_auto_epa: row.current_auto_epa,
          current_teleop_epa: row.current_teleop_epa,
        }
        lookups[row.team_number] = buildEpaLookup(row.epa)
      }
      setSupabaseData(sb)
      setEpaLookups(lookups)
    }

    fetchTeamData()
  }, [event])

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Navbar />
      <div className="max-w-5xl mx-auto p-6">
        <button
          onClick={() => navigate('/events')}
          className="text-gray-400 hover:text-white text-sm mb-6 flex items-center gap-1.5 transition-colors"
        >
          ← All Events
        </button>

        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded-lg p-4 text-red-300 mb-4 text-sm">
            {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-20 text-gray-500">
            Loading event…
          </div>
        )}

        {!loading && event && (
          <>
            {/* Header */}
            <div className="mb-6">
              <h1 className="text-3xl font-bold text-white mb-1">
                {eventName ?? event.code}
              </h1>
              <div className="flex items-center gap-3 text-gray-400 text-sm">
                {event.code !== eventName && (
                  <span className="font-mono text-gray-500">{event.code}</span>
                )}
                <span>{[event.location.city, event.location.country].filter(Boolean).join(', ')}</span>
                <span className="text-gray-600">·</span>
                <span>{formatDateRange(event.start, event.end)}</span>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-800 mb-6">
              <TabButton
                label="Teams"
                count={event.teams.length}
                active={activeTab === 'teams'}
                onClick={() => setActiveTab('teams')}
              />
              <TabButton
                label="Matches"
                count={event.matches.length}
                active={activeTab === 'matches'}
                onClick={() => setActiveTab('matches')}
              />
            </div>

            {activeTab === 'teams' && (
              <TeamsTab
                teams={event.teams}
                supabaseData={supabaseData}
                navigate={navigate}
              />
            )}

            {activeTab === 'matches' && (
              <MatchesTab matches={event.matches} epaLookups={epaLookups} />
            )}
          </>
        )}
      </div>
    </div>
  )
}
