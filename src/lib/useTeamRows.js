import { useEffect, useState } from 'react'
import { fetchTeamsByNumber } from './teams'

export function useTeamRows(season, numbers, columns) {
  const [rows, setRows] = useState({})
  const missingKey = numbers.filter((n) => !rows[n]?.loaded).join(',')

  useEffect(() => {
    if (!missingKey) return
    const wanted = missingKey.split(',').map(Number)
    let stale = false
    fetchTeamsByNumber(season, wanted, columns)
      .then((fetched) => {
        if (stale) return
        setRows((prev) => {
          const next = { ...prev }
          for (const n of wanted) next[n] = { team_number: n, ...prev[n], loaded: true }
          for (const row of fetched) next[row.team_number] = { ...row, loaded: true }
          return next
        })
      })
      .catch((err) => console.error('Failed to load teams', err))
    return () => { stale = true }
  }, [season, columns, missingKey])

  function seed(team) {
    setRows((prev) => ({ ...prev, [team.team_number]: { ...team, ...prev[team.team_number] } }))
  }

  return { rows, seed }
}
