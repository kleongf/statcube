import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
let searchTeams
let fetchTeamsByNumber
let fetchTeamsPage

function lastRequest() {
  const [input] = fetchMock.mock.calls.at(-1)
  return new URL(typeof input === 'string' ? input : input.url)
}

beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://supabase.test')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key')
  vi.stubGlobal('fetch', fetchMock)
  ;({ searchTeams, fetchTeamsByNumber, fetchTeamsPage } = await import('./teams'))
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

const orFilter = () => lastRequest().searchParams.get('or')

describe('searchTeams', () => {
  it('matches a numeric query as a team number prefix or a name substring', async () => {
    const rows = await searchTeams(2025, '162')
    const url = lastRequest()
    expect(url.pathname).toBe('/rest/v1/epa_2025')
    expect(url.searchParams.get('or')).toBe(
      '(team_number.eq.162,' +
        'and(team_number.gte.1620,team_number.lte.1629),' +
        'and(team_number.gte.16200,team_number.lte.16299),' +
        'and(team_number.gte.162000,team_number.lte.162999),' +
        'and(team_number.gte.1620000,team_number.lte.1629999),' +
        'and(team_number.gte.16200000,team_number.lte.16299999),' +
        'and(team_number.gte.162000000,team_number.lte.162999999),' +
        'and(team_number.gte.1620000000,team_number.lte.1629999999),' +
        'team_name.imatch."162")',
    )
    expect(url.searchParams.get('order')).toBe('team_number.asc')
    expect(rows).toEqual([{ team_number: 111, team_name: 'Wild Bots' }])
  })

  it('stops the prefix ranges at the int4 maximum', async () => {
    await searchTeams(2025, '214')
    expect(orFilter()).toContain('and(team_number.gte.2140000000,team_number.lte.2147483647)')
    expect(orFilter()).not.toContain('team_number.gte.21400000000')

    await searchTeams(2025, '2147')
    expect(orFilter()).toContain('and(team_number.gte.2147000000,team_number.lte.2147483647)')
  })

  it('accepts the largest int4 and drops the number clause above it', async () => {
    await searchTeams(2025, '2147483647')
    expect(orFilter()).toBe('(team_number.eq.2147483647,team_name.imatch."2147483647")')

    await searchTeams(2025, '2147483648')
    expect(orFilter()).toBe('(team_name.imatch."2147483648")')

    await searchTeams(2025, '99999999999999999999')
    expect(orFilter()).toBe('(team_name.imatch."99999999999999999999")')
  })

  it('ignores leading zeros in the number clause', async () => {
    await searchTeams(2025, '007')
    expect(orFilter()).toBe(
      '(team_number.eq.7,' +
        'and(team_number.gte.70,team_number.lte.79),' +
        'and(team_number.gte.700,team_number.lte.799),' +
        'and(team_number.gte.7000,team_number.lte.7999),' +
        'and(team_number.gte.70000,team_number.lte.79999),' +
        'and(team_number.gte.700000,team_number.lte.799999),' +
        'and(team_number.gte.7000000,team_number.lte.7999999),' +
        'and(team_number.gte.70000000,team_number.lte.79999999),' +
        'and(team_number.gte.700000000,team_number.lte.799999999),' +
        'team_name.imatch."007")',
    )
  })

  it('has no number clause for an all-zero query', async () => {
    await searchTeams(2025, '000')
    expect(orFilter()).toBe('(team_name.imatch."000")')
  })

  it('searches only names for a non-numeric query', async () => {
    await searchTeams(2025, 'robot')
    expect(orFilter()).toBe('(team_name.imatch."robot")')
    expect(lastRequest().searchParams.has('team_number')).toBe(false)
  })

  it('sends the query trimmed', async () => {
    await searchTeams(2025, '  robot ')
    expect(orFilter()).toBe('(team_name.imatch."robot")')
  })

  it.each([
    ['*', '\\\\*'],
    ['%', '%'],
    ['_', '_'],
    ['\\', '\\\\\\\\'],
    ['a.b', 'a\\\\.b'],
    ['(x|y)', '\\\\(x\\\\|y\\\\)'],
    ['say "hi"', 'say \\"hi\\"'],
  ])('matches %j as literal text', async (query, quoted) => {
    await searchTeams(2025, query)
    expect(orFilter()).toBe(`(team_name.imatch."${quoted}")`)
  })

  it('sends one request with limit=10 by default', async () => {
    await searchTeams(2025, '111')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(lastRequest().searchParams.get('limit')).toBe('10')
  })

  it('honours an explicit limit and requests only the picker columns', async () => {
    await searchTeams(2024, 'bot', { limit: 5 })
    const url = lastRequest()
    expect(url.pathname).toBe('/rest/v1/epa_2024')
    expect(url.searchParams.get('limit')).toBe('5')
    expect(url.searchParams.get('select')).toBe('team_number,team_name')
  })

  it('excludes picked teams in the query itself', async () => {
    await searchTeams(2025, 'robot', { exclude: [16, 25] })
    const url = lastRequest()
    expect(url.searchParams.get('team_number')).toBe('not.in.(16,25)')
    expect(url.searchParams.get('limit')).toBe('10')
  })

  it('adds no exclusion filter when nothing is picked', async () => {
    await searchTeams(2025, 'robot')
    expect(lastRequest().searchParams.has('team_number')).toBe(false)
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

describe('fetchTeamsPage', () => {
  const base = { season: 2025, sort: 'epa', dir: 'desc', page: 1, pageSize: 20 }

  it('asks for one sorted, counted page in a single request', async () => {
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify([{ team_number: 111 }]), {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-range': '80-99/8317' },
      }),
    )
    const result = await fetchTeamsPage({ ...base, page: 5 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [input, init] = fetchMock.mock.calls[0]
    const url = new URL(typeof input === 'string' ? input : input.url)
    const headers = new Headers(init?.headers ?? input.headers)
    expect(url.pathname).toBe('/rest/v1/epa_2025')
    expect(url.searchParams.get('order')).toBe('current_epa.desc.nullslast,team_number.asc')
    expect(url.searchParams.get('offset')).toBe('80')
    expect(url.searchParams.get('limit')).toBe('20')
    expect(headers.get('prefer')).toContain('count=exact')
    expect(url.searchParams.get('select')).toContain('rank_epa')
    expect(result).toEqual({ rows: [{ team_number: 111 }], total: 8317 })
  })

  it('sorts ascending by the chosen column', async () => {
    await fetchTeamsPage({ ...base, sort: 'auto', dir: 'asc' })
    expect(lastRequest().searchParams.get('order')).toBe('current_auto_epa.asc.nullslast,team_number.asc')
  })

  it('filters a numeric search on team_number and a text search on team_name', async () => {
    await fetchTeamsPage({ ...base, search: '11115' })
    expect(orFilter()).toContain('team_number.eq.11115')
    expect(orFilter()).toContain('team_name.imatch."11115"')

    await fetchTeamsPage({ ...base, search: 'robot' })
    expect(orFilter()).toBe('(team_name.imatch."robot")')
  })

  it('adds no filter for a blank search', async () => {
    await fetchTeamsPage({ ...base, search: '  ' })
    expect(lastRequest().searchParams.has('or')).toBe(false)
  })

  it('throws when the request fails', async () => {
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ message: 'boom' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await expect(fetchTeamsPage(base)).rejects.toMatchObject({ message: 'boom' })
  })
})
