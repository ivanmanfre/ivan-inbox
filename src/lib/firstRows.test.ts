import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ calls: 0, fail: false, user: 'u1' as string | null }))
vi.mock('./supabase', () => ({ supabase: { rpc: () => { h.calls++; return Promise.resolve(h.fail ? { data: null, error: { message: 'down' } } : { data: [{ id: `r${h.calls}` }], error: null }) } } }))
vi.mock('./swr', () => ({ currentUserId: () => h.user }))

describe('readFirstRows', () => {
  beforeEach(() => { vi.resetModules(); h.calls = 0; h.fail = false; h.user = 'u1' })
  it('shares concurrent reads; reuse only when the caller asks for it', async () => {
    const { readFirstRows } = await import('./firstRows')
    let t = 0; const now = () => t
    await Promise.all([readFirstRows(0, now), readFirstRows(0, now)])
    expect(h.calls).toBe(1)
    t = 4000
    await readFirstRows(10_000, now)
    expect(h.calls).toBe(1)
    await readFirstRows(0, now)
    expect(h.calls).toBe(2)
    t = 20_000
    await readFirstRows(10_000, now)
    expect(h.calls).toBe(3)
  })
  it('a failed read is never reused and another user never joins it', async () => {
    const { readFirstRows } = await import('./firstRows')
    h.fail = true
    await expect(readFirstRows(10_000)).rejects.toThrow()
    h.fail = false
    await expect(readFirstRows(10_000)).resolves.toHaveLength(1)
    h.user = 'u2'
    await readFirstRows(10_000)
    expect(h.calls).toBe(3)
  })
})
