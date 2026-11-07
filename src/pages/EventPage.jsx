import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { ftcscoutQuery } from '../lib/ftcscout'
import { supabase } from '../lib/supabase'
import { CURRENT_SEASON } from '../lib/constants'
import { useSeason } from '../lib/useSeason'
import SortableTeamsTable from '../components/SortableTeamsTable'
import SimulationTab from '../components/SimulationTab'
import { getEventQuery } from '../lib/eventQuery'
import { calcRedWinProb } from '../lib/winProbability'


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

function getMatchPredictions(matchTeams, postResultTime, epaLookups, params) {
  if (Object.keys(epaLookups).length === 0) return null
  const resultMs = postResultTime ? new Date(postResultTime).getTime() : null
  const red = matchTeams.filter((t) => t.alliance === 'Red' && t.onField)
  const blue = matchTeams.filter((t) => t.alliance === 'Blue' && t.onField)

  const getEpa = (num) => {
    const entries = epaLookups[num]
    if (!entries || entries.length === 0) return params.mean
    if (resultMs == null) return entries[entries.length - 1].value
    return getEpaBeforeTime(entries, resultMs) ?? params.mean
  }

  const r1 = getEpa(red[0]?.teamNumber)
  const r2 = getEpa(red[1]?.teamNumber)
  const b1 = getEpa(blue[0]?.teamNumber)
  const b2 = getEpa(blue[1]?.teamNumber)

  return { winProb: calcRedWinProb(r1, r2, b1, b2, params), redPred: r1 + r2, bluePred: b1 + b2 }
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

function PredCell({ seasonStatus, winProb, redPred, bluePred }) {
  if (seasonStatus === 'loading') return <span className="text-gray-700 text-sm animate-pulse">…</span>
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

function TeamsTab({ teams, supabaseData, season }) {
  const [sortKey, setSortKey] = useState('current_epa')
  const [sortDir, setSortDir] = useState('desc')

  const sorted = useMemo(() => {
    const merged = teams.map(({ team }) => ({
      team_number: team.number,
      team_name: team.name,
      ...(supabaseData[team.number] ?? {}),
    }))
    return merged.sort((a, b) => {
      const av = a[sortKey] ?? -Infinity
      const bv = b[sortKey] ?? -Infinity
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }, [teams, supabaseData, sortKey, sortDir])

  return (
    <SortableTeamsTable
      teams={sorted}
      season={season}
      sortKey={sortKey}
      sortDir={sortDir}
      onSortChange={(key, dir) => { setSortKey(key); setSortDir(dir) }}
    />
  )
}

function MatchesTab({ matches, epaLookups, seasonState }) {
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
            const preds = seasonState.params
              ? getMatchPredictions(m.teams, m.postResultTime, epaLookups, seasonState.params)
              : null
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
                    seasonStatus={seasonState.status}
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

const RANKINGS_COLS = [
  { key: 'rank',  label: 'Rank', sortable: true,  align: 'left',   className: 'w-16' },
  { key: null,    label: 'Team', sortable: false,  align: 'left'   },
  { key: null,    label: 'Record', sortable: false, align: 'center' },
  { key: 'rp',   label: 'RP',   sortable: true,  align: 'right'  },
  { key: 'tb1',  label: 'TB1',  sortable: true,  align: 'right'  },
  { key: 'tb2',  label: 'TB2',  sortable: true,  align: 'right'  },
]

function RankSortIcon({ active, direction }) {
  if (!active) return <span className="ml-1 text-gray-600 select-none">↕</span>
  return <span className="ml-1 text-blue-400 select-none">{direction === 'asc' ? '↑' : '↓'}</span>
}

function RankingsTab({ teams }) {
  const [sortKey, setSortKey] = useState('rank')
  const [sortDir, setSortDir] = useState('asc')

  const rows = useMemo(() => {
    const mapped = teams
      .filter((t) => t.stats)
      .map((t) => ({
        teamNumber: t.teamNumber,
        teamName: t.team?.name ?? '',
        rank: t.stats.rank,
        rp: t.stats.rp,
        tb1: t.stats.tb1,
        tb2: t.stats.tb2,
        wins: t.stats.wins,
        losses: t.stats.losses,
        ties: t.stats.ties,
      }))
    return [...mapped].sort((a, b) => {
      const av = a[sortKey] ?? (sortDir === 'asc' ? Infinity : -Infinity)
      const bv = b[sortKey] ?? (sortDir === 'asc' ? Infinity : -Infinity)
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }, [teams, sortKey, sortDir])

  function handleHeaderClick(key) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'rank' ? 'asc' : 'desc')
    }
  }

  return (
    <div className="bg-gray-900 rounded-xl overflow-hidden border border-gray-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wider">
            {RANKINGS_COLS.map((col) => (
              <th
                key={col.label}
                onClick={col.sortable ? () => handleHeaderClick(col.key) : undefined}
                className={[
                  col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
                  'px-5 py-3 select-none',
                  col.sortable ? 'cursor-pointer hover:text-white transition-colors' : '',
                  col.sortable && sortKey === col.key ? 'text-blue-400' : '',
                  col.className ?? '',
                ].join(' ')}
              >
                {col.label}
                {col.sortable && <RankSortIcon active={sortKey === col.key} direction={sortDir} />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-5 py-10 text-center text-gray-500">No ranking data available.</td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.teamNumber}
                className="border-b border-gray-800/60 last:border-0 hover:bg-gray-800/30 transition-colors"
              >
                <td className="px-5 py-3.5 tabular-nums font-medium text-gray-300">{row.rank ?? '—'}</td>
                <td className="px-5 py-3.5">
                  <span className="font-medium text-white">{row.teamNumber}</span>
                  <span className="text-gray-400 ml-2">{row.teamName}</span>
                </td>
                <td className="px-5 py-3.5 text-center tabular-nums">
                  <span className="text-emerald-400">{row.wins}</span>
                  <span className="text-gray-600 mx-0.5">-</span>
                  <span className="text-red-400">{row.losses}</span>
                  <span className="text-gray-600 mx-0.5">-</span>
                  <span className="text-yellow-400">{row.ties}</span>
                </td>
                <td className={`px-5 py-3.5 text-right tabular-nums font-medium ${sortKey === 'rp' ? 'text-blue-300' : 'text-gray-200'}`}>
                  {row.rp?.toFixed(2) ?? '—'}
                </td>
                <td className={`px-5 py-3.5 text-right tabular-nums ${sortKey === 'tb1' ? 'text-blue-300 font-medium' : 'text-gray-400'}`}>
                  {row.tb1?.toFixed(1) ?? '—'}
                </td>
                <td className={`px-5 py-3.5 text-right tabular-nums ${sortKey === 'tb2' ? 'text-blue-300 font-medium' : 'text-gray-400'}`}>
                  {row.tb2 ?? '—'}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const NO_TEAM_DATA = {}

export default function EventPage() {
  const { eventCode, season: seasonParam } = useParams()
  const season = parseInt(seasonParam ?? String(CURRENT_SEASON), 10)
  const navigate = useNavigate()
  const location = useLocation()
  const eventName = location.state?.name
  const seasonState = useSeason(season)

  const [event, setEvent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [teamData, setTeamData] = useState(null)
  const ratingsLoaded = teamData?.forEvent === event
  const supabaseData = ratingsLoaded ? teamData.supabaseData : NO_TEAM_DATA
  const epaLookups = ratingsLoaded ? teamData.epaLookups : NO_TEAM_DATA

  const [activeTab, setActiveTab] = useState('teams')
  const [simSettings, setSimSettings] = useState({ runs: 1000, topN: 4, seed: 1 })

  const ratings = useMemo(() => {
    if (!ratingsLoaded) return null
    const latest = new Map()
    for (const [team, entries] of Object.entries(epaLookups)) {
      if (entries.length > 0) latest.set(Number(team), entries[entries.length - 1].value)
    }
    return latest
  }, [ratingsLoaded, epaLookups])

  useEffect(() => {
    async function fetchEvent() {
      try {
        const data = await ftcscoutQuery(getEventQuery(season), { season, code: eventCode })
        setEvent(data?.eventByCode ?? null)
      } catch (e) {
        setError(e.message)
      }
      setLoading(false)
    }
    fetchEvent()
  }, [eventCode, season])

  useEffect(() => {
    if (!event) return
    let current = true

    async function fetchTeamData() {
      const numbers = new Set()
      event.teams.forEach(({ team }) => numbers.add(team.number))
      event.matches.forEach((m) => m.teams.forEach((t) => numbers.add(t.teamNumber)))

      const { data, error } = await supabase
        .from(`epa_${season}`)
        .select('team_number, current_epa, current_auto_epa, current_teleop_epa, epa')
        .in('team_number', [...numbers])

      if (!current) return
      if (error) {
        setTeamData({ forEvent: event, supabaseData: {}, epaLookups: {} })
        return
      }

      const sb = {}, lookups = {}
      for (const row of data) {
        sb[row.team_number] = {
          current_epa: row.current_epa,
          current_auto_epa: row.current_auto_epa,
          current_teleop_epa: row.current_teleop_epa,
        }
        lookups[row.team_number] = buildEpaLookup(row.epa)
      }
      setTeamData({ forEvent: event, supabaseData: sb, epaLookups: lookups })
    }

    fetchTeamData()
    return () => { current = false }
  }, [event, season])

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Navbar />
      <div className="max-w-5xl mx-auto p-6">
        <button
          onClick={() => navigate(`/events/${season}`)}
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
              <TabButton
                label="Rankings"
                count={event.teams.filter((t) => t.stats).length || null}
                active={activeTab === 'rankings'}
                onClick={() => setActiveTab('rankings')}
              />
              <TabButton
                label="Simulation"
                active={activeTab === 'simulation'}
                onClick={() => setActiveTab('simulation')}
              />
            </div>

            {activeTab === 'teams' && (
              <TeamsTab
                teams={event.teams}
                supabaseData={supabaseData}
                season={season}
              />
            )}

            {activeTab === 'matches' && (
              <>
                {seasonState.error && (
                  <p className="text-amber-400 text-xs mb-3">
                    {seasonState.error}. Predictions are unavailable.
                  </p>
                )}
                <MatchesTab matches={event.matches} epaLookups={epaLookups} seasonState={seasonState} />
              </>
            )}

            {activeTab === 'rankings' && (
              <RankingsTab teams={event.teams} />
            )}

            {activeTab === 'simulation' && (
              <SimulationTab
                event={event}
                season={season}
                ratings={ratings}
                seasonState={seasonState}
                settings={simSettings}
                onSettingsChange={setSimSettings}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
