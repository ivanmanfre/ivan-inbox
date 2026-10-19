import { describe, expect, it } from 'vitest'
import { supplyOf } from './supply'
import { swishdmReady } from './glance/ready'
import type { CcPayload } from '../../lib/campaignControl'
import type { LanesData } from './useLanesData'

const NOW = Date.parse('2026-09-28T12:00:00Z')
const empty = { value: null, failed: null }
const base = (over: Partial<Record<keyof LanesData, unknown>>): LanesData =>
  new Proxy({ ...over } as Record<string, unknown>, { get: (t, k) => (k in t ? { value: t[k as string], failed: null } : empty) }) as unknown as LanesData

describe('lead supply of one seat', () => {
  const ready = { lanes: [
    { seat: 'arch', lane: 'cold', label: 'Cold', n: 90, capped: false, campaignId: null, off: null },
    { seat: 'arch', lane: 'hiring', label: 'Hiring signal', n: 30, capped: false, campaignId: null, off: null },
    { seat: 'ivan', lane: 'cold', label: 'Cold', n: 500, capped: false, campaignId: null, off: null },
  ], saturdayNy: false }
  const rows = [
    { client_id: 'arch', lane: 'cold', day: '2026-09-27', qualified_in: 20, sent_out: 40 },
    { client_id: 'arch', lane: 'cold', day: '2026-09-25', qualified_in: 10, sent_out: 40 },
    { client_id: 'arch', lane: 'cold', day: '2026-09-10', qualified_in: 99, sent_out: 1 },
    { client_id: 'ivan', lane: 'cold', day: '2026-09-27', qualified_in: 500, sent_out: 1 },
  ]
  const pipeline = [{ client_id: 'arch', sendable: 0, sent_7d: 210 }]

  it('counts only this seat: ready, runway at the 7-day pace, refill and the day it runs dry', () => {
    const s = supplyOf(base({ ready, replacement: rows, pipeline, gov: [] }), 'arch', NOW)
    expect(s.ready).toBe(120)
    expect(s.rate).toBe(30)
    expect(s.runwayDays).toBe(4)
    expect(s.in7).toBe(30); expect(s.out7).toBe(80)
    expect(s.refill).toBe(0.38)
    expect(s.emptyIn).toBe(16) // 120 ready ÷ (50 net out ÷ 7 days)
    expect(s.days).toHaveLength(14)
    expect(s.days!.at(-2)).toEqual({ day: '2026-09-27', inn: 20, out: 40 })
  })

  it('says unknown, never 0, while the reads are pending', () => {
    const s = supplyOf(base({}), 'arch', NOW)
    expect(s.ready).toBeNull(); expect(s.runwayDays).toBeNull(); expect(s.refill).toBeNull(); expect(s.days).toBeNull()
  })

  it('a pool that grows has no empty date', () => {
    const s = supplyOf(base({ ready, replacement: rows, pipeline }), 'ivan', NOW)
    expect(s.refill).toBe(500); expect(s.emptyIn).toBeNull()
  })
})

describe('SwishDM ready = the monitor replay of its own picker', () => {
  const cc = (pools: Record<string, unknown> | null) => ({ clients: [{ client_id: 'swishdm', invitation: { eligible_stock_by_pool: pools } }] }) as unknown as CcPayload
  it('noted invites are ready; blank reconnects show, excluded from fresh stock', () => {
    const r = swishdmReady(cc({ eligible: 2, noted_invites: 2, reconnect_blank_due: 1, approved_drafts_unsent: 5 }))!
    expect(r.total).toBe(2)
    expect(r.lanes.map(l => [l.lane, l.n, Boolean(l.off)])).toEqual([['noted', 2, false], ['reconnect', 1, true]])
  })
  it('an uncounted queue is unknown, never 0', () => {
    expect(swishdmReady(cc({ reason: 'swishdm_queue_unavailable' }))).toBeNull()
    expect(swishdmReady(null)).toBeNull()
  })
})
