import { useEffect, useMemo } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useTeamRows } from '../lib/useTeamRows'
import Navbar from '../components/Navbar'
import SeasonSelect from '../components/SeasonSelect'
import TeamSearchBox from '../components/TeamSearchBox'
import LoadError from '../components/LoadError'
import { ALLIANCE_SIZE, parseAlliances, paramsMatch, withTeamParams } from '../lib/teamParams'
import { CURRENT_SEASON, SEASON_PARAMS } from '../lib/constants'

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

function TeamPicker({ label, accent, teams, onAdd, onRemove, season, disabledNums }) {
  const full = teams.length >= ALLIANCE_SIZE

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
        {hasData && (
          <div className="flex-[2] h-2 rounded-full bg-blue-500 overflow-hidden">
            <div
              className="h-full bg-red-500 rounded-full transition-all duration-300"
              style={{ width: `${redPct}%` }}
            />
          </div>
        )}
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

const STAT_COLUMNS = 'team_number, team_name, current_epa, current_auto_epa, current_teleop_epa'

export default function AllianceComparePage() {
  const { season: seasonParam } = useParams()
  const season = parseInt(seasonParam ?? String(CURRENT_SEASON), 10)
  return <AllianceView key={season} season={season} />
}

function AllianceView({ season }) {
  const params = SEASON_PARAMS[season] ?? SEASON_PARAMS[CURRENT_SEASON]
  const [searchParams, setSearchParams] = useSearchParams()

  const { red: redNums, blue: blueNums } = useMemo(
    () => parseAlliances(searchParams.get('red'), searchParams.get('blue')),
    [searchParams],
  )
  const { rows: teamRows, seed, failed, retry } = useTeamRows(season, [...redNums, ...blueNums], STAT_COLUMNS)
  const toTeam = (n) => teamRows[n] ?? { team_number: n }
  const redTeams = redNums.map(toTeam)
  const blueTeams = blueNums.map(toTeam)

  useEffect(() => {
    const lists = { red: redNums, blue: blueNums }
    if (!paramsMatch(searchParams, lists)) {
      setSearchParams((prev) => withTeamParams(prev, lists), { replace: true })
    }
  }, [searchParams, setSearchParams, redNums, blueNums])

  const disabledNums = new Set([...redNums, ...blueNums])

  function setAlliance(key, nums) {
    setSearchParams((prev) => withTeamParams(prev, { [key]: nums }))
  }

  function addTo(key, nums, team) {
    if (nums.length >= ALLIANCE_SIZE || disabledNums.has(team.team_number)) return
    seed(team)
    setAlliance(key, [...nums, team.team_number])
  }

  const addRed = (team) => addTo('red', redNums, team)
  const addBlue = (team) => addTo('blue', blueNums, team)

  const getStat = (team, key) => teamRows[team?.team_number]?.[key] ?? null

  const redEpas  = redTeams.map((t) => getStat(t, 'current_epa'))
  const blueEpas = blueTeams.map((t) => getStat(t, 'current_epa'))
  const redAutoEpas  = redTeams.map((t) => getStat(t, 'current_auto_epa'))
  const blueAutoEpas = blueTeams.map((t) => getStat(t, 'current_auto_epa'))
  const redTeleopEpas  = redTeams.map((t) => getStat(t, 'current_teleop_epa'))
  const blueTeleopEpas = blueTeams.map((t) => getStat(t, 'current_teleop_epa'))

  const showComparison = redTeams.length > 0 || blueTeams.length > 0
  const showWinProb =
    redTeams.length > 0 && blueTeams.length > 0 &&
    [...redTeams, ...blueTeams].every((t) => t.loaded)

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

        {failed && <LoadError onRetry={retry} />}

        {!showComparison ? (
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-16 text-center text-gray-500">
            Pick teams for each alliance to compare
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
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
