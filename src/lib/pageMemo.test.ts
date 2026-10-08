import { afterEach, describe, expect, it } from 'vitest'
import { MEMO_MAX_AGE_MS, forget, recall, remember } from './pageMemo'

afterEach(() => forget())

describe('pageMemo: the last good read, for the next visit', () => {
  it('reads back for the same user only', () => {
    expect(remember('k', [1, 2], { user: 'u1', at: 1000 })).toBe(true)
    expect(recall('k', 2000, 'u1')).toEqual({ value: [1, 2], at: 1000 })
    expect(recall('k', 2000, 'u2')).toBeNull()
    expect(recall('k', 2000, null)).toBeNull()
  })
  it('a signed-out read is never kept', () => {
    expect(remember('k', [1], { user: null })).toBe(false)
    expect(recall('k', Date.now(), 'u1')).toBeNull()
  })
  it('an old copy is a miss, never a stale paint', () => {
    remember('k', [1], { user: 'u1', at: 0 })
    expect(recall('k', MEMO_MAX_AGE_MS, 'u1')).not.toBeNull()
    expect(recall('k', MEMO_MAX_AGE_MS + 1, 'u1')).toBeNull()
  })
  it('an empty list never replaces a known non-empty one (N3b)', () => {
    remember('k', [1, 2, 3], { user: 'u1', at: 1000 })
    expect(remember('k', [], { user: 'u1', at: 2000 })).toBe(false)
    expect(recall('k', 3000, 'u1')).toEqual({ value: [1, 2, 3], at: 1000 })
    // a different user's empty read is that user's own first answer
    expect(remember('k', [], { user: 'u2', at: 2000 })).toBe(true)
  })
  it('judges the list inside an object when told where it is', () => {
    const list = (v: unknown) => (v as { rows: unknown[] }).rows
    remember('k', { rows: [1], n: 1 }, { user: 'u1', at: 1000, list })
    expect(remember('k', { rows: [], n: 0 }, { user: 'u1', at: 2000, list })).toBe(false)
    expect(remember('k', { rows: [2], n: 1 }, { user: 'u1', at: 3000, list })).toBe(true)
    expect(recall<{ rows: number[] }>('k', 3000, 'u1')?.value.rows).toEqual([2])
  })
  it('an empty first answer and a non-list value are kept', () => {
    expect(remember('a', [], { user: 'u1' })).toBe(true)
    expect(remember('b', { x: 1 }, { user: 'u1' })).toBe(true)
    expect(remember('b', 0, { user: 'u1' })).toBe(true)
  })
})
