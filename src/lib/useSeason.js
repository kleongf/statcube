import { useEffect, useState } from 'react'
import { supabase } from './supabase'

let seasonsRequest = null

function loadSeasons() {
  seasonsRequest ??= supabase
    .from('seasons')
    .select('season, mean, a, p, mean_auto, a_auto, p_auto')
    .then(({ data, error }) => {
      if (error) throw new Error(error.message)
      return new Map(data.map((row) => [row.season, row]))
    })
    .catch((e) => {
      seasonsRequest = null
      throw e
    })
  return seasonsRequest
}

export function useSeason(season) {
  const [state, setState] = useState({ seasons: null, error: null })

  useEffect(() => {
    let live = true
    loadSeasons().then(
      (seasons) => live && setState({ seasons, error: null }),
      (e) => live && setState({ seasons: null, error: `Could not load season parameters: ${e.message}` }),
    )
    return () => { live = false }
  }, [])

  if (state.error) return { params: null, error: state.error }
  if (!state.seasons) return { params: null, error: null }
  const params = state.seasons.get(season)
  return params ? { params, error: null } : { params: null, error: `No parameters found for season ${season}` }
}
