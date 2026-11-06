import { useEffect, useState } from 'react'
import { searchTeams } from './teams'

export const SEARCH_DEBOUNCE_MS = 250

export function useTeamSearch(season, query) {
  const q = query.trim()
  const key = `${season}|${q}`
  const [settled, setSettled] = useState({ key: '', results: [] })

  useEffect(() => {
    if (!q) return
    let stale = false
    const timer = setTimeout(async () => {
      let results = []
      try {
        results = await searchTeams(season, q)
      } catch (err) {
        console.error('Team search failed', err)
      }
      if (!stale) setSettled({ key, results })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [season, q, key])

  const ready = Boolean(q) && settled.key === key
  return { results: ready ? settled.results : [], searched: ready }
}
