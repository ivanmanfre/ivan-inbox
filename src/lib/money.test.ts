import { describe, expect, it } from 'vitest'
import {
  RUNWAY_REFUSAL, aggregateByDay, aggregateByWeek, billingDay, clientLabel,
  computeRunway, daysSince, deltaRatio, fmtUsd, isStale, isoWeekKey,
  laneTotals, lastNDays, latestPerClient, provenanceText, relAge, riskNoteKind,
  riskNoteText, topActors, type ActorDayRow, type EngineCounterDayRow,
  type LaneDayRow, type MoneyLedgerRow,
} from './money'

const NOW = new Date('2026-09-01T12:00:00Z').getTime()

describe('runway — never estimated', () => {
  it('refuses when cash_on_hand_usd is absent', () => {
    const r = computeRunway({
      cashOnHandUsd: null, cashAsOfDate: '2026-08-30', vendorSpend30dUsd: 1000,
      verifiedMrrSumUsd: 5000, now: NOW,
    })
    expect(r).toEqual({ ok: false, reason: RUNWAY_REFUSAL })
  })

  it('refuses when cash_as_of_date is absent', () => {
    const r = computeRunway({
      cashOnHandUsd: 40000, cashAsOfDate: null, vendorSpend30dUsd: 1000,
      verifiedMrrSumUsd: 5000, now: NOW,
    })
    expect(r).toEqual({ ok: false, reason: RUNWAY_REFUSAL })
  })

  it('refuses when the cash figure is 31 days stale', () => {
    // NOW is 2026-09-01; 31 days back is 2026-08-01.
    const r = computeRunway({
      cashOnHandUsd: 40000, cashAsOfDate: '2026-08-01', vendorSpend30dUsd: 1000,
      verifiedMrrSumUsd: 5000, now: NOW,
    })
    expect(r).toEqual({ ok: false, reason: RUNWAY_REFUSAL })
  })

  it('computes a value on a fresh cash figure (30 days is still in bounds)', () => {
    const r = computeRunway({
      cashOnHandUsd: 40000, cashAsOfDate: '2026-08-02', vendorSpend30dUsd: 1500,
      verifiedMrrSumUsd: 6000, now: NOW,
    })
    expect(r).toEqual({ ok: true, value: 40000 - 1500 + 6000 })
  })

  it('computes a value on a same-day cash figure', () => {
    const r = computeRunway({
      cashOnHandUsd: 12000, cashAsOfDate: '2026-09-01', vendorSpend30dUsd: 0,
      verifiedMrrSumUsd: 3000, now: NOW,
    })
    expect(r).toEqual({ ok: true, value: 15000 })
  })
})

describe('deltaRatio', () => {
  it('formats a normal ratio as N.Nx', () => {
    expect(deltaRatio(2960, 100)).toBe('29.6×')
    expect(deltaRatio(100, 100)).toBe('1.0×')
  })

  it('refuses to divide by zero and says so', () => {
    expect(deltaRatio(500, 0)).toBe('∞ (engines claimed $0)')
    expect(deltaRatio(0, 0)).toBe('∞ (engines claimed $0)')
  })
})

describe('provenance formatting', () => {
  it('renders source_kind, source_ref and relative age', () => {
    const oneHourAgo = new Date(NOW - 3600_000).toISOString()
    const text = provenanceText({ source_kind: 'stripe', source_ref: 'inv_123', observed_at: oneHourAgo }, NOW)
    expect(text).toBe('stripe · inv_123 · observed 1h ago')
  })

  it('falls back to "no ref" when source_ref is null', () => {
    const text = provenanceText({ source_kind: 'memory', source_ref: null, observed_at: new Date(NOW).toISOString() }, NOW)
    expect(text).toContain('memory · no ref ·')
  })

  it('appends a stale marker past 7 days and not before', () => {
    const eightDaysAgo = new Date(NOW - 8 * 86_400_000).toISOString()
    const sixDaysAgo = new Date(NOW - 6 * 86_400_000).toISOString()
    expect(provenanceText({ source_kind: 'stripe', source_ref: 'x', observed_at: eightDaysAgo }, NOW))
      .toMatch(/stale 8d$/)
    expect(provenanceText({ source_kind: 'stripe', source_ref: 'x', observed_at: sixDaysAgo }, NOW))
      .not.toMatch(/stale/)
  })

  it('treats a missing observed_at as never / infinitely stale-eligible but does not throw', () => {
    expect(() => provenanceText({ source_kind: 'memory', source_ref: null, observed_at: null }, NOW)).not.toThrow()
    expect(provenanceText({ source_kind: 'memory', source_ref: null, observed_at: null }, NOW)).toContain('observed never')
  })
})

