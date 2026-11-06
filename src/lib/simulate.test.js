import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RANKING_RULES, replayRankings } from './rankings.js'
import { mulberry32, runSimulations, topNProbability, upcomingMatches } from './simulate.js'

const FIXTURE = join(import.meta.dirname, '__fixtures__/rankings/2025-USMIGRQ.json')
const rules = RANKING_RULES[2025]
const params = { mean: 56, a: 2.1482, p: 0.6543 }
const NO_POINTS = { autoPoints: 0, totalPointsNp: 0, dcBasePoints: 0 }

function entry(teamNumber, alliance, extra = {}) {
  return { teamNumber, alliance, onField: true, surrogate: false, ...extra }
}

function qual(red, blue, scores) {
  return {
    tournamentLevel: 'Quals',
    hasBeenPlayed: scores != null,
    teams: [...red.map((t) => (typeof t === 'number' ? entry(t, 'Red') : t)), ...blue.map((t) => (typeof t === 'number' ? entry(t, 'Blue') : t))],
    scores: scores && { red: { ...NO_POINTS, totalPoints: scores[0] }, blue: { ...NO_POINTS, totalPoints: scores[1] } },
  }
}

function simulate(matches, ratings, runs, overrides = {}) {
  return runSimulations({
    standings: replayRankings(matches, rules),
    upcoming: upcomingMatches(matches),
    ratings: new Map(Object.entries(ratings).map(([team, value]) => [Number(team), value])),
    params,
    rules,
    runs,
    rng: mulberry32(1),
    ...overrides,
  })
}

const byTeam = (result) => Object.fromEntries(result.teams.map((t) => [t.teamNumber, t]))

describe('runSimulations', () => {
  it('keeps the replayed standings when no match is left to play', () => {
    const matches = [qual([1, 2], [3, 4], [50, 30]), qual([1, 3], [2, 4], [40, 60])]
    const replayed = replayRankings(matches, rules)
    const result = simulate(matches, {}, 50)
    for (const row of replayed) {
      const team = byTeam(result)[row.teamNumber]
      expect(team.meanRank).toBe(row.rank)
      expect(team.meanRp).toBeCloseTo(row.rp, 9)
      expect(team.startRank).toBe(row.rank)
    }
  })

  it('awards win RP to the favorite and nothing to the underdog', () => {
    const result = byTeam(simulate([qual([1, 2], [3, 4], null)], { 1: 100, 2: 100, 3: 0, 4: 0 }, 200))
    expect(result[1].meanRp).toBe(rules.winRp)
    expect(result[3].meanRp).toBe(0)
    expect(result[1].medianRank).toBe(1)
    expect(result[4].medianRank).toBe(4)
  })

  it('awards tie RP and no bonus RP when the scores tie', () => {
    const matches = [qual([1, 2], [3, 4], null)]
    const result = byTeam(simulate(matches, {}, 20, { params: { mean: 0, a: 0, p: 1 } }))
    for (const t of [1, 2, 3, 4]) expect(result[t].meanRp).toBe(rules.tieRp)
  })

  it('gives a surrogate team no RP and no match from an upcoming match', () => {
    const surrogate = entry(2, 'Red', { surrogate: true })
    const matches = [qual([1, 2], [3, 4], [50, 30]), qual([1, surrogate], [3, 4], null)]
    const result = byTeam(simulate(matches, { 1: 100, 2: 100, 3: 0, 4: 0 }, 50))
    expect(result[2].meanRp).toBe(rules.winRp)
  })

  it('ends every run with one team at each rank', () => {
    const matches = JSON.parse(readFileSync(FIXTURE, 'utf8')).data.eventByCode.matches.map((m, i) => (i > 10 ? { ...m, hasBeenPlayed: false, scores: null } : m))
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
    const matches = JSON.parse(readFileSync(FIXTURE, 'utf8')).data.eventByCode.matches.map((m) =>
      m.tournamentLevel === 'Quals' && m.matchNum > 20 ? { ...m, hasBeenPlayed: false, scores: null } : m,
    )
    expect(upcomingMatches(matches).length).toBe(27)
    const started = performance.now()
    const result = simulate(matches, {}, 1000)
    const elapsed = performance.now() - started
    expect(result.runs).toBe(1000)
    expect(elapsed).toBeLessThan(1500)
  })
})
