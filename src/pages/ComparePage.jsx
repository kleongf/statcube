import { useEffect, useState, useMemo, useRef } from 'react'
import { useParams } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { supabase } from '../lib/supabase'
import Navbar from '../components/Navbar'
import SeasonSelect from '../components/SeasonSelect'
import { CURRENT_SEASON } from '../lib/constants'

const TEAM_COLORS = [
  '#60a5fa', '#34d399', '#a78bfa', '#f472b6',
  '#fb923c', '#facc15', '#38bdf8', '#4ade80',
]

const METRICS = [
  { key: 'epa',        label: 'Total EPA' },
  { key: 'auto_epa',   label: 'Auto EPA'  },
  { key: 'teleop_epa', label: 'Teleop EPA' },
]

function buildChartData(teamEpaData, teamNumbers, metric) {
  const allTimestamps = new Set()
  for (const num of teamNumbers) {
    for (const ts of Object.keys(teamEpaData[num]?.[metric] ?? {})) {
      allTimestamps.add(ts)
    }
  }
  const sorted = [...allTimestamps].sort()
  const lastValue = {}
  return sorted.map((ts, idx) => {
    const point = {
      index: idx + 1,
      timestamp: new Date(ts).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      }),
    }
    for (const num of teamNumbers) {
      const raw = teamEpaData[num]?.[metric]?.[ts]
      if (raw != null) lastValue[num] = raw
      point[num] = lastValue[num] ?? null
    }
    return point
  })
}

function CompareTooltip({ active, payload, selected }) {
  if (!active || !payload?.length) return null
  const ts = payload[0]?.payload?.timestamp
  const dataPoint = payload[0]?.payload ?? {}
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-sm shadow-xl">
      {ts && <p className="text-gray-400 mb-2 text-xs">{ts}</p>}
      {selected.map((team, i) => {
        const color = TEAM_COLORS[i % TEAM_COLORS.length]
        const value = dataPoint[team.team_number]
        return (
          <div key={team.team_number} className="flex items-center gap-2 mb-0.5">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: color }} />
            <span className="text-gray-300 tabular-nums">{team.team_number}</span>
            {team.team_name && (
              <span className="text-gray-500 text-xs">· {team.team_name}</span>
            )}
            <span className="font-medium text-white tabular-nums ml-auto pl-3">
              {value != null ? value.toFixed(2) : '—'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function ComparePage() {
  const { season: seasonParam } = useParams()
  const season = parseInt(seasonParam ?? String(CURRENT_SEASON), 10)

  const [allTeams, setAllTeams]     = useState([])
  const [teamsLoading, setTeamsLoading] = useState(true)

  const [selected, setSelected]     = useState([]) // [{team_number, team_name}]
  const [epaData, setEpaData]       = useState({}) // {team_number: {epa, auto_epa, teleop_epa}}

  const [metric, setMetric]         = useState('epa')
  const [search, setSearch]         = useState('')
  const [open, setOpen]             = useState(false)
  const dropdownRef                 = useRef(null)

  // Reset when season changes
  useEffect(() => {
    setSelected([])
    setEpaData({})
  }, [season])

  // Fetch team list for the season
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

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function addTeam(team) {
    if (selected.some((t) => t.team_number === team.team_number)) return
    setSelected((prev) => [...prev, team])
    setSearch('')
    setOpen(false)

    if (epaData[team.team_number]) return
    const { data } = await supabase
      .from(`epa_${season}`)
      .select('team_number, epa, auto_epa, teleop_epa')
      .eq('team_number', team.team_number)
      .single()
    if (data) setEpaData((prev) => ({ ...prev, [data.team_number]: data }))
  }

  function removeTeam(num) {
    setSelected((prev) => prev.filter((t) => t.team_number !== num))
  }

  const filteredTeams = useMemo(() => {
    const q = search.trim().toLowerCase()
    const selectedNums = new Set(selected.map((t) => t.team_number))
    const pool = allTeams.filter((t) => !selectedNums.has(t.team_number))
    if (!q) return pool.slice(0, 50)
    return pool
      .filter(
        (t) =>
          String(t.team_number).includes(q) ||
          (t.team_name ?? '').toLowerCase().includes(q),
      )
      .slice(0, 50)
  }, [allTeams, search, selected])

  const teamNumbers = selected.map((t) => t.team_number)

  const chartData = useMemo(() => {
    if (selected.length === 0) return []
    return buildChartData(epaData, teamNumbers, metric)
  }, [selected, epaData, metric])

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Navbar />
      <div className="max-w-5xl mx-auto p-6">
        <div className="flex items-start justify-between mb-1">
          <h1 className="text-3xl font-bold text-white">Compare Teams</h1>
          <SeasonSelect season={season} getPath={(s) => `/compare/${s}`} />
        </div>
        <p className="text-gray-400 mb-6 text-sm">
          {season}/{season + 1} season · Compare EPA metrics over time
        </p>

        {/* Team picker */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-5">
          {/* Selected chips */}
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {selected.map((team, i) => {
                const color = TEAM_COLORS[i % TEAM_COLORS.length]
                return (
                  <span
                    key={team.team_number}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
                    style={{
                      background: `${color}1a`,
                      color,
                      border: `1px solid ${color}44`,
                    }}
                  >
                    <span className="tabular-nums">{team.team_number}</span>
                    {team.team_name && (
                      <span className="opacity-70 font-normal">· {team.team_name}</span>
                    )}
                    <button
                      onClick={() => removeTeam(team.team_number)}
                      className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity leading-none"
                      aria-label={`Remove ${team.team_number}`}
                    >
                      ×
                    </button>
                  </span>
                )
              })}
            </div>
          )}

          {/* Search input + dropdown */}
          <div className="relative" ref={dropdownRef}>
            <input
              type="text"
              placeholder={
                teamsLoading ? 'Loading teams…' : 'Search team name or number to add…'
              }
              value={search}
              disabled={teamsLoading}
              onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
              onFocus={() => setOpen(true)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
            />
            {open && filteredTeams.length > 0 && (
              <ul className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto bg-gray-800 border border-gray-700 rounded-lg shadow-xl">
                {filteredTeams.map((team) => (
                  <li
                    key={team.team_number}
                    onMouseDown={() => addTeam(team)}
                    className="px-4 py-2 text-sm cursor-pointer hover:bg-gray-700 transition-colors flex items-center gap-2"
                  >
                    <span className="text-white font-medium tabular-nums w-16 shrink-0">
                      {team.team_number}
                    </span>
                    {team.team_name && (
                      <span className="text-gray-400 truncate">{team.team_name}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Metric selector */}
        <div className="flex items-center gap-3 mb-6">
          <span className="text-sm text-gray-400 shrink-0">Metric</span>
          <div className="flex gap-1">
            {METRICS.map((m) => (
              <button
                key={m.key}
                onClick={() => setMetric(m.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  metric === m.key
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Chart */}
        {selected.length === 0 ? (
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-16 text-center text-gray-500">
            Select at least one team to compare
          </div>
        ) : (
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
            <ResponsiveContainer width="100%" height={420}>
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
                <Tooltip content={<CompareTooltip selected={selected} />} />
                <Legend wrapperStyle={{ paddingTop: 16, fontSize: 13, color: '#9ca3af' }} />
                {selected.map((team, i) =>
                  epaData[team.team_number] ? (
                    <Line
                      key={team.team_number}
                      type="monotone"
                      dataKey={team.team_number}
                      name={String(team.team_number)}
                      stroke={TEAM_COLORS[i % TEAM_COLORS.length]}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 5 }}
                      connectNulls
                    />
                  ) : null,
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}