describe('isStale / daysSince', () => {
  it('is false at exactly the boundary and true just past it', () => {
    const sevenDaysAgo = new Date(NOW - 7 * 86_400_000).toISOString()
    const eightDaysAgo = new Date(NOW - 8 * 86_400_000).toISOString()
    expect(isStale(sevenDaysAgo, NOW)).toBe(false)
    expect(isStale(eightDaysAgo, NOW)).toBe(true)
  })

  it('treats a null observed_at as infinitely old', () => {
    expect(daysSince(null, NOW)).toBe(Infinity)
    expect(isStale(null, NOW)).toBe(true)
  })
})

describe('relAge', () => {
  it('reads "never" for a null timestamp', () => {
    expect(relAge(null, NOW)).toBe('never')
  })

  it('steps through the same tiers as Surface.tsx', () => {
    expect(relAge(new Date(NOW - 2_000).toISOString(), NOW)).toBe('just now')
    expect(relAge(new Date(NOW - 30_000).toISOString(), NOW)).toBe('30s ago')
    expect(relAge(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5m ago')
    expect(relAge(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe('3h ago')
    expect(relAge(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBe('2d ago')
  })
})

describe('fmtUsd', () => {
  it('formats with a thousands separator and no decimals', () => {
    expect(fmtUsd(1234)).toBe('$1,234')
    expect(fmtUsd(1234.6)).toBe('$1,235')
    expect(fmtUsd(-500)).toBe('-$500')
    expect(fmtUsd(0)).toBe('$0')
  })
})

function ledgerRow(over: Partial<MoneyLedgerRow>): MoneyLedgerRow {
  return {
    id: 'r1', client_id: null, kind: 'mrr', amount_usd: 1000, currency: 'usd',
    occurred_on: '2026-09-01', source_kind: 'stripe', source_ref: 'x',
    observed_at: '2026-09-01T00:00:00Z', verified: true, note: null,
    ...over,
  }
}

describe('latestPerClient', () => {
  it('keeps the newest row per client, treating null as Ivan', () => {
    const rows = [
      ledgerRow({ id: 'a', client_id: 'risedtc', occurred_on: '2026-09-01' }),
      ledgerRow({ id: 'b', client_id: 'risedtc', occurred_on: '2026-08-01' }),
      ledgerRow({ id: 'c', client_id: null, occurred_on: '2026-08-15' }),
    ]
    const out = latestPerClient(rows)
    expect(out.map(r => r.id)).toEqual(['a', 'c'])
  })
})

describe('clientLabel', () => {
  it('maps known lanes and falls back to the raw id', () => {
    expect(clientLabel(null)).toBe('Ivan')
    expect(clientLabel('risedtc')).toBe('Mattan Danino')
    expect(clientLabel('arch')).toBe('Davorin Smit')
    expect(clientLabel('some_new_client')).toBe('some_new_client')
  })
})

describe('billingDay', () => {
  it('reads billing_day:<n> out of the note field', () => {
    expect(billingDay(ledgerRow({ note: 'billing_day:15' }))).toBe(15)
    expect(billingDay(ledgerRow({ note: 'renewal: nothing here' }))).toBeNull()
    expect(billingDay(ledgerRow({ note: null }))).toBeNull()
  })
})

describe('renewal/risk note parsing', () => {
  it('classifies the prefix and strips it for display', () => {
    expect(riskNoteKind('renewal: due in 12 days')).toBe('renewal')
    expect(riskNoteKind('risk: went quiet after invoice')).toBe('risk')
    expect(riskNoteText('renewal: due in 12 days')).toBe('due in 12 days')
    expect(riskNoteText('risk: went quiet after invoice')).toBe('went quiet after invoice')
  })
})

describe('isoWeekKey', () => {
  it('matches the ISO calendar week', () => {
    expect(isoWeekKey('2026-09-01')).toBe('2026-W36')
    expect(isoWeekKey('2026-01-01')).toBe('2026-W01')
  })
})

function laneRow(over: Partial<LaneDayRow>): LaneDayRow {
  return {
    day: '2026-09-01', lane: 'ivan', vendor: 'apify', runs: 10,
    usd_presettle: 12, usd_settled: 10, settled_runs: 9, observed_at: '2026-09-01T00:00:00Z',
    ...over,
  }
}
function engineRow(over: Partial<EngineCounterDayRow>): EngineCounterDayRow {
  return { day: '2026-09-01', action_type: 'scrape', runs: 10, apify_usd_claimed: 1, ...over }
}

describe('aggregateByDay / aggregateByWeek', () => {
  it('sums runs and settled/presettle usd per day and computes the delta ratio', () => {
    const lane = [
      laneRow({ day: '2026-09-01', usd_settled: 10, usd_presettle: 12, runs: 5 }),
      laneRow({ day: '2026-09-01', usd_settled: 5, usd_presettle: 6, runs: 3 }),
      laneRow({ day: '2026-08-31', usd_settled: 20, usd_presettle: 22, runs: 4 }),
    ]
    const engine = [engineRow({ day: '2026-09-01', apify_usd_claimed: 0.5 })]
    const out = aggregateByDay(lane, engine)
    expect(out[0]).toMatchObject({ period: '2026-09-01', runs: 8, settledUsd: 15, presettleUsd: 18, claimedUsd: 0.5 })
    expect(out[0].deltaRatio).toBe('30.0×')
    expect(out[1]).toMatchObject({ period: '2026-08-31', runs: 4, settledUsd: 20, claimedUsd: 0 })
    expect(out[1].deltaRatio).toBe('∞ (engines claimed $0)')
  })

  it('rolls up into ISO weeks', () => {
    const lane = [
      laneRow({ day: '2026-08-31', usd_settled: 10 }), // W36
      laneRow({ day: '2026-09-01', usd_settled: 5 }),  // W36
      laneRow({ day: '2026-08-24', usd_settled: 7 }),  // W35
    ]
    const out = aggregateByWeek(lane, [])
    const w36 = out.find(p => p.period === '2026-W36')
    const w35 = out.find(p => p.period === '2026-W35')
    expect(w36?.settledUsd).toBe(15)
    expect(w35?.settledUsd).toBe(7)
  })
})

describe('lastNDays', () => {
  it('keeps only rows within the window', () => {
    const rows = [{ day: '2026-09-01' }, { day: '2026-08-20' }]
    expect(lastNDays(rows, 7, NOW)).toEqual([{ day: '2026-09-01' }])
  })
})

describe('topActors', () => {
  it('sums per actor, sorts by usd desc, computes usd/run', () => {
    const rows: ActorDayRow[] = [
      { ...laneRow({}), actor_or_service: 'harvestapi', usd_settled: 30, runs: 10 },
      { ...laneRow({}), actor_or_service: 'harvestapi', usd_settled: 10, runs: 5 },
      { ...laneRow({}), actor_or_service: 'unipile', usd_settled: 5, runs: 20 },
    ]
    const out = topActors(rows)
    expect(out[0]).toMatchObject({ actor: 'harvestapi', runs: 15, usd: 40, usdPerRun: 40 / 15 })
    expect(out[1]).toMatchObject({ actor: 'unipile', runs: 20, usd: 5, usdPerRun: 0.25 })
  })
})

describe('laneTotals', () => {
  it('sums settled usd and runs per lane', () => {
    const rows = [
      laneRow({ lane: 'ivan', usd_settled: 10, runs: 3 }),
      laneRow({ lane: 'ivan', usd_settled: 5, runs: 2 }),
      laneRow({ lane: 'risedtc', usd_settled: 100, runs: 40 }),
    ]
    const out = laneTotals(rows)
    expect(out.find(l => l.lane === 'ivan')).toMatchObject({ usd: 15, runs: 5 })
    expect(out.find(l => l.lane === 'risedtc')).toMatchObject({ usd: 100, runs: 40 })
  })
})
