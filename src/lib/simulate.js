import { compareRankings } from './rankings.js'

export function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// An upcoming match lists each alliance's entries: { teamNumber, onField, surrogate }.
export function upcomingMatches(matches) {
  const toEntry = ({ teamNumber, onField, surrogate }) => ({ teamNumber, onField, surrogate })
  return matches
    .filter((m) => m.tournamentLevel === 'Quals' && !m.hasBeenPlayed)
    .map((m) => ({
      red: m.teams.filter((t) => t.alliance === 'Red').map(toEntry),
      blue: m.teams.filter((t) => t.alliance === 'Blue').map(toEntry),
    }))
}

function allianceScoreModel(entries, ratings, params) {
  const mean = entries
    .filter((e) => e.onField)
    .reduce((sum, e) => sum + (ratings.get(e.teamNumber) ?? params.mean), 0)
  return { mean, std: params.a * Math.pow(Math.max(1, mean), params.p) }
}

function percentile(rankCounts, runs, fraction) {
  const target = fraction * runs
  let seen = 0
  for (let i = 0; i < rankCounts.length; i++) {
    seen += rankCounts[i]
    if (seen >= target) return i + 1
  }
  return rankCounts.length
}

export function topNProbability(team, n, runs) {
  let hits = 0
  for (let i = 0; i < Math.min(n, team.rankCounts.length); i++) hits += team.rankCounts[i]
  return hits / runs
}

// Plays the upcoming qualification matches `runs` times from the replayed standings.
// Each alliance scores Normal(sum of its ratings, a * sum^p) rounded to a whole number,
// and only win and tie RP are awarded. Tiebreak averages stay at their replayed values.
//   standings  replayRankings output
//   upcoming   upcomingMatches output
//   ratings    Map of teamNumber to rating, params.mean when absent
//   params     { mean, a, p } for the season
//   rules      { winRp, tieRp }
// Returns { runs, teams } with one row per team in standings order:
//   { teamNumber, startRank, startRp, meanRank, meanRp, p10Rank, medianRank, p90Rank, rankCounts }
// rankCounts[r - 1] is how many runs ended with the team at rank r.
export function runSimulations({ standings, upcoming, ratings, params, rules, runs, rng = Math.random }) {
  const teamCount = standings.length
  const slot = new Map(standings.map((row, i) => [row.teamNumber, i]))
  const baseRp = Float64Array.from(standings, (row) => row.rpTotal)
  const basePlayed = Int32Array.from(standings, (row) => row.matchesPlayed)

  const plan = upcoming.map((m) => {
    const credited = (entries) => entries.filter((e) => !e.surrogate).map((e) => slot.get(e.teamNumber))
    return {
      red: allianceScoreModel(m.red, ratings, params),
      blue: allianceScoreModel(m.blue, ratings, params),
      redSlots: credited(m.red),
      blueSlots: credited(m.blue),
    }
  })

  const rpTotal = new Float64Array(teamCount)
  const played = new Int32Array(teamCount)
  const rankCounts = standings.map(() => new Int32Array(teamCount))
  const rankSum = new Float64Array(teamCount)
  const rpSum = new Float64Array(teamCount)
  const field = standings.map((row, i) => ({ slot: i, teamNumber: row.teamNumber, tiebreaks: row.tiebreaks, rp: 0 }))

  let spare = null
  const normal = () => {
    if (spare !== null) {
      const value = spare
      spare = null
      return value
    }
    const radius = Math.sqrt(-2 * Math.log(1 - rng()))
    const angle = 2 * Math.PI * rng()
    spare = radius * Math.sin(angle)
    return radius * Math.cos(angle)
  }
  const award = (slots, rp) => {
    for (const s of slots) {
      rpTotal[s] += rp
      played[s]++
    }
  }

  for (let run = 0; run < runs; run++) {
    rpTotal.set(baseRp)
    played.set(basePlayed)
    for (const m of plan) {
      const red = Math.max(0, Math.round(m.red.mean + m.red.std * normal()))
      const blue = Math.max(0, Math.round(m.blue.mean + m.blue.std * normal()))
      award(m.redSlots, red > blue ? rules.winRp : red === blue ? rules.tieRp : 0)
      award(m.blueSlots, blue > red ? rules.winRp : red === blue ? rules.tieRp : 0)
    }
    for (const f of field) f.rp = played[f.slot] ? rpTotal[f.slot] / played[f.slot] : 0
    field.sort(compareRankings)
    field.forEach((f, position) => {
      rankCounts[f.slot][position]++
      rankSum[f.slot] += position + 1
      rpSum[f.slot] += f.rp
    })
  }

  return {
    runs,
    teams: standings.map((row, i) => ({
      teamNumber: row.teamNumber,
      startRank: row.rank,
      startRp: row.rp,
      meanRank: rankSum[i] / runs,
      meanRp: rpSum[i] / runs,
      p10Rank: percentile(rankCounts[i], runs, 0.1),
      medianRank: percentile(rankCounts[i], runs, 0.5),
      p90Rank: percentile(rankCounts[i], runs, 0.9),
      rankCounts: rankCounts[i],
    })),
  }
}
