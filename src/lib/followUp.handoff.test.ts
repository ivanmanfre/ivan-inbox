import { describe, it, expect, vi, beforeEach } from 'vitest'

// A recording stand-in for supabase.from(): every filter lands in `calls`.
type Call = [string, ...unknown[]]
const state: { row: Record<string, unknown>; calls: Call[]; updateResult: unknown[] } = { row: {}, calls: [], updateResult: [] }
function chain(kind: 'select' | 'update') {
  const c: Record<string, unknown> = {}
  for (const m of ['eq', 'is']) c[m] = (...a: unknown[]) => { state.calls.push([m, ...a]); return c }
  c.single = async () => ({ data: state.row, error: null })
  c.select = async (cols: string) => { state.calls.push(['returning', cols]); return { data: kind === 'update' ? state.updateResult : [state.row], error: null } }
  return c
}
vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({
      select: () => chain('select'),
      update: (body: unknown) => { state.calls.push(['update', body]); return chain('update') },
    }),
  },
}))

import { restoreHandOff, setFollowUp } from './followUp'

const HANDOFF = 'booking_request_escalated_to_human'

beforeEach(() => { state.calls = []; state.updateResult = [{ id: 'p1', updated_at: '2026-11-15T20:00:00.5+00:00' }] })

describe('setFollowUp over a booking hand-off', () => {
  it('writes only over the exact hand-off revision it read and returns what it replaced', async () => {
    state.row = { skip_reason: HANDOFF, next_touch_after: null, operator_note: 'ctx', updated_at: '2026-11-15T19:27:01.597435+00:00' }
    const r = await setFollowUp('p1', '2026-11-20T07:00:00Z', 'check Canada')
    expect(state.calls).toContainEqual(['eq', 'skip_reason', HANDOFF])
    expect(state.calls).toContainEqual(['eq', 'updated_at', '2026-11-15T19:27:01.597435+00:00'])
    expect(r.handOff).toEqual({ skip_reason: HANDOFF, next_touch_after: null, operator_note: 'ctx' })
    expect(r.updatedAt).toBe('2026-11-15T20:00:00.5+00:00')
  })

  it('fails loudly when the row moved in between (a newer hand-off or verdict wins)', async () => {
    state.row = { skip_reason: HANDOFF, next_touch_after: null, operator_note: null, updated_at: 'x' }
    state.updateResult = []
    await expect(setFollowUp('p1', '2026-11-20T07:00:00Z', '')).rejects.toThrow(/changed/)
  })

  it('still refuses a verdict without writing', async () => {
    state.row = { skip_reason: 'suspected_phishing_booking_link', next_touch_after: null, operator_note: null, updated_at: 'x' }
    await expect(setFollowUp('p1', '2026-11-20T07:00:00Z', '')).rejects.toThrow(/clear that first/)
    expect(state.calls.some(c => c[0] === 'update')).toBe(false)
  })

  it('records no hand-off when there was none', async () => {
    state.row = { skip_reason: null, next_touch_after: null, operator_note: null, updated_at: 'x' }
    const r = await setFollowUp('p1', '2026-11-20T07:00:00Z', '')
    expect(state.calls).toContainEqual(['is', 'skip_reason', null])
    expect(r.handOff).toBeNull()
  })
})

describe('restoreHandOff (Undo)', () => {
  it('puts the hand-off back only over the exact Later write', async () => {
    await restoreHandOff({ prospectId: 'p1', updatedAt: 'rev2', handOff: { skip_reason: HANDOFF, next_touch_after: null, operator_note: 'ctx' } })
    const upd = state.calls.find(c => c[0] === 'update')![1] as Record<string, unknown>
    expect(upd.skip_reason).toBe(HANDOFF)
    expect(upd.operator_note).toBe('ctx')
    expect(state.calls).toContainEqual(['eq', 'skip_reason', 'follow_up_dated'])
    expect(state.calls).toContainEqual(['eq', 'updated_at', 'rev2'])
  })

  it('says nothing was put back when the thread moved since', async () => {
    state.updateResult = []
    await expect(restoreHandOff({ prospectId: 'p1', updatedAt: 'rev2', handOff: { skip_reason: HANDOFF, next_touch_after: null, operator_note: null } })).rejects.toThrow(/nothing was put back/)
  })
})
