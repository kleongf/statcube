import { useEffect, useId, useRef, useState } from 'react'
import { useTeamSearch } from '../lib/useTeamSearch'

const SIZES = {
  md: { input: 'px-4 py-2', list: 'max-h-60', item: 'px-4 py-2', number: 'w-16' },
  sm: { input: 'px-3 py-1.5', list: 'max-h-52', item: 'px-3 py-2', number: 'w-14' },
}

export default function TeamSearchBox({
  season,
  excluded,
  onPick,
  placeholder = 'Search team name or number…',
  focusClass = 'focus:border-blue-500',
  size = 'md',
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef(null)
  const listId = useId()
  const s = SIZES[size]

  const { results, searched } = useTeamSearch(season, search)
  const suggestions = results.filter((t) => !excluded.has(t.team_number))
  const highlighted = Math.min(active, suggestions.length - 1)

  useEffect(() => {
    function handleClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function pick(team) {
    onPick(team)
    setSearch('')
    setOpen(false)
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!suggestions.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((highlighted + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      setActive((highlighted - 1 + suggestions.length) % suggestions.length)
    } else if (e.key === 'Enter' && open) {
      e.preventDefault()
      pick(suggestions[highlighted])
    }
  }

  const showList = open && suggestions.length > 0
  const showEmpty = open && searched && suggestions.length === 0

  return (
    <div className="relative" ref={rootRef}>
      <input
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList ? `${listId}-${highlighted}` : undefined}
        aria-autocomplete="list"
        placeholder={placeholder}
        value={search}
        onChange={(e) => { setSearch(e.target.value); setActive(0); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className={`w-full bg-gray-800 border border-gray-700 rounded-lg ${s.input} text-sm text-gray-100 placeholder-gray-500 focus:outline-none ${focusClass} transition-colors`}
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className={`absolute z-20 mt-1 w-full ${s.list} overflow-y-auto bg-gray-800 border border-gray-700 rounded-lg shadow-xl`}
        >
          {suggestions.map((team, i) => (
            <li
              key={team.team_number}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === highlighted}
              onMouseDown={() => pick(team)}
              onMouseMove={() => setActive(i)}
              className={`${s.item} text-sm cursor-pointer transition-colors flex items-center gap-2 ${
                i === highlighted ? 'bg-gray-700' : ''
              }`}
            >
              <span className={`text-white font-medium tabular-nums ${s.number} shrink-0`}>
                {team.team_number}
              </span>
              {team.team_name && (
                <span className="text-gray-400 truncate">{team.team_name}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {showEmpty && (
        <div className="absolute z-20 mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg shadow-xl px-4 py-2 text-sm text-gray-500">
          No teams match
        </div>
      )}
    </div>
  )
}
