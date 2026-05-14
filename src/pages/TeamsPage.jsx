import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Navbar from '../components/Navbar'

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

const COLUMNS = [
  { key: null, label: '#', sortable: false, align: 'left', className: 'w-10' },
  { key: 'team', label: 'Team', sortable: false, align: 'left' },
  { key: 'current_epa', label: 'Total EPA', sortable: true, align: 'right' },
  { key: 'current_auto_epa', label: 'Auto EPA', sortable: true, align: 'right' },
  { key: 'current_teleop_epa', label: 'Teleop EPA', sortable: true, align: 'right' },
]

function SortIcon({ active, direction }) {
  if (!active) return <span className="ml-1 text-gray-600 select-none">↕</span>
  return (
    <span className="ml-1 text-blue-400 select-none">
      {direction === 'asc' ? '↑' : '↓'}
    </span>
  )
}

export default function TeamsPage() {
  const [allTeams, setAllTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('current_epa')
  const [sortDir, setSortDir] = useState('desc')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)

  const navigate = useNavigate()

  useEffect(() => {
    async function fetchTeams() {
      const BATCH = 1000
      let from = 0
      const rows = []

      while (true) {
        const { data, error } = await supabase
          .from('epa_snapshots')
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
  }, [])

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

  function handleHeaderClick(key) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Navbar />
      <div className="max-w-5xl mx-auto p-6">
        <h1 className="text-3xl font-bold mb-1 text-white">2025-2026 Team Rankings</h1>
        <p className="text-gray-400 mb-6 text-sm">Ranked by Expected Points Added (EPA)</p>

        {/* Controls row */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          {/* Search */}
          <input
            type="text"
            placeholder="Search team name or number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
          />

          {/* Page size */}
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

        {/* Error */}
        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded-lg p-4 text-red-300 mb-4">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20 text-gray-500">
            Loading teams…
          </div>
        )}

        {/* Table */}
        {!loading && !error && (
          <>
            <div className="bg-gray-900 rounded-xl overflow-hidden border border-gray-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wider">
                    {COLUMNS.map((col) => (
                      <th
                        key={col.label}
                        onClick={col.sortable ? () => handleHeaderClick(col.key) : undefined}
                        className={[
                          col.align === 'right' ? 'text-right' : 'text-left',
                          'px-5 py-3 select-none',
                          col.sortable ? 'cursor-pointer hover:text-white transition-colors' : '',
                          col.sortable && sortKey === col.key ? 'text-blue-400' : '',
                          col.className ?? '',
                        ].join(' ')}
                      >
                        {col.label}
                        {col.sortable && (
                          <SortIcon active={sortKey === col.key} direction={sortDir} />
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-10 text-center text-gray-500">
                        No teams match your search.
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((team) => {
                      return (
                        <tr
                          key={team.team_number}
                          onClick={() => navigate(`/team/${team.team_number}`)}
                          className="border-b border-gray-800/60 hover:bg-gray-800/50 cursor-pointer transition-colors last:border-0"
                        >
                          <td className="px-5 py-3.5 text-gray-500 tabular-nums">{globalRanks[team.team_number]}</td>
                          <td className="px-5 py-3.5">
                            <span className="font-medium text-white">{team.team_number}</span>
                            <span className="text-gray-400 ml-2">{team.team_name}</span>
                          </td>
                          <td className={`px-5 py-3.5 text-right tabular-nums font-medium ${sortKey === 'current_epa' ? 'text-blue-300' : 'text-gray-200'}`}>
                            {team.current_epa?.toFixed(2) ?? '—'}
                          </td>
                          <td className={`px-5 py-3.5 text-right tabular-nums ${sortKey === 'current_auto_epa' ? 'text-blue-300 font-medium' : 'text-gray-400'}`}>
                            {team.current_auto_epa?.toFixed(2) ?? '—'}
                          </td>
                          <td className={`px-5 py-3.5 text-right tabular-nums ${sortKey === 'current_teleop_epa' ? 'text-blue-300 font-medium' : 'text-gray-400'}`}>
                            {team.current_teleop_epa?.toFixed(2) ?? '—'}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

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
