export const MAX_COMPARE_TEAMS = 8
export const ALLIANCE_SIZE = 2

export function parseTeamList(raw) {
  const numbers = []
  for (const part of (raw ?? '').split(',')) {
    const item = part.trim()
    if (!/^\d{1,9}$/.test(item)) continue
    const n = Number(item)
    if (n > 0 && !numbers.includes(n)) numbers.push(n)
  }
  return numbers
}

export function parseCompareTeams(raw) {
  return parseTeamList(raw).slice(0, MAX_COMPARE_TEAMS)
}

export function parseAlliances(red, blue) {
  const redTeams = parseTeamList(red).slice(0, ALLIANCE_SIZE)
  const blueTeams = parseTeamList(blue)
    .filter((n) => !redTeams.includes(n))
    .slice(0, ALLIANCE_SIZE)
  return { red: redTeams, blue: blueTeams }
}

export function withTeamParams(prev, lists) {
  const next = new URLSearchParams(prev)
  for (const [key, numbers] of Object.entries(lists)) {
    if (numbers.length) next.set(key, numbers.join(','))
    else next.delete(key)
  }
  return next
}

export function paramsMatch(searchParams, lists) {
  return Object.entries(lists).every(
    ([key, numbers]) => (searchParams.get(key) ?? '') === numbers.join(','),
  )
}

export function dropUnknownTeams(numbers, rows) {
  return numbers.filter((n) => rows[n]?.exists !== false)
}
