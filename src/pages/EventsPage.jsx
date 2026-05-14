import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { ftcscoutQuery } from '../lib/ftcscout'

const SEASON = 2025

const EVENTS_QUERY = `
  query Events($season: Int!) {
    eventsSearch(season: $season) {
      code
      name
      location {
        city
        country
        state
      }
      start
      end
    }
  }
`

function formatDateRange(start, end) {
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
  const fmt = (d, opts) => d.toLocaleDateString(undefined, opts)
  const s = parse(start)
  const e = parse(end)

  if (start === end) return fmt(s, { month: 'short', day: 'numeric', year: 'numeric' })

  const sameYear = s.getFullYear() === e.getFullYear()
  const sameMonth = sameYear && s.getMonth() === e.getMonth()

  if (sameMonth) {
    return `${fmt(s, { month: 'short', day: 'numeric' })}–${fmt(e, { day: 'numeric', year: 'numeric' })}`
  }
  if (sameYear) {
    return `${fmt(s, { month: 'short', day: 'numeric' })} – ${fmt(e, { month: 'short', day: 'numeric', year: 'numeric' })}`
  }
  return `${fmt(s, { month: 'short', day: 'numeric', year: 'numeric' })} – ${fmt(e, { month: 'short', day: 'numeric', year: 'numeric' })}`
}

function EventCard({ event, onClick }) {
  const { name, code, location, start, end } = event
  const locationStr = [location.city, location.country].filter(Boolean).join(', ')

  return (
    <button
      onClick={onClick}
      className="text-left bg-gray-900 border border-gray-800 rounded-xl px-5 py-4 hover:border-gray-600 hover:bg-gray-800/60 transition-colors w-full"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-semibold text-white text-sm leading-snug">{name}</h3>
        <span className="text-xs text-gray-500 font-mono shrink-0 mt-0.5">{code}</span>
      </div>
      <p className="text-gray-400 text-xs mb-1">{locationStr}</p>
      <p className="text-gray-500 text-xs">{formatDateRange(start, end)}</p>
    </button>
  )
}

export default function EventsPage() {
  const [allEvents, setAllEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    async function fetchEvents() {
      try {
        const data = await ftcscoutQuery(EVENTS_QUERY, { season: SEASON })
        const events = data?.eventsSearch ?? []
        events.sort((a, b) => a.start.localeCompare(b.start))
        setAllEvents(events)
      } catch (e) {
        setError(e.message)
      }
      setLoading(false)
    }
    fetchEvents()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allEvents
    return allEvents.filter((e) => e.name.toLowerCase().includes(q))
  }, [allEvents, search])

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Navbar />
      <div className="max-w-5xl mx-auto p-6">
        <h1 className="text-3xl font-bold mb-1 text-white">Events</h1>
        <p className="text-gray-400 text-sm mb-6">{SEASON}/{SEASON + 1} season</p>

        <input
          type="text"
          placeholder="Search events…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full mb-6 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
        />

        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded-lg p-4 text-red-300 mb-4 text-sm">
            {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-20 text-gray-500">
            Loading events…
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-16 text-gray-500">No events match your search.</div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <>
            <p className="text-gray-500 text-xs mb-4">
              {filtered.length} {filtered.length === 1 ? 'event' : 'events'}
              {search && ` matching "${search}"`}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((event) => (
                <EventCard
                  key={event.code}
                  event={event}
                  onClick={() => navigate(`/events/${event.code}`, { state: { name: event.name } })}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
