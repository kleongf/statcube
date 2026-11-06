// Qualification ranking rules per season. PR-10 moves them into seasons.rp_rules.
//   winRp, tieRp   ranking points for a win or a tie
//   bonusRps       alliance score fields that award 1 RP each when true
//   tiebreaks      alliance score fields whose per-match average breaks RP ties, in order
// After the tiebreaks, the lower team number ranks first. ftcscout does the same
// (9 of 9 fully tied pairs checked in 553 events, 2022-2026).
export const RANKING_RULES = {
  2022: { winRp: 2, tieRp: 1, bonusRps: [], tiebreaks: ['autoPoints', 'egPoints'] },
  2023: { winRp: 2, tieRp: 1, bonusRps: [], tiebreaks: ['autoPoints', 'egPoints'] },
  2024: { winRp: 2, tieRp: 1, bonusRps: [], tiebreaks: ['autoPoints', 'dcParkPoints'] },
  2025: {
    winRp: 3,
    tieRp: 1,
    bonusRps: ['movementRp', 'goalRp', 'patternRp'],
    tiebreaks: ['totalPointsNp', 'dcBasePoints'],
  },
  2026: {
    winRp: 3,
    tieRp: 1,
    bonusRps: ['swarmRp', 'pollinator1Rp', 'pollinator2Rp'],
    tiebreaks: ['totalPointsNp', 'tips'],
  },
}

export function rankingRulesFor(season) {
  return RANKING_RULES[season] ?? null
}

export function scoreFieldsFor(season) {
  const rules = rankingRulesFor(season)
  const extra = rules ? [...rules.tiebreaks, ...rules.bonusRps] : []
  return ['totalPoints', ...new Set(extra)]
}

export function compareRankings(a, b) {
  if (a.rp !== b.rp) return b.rp - a.rp
  for (let i = 0; i < a.tiebreaks.length; i++) {
    if (a.tiebreaks[i] !== b.tiebreaks[i]) return b.tiebreaks[i] - a.tiebreaks[i]
  }
  return a.teamNumber - b.teamNumber
}

function outcome(own, opp, rules) {
  let rp = 0
  if (own.totalPoints > opp.totalPoints) rp = rules.winRp
  else if (own.totalPoints === opp.totalPoints) rp = rules.tieRp
  for (const field of rules.bonusRps) if (own[field]) rp += 1
  return rp
}

// matches: the event's matches as getEventQuery returns them.
// Returns one row per team in any qualification match, ranked:
//   { teamNumber, matchesPlayed, wins, losses, ties, rpTotal, rp, tiebreaks, rank }
// rp and tiebreaks are per-match averages, and 0 before a team's first match.
// Only surrogate entries earn nothing. ftcscout counts a DQ, no-show, or off-field
// entry like any other, so this does too.
export function replayRankings(matches, rules) {
  const acc = new Map()
  for (const match of matches) {
    if (match.tournamentLevel !== 'Quals') continue
    const scored = match.hasBeenPlayed && match.scores
    for (const entry of match.teams) {
      let row = acc.get(entry.teamNumber)
      if (!row) {
        row = { teamNumber: entry.teamNumber, matchesPlayed: 0, wins: 0, losses: 0, ties: 0, rpTotal: 0, tbTotals: rules.tiebreaks.map(() => 0) }
        acc.set(entry.teamNumber, row)
      }
      if (!scored || entry.surrogate) continue
      const red = entry.alliance === 'Red'
      const own = red ? match.scores.red : match.scores.blue
      const opp = red ? match.scores.blue : match.scores.red
      row.matchesPlayed++
      row.rpTotal += outcome(own, opp, rules)
      if (own.totalPoints > opp.totalPoints) row.wins++
      else if (own.totalPoints < opp.totalPoints) row.losses++
      else row.ties++
      rules.tiebreaks.forEach((field, i) => { row.tbTotals[i] += own[field] })
    }
  }
  const rows = [...acc.values()].map(({ tbTotals, ...row }) => ({
    ...row,
    rp: row.matchesPlayed ? row.rpTotal / row.matchesPlayed : 0,
    tiebreaks: tbTotals.map((total) => (row.matchesPlayed ? total / row.matchesPlayed : 0)),
  }))
  rows.sort(compareRankings)
  rows.forEach((row, i) => { row.rank = i + 1 })
  return rows
}
