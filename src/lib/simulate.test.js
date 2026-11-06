import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RANKING_RULES, replayRankings } from './rankings.js'
import { bonusRates, mulberry32, runSimulations, topNProbability, upcomingMatches } from './simulate.js'
import { calcRedWinProb } from './winProbability.js'

const FIXTURE = join(import.meta.dirname, '__fixtures__/rankings/2025-USMIGRQ.json')
const rules = RANKING_RULES[2025]
const params = { mean: 56, a: 2.1482, p: 0.6543 }
const NOISELESS = { mean: 56, a: 0, p: 1 }
const NO_POINTS = { autoPoints: 0, totalPointsNp: 0, dcBasePoints: 0 }
const ALL_BONUSES = { movementRp: true, goalRp: true, patternRp: true }

function entry(teamNumber, alliance, extra = {}) {
  return { teamNumber, alliance, onField: true, surrogate: false, ...extra }
}

function qual(red, blue, scores, bonuses = {}) {
  return {
    tournamentLevel: 'Quals',
    hasBeenPlayed: scores != null,
    teams: [...red.map((t) => (typeof t === 'number' ? entry(t, 'Red') : t)), ...blue.map((t) => (typeof t === 'number' ? entry(t, 'Blue') : t))],
    scores: scores && {
      red: { ...NO_POINTS, totalPoints: scores[0], ...bonuses.red },
      blue: { ...NO_POINTS, totalPoints: scores[1], ...bonuses.blue },
    },
  }
}

function simulate(matches, ratings, runs, overrides = {}) {
  const seasonRules = overrides.rules ?? rules
  return runSimulations({
    standings: replayRankings(matches, seasonRules),
    upcoming: upcomingMatches({ finished: false, matches }),
    ratings: new Map(Object.entries(ratings).map(([team, value]) => [Number(team), value])),
    params,
    rules: seasonRules,
    runs,
    rng: mulberry32(1),
    ...overrides,
  })
}

const byTeam = (result) => Object.fromEntries(result.teams.map((t) => [t.teamNumber, t]))

const fixtureQuals = () => JSON.parse(readFileSync(FIXTURE, 'utf8')).data.eventByCode.matches.filter((m) => m.tournamentLevel === 'Quals')
const unplayed = (m) => ({ ...m, hasBeenPlayed: false, scores: null, teams: m.teams.map((t) => ({ ...t, onField: true })) })

describe('upcomingMatches', () => {
  const played = qual([1, 2], [3, 4], [50, 30])
  const pending = qual([1, 3], [2, 4], null)
  const playoff = (hasBeenPlayed) => ({ ...qual([1, 2], [3, 4], hasBeenPlayed ? [10, 5] : null), tournamentLevel: 'DoubleElim' })

  it('lists the unplayed quals of an event in progress', () => {
    expect(upcomingMatches({ finished: false, matches: [played, pending, playoff(false)] })).toHaveLength(1)
  })

  it('lists nothing once ftcscout marks the event finished', () => {
    expect(upcomingMatches({ finished: true, matches: [played, pending] })).toEqual([])
  })

  it('lists nothing once any playoff match is played', () => {
    expect(upcomingMatches({ finished: false, matches: [played, pending, playoff(true)] })).toEqual([])
  })
})

describe('bonusRates', () => {
  it('gives each team its rate over counted quals and an unplayed team the event rate', () => {
    const matches = [
      qual([1, 2], [3, 4], [50, 30], { red: { movementRp: true, goalRp: true }, blue: { movementRp: true } }),
      qual([1, 3], [2, entry(5, 'Blue', { surrogate: true })], [40, 60], { red: { movementRp: true } }),
      qual([5, 6], [7, 8], null),
    ]
    const rates = bonusRates(replayRankings(matches, rules), rules.bonusRps.length)
    expect(rates.get(1)).toEqual([1, 0.5, 0])
    expect(rates.get(2)).toEqual([0.5, 0.5, 0])
    expect(rates.get(4)).toEqual([1, 0, 0])
    const eventRate = [6 / 7, 2 / 7, 0]
    for (const team of [5, 6, 7, 8]) expect(rates.get(team)).toEqual(eventRate)
  })

  it('gives every team a rate of zero before any qual is played', () => {
    const rates = bonusRates(replayRankings([qual([1, 2], [3, 4], null)], rules), rules.bonusRps.length)
    for (const team of [1, 2, 3, 4]) expect(rates.get(team)).toEqual([0, 0, 0])
  })
})

