import { useEffect, useState, useMemo, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Navbar from '../components/Navbar'
import SeasonSelect from '../components/SeasonSelect'
import { CURRENT_SEASON, SEASON_PARAMS } from '../lib/constants'

// ── Math (same as TeamPage) ───────────────────────────────────────────────────

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

function calcRedWinProb(r1, r2, b1, b2, params) {
  const red = (r1 ?? 0) + (r2 ?? 0)
  const blue = (b1 ?? 0) + (b2 ?? 0)
  const redStd = params.a * Math.pow(Math.max(1, red), params.p)
  const blueStd = params.a * Math.pow(Math.max(1, blue), params.p)
  const z = (0 - (red - blue)) / Math.sqrt(redStd ** 2 + blueStd ** 2)
  return 1 - normalCDF(z)
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TeamPicker({ label, accent, teams, onAdd, onRemove, allTeams, teamsLoading, disabledNums }) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef(null)
  const full = teams.length >= 2

  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const pool = allTeams.filter((t) => !disabledNums.has(t.team_number))
    if (!q) return pool.slice(0, 50)
    return pool
      .filter(
        (t) =>
          String(t.team_number).includes(q) ||
          (t.team_name ?? '').toLowerCase().includes(q),
      )
      .slice(0, 50)
  }, [allTeams, search, disabledNums])

  const colors = {
    red:  { chip: '#f87171', border: 'border-red-800',   bg: 'bg-red-950',  focus: 'focus:border-red-500',  hover: 'hover:bg-red-900/40' },
    blue: { chip: '#60a5fa', border: 'border-blue-800',  bg: 'bg-blue-950', focus: 'focus:border-blue-500', hover: 'hover:bg-blue-900/40' },
  }
  const c = colors[accent]

  return (
    <div className={`flex-1 border ${c.border} ${c.bg} rounded-xl p-4`}>
      <h2 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: c.chip }}>
        {label}
      </h2>

      {/* Selected chips */}
      <div className="flex flex-col gap-2 mb-3 min-h-[4rem]">
        {teams.map((team) => (
          <span
            key={team.team_number}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{
              background: `${c.chip}18`,
              color: c.chip,
              border: `1px solid ${c.chip}44`,
            }}
          >
            <span className="tabular-nums font-semibold">{team.team_number}</span>
            {team.team_name && (
              <span className="opacity-70 font-normal truncate">{team.team_name}</span>
            )}
            <button
              onClick={() => onRemove(team.team_number)}
              className="ml-auto opacity-60 hover:opacity-100 transition-opacity leading-none shrink-0"
              aria-label={`Remove ${team.team_number}`}
            >
              ×
            </button>
          </span>
        ))}
        {!full && teams.length === 0 && (
          <span className="text-xs text-gray-600 italic">No teams selected</span>
        )}
      </div>

      {/* Search */}
      {!full && (
        <div className="relative" ref={dropdownRef}>
          <input
            type="text"
            placeholder={teamsLoading ? 'Loading teams…' : 'Search team…'}
            value={search}
            disabled={teamsLoading}
            onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            className={`w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none ${c.focus} transition-colors`}
          />
          {open && filtered.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full max-h-52 overflow-y-auto bg-gray-800 border border-gray-700 rounded-lg shadow-xl">
              {filtered.map((team) => (
                <li
                  key={team.team_number}
                  onMouseDown={() => { onAdd(team); setSearch(''); setOpen(false) }}
                  className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-700 transition-colors flex items-center gap-2"
                >
                  <span className="text-white font-medium tabular-nums w-14 shrink-0">{team.team_number}</span>
                  {team.team_name && <span className="text-gray-400 truncate">{team.team_name}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function StatRow({ label, redValues, blueValues }) {
  const redSum = redValues.reduce((s, v) => s + (v ?? 0), 0)
  const blueSum = blueValues.reduce((s, v) => s + (v ?? 0), 0)
  const total = redSum + blueSum
  const redPct = total > 0 ? (redSum / total) * 100 : 50

  const hasData = redValues.some((v) => v != null) || blueValues.some((v) => v != null)

  return (
    <div className="mb-4">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex items-center gap-3 mb-1.5">
        {/* Red side */}
        <div className="flex-1 text-right">
          <span className="text-red-400 font-semibold tabular-nums text-sm">
            {redSum.toFixed(2)}
          </span>
          {redValues.length > 0 && (
            <div className="text-xs text-gray-600 tabular-nums">
              {redValues.map((v, i) => (
                <span key={i}>{i > 0 ? ' + ' : ''}{v != null ? v.toFixed(1) : '—'}</span>
              ))}
            </div>
          )}
        </div>
        {/* Bar */}
        {hasData && (
          <div className="flex-[2] h-2 rounded-full bg-blue-500 overflow-hidden">
            <div
              className="h-full bg-red-500 rounded-full transition-all duration-300"
              style={{ width: `${redPct}%` }}
            />
          </div>
        )}
        {/* Blue side */}
        <div className="flex-1">
          <span className="text-blue-400 font-semibold tabular-nums text-sm">
            {blueSum.toFixed(2)}
          </span>
          {blueValues.length > 0 && (
            <div className="text-xs text-gray-600 tabular-nums">
              {blueValues.map((v, i) => (
                <span key={i}>{i > 0 ? ' + ' : ''}{v != null ? v.toFixed(1) : '—'}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AllianceComparePage() {
  const { season: seasonParam } = useParams()
  const season = parseInt(seasonParam ?? String(CURRENT_SEASON), 10)
  const params = SEASON_PARAMS[season] ?? SEASON_PARAMS[CURRENT_SEASON]

  const [allTeams, setAllTeams] = useState([])
  const [teamsLoading, setTeamsLoading] = useState(true)
  const [redTeams, setRedTeams] = useState([])
  const [blueTeams, setBlueTeams] = useState([])
  const [teamStats, setTeamStats] = useState({})

  useEffect(() => {
    setRedTeams([])
    setBlueTeams([])
    setTeamStats({})
  }, [season])

  useEffect(() => {
    setAllTeams([])
    setTeamsLoading(true)
    async function fetchTeams() {
      const BATCH = 1000
      let from = 0
      const rows = []
      while (true) {
        const { data, error } = await supabase
          .from(`epa_${season}`)
          .select('team_number, team_name')
          .range(from, from + BATCH - 1)
        if (error) break
        rows.push(...data)
        if (data.length < BATCH) break
        from += BATCH
      }
      setAllTeams(rows.sort((a, b) => a.team_number - b.team_number))
      setTeamsLoading(false)
    }
    fetchTeams()
  }, [season])

  async function fetchStats(team) {
    if (teamStats[team.team_number]) return
    const { data } = await supabase
      .from(`epa_${season}`)
      .select('team_number, current_epa, current_auto_epa, current_teleop_epa')
      .eq('team_number', team.team_number)
      .single()
    if (data) setTeamStats((prev) => ({ ...prev, [data.team_number]: data }))
  }

  function addRed(team) {
    if (redTeams.length >= 2) return
    setRedTeams((prev) => [...prev, team])
    fetchStats(team)
  }

  function addBlue(team) {
    if (blueTeams.length >= 2) return
    setBlueTeams((prev) => [...prev, team])
    fetchStats(team)
  }

  const disabledNums = useMemo(
    () => new Set([...redTeams, ...blueTeams].map((t) => t.team_number)),
    [redTeams, blueTeams],
  )

  const getStat = (team, key) => teamStats[team?.team_number]?.[key] ?? null

  const redEpas  = redTeams.map((t) => getStat(t, 'current_epa'))
  const blueEpas = blueTeams.map((t) => getStat(t, 'current_epa'))
  const redAutoEpas  = redTeams.map((t) => getStat(t, 'current_auto_epa'))
  const blueAutoEpas = blueTeams.map((t) => getStat(t, 'current_auto_epa'))
  const redTeleopEpas  = redTeams.map((t) => getStat(t, 'current_teleop_epa'))
  const blueTeleopEpas = blueTeams.map((t) => getStat(t, 'current_teleop_epa'))

  const showComparison = redTeams.length > 0 || blueTeams.length > 0
  const showWinProb = redTeams.length > 0 && blueTeams.length > 0

  const winProb = showWinProb
    ? calcRedWinProb(redEpas[0], redEpas[1] ?? null, blueEpas[0], blueEpas[1] ?? null, params)
    : null

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Navbar />
      <div className="max-w-5xl mx-auto p-6">
        <div className="flex items-start justify-between mb-1">
          <h1 className="text-3xl font-bold text-white">Alliance Compare</h1>
          <SeasonSelect season={season} getPath={(s) => `/alliance/${s}`} />
        </div>
        <p className="text-gray-400 mb-6 text-sm">
          {season}/{season + 1} season · Build two alliances and compare their expected performance
        </p>

        {/* Alliance pickers */}
        <div className="flex gap-4 mb-6">
          <TeamPicker
            label="Red Alliance"
            accent="red"
            teams={redTeams}
            onAdd={addRed}
            onRemove={(num) => setRedTeams((prev) => prev.filter((t) => t.team_number !== num))}
            allTeams={allTeams}
            teamsLoading={teamsLoading}
            disabledNums={disabledNums}
          />
          <TeamPicker
            label="Blue Alliance"
            accent="blue"
            teams={blueTeams}
            onAdd={addBlue}
            onRemove={(num) => setBlueTeams((prev) => prev.filter((t) => t.team_number !== num))}
            allTeams={allTeams}
            teamsLoading={teamsLoading}
            disabledNums={disabledNums}
          />
        </div>

        {/* Comparison */}
        {!showComparison ? (
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-16 text-center text-gray-500">
            Pick teams for each alliance to compare
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            {/* Win probability */}
            {showWinProb && winProb != null && (
              <div className="mb-6">
                <div className="flex justify-between text-sm font-semibold mb-2">
                  <span className="text-red-400">Red {(winProb * 100).toFixed(1)}%</span>
                  <span className="text-gray-400 text-xs self-center uppercase tracking-wide">Win Probability</span>
                  <span className="text-blue-400">Blue {((1 - winProb) * 100).toFixed(1)}%</span>
                </div>
                <div className="h-3 rounded-full bg-blue-500 overflow-hidden">
                  <div
                    className="h-full bg-red-500 rounded-full transition-all duration-300"
                    style={{ width: `${winProb * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* EPA breakdowns */}
            <div className="flex justify-between text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
              <span className="text-red-500">Red Alliance</span>
              <span className="text-blue-500">Blue Alliance</span>
            </div>
            <StatRow
              label="Total EPA"
              redValues={redEpas}
              blueValues={blueEpas}
            />
            <StatRow
              label="Auto EPA"
              redValues={redAutoEpas}
              blueValues={blueAutoEpas}
            />
            <StatRow
              label="Teleop EPA"
              redValues={redTeleopEpas}
              blueValues={blueTeleopEpas}
            />
          </div>
        )}
      </div>
    </div>
  )
}
