import { useState, useMemo, useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { useTeamRows } from '../lib/useTeamRows'
import Navbar from '../components/Navbar'
import SeasonSelect from '../components/SeasonSelect'
import TeamSearchBox from '../components/TeamSearchBox'
import LoadError from '../components/LoadError'
import { MAX_COMPARE_TEAMS, parseCompareTeams, paramsMatch, withTeamParams } from '../lib/teamParams'
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

const EPA_COLUMNS = 'team_number, team_name, epa, auto_epa, teleop_epa'

export default function ComparePage() {
  const { season: seasonParam } = useParams()
  const season = parseInt(seasonParam ?? String(CURRENT_SEASON), 10)
  return <CompareView key={season} season={season} />
}

function CompareView({ season }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [metric, setMetric]     = useState('epa')

  const teamNumbers = useMemo(
    () => parseCompareTeams(searchParams.get('teams')),
    [searchParams],
  )
  const { rows: teamRows, seed, failed, retry } = useTeamRows(season, teamNumbers, EPA_COLUMNS)
  const selected = teamNumbers.map((n) => teamRows[n] ?? { team_number: n })

  useEffect(() => {
    if (!paramsMatch(searchParams, { teams: teamNumbers })) {
      setSearchParams((prev) => withTeamParams(prev, { teams: teamNumbers }), { replace: true })
    }
  }, [searchParams, setSearchParams, teamNumbers])

  const full = teamNumbers.length >= MAX_COMPARE_TEAMS

  function setTeams(nums) {
    setSearchParams((prev) => withTeamParams(prev, { teams: nums }))
  }

  function addTeam(team) {
    if (full || teamNumbers.includes(team.team_number)) return
    seed(team)
    setTeams([...teamNumbers, team.team_number])
  }

  function removeTeam(num) {
    setTeams(teamNumbers.filter((n) => n !== num))
  }

  const chartData = useMemo(() => {
    if (teamNumbers.length === 0) return []
    return buildChartData(teamRows, teamNumbers, metric)
  }, [teamRows, teamNumbers, metric])

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

          {full ? (
            <p className="text-sm text-gray-500">
              Up to {MAX_COMPARE_TEAMS} teams. Remove one to add another.
            </p>
          ) : (
            <TeamSearchBox
              season={season}
              excluded={new Set(teamNumbers)}
              onPick={addTeam}
            />
          )}
        </div>

        {failed && <LoadError onRetry={retry} />}

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
                  teamRows[team.team_number]?.epa ? (
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
