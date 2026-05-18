import { NavLink, useMatch } from 'react-router-dom'
import { CURRENT_SEASON } from '../lib/constants'

export default function Navbar() {
  const teamsMatch   = useMatch('/teams/:season')
  const eventsMatch  = useMatch('/events/:season')
  const teamMatch    = useMatch('/team/:teamNumber/:season')
  const eventMatch   = useMatch('/event/:season/:eventCode')
  const compareMatch = useMatch('/compare/:season')

  const season =
    teamsMatch?.params?.season ??
    eventsMatch?.params?.season ??
    teamMatch?.params?.season ??
    eventMatch?.params?.season ??
    compareMatch?.params?.season ??
    String(CURRENT_SEASON)

  const linkClass = ({ isActive }) =>
    `text-sm font-medium transition-colors ${
      isActive ? 'text-white' : 'text-gray-400 hover:text-white'
    }`

  return (
    <nav className="bg-gray-900 border-b border-gray-800 px-6 py-3 sticky top-0 z-10">
      <div className="max-w-5xl mx-auto flex items-center gap-6">
        <span className="text-white font-bold tracking-tight mr-2">
          <NavLink to="/" className="flex items-center gap-1.5 hover:text-white">
            <img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGNsYXNzPSJsdWNpZGUgbHVjaWRlLWJveC1pY29uIGx1Y2lkZS1ib3giPjxwYXRoIGQ9Ik0yMSA4YTIgMiAwIDAgMC0xLTEuNzNsLTctNGEyIDIgMCAwIDAtMiAwbC03IDRBMiAyIDAgMCAwIDMgOHY4YTIgMiAwIDAgMCAxIDEuNzNsNyA0YTIgMiAwIDAgMCAyIDBsNy00QTIgMiAwIDAgMCAyMSAxNloiLz48cGF0aCBkPSJtMy4zIDcgOC43IDUgOC43LTUiLz48cGF0aCBkPSJNMTIgMjJWMTIiLz48L3N2Zz4=" alt="cube" className="w-[1em] h-[1em]" style={{
              filter: 'invert(1)'
            }} />
            StatCube
          </NavLink>
        </span>
        <NavLink to={`/teams/${season}`} className={linkClass}>Teams</NavLink>
        <NavLink to={`/events/${season}`} className={linkClass}>Events</NavLink>
        <NavLink to={`/compare/${season}`} className={linkClass}>Compare</NavLink>
        <NavLink to="/methodology" className={linkClass}>Methodology</NavLink>
      </div>
    </nav>
  )
}
