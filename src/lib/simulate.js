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

function eventEnded(event) {
  return event.finished || event.matches.some((m) => m.tournamentLevel !== 'Quals' && m.hasBeenPlayed)
}

export function upcomingMatches(event) {
  if (eventEnded(event)) return []
  const toEntry = ({ teamNumber, onField, surrogate }) => ({ teamNumber, onField, surrogate })
  return event.matches
    .filter((m) => m.tournamentLevel === 'Quals' && !m.hasBeenPlayed)
    .map((m) => ({
      red: m.teams.filter((t) => t.alliance === 'Red').map(toEntry),
      blue: m.teams.filter((t) => t.alliance === 'Blue').map(toEntry),
    }))
}

export function bonusRates(standings, fieldCount) {
  const counts = new Array(fieldCount).fill(0)
  let played = 0
  for (const row of standings) {
    played += row.matchesPlayed
    row.bonusCounts.forEach((c, k) => { counts[k] += c })
  }
  const eventRate = counts.map((c) => (played ? c / played : 0))
  return new Map(
    standings.map((row) => [row.teamNumber, row.matchesPlayed ? row.bonusCounts.map((c) => c / row.matchesPlayed) : eventRate]),
  )
}

function allianceModel(entries, ratings, rates, params) {
  const onField = entries.filter((e) => e.onField)
  const mean = onField.reduce((sum, e) => sum + (ratings.get(e.teamNumber) ?? params.mean), 0)
  const teamRates = onField.map((e) => rates.get(e.teamNumber))
  const bonusP = teamRates.length ? teamRates[0].map((_, k) => teamRates.reduce((sum, r) => sum + r[k], 0) / teamRates.length) : []
  return { mean, std: params.a * Math.pow(Math.max(1, mean), params.p), bonusP }
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

export function runSimulations({ standings, upcoming, ratings, params, rules: { winRp, tieRp, bonusRps }, runs, rng = Math.random }) {
  const teamCount = standings.length
  const slot = new Map(standings.map((row, i) => [row.teamNumber, i]))
  const baseRp = Float64Array.from(standings, (row) => row.rpTotal)
  const basePlayed = Int32Array.from(standings, (row) => row.matchesPlayed)
  const rates = bonusRates(standings, bonusRps.length)

  const plan = upcoming.map((m) => {
    const credited = (entries) => entries.filter((e) => !e.surrogate).map((e) => slot.get(e.teamNumber))
    return {
      red: allianceModel(m.red, ratings, rates, params),
      blue: allianceModel(m.blue, ratings, rates, params),
      redSlots: credited(m.red),
      blueSlots: credited(m.blue),
    }
  })

  const rpTotal = new Float64Array(teamCount)
  const played = new Int32Array(teamCount)
  const rankCounts = standings.map(() => new Int32Array(teamCount))
  const rankSum = new Float64Array(teamCount)
  const rpSum = new Float64Array(teamCount)
  const field = standings.map((_, i) => ({ slot: i, rp: 0, randomTiebreak: 0 }))

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
  const bonus = (alliance) => {
    let rp = 0
    for (const p of alliance.bonusP) if (rng() < p) rp++
    return rp
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
      award(m.redSlots, (red > blue ? winRp : red === blue ? tieRp : 0) + bonus(m.red))
      award(m.blueSlots, (blue > red ? winRp : red === blue ? tieRp : 0) + bonus(m.blue))
    }
    for (const f of field) {
      f.rp = played[f.slot] ? rpTotal[f.slot] / played[f.slot] : 0
      f.randomTiebreak = rng()
    }
    field.sort((a, b) => b.rp - a.rp || a.randomTiebreak - b.randomTiebreak)
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
