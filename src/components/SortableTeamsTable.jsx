import { useNavigate } from 'react-router-dom'

const COLUMNS = [
  { key: null,                label: '#',          sortable: false, align: 'left',  className: 'w-10' },
  { key: 'team',              label: 'Team',        sortable: false, align: 'left'  },
  { key: 'current_epa',      label: 'Total EPA',   sortable: true,  align: 'right' },
  { key: 'current_auto_epa', label: 'Auto EPA',    sortable: true,  align: 'right' },
  { key: 'current_teleop_epa', label: 'Teleop EPA', sortable: true,  align: 'right' },
]

function SortIcon({ active, direction }) {
  if (!active) return <span className="ml-1 text-gray-600 select-none">↕</span>
  return (
    <span className="ml-1 text-blue-400 select-none">
      {direction === 'asc' ? '↑' : '↓'}
    </span>
  )
}

// teams: pre-sorted array of { team_number, team_name, current_epa, current_auto_epa, current_teleop_epa }
// rankMap: optional map of team_number -> rank; if absent, uses index in teams array
// sortKey, sortDir, onSortChange: controlled sort state from parent
export default function SortableTeamsTable({ teams, season, rankMap, sortKey, sortDir, onSortChange }) {
  const navigate = useNavigate()

  function handleHeaderClick(key) {
    if (key === sortKey) {
      onSortChange(key, sortDir === 'desc' ? 'asc' : 'desc')
    } else {
      onSortChange(key, 'desc')
    }
  }

  return (
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
                {col.sortable && <SortIcon active={sortKey === col.key} direction={sortDir} />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {teams.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-5 py-10 text-center text-gray-500">No teams.</td>
            </tr>
          ) : (
            teams.map((team, i) => (
              <tr
                key={team.team_number}
                onClick={() => navigate(`/team/${team.team_number}/${season}`)}
                className="border-b border-gray-800/60 hover:bg-gray-800/50 cursor-pointer transition-colors last:border-0"
              >
                <td className="px-5 py-3.5 text-gray-500 tabular-nums">
                  {rankMap ? rankMap[team.team_number] : i + 1}
                </td>
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
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
