import { beforeEach, describe, expect, it, vi } from 'vitest'

// scheduleGuarded: a past time is refused before any write, and the stored scheduled_at comes back
// (the weekday guard trigger can store another day than the one asked for).
const db = vi.hoisted(() => ({ result: { data: [{ id: 'd1', scheduled_at: '2099-01-07T09:45:00Z' }], error: null } as { data: unknown; error: unknown }, update: vi.fn() }))
vi.mock('../../lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  for (const k of ['from', 'eq', 'is', 'in']) chain[k] = () => chain
  chain.update = (v: unknown) => { db.update(v); return chain }
  chain.select = () => Promise.resolve(db.result)
  return { supabase: chain }
})
import { scheduleGuarded } from './writes'

beforeEach(() => { db.update.mockReset(); db.result = { data: [{ id: 'd1', scheduled_at: '2099-01-07T09:45:00Z' }], error: null } })

describe('scheduleGuarded', () => {
  it('refuses a time that already passed and writes nothing', async () => {
    await expect(scheduleGuarded('d1', '2020-01-01T09:45:00Z')).rejects.toThrow('already passed')
    expect(db.update).not.toHaveBeenCalled()
  })
  it('returns the time the row now holds, which may be another day than asked', async () => {
    await expect(scheduleGuarded('d1', '2099-01-05T09:45:00Z')).resolves.toBe('2099-01-07T09:45:00Z')
    expect(db.update).toHaveBeenCalledWith({ status: 'scheduled', scheduled_at: '2099-01-05T09:45:00Z' })
  })
  it('an empty answer is still a refusal', async () => {
    db.result = { data: [], error: null }
    await expect(scheduleGuarded('d1', '2099-01-05T09:45:00Z')).rejects.toThrow('Not scheduled')
  })
})
