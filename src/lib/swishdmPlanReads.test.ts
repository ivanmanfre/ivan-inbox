import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { rpc } }))

import { fetchPlan } from './contentPlan'
import { fetchDecisionHistory } from './brainPage'

const weeks = ['this', 'next', 'after'].map((which, i) => ({
  start: `2026-10-${19 + i * 7}`, which, target: 0, filled: 0, open: 0, posts: [], planned: [],
}))

beforeEach(() => rpc.mockReset())

describe('SwishDM onboarding reads', () => {
  it('reads an unscheduled held plan through the read-only seat RPC', async () => {
    rpc.mockResolvedValue({ data: { ok: true, account: 'swishdm', state: 'awaiting_cadence', weeks, done: [], warnings: [], held_drafts: [{ id: 'held-1', title: 'Held draft' }] }, error: null })
    const plan = await fetchPlan('swishdm')
    expect(rpc).toHaveBeenCalledWith('content_plan_week_onboarding', { p_account: 'swishdm' })
    expect(plan.held_drafts).toEqual([{ id: 'held-1', title: 'Held draft' }])
    expect(plan.weeks.every(w => w.planned.length === 0 && w.posts.length === 0)).toBe(true)
  })

  it.each(['ivan', 'risedtc', 'arch'] as const)('keeps %s on its existing plan RPC', async lane => {
    rpc.mockResolvedValue({ data: { ok: true, account: lane, weeks, done: [], warnings: [] }, error: null })
    await fetchPlan(lane)
    expect(rpc).toHaveBeenCalledWith('content_plan_week', { p_account: lane })
  })

  it('reads only SwishDM decision history through the read-only seat RPC', async () => {
    rpc.mockResolvedValue({ data: { rulings: [], links: [] }, error: null })
    const history = await fetchDecisionHistory('swishdm')
    expect(rpc).toHaveBeenCalledWith('cb51_decision_history_onboarding', { p_client: 'swishdm' })
    expect(history.rulings).toEqual([])
    expect(history.links.size).toBe(0)
  })

  it.each(['ivan', 'risedtc', 'arch'] as const)('keeps %s on its existing history RPC', async lane => {
    rpc.mockResolvedValue({ data: { rulings: [], links: [] }, error: null })
    await fetchDecisionHistory(lane)
    expect(rpc).toHaveBeenCalledWith('cb51_decision_history', { p_client: lane })
  })
})
