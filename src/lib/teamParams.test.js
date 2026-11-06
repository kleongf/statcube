import { describe, expect, it } from 'vitest'
import {
  parseAlliances,
  parseCompareTeams,
  parseTeamList,
  paramsMatch,
  withTeamParams,
} from './teamParams'

describe('parseTeamList', () => {
  it('keeps positive decimal integers in order', () => {
    expect(parseTeamList('293,18,16')).toEqual([293, 18, 16])
  })

  it.each([
    ['hex', '0x12'],
    ['exponent', '1e3'],
    ['decimal', '1.5'],
    ['negative', '-3'],
    ['zero', '0'],
    ['sign', '+5'],
    ['word', 'abc'],
    ['empty item', ''],
    ['ten digits', '2147483647'],
    ['int4 overflow', '2147483648'],
    ['huge', '99999999999'],
  ])('drops a %s value', (_, bad) => {
    expect(parseTeamList(bad)).toEqual([])
  })

  it('drops bad values without losing the valid ones', () => {
    expect(parseTeamList('18,99999999999,0x12,1e3,1.5,,293')).toEqual([18, 293])
  })

  it('drops duplicates and trims spaces', () => {
    expect(parseTeamList('16, 16 ,7,16')).toEqual([16, 7])
  })

  it('returns nothing for a missing parameter', () => {
    expect(parseTeamList(null)).toEqual([])
  })
})

describe('parseCompareTeams', () => {
  it('keeps at most 8 teams', () => {
    expect(parseCompareTeams('1,2,3,4,5,6,7,8,9,10')).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('counts only valid teams toward the cap', () => {
    expect(parseCompareTeams('x,1,1,2,3,4,5,6,7,8,9')).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })
})

describe('parseAlliances', () => {
  it('keeps two teams per side', () => {
    expect(parseAlliances('1,2,3', '4,5,6')).toEqual({ red: [1, 2], blue: [4, 5] })
  })

  it('never puts a team on both sides', () => {
    expect(parseAlliances('16', '16')).toEqual({ red: [16], blue: [] })
    expect(parseAlliances('16,18', '18,22,7')).toEqual({ red: [16, 18], blue: [22, 7] })
  })

  it('fills blue from valid teams after the cross-side dedupe', () => {
    expect(parseAlliances('1,2', '1,2,3,4')).toEqual({ red: [1, 2], blue: [3, 4] })
  })

  it('handles missing parameters', () => {
    expect(parseAlliances(null, null)).toEqual({ red: [], blue: [] })
  })
})

describe('team URL parameters', () => {
  it('writes a list and removes an empty one, keeping other parameters', () => {
    const prev = new URLSearchParams('teams=1&metric=auto')
    expect(withTeamParams(prev, { teams: [3, 4] }).toString()).toBe('teams=3%2C4&metric=auto')
    expect(withTeamParams(prev, { teams: [] }).toString()).toBe('metric=auto')
  })

  it('detects a URL that differs from the cleaned lists', () => {
    expect(paramsMatch(new URLSearchParams('teams=18,293'), { teams: [18, 293] })).toBe(true)
    expect(paramsMatch(new URLSearchParams('teams=18,0x12'), { teams: [18] })).toBe(false)
    expect(paramsMatch(new URLSearchParams('teams=abc'), { teams: [] })).toBe(false)
    expect(paramsMatch(new URLSearchParams(''), { teams: [] })).toBe(true)
  })
})
