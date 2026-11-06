import { supabase } from './supabase'

const PICKER_COLUMNS = 'team_number, team_name'
const INT4_MAX = 2147483647

function numberPrefixRanges(digits) {
  if (!/^[1-9]\d*$/.test(digits) || Number(digits) > INT4_MAX) return []
  const ranges = []
  for (let span = 1; Number(digits) * span <= INT4_MAX; span *= 10) {
    const lo = Number(digits) * span
    ranges.push([lo, Math.min(lo + span - 1, INT4_MAX)])
  }
  return ranges
}

function quoteLogicValue(value) {
  return `"${value.replace(/[\\"]/g, '\\$&')}"`
}

function teamFilter(q) {
  const numberClauses = numberPrefixRanges(q).map(([lo, hi]) =>
    lo === hi ? `team_number.eq.${lo}` : `and(team_number.gte.${lo},team_number.lte.${hi})`,
  )
  const literalName = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...numberClauses, `team_name.imatch.${quoteLogicValue(literalName)}`].join(',')
}

export async function searchTeams(season, query, { limit = 10, exclude = [] } = {}) {
  const q = query.trim()
  if (!q) return []
  let request = supabase
    .from(`epa_${season}`)
    .select(PICKER_COLUMNS)
    .or(teamFilter(q))
  if (exclude.length) request = request.not('team_number', 'in', `(${exclude.join(',')})`)
  const { data, error } = await request.order('team_number').limit(limit)
  if (error) throw error
  return data
}

export async function fetchTeamsByNumber(season, numbers, columns = PICKER_COLUMNS) {
  if (numbers.length === 0) return []
  const { data, error } = await supabase
    .from(`epa_${season}`)
    .select(columns)
    .in('team_number', numbers)
  if (error) throw error
  return data
}
