import { useEffect, useState, useMemo } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { fetchTeamsByNumber } from '../lib/teams'
import Navbar from '../components/Navbar'
import SeasonSelect from '../components/SeasonSelect'
import TeamSearchBox from '../components/TeamSearchBox'
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

function TeamPicker({ label, accent, teams, onAdd, onRemove, season, disabledNums }) {
  const full = teams.length >= 2

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
        <TeamSearchBox
          season={season}
          excluded={disabledNums}
          onPick={onAdd}
          placeholder="Search team…"
          focusClass={c.focus}
          size="sm"
        />
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

const STAT_COLUMNS = 'team_number, team_name, current_epa, current_auto_epa, current_teleop_epa'

function parseTeamNumbers(raw) {
  const nums = (raw ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0)
  return [...new Set(nums)].slice(0, 2)
}

export default function AllianceComparePage() {
  const { season: seasonParam } = useParams()
  const season = parseInt(seasonParam ?? String(CURRENT_SEASON), 10)
  return <AllianceView key={season} season={season} />
}

function AllianceView({ season }) {
  const params = SEASON_PARAMS[season] ?? SEASON_PARAMS[CURRENT_SEASON]
  const [searchParams, setSearchParams] = useSearchParams()
  const [teamRows, setTeamRows] = useState({}) // {team_number: {team_name, current_epa, ...}}

  const redNums = useMemo(() => parseTeamNumbers(searchParams.get('red')), [searchParams])
  const blueNums = useMemo(() => parseTeamNumbers(searchParams.get('blue')), [searchParams])
  const toTeam = (n) => teamRows[n] ?? { team_number: n }
  const redTeams = redNums.map(toTeam)
  const blueTeams = blueNums.map(toTeam)

  const missingKey = [...redNums, ...blueNums].filter((n) => !teamRows[n]?.loaded).join(',')

  useEffect(() => {
    if (!missingKey) return
    const wanted = missingKey.split(',').map(Number)
    let stale = false
    fetchTeamsByNumber(season, wanted, STAT_COLUMNS)
      .then((rows) => {
        if (stale) return
        setTeamRows((prev) => {
          const next = { ...prev }
          for (const n of wanted) next[n] = { team_number: n, ...prev[n], loaded: true }
          for (const row of rows) next[row.team_number] = { ...row, loaded: true }
          return next
        })
      })
      .catch((err) => console.error('Failed to load teams', err))
    return () => { stale = true }
  }, [season, missingKey])

  function setAlliance(key, nums) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (nums.length) next.set(key, nums.join(','))
        else next.delete(key)
        return next
      },
      { replace: true },
    )
  }

  function addTo(key, nums, team) {
    if (nums.length >= 2) return
    setTeamRows((prev) => ({ ...prev, [team.team_number]: { ...team, ...prev[team.team_number] } }))
    setAlliance(key, [...nums, team.team_number])
  }

  const addRed = (team) => addTo('red', redNums, team)
  const addBlue = (team) => addTo('blue', blueNums, team)

  const disabledNums = useMemo(() => new Set([...redNums, ...blueNums]), [redNums, blueNums])

  const getStat = (team, key) => teamRows[team?.team_number]?.[key] ?? null

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
            onRemove={(num) => setAlliance('red', redNums.filter((n) => n !== num))}
            season={season}
            disabledNums={disabledNums}
          />
          <TeamPicker
            label="Blue Alliance"
            accent="blue"
            teams={blueTeams}
            onAdd={addBlue}
            onRemove={(num) => setAlliance('blue', blueNums.filter((n) => n !== num))}
            season={season}
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
