import { describe, expect, it } from 'vitest'
import { searchStatus } from './searchStatus'

describe('searchStatus', () => {
  it('is idle without a query', () => {
    expect(searchStatus({ q: '', key: '', settledKey: 'a', failedKey: 'a' })).toBe('idle')
  })

  it('is pending until the current key settles', () => {
    expect(searchStatus({ q: 'ab', key: 'k2', settledKey: 'k1', failedKey: null })).toBe('pending')
  })

  it('is settled once the current key has results', () => {
    expect(searchStatus({ q: 'ab', key: 'k1', settledKey: 'k1', failedKey: null })).toBe('settled')
  })

  it('is failed only for the key that failed, so other text is unaffected', () => {
    expect(searchStatus({ q: 'ab', key: 'k1', settledKey: 'k0', failedKey: 'k1' })).toBe('failed')
    expect(searchStatus({ q: 'abc', key: 'k2', settledKey: 'k0', failedKey: 'k1' })).toBe('pending')
  })
})
