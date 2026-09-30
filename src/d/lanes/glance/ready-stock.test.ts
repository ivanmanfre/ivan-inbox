import { describe, expect, it } from 'vitest'
import { buildReady, laneOf, readyOf, type Cand, type Ctx } from './ready'
const now = Date.parse('2026-09-30T08:00:00Z')
const rise = '6549db14-3bdf-4462-a7ee-c97d762bb2cb'
const x = { now, cfg: {}, scorer: 17, ivanIds: new Set(['iv']), riseLive: new Set([rise]), archLive: new Set(['arch']), stop: new Set(), touch: new Set(), satNy: false, riseReadyIds: new Set(['allowed']) } as Ctx
const c = (o: Partial<Cand> = {}): Cand => ({ id: 'allowed', campaign_id: 'iv', stage: 'enriched', icp_score: 7, trigger_type: 'engaged_post', trigger_confidence: 3, scorer_version: '17', country: 'US', preferred_channel: null, connection_sent_at: null, connected_at: null, last_dm_sent_at: null, liveness_checked_at: null, created_at: '2026-09-29', skip_state: null, skip_reason: null, reply_count: 0, note_variant: null, hypertarget_reserved: false, company_domain: null, ed_lane: null, sig_ok: null, sig_note: null, rise_note: 'Hi', anchor: null, gate: null, partner: null, colleague: null, refused: null, src: null, waived: null, lang_hold: null, copy_hold: null, ...o })
describe('fresh qualified stock', () => {
  it.each([{ skip_state: 'hold' }, { hypertarget_reserved: true }, { last_dm_sent_at: '2026-09-20' }, { reply_count: 1 }, { next_touch_after: '2026-10-10' }, { call_booked_at: '2026-09-29' }, { needs_manual_reply: true }, { recycled_at: '2026-09-01' }])('excludes a held or previously contacted Ivan lead: %j', fields => {
    expect(laneOf(c(fields), x)).toBeNull()
  })
  it('uses the authoritative RISE ready set even when a held row passes the old picker filter', () => {
    expect(laneOf(c({ campaign_id: rise, id: 'held' }), x)).toBeNull()
    expect(laneOf(c({ campaign_id: rise }), x)).toEqual({ seat: 'risedtc', lane: 'engager' })
  })
  it('keeps retries visible without adding them to fresh stock', () => {
    const r = buildReady([c()], x, false)
    r.lanes.push({ seat: 'ivan', lane: 'retry', label: 'Warm invite retry', n: 25, capped: false, campaignId: null, off: null })
    expect(readyOf(r, 'ivan').total).toBe(1)
    expect(readyOf(r, 'ivan').lanes.find(l => l.lane === 'retry')?.n).toBe(25)
  })
  it('preserves the canonical unique-person count and leaves unverified RISE pools separate', () => {
    const r = buildReady([c({ campaign_id: rise }), c({ campaign_id: rise, id: 'duplicate' })], { ...x, riseReadyIds: new Set(['allowed','duplicate']), riseReadyCount: 1 }, false)
    r.lanes.push({ seat: 'risedtc', lane: 'partner', label: 'CMO partners', n: 18, capped: false, campaignId: null, off: null })
    expect(readyOf(r, 'risedtc').total).toBe(1)
    expect(readyOf(r, 'risedtc').lanes.find(l => l.lane === 'partner')?.label).toBe('CMO partners candidates')
  })
  it('requires a score even for ARCH waiver sources', () => {
    expect(laneOf(c({ campaign_id: 'arch', stage: 'queued', ed_lane: 'engager_warm', icp_score: null, waived: 'true' }), x)).toBeNull()
  })
})
