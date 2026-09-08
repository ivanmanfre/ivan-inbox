import { describe, expect, it } from 'vitest'
import { cacheLoadedAt } from './parts'

// W3-10: the fetch-error banner's sub-line must not claim cached rows
// survived when the cache is empty, and must not lose the claim when it
// genuinely isn't.
describe('cacheLoadedAt', () => {
  it('drops the loadedAt stamp when the cache is empty, so the copy says nothing loaded', () => {
    expect(cacheLoadedAt(0, '2026-09-08T10:00:00Z')).toBe(null)
  })

  it('drops the stamp even if one was somehow set on an empty cache', () => {
    expect(cacheLoadedAt(0, null)).toBe(null)
  })

  it('keeps the loadedAt stamp when the cache is non-empty, so the message stays', () => {
    expect(cacheLoadedAt(5, '2026-09-08T10:00:00Z')).toBe('2026-09-08T10:00:00Z')
  })

  it('passes through null on a non-empty cache with no stamp yet', () => {
    expect(cacheLoadedAt(5, null)).toBe(null)
  })
})
