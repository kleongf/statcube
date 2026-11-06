import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
let searchTeams
let fetchTeamsByNumber

function lastRequest() {
  const [input] = fetchMock.mock.calls.at(-1)
  return new URL(typeof input === 'string' ? input : input.url)
}

beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://supabase.test')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key')
  vi.stubGlobal('fetch', fetchMock)
  ;({ searchTeams, fetchTeamsByNumber } = await import('./teams'))
})

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () =>
    new Response(JSON.stringify([{ team_number: 111, team_name: 'Wild Bots' }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
})

describe('searchTeams', () => {
  it('matches a numeric query on team_number by equality', async () => {
    const rows = await searchTeams(2025, '11115')
    const url = lastRequest()
    expect(url.pathname).toBe('/rest/v1/epa_2025')
    expect(url.searchParams.get('team_number')).toBe('eq.11115')
    expect(url.searchParams.has('team_name')).toBe(false)
    expect(rows).toEqual([{ team_number: 111, team_name: 'Wild Bots' }])
  })

  it('matches any other query on team_name with ilike', async () => {
    await searchTeams(2025, 'robot')
    const url = lastRequest()
    expect(url.searchParams.get('team_name')).toBe('ilike.%robot%')
    expect(url.searchParams.has('team_number')).toBe(false)
  })

  it('sends one request with limit=10 by default', async () => {
    await searchTeams(2025, '111')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(lastRequest().searchParams.get('limit')).toBe('10')
  })

  it('honours an explicit limit and requests only the picker columns', async () => {
    await searchTeams(2024, 'bot', 5)
    const url = lastRequest()
    expect(url.pathname).toBe('/rest/v1/epa_2024')
    expect(url.searchParams.get('limit')).toBe('5')
    expect(url.searchParams.get('select')).toBe('team_number,team_name')
  })

  it('treats LIKE wildcards in the query as literal text', async () => {
    await searchTeams(2025, '100%_a')
    expect(lastRequest().searchParams.get('team_name')).toBe('ilike.%100\\%\\_a%')
  })

  it('sends no request for a blank query', async () => {
    expect(await searchTeams(2025, '   ')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws when the request fails', async () => {
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ message: 'boom' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await expect(searchTeams(2025, 'robot')).rejects.toMatchObject({ message: 'boom' })
  })
})

describe('fetchTeamsByNumber', () => {
  it('loads several teams in one request by number', async () => {
    await fetchTeamsByNumber(2025, [111, 254])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(lastRequest().searchParams.get('team_number')).toBe('in.(111,254)')
  })

  it('sends no request for an empty list', async () => {
    expect(await fetchTeamsByNumber(2025, [])).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
