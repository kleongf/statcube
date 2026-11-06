import { supabase } from './supabase'

const PICKER_COLUMNS = 'team_number, team_name'

function applyTeamFilter(query, search) {
  const q = search.trim()
  if (!q) return query
  if (/^\d+$/.test(q)) return query.eq('team_number', Number(q))
  return query.ilike('team_name', `%${q.replace(/[\\%_]/g, '\\$&')}%`)
}

export async function searchTeams(season, q, limit = 10) {
  if (!q.trim()) return []
  const { data, error } = await applyTeamFilter(
    supabase.from(`epa_${season}`).select(PICKER_COLUMNS),
    q,
  )
    .order('team_number')
    .limit(limit)
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
