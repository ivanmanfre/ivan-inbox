import { beforeEach, describe, expect, it, vi } from 'vitest'

const pages: Array<Array<{ id: string; group_key: string | null; read_at: string | null; expires_at: string | null }>> = []
const filters: string[][] = []
vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => {
    const f: string[] = []; filters.push(f)
    const q = {
      select: () => q,
      is: (key: string) => { f.push(`is:${key}`); return q },
      or: (value: string) => { f.push(`or:${value}`); return q },
      order: () => q,
      range: async () => ({ data: pages.shift() ?? [], error: null }),
    }
    return q
  } },
}))
const { fetchBellCounts } = await import('./bell')

beforeEach(() => { pages.length = 0; filters.length = 0 })

describe('bell counts and exact expiry', () => {
  it('uses all active pages, including read rows and beyond feed cap, for next expiry', async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    pages.push(Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}`, group_key: null, read_at: null, expires_at: null })))
    pages.push([{ id: 'read-late-page', group_key: null, read_at: '2026-09-28T09:00:00Z', expires_at: future }])
    expect(await fetchBellCounts()).toEqual({ unreadGroups: 1000, open: 1001, nextExpiryAt: future })
    expect(filters).toHaveLength(2)
    expect(filters.every(f => f.includes('is:dismissed_at') && f.some(x => x.startsWith('or:expires_at.is.null,expires_at.gt.')))).toBe(true)
  })
})
