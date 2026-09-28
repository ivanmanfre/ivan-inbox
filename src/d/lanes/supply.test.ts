import { describe, expect, it } from 'vitest'
import { supplyOf } from './supply'
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
