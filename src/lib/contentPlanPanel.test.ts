import { describe, expect, it } from 'vitest'
import { parseCalendarPanel } from './contentPlanPanel'

const ok = () => ({
  ok: true, as_of: '2026-11-16T10:00:00Z', this_week: '2026-11-16',
  slots: [{ slot_id: '00000000-0000-4000-8000-0000000000a1', week_start: '2026-11-16', draft_id: null, belief: 3, vehicle: 'scene_dialogue', is_copy: false }],
  quotas: [{ slot_kind: 'business_event', belief: null, vehicle: null, per_week: 2, every_n_weeks: 1, note: null }],
  week_fill: [{ week_start: '2026-11-16', slots: 1, copies: 0, no_belief: 0, by_belief: { '3': 1 }, by_vehicle: { scene_dialogue: 1 } }],
  profile_first: { score: '1 of 3', proof: false, outreach_belief: false, him: true, unlabeled: [], posts: [] },
  pv48: [], cohorts: { filter_key: 'k1', rows: [], note: 'Rates compare only within one filter key.' }, booking_reasons: [], enforce: 'off',
})

describe('parseCalendarPanel', () => {
  it('reads a full answer', () => {
    const p = parseCalendarPanel(ok())
    expect(p.slots).toHaveLength(1)
    expect(p.profile_first?.score).toBe('1 of 3')
    expect(p.cohorts.filter_key).toBe('k1')
    expect(p.enforce).toBe('off')
  })
  it('fills missing lists with empty ones and drops a malformed profile check', () => {
    const d: Record<string, unknown> = ok()
    delete d.pv48; delete d.booking_reasons; delete d.quotas; d.profile_first = { score: 3 }; d.cohorts = null
    const p = parseCalendarPanel(d)
    expect(p.pv48).toEqual([]); expect(p.booking_reasons).toEqual([]); expect(p.quotas).toEqual([])
    expect(p.profile_first).toBeNull()
    expect(p.cohorts).toEqual({ filter_key: null, rows: [], note: '' })
  })
  it('refuses an answer that is not ok or has no weeks', () => {
    expect(() => parseCalendarPanel(null)).toThrow()
    expect(() => parseCalendarPanel({ ...ok(), ok: false })).toThrow()
    expect(() => parseCalendarPanel({ ...ok(), week_fill: undefined })).toThrow()
  })
})
