import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { SEASONS } from '../lib/constants'

export default function SeasonSelect({ season, getPath }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function select(year) {
    setOpen(false)
    navigate(getPath(year))
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={[
          'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
          'bg-gray-900 border text-gray-200',
          open
            ? 'border-blue-500 text-white'
            : 'border-gray-700 hover:border-gray-500 hover:text-white',
        ].join(' ')}
      >
        <span>{season}/{season + 1}</span>
        <svg
          className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-32 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl overflow-hidden z-50">
          {[...SEASONS].reverse().map((y) => {
            const active = y === season
            return (
              <button
                key={y}
                onClick={() => select(y)}
                className={[
                  'w-full text-left px-3 py-2 text-sm transition-colors',
                  active
                    ? 'text-blue-400 font-medium bg-blue-950/40'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white',
                ].join(' ')}
              >
                {y}/{y + 1}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
