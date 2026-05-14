import { NavLink } from 'react-router-dom'

export default function Navbar() {
  const linkClass = ({ isActive }) =>
    `text-sm font-medium transition-colors ${
      isActive ? 'text-white' : 'text-gray-400 hover:text-white'
    }`

  return (
    <nav className="bg-gray-900 border-b border-gray-800 px-6 py-3 sticky top-0 z-10">
      <div className="max-w-5xl mx-auto flex items-center gap-6">
        <span className="text-white font-bold tracking-tight mr-2">
          <NavLink to="/" className="hover:text-white">
          StatCube
          </NavLink>
        </span>
        <NavLink to="/" className={linkClass}>Teams</NavLink>
        <NavLink to="/events" className={linkClass}>Events</NavLink>
        <NavLink to="/methodology" className={linkClass}>Methodology</NavLink>
      </div>
    </nav>
  )
}
