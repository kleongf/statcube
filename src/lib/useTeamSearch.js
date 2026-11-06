import { useEffect, useRef, useState } from 'react'
import { searchTeams } from './teams'

const SEARCH_DEBOUNCE_MS = 150
const NO_RESULTS = { key: '', results: [] }

export function useTeamSearch(season, query, excluded) {
  const q = query.trim()
  const excludedKey = [...excluded].sort((a, b) => a - b).join(',')
  const key = `${season}|${q}|${excludedKey}`
  const [settled, setSettled] = useState(NO_RESULTS)
  const runNow = useRef(null)

  if (!q && settled.key) setSettled(NO_RESULTS)

  useEffect(() => {
    if (!q) return
    let live = true
    let request = null
    const run = () => {
      request ??= searchTeams(season, q, {
        exclude: excludedKey ? excludedKey.split(',').map(Number) : [],
      })
        .catch((err) => {
          console.error('Team search failed', err)
          return []
        })
        .then((results) => {
          if (!live) return null
          setSettled({ key, results })
          return results
        })
      return request
    }
    const timer = setTimeout(run, SEARCH_DEBOUNCE_MS)
    runNow.current = () => {
      clearTimeout(timer)
      return run()
    }
    return () => {
      live = false
      clearTimeout(timer)
      runNow.current = null
    }
  }, [season, q, excludedKey, key])

  const status = !q ? 'idle' : settled.key === key ? 'settled' : 'pending'

  function flush() {
    if (status === 'settled') return Promise.resolve(settled.results)
    return runNow.current?.() ?? Promise.resolve(null)
  }

  return { results: q ? settled.results : [], status, flush }
}