describe('runSimulations', () => {
  it('keeps the replayed standings when no match is left to play', () => {
    const matches = [qual([1, 2], [3, 4], [50, 30], { red: { movementRp: true } }), qual([1, 3], [2, 4], [40, 60])]
    const replayed = replayRankings(matches, rules)
    const result = simulate(matches, {}, 50)
    for (const row of replayed) {
      const team = byTeam(result)[row.teamNumber]
      expect(team.meanRank).toBe(row.rank)
      expect(team.meanRp).toBeCloseTo(row.rp, 9)
      expect(team.startRank).toBe(row.rank)
    }
  })

  it('awards win RP to the alliance that outscores and nothing to the other', () => {
    const result = byTeam(simulate([qual([1, 2], [3, 4], null)], { 1: 100, 2: 100, 3: 0, 4: 0 }, 200, { params: NOISELESS }))
    expect(result[1].meanRp).toBe(rules.winRp)
    expect(result[3].meanRp).toBe(0)
    for (const t of [1, 2]) expect(result[t].p90Rank).toBeLessThanOrEqual(2)
    for (const t of [3, 4]) expect(result[t].p10Rank).toBeGreaterThanOrEqual(3)
  })

  it('awards tie RP and no bonus RP when the scores tie and no qual is played', () => {
    const matches = [qual([1, 2], [3, 4], null)]
    const result = byTeam(simulate(matches, {}, 20, { params: { mean: 0, a: 0, p: 1 } }))
    for (const t of [1, 2, 3, 4]) expect(result[t].meanRp).toBe(rules.tieRp)
  })

  it('gives a surrogate team no RP and no match from an upcoming match', () => {
    const surrogate = entry(2, 'Red', { surrogate: true })
    const matches = [qual([1, 2], [3, 4], [50, 30]), qual([1, surrogate], [3, 4], null)]
    const result = byTeam(simulate(matches, { 1: 0, 2: 0, 3: 100, 4: 100 }, 50, { params: NOISELESS }))
    expect(result[2].meanRp).toBe(rules.winRp)
    expect(result[1].meanRp).toBe(rules.winRp / 2)
  })

  it('awards each bonus RP at the mean rate of the two alliance partners', () => {
    const matches = [qual([1, 2], [3, 4], [50, 30], { red: ALL_BONUSES }), qual([1, 2], [3, 4], null)]
    const result = byTeam(simulate(matches, {}, 50, { params: NOISELESS }))
    expect(result[1].meanRp).toBe((rules.winRp + 3 + rules.tieRp + 3) / 2)
    expect(result[3].meanRp).toBe(rules.tieRp / 2)

    const mixed = [qual([1, 2], [3, 4], [50, 30], { red: ALL_BONUSES }), qual([1, 3], [2, 4], null)]
    const runs = 20000
    const half = byTeam(simulate(mixed, {}, runs, { params: NOISELESS }))
    const simulatedBonus = 2 * half[3].meanRp - rules.tieRp
    expect(simulatedBonus).toBeCloseTo(3 * 0.5, 1)
  })

  it('simulates a team with no counted match yet and leaves it unranked at the start', () => {
    const matches = [qual([1, 2], [3, 4], [50, 30]), qual([5, 1], [3, 4], null)]
    const five = byTeam(simulate(matches, { 1: 100, 5: 100, 3: 0, 4: 0 }, 20, { params: NOISELESS }))[5]
    expect(five.startRank).toBeNull()
    expect(five.meanRp).toBe(rules.winRp)
  })

  it('gives identical teams the same mean rank before any qual is played', () => {
    const result = simulate(fixtureQuals().map(unplayed), {}, 10000)
    const center = (result.teams.length + 1) / 2
    for (const t of result.teams) expect(Math.abs(t.meanRank - center), `team ${t.teamNumber}`).toBeLessThanOrEqual(0.5)
  })

  it('wins a match as often as the site win probability says', () => {
    const rules2024 = RANKING_RULES[2024]
    for (const [r1, r2, b1, b2] of [[56, 56, 56, 56], [70, 60, 55, 30]]) {
      const ratings = { 1: r1, 2: r2, 3: b1, 4: b2 }
      const result = byTeam(simulate([qual([1, 2], [3, 4], null)], ratings, 20000, { rules: rules2024, rng: mulberry32(2) }))
      const winShare = result[1].meanRp / rules2024.winRp
      expect(Math.abs(winShare - calcRedWinProb(r1, r2, b1, b2, params))).toBeLessThanOrEqual(0.01)
    }
  })

  it('ends every run with one team at each rank', () => {
    const matches = fixtureQuals().map((m, i) => (i > 10 ? unplayed(m) : m))
    const result = simulate(matches, {}, 300)
    for (let rank = 0; rank < result.teams.length; rank++) {
      expect(result.teams.reduce((sum, t) => sum + t.rankCounts[rank], 0)).toBe(300)
    }
    const total = result.teams.reduce((sum, t) => sum + topNProbability(t, 4, 300), 0)
    expect(total).toBeCloseTo(4, 9)
  })

  it('repeats exactly for the same seed', () => {
    const matches = [qual([1, 2], [3, 4], null), qual([1, 3], [2, 4], null)]
    expect(simulate(matches, { 1: 60 }, 100)).toEqual(simulate(matches, { 1: 60 }, 100))
  })

  it('runs 1,000 simulations of a real event cut after match 20 in under 1.5 s', () => {
    const matches = fixtureQuals().map((m) => (m.matchNum > 20 ? unplayed(m) : m))
    expect(upcomingMatches({ finished: false, matches }).length).toBe(27)
    const started = performance.now()
    const result = simulate(matches, {}, 1000)
    const elapsed = performance.now() - started
    expect(result.runs).toBe(1000)
    expect(elapsed).toBeLessThan(1500)
  })
})
