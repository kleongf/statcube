import { useEffect, useRef, useState } from 'react'
import { searchTeams } from './teams'
import { searchStatus } from './searchStatus'

const SEARCH_DEBOUNCE_MS = 150
const NO_RESULTS = { key: '', results: [] }

export function useTeamSearch(season, query, excluded) {
  const q = query.trim()
  const excludedKey = [...excluded].sort((a, b) => a - b).join(',')
  const key = `${season}|${q}|${excludedKey}`
  const [settled, setSettled] = useState(NO_RESULTS)
  const [failedKey, setFailedKey] = useState(null)
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
        .then(
          (results) => {
            if (!live) return null
            setSettled({ key, results })
            return results
          },
          (err) => {
            console.error('Team search failed', err)
            if (live) setFailedKey(key)
            return null
          },
        )
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
      setFailedKey(null)
    }
  }, [season, q, excludedKey, key])

  const status = searchStatus({ q, key, settledKey: settled.key, failedKey })

  function flush() {
    if (status === 'settled') return Promise.resolve(settled.results)
    if (status === 'failed') return Promise.resolve(null)
    return runNow.current?.() ?? Promise.resolve(null)
  }

  const results = status === 'idle' || status === 'failed' ? NO_RESULTS.results : settled.results
  return { results, status, flush }
}
