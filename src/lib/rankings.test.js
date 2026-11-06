import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RANKING_RULES, replayRankings } from './rankings.js'

const FIXTURE_DIR = join(import.meta.dirname, '__fixtures__/rankings')

const fixtures = readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith('.json'))
  .map((name) => {
    const [season, code] = name.replace('.json', '').split('-')
    const event = JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')).data.eventByCode
    return { season: Number(season), code, event }
  })

function team(teamNumber, alliance, extra = {}) {
  return { teamNumber, alliance, onField: true, surrogate: false, ...extra }
}

const NO_POINTS = { autoPoints: 0, egPoints: 0, dcParkPoints: 0, totalPointsNp: 0, dcBasePoints: 0, tips: 0 }

function qual(red, blue, redScore, blueScore, extra = {}) {
  return {
    tournamentLevel: 'Quals',
    hasBeenPlayed: redScore != null,
    teams: [...red.map((t) => (typeof t === 'number' ? team(t, 'Red') : t)), ...blue.map((t) => (typeof t === 'number' ? team(t, 'Blue') : t))],
    scores: redScore == null ? null : { red: { ...NO_POINTS, totalPoints: redScore, ...extra.red }, blue: { ...NO_POINTS, totalPoints: blueScore, ...extra.blue } },
  }
}

const rules2025 = RANKING_RULES[2025]
const rules2024 = RANKING_RULES[2024]

describe('replayRankings against recorded ftcscout events', () => {
  it('covers five 2025 events and at least one of 2022, 2023, 2024, and 2026', () => {
    const count = (season) => fixtures.filter((f) => f.season === season).length
    expect(count(2025)).toBeGreaterThanOrEqual(5)
    for (const season of [2022, 2023, 2024, 2026]) expect(count(season)).toBeGreaterThanOrEqual(1)
  })

  it('covers surrogate matches, DQs, and teams tied on every ranking criterion', () => {
    const entries = fixtures.flatMap((f) => f.event.matches.filter((m) => m.tournamentLevel === 'Quals').flatMap((m) => m.teams))
    expect(entries.some((t) => t.surrogate)).toBe(true)
    expect(fixtures.some((f) => f.event.teams.some((t) => t.stats?.dqs > 0))).toBe(true)
    const tied = fixtures.some(({ season, event }) => {
      const rows = replayRankings(event.matches, RANKING_RULES[season])
      return rows.some((row, i) => i > 0 && row.rp === rows[i - 1].rp && row.tiebreaks.every((v, k) => v === rows[i - 1].tiebreaks[k]))
    })
    expect(tied).toBe(true)
  })

  for (const { season, code, event } of fixtures) {
    it(`${season} ${code} reproduces rp, rank, record, and tiebreakers for every team`, () => {
      const rows = new Map(replayRankings(event.matches, RANKING_RULES[season]).map((row) => [row.teamNumber, row]))
      const ranked = event.teams.filter((t) => t.stats)
      expect(ranked.length).toBeGreaterThan(0)
      for (const { teamNumber, stats } of ranked) {
        const row = rows.get(teamNumber)
        expect(row, `team ${teamNumber} present`).toBeDefined()
        expect({
          rank: row.rank,
          matchesPlayed: row.matchesPlayed,
          record: [row.wins, row.losses, row.ties],
        }).toEqual({
          rank: stats.rank,
          matchesPlayed: stats.qualMatchesPlayed,
          record: [stats.wins, stats.losses, stats.ties],
        })
        expect(row.rp).toBeCloseTo(stats.rp, 9)
        expect(row.tiebreaks[0]).toBeCloseTo(stats.tb1, 9)
        expect(row.tiebreaks[1]).toBeCloseTo(stats.tb2, 9)
      }
    })
  }
})

describe('replayRankings rules', () => {
  it('awards win RP plus each true bonus RP, and tie RP on equal scores', () => {
    const rows = replayRankings(
      [
        qual([1, 2], [3, 4], 50, 30, { red: { movementRp: true, goalRp: false, patternRp: true }, blue: { movementRp: true } }),
        qual([1, 3], [2, 4], 40, 40),
      ],
      rules2025,
    )
    const rp = Object.fromEntries(rows.map((r) => [r.teamNumber, r.rpTotal]))
    expect(rp).toEqual({ 1: 3 + 2 + 1, 2: 3 + 2 + 1, 3: 1 + 1, 4: 1 + 1 })
  })

  it('awards no bonus RP in a season without bonus fields', () => {
    const rows = replayRankings([qual([1, 2], [3, 4], 50, 30, { red: { movementRp: true } })], rules2024)
    expect(rows.find((r) => r.teamNumber === 1).rpTotal).toBe(2)
  })

  it('gives a surrogate team no RP, no match played, and no record', () => {
    const rows = replayRankings(
      [qual([1, team(2, 'Red', { surrogate: true })], [3, 4], 50, 30), qual([2, 3], [1, 4], 10, 20)],
      rules2024,
    )
    const two = rows.find((r) => r.teamNumber === 2)
    expect(two).toMatchObject({ matchesPlayed: 1, wins: 0, losses: 1, rpTotal: 0 })
  })

  it('counts a DQ or off-field entry like any other, the way ftcscout does', () => {
    const rows = replayRankings(
      [qual([1, team(2, 'Red', { dq: true, noShow: true, onField: false })], [3, 4], 50, 30)],
      rules2024,
    )
    expect(rows.find((r) => r.teamNumber === 2)).toMatchObject({ matchesPlayed: 1, wins: 1, rpTotal: 2 })
  })

  it('lists every team of an unplayed event at zero RP, ranked by team number', () => {
    const rows = replayRankings([qual([7, 5], [9, 3], null)], rules2025)
    expect(rows.map((r) => [r.rank, r.teamNumber, r.rp, r.matchesPlayed])).toEqual([
      [1, 3, 0, 0],
      [2, 5, 0, 0],
      [3, 7, 0, 0],
      [4, 9, 0, 0],
    ])
  })

  it('ignores playoff matches', () => {
    const playoff = { ...qual([1, 2], [3, 4], 90, 10), tournamentLevel: 'DoubleElim' }
    expect(replayRankings([playoff], rules2024)).toEqual([])
  })

  it('breaks RP ties by the first tiebreak average, then the second, then team number', () => {
    const firstDecides = replayRankings(
      [
        qual([1, 2], [3, 4], 50, 30, { red: { autoPoints: 5, dcParkPoints: 0 }, blue: { autoPoints: 4, dcParkPoints: 9 } }),
        qual([5, 6], [7, 8], 50, 30, { red: { autoPoints: 6, dcParkPoints: 1 }, blue: { autoPoints: 1, dcParkPoints: 1 } }),
      ],
      rules2024,
    )
    expect(firstDecides.slice(0, 4).map((r) => r.teamNumber)).toEqual([5, 6, 1, 2])
    const secondDecides = replayRankings(
      [qual([1, 2], [3, 4], 50, 30, { red: { autoPoints: 5, dcParkPoints: 2 }, blue: {} }), qual([5, 6], [7, 8], 50, 30, { red: { autoPoints: 5, dcParkPoints: 7 }, blue: {} })],
      rules2024,
    )
    expect(secondDecides.slice(0, 4).map((r) => r.teamNumber)).toEqual([5, 6, 1, 2])
  })
})
