import { useEffect, useState, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Navbar from '../components/Navbar'
import SeasonSelect from '../components/SeasonSelect'
import SortableTeamsTable from '../components/SortableTeamsTable'
import { CURRENT_SEASON } from '../lib/constants'

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

export default function TeamsPage() {
  const { season: seasonParam } = useParams()
  const season = parseInt(seasonParam ?? String(CURRENT_SEASON), 10)

  const [allTeams, setAllTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('current_epa')
  const [sortDir, setSortDir] = useState('desc')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)

  useEffect(() => {
    setAllTeams([])
    setLoading(true)
    setError(null)

    async function fetchTeams() {
      const BATCH = 1000
      let from = 0
      const rows = []

      while (true) {
        const { data, error } = await supabase
          .from(`epa_${season}`)
          .select('team_number, team_name, current_epa, current_auto_epa, current_teleop_epa')
          .range(from, from + BATCH - 1)

        if (error) {
          setError(error.message)
          setLoading(false)
          return
        }

        rows.push(...data)
        if (data.length < BATCH) break
        from += BATCH
      }

      setAllTeams(rows)
      setLoading(false)
    }
    fetchTeams()
  }, [season])

  // Reset to page 1 whenever search, sort, or page size changes
  useEffect(() => { setPage(1) }, [search, sortKey, sortDir, pageSize])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allTeams
    return allTeams.filter(
      (t) =>
        String(t.team_number).includes(q) ||
        (t.team_name ?? '').toLowerCase().includes(q),
    )
  }, [allTeams, search])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity
      const bv = b[sortKey] ?? -Infinity
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }, [filtered, sortKey, sortDir])

  // Rank within the full dataset, unaffected by search filter
  const globalRanks = useMemo(() => {
    const fullSorted = [...allTeams].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity
      const bv = b[sortKey] ?? -Infinity
      return sortDir === 'asc' ? av - bv : bv - av
    })
    const ranks = {}
    fullSorted.forEach((team, i) => { ranks[team.team_number] = i + 1 })
    return ranks
  }, [allTeams, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize)

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Navbar />
      <div className="max-w-5xl mx-auto p-6">
        <div className="flex items-start justify-between mb-1">
          <h1 className="text-3xl font-bold text-white">Team Rankings</h1>
          <SeasonSelect season={season} getPath={(s) => `/teams/${s}`} />
        </div>
        <p className="text-gray-400 mb-6 text-sm">{season}/{season + 1} season · Ranked by Expected Points Added (EPA)</p>

        {/* Controls row */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <input
            type="text"
            placeholder="Search team name or number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
          />
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-gray-500 text-sm whitespace-nowrap">Show</span>
            <div className="flex gap-1">
              {PAGE_SIZE_OPTIONS.map((n) => (
                <button
                  key={n}
                  onClick={() => setPageSize(n)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    pageSize === n
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded-lg p-4 text-red-300 mb-4">
            {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-20 text-gray-500">
            Loading teams…
          </div>
        )}

        {!loading && !error && (
          <>
            <SortableTeamsTable
              teams={pageRows}
              season={season}
              rankMap={globalRanks}
              sortKey={sortKey}
              sortDir={sortDir}
              onSortChange={(key, dir) => { setSortKey(key); setSortDir(dir) }}
            />

            {/* Pagination footer */}
            <div className="flex items-center justify-between mt-4 text-sm text-gray-400">
              <span>
                {sorted.length === 0
                  ? 'No results'
                  : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, sorted.length)} of ${sorted.length} teams`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page === 1}
                  className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  ← Prev
                </button>
                <span className="px-2 tabular-nums">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Next →
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
