import { describe, expect, it, vi } from 'vitest'

const ranges: Array<[number, number]> = []
const total = vi.hoisted(() => ({ n: 0 }))
vi.mock('./supabase', () => ({
  supabase: {
    from: () => {
      const q = {
        select: () => q,
        order: () => q,
        range: (a: number, b: number) => {
          ranges.push([a, b])
          const rows = Array.from({ length: Math.max(0, Math.min(b + 1, total.n) - a) }, (_, i) => ({ id: String(a + i) }))
          return Promise.resolve({ data: rows, error: null })
        },
      }
      return q
    },
  },
}))
const { fetchCalls } = await import('./transcripts')

describe('fetchCalls', () => {
  it('pages past 200 rows so the oldest calls load', async () => {
    total.n = 240
    ranges.length = 0
    const rows = await fetchCalls()
    expect(rows).toHaveLength(240)
    expect(ranges).toEqual([[0, 199], [200, 399]])
  })
  it('stops after one page when it is not full', async () => {
    total.n = 50
    ranges.length = 0
    expect(await fetchCalls()).toHaveLength(50)
    expect(ranges).toEqual([[0, 199]])
  })
})
