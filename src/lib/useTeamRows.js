import { useEffect, useState } from 'react'
import { fetchTeamsByNumber } from './teams'

export function useTeamRows(season, numbers, columns) {
  const [rows, setRows] = useState({})
  const [failedKey, setFailedKey] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const missingKey = numbers.filter((n) => !rows[n]?.loaded).join(',')
  const [seenKey, setSeenKey] = useState(missingKey)

  if (seenKey !== missingKey) {
    setSeenKey(missingKey)
    setFailedKey(null)
  }

  useEffect(() => {
    if (!missingKey) return
    const wanted = missingKey.split(',').map(Number)
    let stale = false
    fetchTeamsByNumber(season, wanted, columns)
      .then((fetched) => {
        if (stale) return
        setRows((prev) => {
          const next = { ...prev }
          for (const n of wanted) next[n] = { team_number: n, exists: false, ...prev[n], loaded: true }
          for (const row of fetched) next[row.team_number] = { ...row, exists: true, loaded: true }
          return next
        })
      })
      .catch((err) => {
        console.error('Failed to load teams', err)
        if (!stale) setFailedKey(missingKey)
      })
    return () => { stale = true }
  }, [season, columns, missingKey, attempt])

  function seed(team) {
    setRows((prev) => ({ ...prev, [team.team_number]: { ...team, ...prev[team.team_number], exists: true } }))
  }

  function retry() {
    setFailedKey(null)
    setAttempt((n) => n + 1)
  }

  return { rows, seed, failed: Boolean(missingKey) && failedKey === missingKey, retry }
}
