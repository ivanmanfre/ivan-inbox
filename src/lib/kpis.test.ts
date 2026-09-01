import { describe, it, expect } from 'vitest'
import { acceptRate, runwayDays, governorHeadroomPct, laneLabel, governorEnforcementGap, replacementRate, daysToEmpty, buildLedger, type LedgerRow } from './kpis'

describe('acceptRate', () => {
  it('rounds accepted/sent to a whole percent', () => {
    expect(acceptRate(100, 31)).toBe(31)
    expect(acceptRate(3, 1)).toBe(33)
  })
  it('returns 0 when nothing was sent (no divide-by-zero)', () => {
    expect(acceptRate(0, 0)).toBe(0)
  })
})

describe('runwayDays', () => {
  it('floors sendable / daily rate', () => {
    expect(runwayDays(40, 4)).toBe(10)
    expect(runwayDays(9, 4)).toBe(2)
  })
  it('returns Infinity-safe 999 when send rate is 0', () => {
    expect(runwayDays(40, 0)).toBe(999)
  })
})

describe('governorHeadroomPct', () => {
  it('percent of cap used, clamped 0..100', () => {
    expect(governorHeadroomPct(42, 84)).toBe(50)
    expect(governorHeadroomPct(90, 84)).toBe(100)
    expect(governorHeadroomPct(0, 0)).toBe(0)
  })
})

describe('laneLabel', () => {
  it('maps lane keys to display labels', () => {
    expect(laneLabel('cold')).toBe('Cold')
    expect(laneLabel('warm')).toBe('Warm / Orbit')
    expect(laneLabel('engager')).toBe('Engager')
    expect(laneLabel('harvest')).toBe('Harvested')
    expect(laneLabel('other')).toBe('Other')
  })
})

describe('governorEnforcementGap', () => {
  it('true when the shared enforcement counter is maxed but this client is under it', () => {
    // ivan sent 41, but the shared sender_health counter reads 98/50 → gated by Rise
    expect(governorEnforcementGap(41, 50, 98, 50)).toBe(true)
  })
  it('false when the enforcement counter has not hit its cap', () => {
    expect(governorEnforcementGap(41, 50, 41, 50)).toBe(false)
  })
  it('false when this client already accounts for the whole enforcement count', () => {
    expect(governorEnforcementGap(98, 50, 98, 50)).toBe(false)
  })
  it('false on legacy RPC where enforcement fields are absent (null)', () => {
    expect(governorEnforcementGap(41, 50, null, null)).toBe(false)
    expect(governorEnforcementGap(41, 50, 98, null)).toBe(false)
    expect(governorEnforcementGap(41, 50, null, 50)).toBe(false)
  })
})

describe('replacementRate', () => {
  it('is IN / OUT to 2dp', () => {
    expect(replacementRate(116, 106)).toBe(1.09)
    expect(replacementRate(60, 40)).toBe(1.5)
  })
  it('is null against zero sends — a rate over 0 out is not a fact about the pipeline', () => {
    expect(replacementRate(50, 0)).toBeNull()
  })
  it('does NOT clamp: a backfill day is allowed to read high', () => {
    expect(replacementRate(50, 2)).toBe(25)
  })
})

describe('daysToEmpty', () => {
  it('counts down only while draining', () => {
    // 40 sendable, 40/day out, 0.5x refill -> losing 20/day -> 2 days
    expect(daysToEmpty(40, 40, 0.5)).toBe(2)
  })
  it('is null at or above break-even (no depletion date exists)', () => {
    expect(daysToEmpty(40, 40, 1)).toBeNull()
    expect(daysToEmpty(40, 40, 1.5)).toBeNull()
  })
  it('is null when the rate is unknown or nothing is going out', () => {
    expect(daysToEmpty(40, 40, null)).toBeNull()
    expect(daysToEmpty(40, 0, 0.5)).toBeNull()
  })
})

describe('buildLedger', () => {
  const row = (o: Partial<LedgerRow> & { client_id: string; day: string }): LedgerRow => ({
    invites: 0, accepted: 0, dms: 0, inmails: 0, cap_used: null, cap_limit: null, ...o,
  })
  const rows: LedgerRow[] = [
    row({ client_id: 'arch', day: '2026-09-01', invites: 25, accepted: 6, dms: 10, inmails: 3, cap_used: 35, cap_limit: 40 }),
    row({ client_id: 'arch', day: '2026-08-30', cap_used: 25, cap_limit: 40 }),          // counter spent, nothing sent
    row({ client_id: 'ivan', day: '2026-09-01', invites: 40, accepted: 4, dms: 13, cap_used: 40, cap_limit: 40 }),
    row({ client_id: 'ivan', day: '2026-08-29', invites: 8, accepted: 4 }),              // no counter row
  ]
  it('emits every day newest first, zero-filled, for one seat', () => {
    const l = buildLedger(rows, 'arch', 3, '2026-09-01')
    expect(l.map(d => d.day)).toEqual(['2026-09-01', '2026-08-31', '2026-08-30'])
    expect(l[1]).toMatchObject({ invites: 0, accepted: 0, cap_used: null, burned: 0 })
  })
  it('burned = counter spent minus invites that landed, never negative', () => {
    const l = buildLedger(rows, 'arch', 3, '2026-09-01')
    expect(l[0].burned).toBe(10)   // 35 spent, 25 landed
    expect(l[2].burned).toBe(25)   // 25 spent, 0 landed (the 08-30 dead day)
    expect(buildLedger(rows, 'ivan', 1, '2026-09-01')[0].burned).toBe(0)
  })
  it('a day with no counter row has null cap and 0 burned, not a fake 0/0', () => {
    const d = buildLedger(rows, 'ivan', 4, '2026-09-01')[3]
    expect(d.day).toBe('2026-08-29')
    expect(d.cap_used).toBeNull(); expect(d.cap_limit).toBeNull(); expect(d.burned).toBe(0)
  })
  it("'all' sums the seats, cap columns included", () => {
    const d = buildLedger(rows, 'all', 1, '2026-09-01')[0]
    expect(d).toMatchObject({ invites: 65, accepted: 10, dms: 23, inmails: 3, cap_used: 75, cap_limit: 80, burned: 10 })
  })
})
