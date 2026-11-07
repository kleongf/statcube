import { useEffect, useState } from 'react'
import { useLocation, useNavigationType, useParams, useSearchParams } from 'react-router-dom'
import Navbar from '../components/Navbar'
import SeasonSelect from '../components/SeasonSelect'
import SortableTeamsTable from '../components/SortableTeamsTable'
import { CURRENT_SEASON } from '../lib/constants'
import { TEAM_SORTS, fetchTeamsPage } from '../lib/teams'

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const DEFAULT_PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 250
const RANGE_NOT_SATISFIABLE = 'PGRST103'

const SORT_BY_COLUMN = Object.fromEntries(
  Object.entries(TEAM_SORTS).map(([sort, { column }]) => [column, sort]),
)

function readView(params) {
  const sort = params.get('sort') in TEAM_SORTS ? params.get('sort') : 'epa'
  const dir = params.get('dir') === 'asc' ? 'asc' : 'desc'
  const pageSize = PAGE_SIZE_OPTIONS.includes(Number(params.get('pageSize')))
    ? Number(params.get('pageSize'))
    : DEFAULT_PAGE_SIZE
  const page = Math.max(1, parseInt(params.get('page'), 10) || 1)
  return { sort, dir, pageSize, page, q: params.get('q') ?? '' }
}

function writeView({ sort, dir, pageSize, page, q }) {
  const params = new URLSearchParams()
  if (q.trim()) params.set('q', q)
  if (sort !== 'epa') params.set('sort', sort)
  if (dir !== 'desc') params.set('dir', dir)
  if (pageSize !== DEFAULT_PAGE_SIZE) params.set('pageSize', String(pageSize))
  if (page > 1) params.set('page', String(page))
  return params
}

function seasonPath(season, view) {
  const query = writeView({ ...view, page: 1 }).toString()
  return `/teams/${season}${query ? `?${query}` : ''}`
}

export default function TeamsPage() {
  const { season: seasonParam } = useParams()
  const season = parseInt(seasonParam ?? String(CURRENT_SEASON), 10)
  const [searchParams, setSearchParams] = useSearchParams()
  const view = readView(searchParams)
  const { sort, dir, pageSize, page, q } = view

  const location = useLocation()
  const navigationType = useNavigationType()
  const [draft, setDraft] = useState(q)
  const [synced, setSynced] = useState({ key: location.key, q })
  if (location.key !== synced.key) {
    setSynced({ key: location.key, q })
    if (navigationType === 'POP' || q !== synced.q) setDraft(q)
  }

  function update(changes, { replace = false } = {}) {
    setSearchParams(writeView({ ...view, ...changes }), { replace })
  }

  useEffect(() => {
    if (draft.trim() === q.trim()) return
    const timer = setTimeout(() => {
      setSearchParams(writeView({ sort, dir, pageSize, page: 1, q: draft }), { replace: true })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft, q, sort, dir, pageSize, setSearchParams])

  const key = `${season}|${sort}|${dir}|${pageSize}|${page}|${q.trim()}`
  const [settled, setSettled] = useState({ key: null, rows: [], total: 0 })
  const [failed, setFailed] = useState(null)

  useEffect(() => {
    let live = true
    fetchTeamsPage({ season, sort, dir, search: q, page, pageSize }).then(
      ({ rows, total }) => {
        if (!live) return
        setSettled({ key, rows, total })
        setFailed(null)
      },
      (err) => {
        if (!live) return
        if (err.code === RANGE_NOT_SATISFIABLE && page > 1) {
          setSearchParams(writeView({ sort, dir, pageSize, page: 1, q }), { replace: true })
          return
        }
        console.error('Teams page failed', err)
        setFailed({ key, message: err.message })
      },
    )
    return () => { live = false }
  }, [key, season, sort, dir, q, page, pageSize, setSearchParams])

  const error = failed?.key === key ? failed.message : null
  const loading = settled.key !== key && !error
  const { rows, total } = settled
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const rankKey = TEAM_SORTS[sort].rank
  const rankMap = Object.fromEntries(rows.map((t) => [t.team_number, t[rankKey]]))
  const firstShown = (page - 1) * pageSize + 1
  const lastShown = Math.min(page * pageSize, total)
  const showControls = settled.key !== null || error

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Navbar />
      <div className="max-w-5xl mx-auto p-6">
        <div className="flex items-start justify-between mb-1">
          <h1 className="text-3xl font-bold text-white">Team Rankings</h1>
          <SeasonSelect season={season} getPath={(s) => seasonPath(s, { sort, dir, pageSize, q: draft })} />
        </div>
        <p className="text-gray-400 mb-6 text-sm">{season}/{season + 1} season · Ranked by Expected Points Added (EPA)</p>

        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <input
            type="text"
            placeholder="Search team name or number…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
          />
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-gray-500 text-sm whitespace-nowrap">Show</span>
            <div className="flex gap-1">
              {PAGE_SIZE_OPTIONS.map((n) => (
                <button
                  key={n}
                  onClick={() => update({ pageSize: n, page: 1 })}
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

        {settled.key === null && loading && (
          <div className="flex items-center justify-center py-20 text-gray-500">
            Loading teams…
          </div>
        )}

        {showControls && (
          <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            <SortableTeamsTable
              teams={error ? [] : rows}
              season={season}
              rankMap={rankMap}
              sortKey={TEAM_SORTS[sort].column}
              sortDir={dir}
              onSortChange={(column, nextDir) =>
                update({ sort: SORT_BY_COLUMN[column], dir: nextDir, page: 1 })
              }
            />

            <div className="flex items-center justify-between mt-4 text-sm text-gray-400">
              <span>
                {error ? '' : total === 0
                  ? 'No results'
                  : `${firstShown.toLocaleString()}-${lastShown.toLocaleString()} of ${total.toLocaleString()} teams`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => update({ page: page - 1 })}
                  disabled={page === 1}
                  className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  ← Prev
                </button>
                <span className="px-2 tabular-nums">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => update({ page: page + 1 })}
                  disabled={!error && page >= totalPages}
                  className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Next →
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
