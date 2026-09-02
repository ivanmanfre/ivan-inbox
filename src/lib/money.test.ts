import { describe, expect, it } from 'vitest'
import {
  RUNWAY_REFUSAL, aggregateByDay, aggregateByWeek, billingDay, clientLabel,
  computeRunway, dayRangeLabel, daysSince, deltaRatio, fmtShareOfTotal, fmtUsd,
  fmtUsdPerUnit, isStale, isTokenPriced, isoWeekKey, laneTotals, laneTotalsGrandTotal,
  lastNDays, latestPerClient, mrrByClient, noteReason, provenanceText,
  relAge, riskNoteKind, riskNoteText, shareOfTotalPct, topActors, type ActorDayRow,
  type EngineCounterDayRow, type LaneDayRow, type MoneyLedgerRow,
} from './money'

const NOW = new Date('2026-09-01T12:00:00Z').getTime()

describe('runway - never estimated', () => {
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

describe('fmtUsdPerUnit', () => {
  it('shows cents under a dollar rather than rounding a real cost to $0', () => {
    expect(fmtUsdPerUnit(0.229)).toBe('$0.23')
    expect(fmtUsdPerUnit(0.004)).toBe('$0.00')
    expect(fmtUsdPerUnit(-0.5)).toBe('-$0.50')
  })

  it('matches fmtUsd at or above a dollar, and at exactly zero', () => {
    expect(fmtUsdPerUnit(1)).toBe('$1')
    expect(fmtUsdPerUnit(2.6)).toBe('$3')
    expect(fmtUsdPerUnit(0)).toBe('$0')
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

describe('mrrByClient — a client can hold an amount row AND note-only rows', () => {
  it('picks the amount row even when a newer note-only row exists', () => {
    const rows = [
      ledgerRow({ id: 'note', client_id: 'arch', occurred_on: '2026-09-02', amount_usd: null, note: 'risk: went quiet' }),
      ledgerRow({ id: 'amt', client_id: 'arch', occurred_on: '2026-08-01', amount_usd: 3000, note: 'billing_day:18' }),
    ]
    const [c] = mrrByClient(rows)
    expect(c.amountRow?.id).toBe('amt')
    expect(c.latestRow.id).toBe('note')
  })

  it('renders no amount row at all when every row on file is note-only', () => {
    const rows = [
      ledgerRow({ id: 'r1', client_id: 'risedtc', amount_usd: null, note: 'resolve live: pending direct confirmation' }),
    ]
    const [c] = mrrByClient(rows)
    expect(c.amountRow).toBeNull()
    expect(c.latestRow.id).toBe('r1')
  })

  it('keeps clients separate, including Ivan (null client_id)', () => {
    const rows = [
      ledgerRow({ id: 'ivan', client_id: null, amount_usd: 500 }),
      ledgerRow({ id: 'risedtc', client_id: 'risedtc', amount_usd: 3000 }),
    ]
    const out = mrrByClient(rows)
    expect(out.map(c => c.clientId)).toEqual([null, 'risedtc'])
  })
})

describe('noteReason', () => {
  it('strips the prefix before the first colon, generically', () => {
    expect(noteReason('resolve live: pending direct confirmation')).toBe('pending direct confirmation')
    expect(noteReason('renewal: due in 12 days')).toBe('due in 12 days')
  })
})

describe('isTokenPriced', () => {
  it('flags the anthropic_api vendor and nothing else', () => {
    expect(isTokenPriced('anthropic_api')).toBe(true)
    expect(isTokenPriced('apify')).toBe(false)
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
  return {
    day: '2026-09-01', action_type: 'rise_engager_run', runs: 10, apify_usd_claimed: 1,
    observed_at: '2026-09-01T00:00:00Z', ...over,
  }
}

describe('aggregateByDay / aggregateByWeek', () => {
  it('sums apify-only runs/settled/presettle across every lane, and rates the RISE lane alone', () => {
    const lane = [
      laneRow({ day: '2026-09-01', lane: 'risedtc', vendor: 'apify', usd_settled: 10, usd_presettle: 12, runs: 5 }),
      laneRow({ day: '2026-09-01', lane: 'risedtc', vendor: 'apify', usd_settled: 5, usd_presettle: 6, runs: 3 }),
      laneRow({ day: '2026-09-01', lane: 'ivan', vendor: 'apify', usd_settled: 3, usd_presettle: 4, runs: 2 }),
      // A token aggregate, not a run — must not leak into runs/settled/presettle at all.
      laneRow({ day: '2026-09-01', lane: 'risedtc', vendor: 'anthropic_api', usd_settled: null, usd_presettle: 999, runs: 999 }),
      laneRow({ day: '2026-08-31', lane: 'risedtc', vendor: 'apify', usd_settled: 20, usd_presettle: 22, runs: 4 }),
    ]
    const engine = [
      engineRow({ day: '2026-09-01', action_type: 'rise_engager_run', apify_usd_claimed: 0.5 }),
      // Not one of the three RISE action types — must be excluded from riseClaimedUsd.
      engineRow({ day: '2026-09-01', action_type: 'some_other_engine_run', apify_usd_claimed: 100 }),
    ]
    const out = aggregateByDay(lane, engine)
    expect(out[0]).toMatchObject({
      period: '2026-09-01', runs: 10, settledUsd: 18, presettleUsd: 22,
      riseBilledUsd: 15, riseClaimedUsd: 0.5,
    })
    expect(out[0].riseDeltaRatio).toBe('30.0×')
    expect(out[1]).toMatchObject({ period: '2026-08-31', runs: 4, settledUsd: 20, riseBilledUsd: 20, riseClaimedUsd: 0 })
    expect(out[1].riseDeltaRatio).toBe('∞ (engines claimed $0)')
  })

  it('rolls up into ISO weeks, apify-only', () => {
    const lane = [
      laneRow({ day: '2026-08-31', lane: 'risedtc', vendor: 'apify', usd_settled: 10 }), // W36
      laneRow({ day: '2026-09-01', lane: 'risedtc', vendor: 'apify', usd_settled: 5 }),  // W36
      laneRow({ day: '2026-08-24', lane: 'risedtc', vendor: 'apify', usd_settled: 7 }),  // W35
    ]
    const out = aggregateByWeek(lane, [])
    const w36 = out.find(p => p.period === '2026-W36')
    const w35 = out.find(p => p.period === '2026-W35')
    expect(w36?.settledUsd).toBe(15)
    expect(w35?.settledUsd).toBe(7)
  })

  it('renders presettleUsd as null, never 0, when every contributing row has a null presettle', () => {
    const lane = [
      laneRow({ day: '2026-09-01', lane: 'ivan', vendor: 'apify', usd_presettle: null, usd_settled: 5, runs: 1 }),
    ]
    const out = aggregateByDay(lane, [])
    expect(out[0].presettleUsd).toBeNull()
    expect(out[0].settledUsd).toBe(5)
  })

  it('reports riseBilledUsd (and riseDeltaRatio) as null, not 0, when RISE has no apify rows that period', () => {
    const lane = [laneRow({ day: '2026-09-01', lane: 'ivan', vendor: 'apify', usd_settled: 5 })]
    const engine = [engineRow({ day: '2026-09-01', action_type: 'gold_harvester_run', apify_usd_claimed: 2 })]
    const out = aggregateByDay(lane, engine)
    expect(out[0].riseBilledUsd).toBeNull()
    expect(out[0].riseDeltaRatio).toBeNull()
    expect(out[0].riseClaimedUsd).toBe(2)
  })

  it('reads riseClaimedObservedAt from the view\'s own observed_at, not a bucket-date guess', () => {
    const lane = [laneRow({ day: '2026-09-01', lane: 'risedtc', vendor: 'apify', usd_settled: 5 })]
    const engine = [engineRow({ day: '2026-09-01', action_type: 'rise_cold_run', apify_usd_claimed: 1, observed_at: '2026-09-02T03:00:00Z' })]
    const out = aggregateByDay(lane, engine)
    expect(out[0].riseClaimedObservedAt).toBe('2026-09-02T03:00:00Z')
  })
})

describe('lastNDays — exact N-day windows (account-wide skeptic W1)', () => {
  it('keeps only rows within the window', () => {
    const rows = [{ day: '2026-09-01' }, { day: '2026-08-20' }]
    expect(lastNDays(rows, 7, NOW)).toEqual([{ day: '2026-09-01' }])
  })

  it('"last 7 days" covers exactly 7 distinct calendar dates, not 8', () => {
    // NOW is 2026-09-01T12:00:00Z (mid-day, not midnight — the case that
    // exposed the bug: truncating `now - 7*DAY_MS` to a date landed on
    // 2026-08-25, an 8-date span from 08-25 through 09-01 inclusive).
    const eightDays = [
      '2026-09-01', '2026-08-31', '2026-08-30', '2026-08-29',
      '2026-08-28', '2026-08-27', '2026-08-26', '2026-08-25',
    ].map(day => ({ day }))
    const out = lastNDays(eightDays, 7, NOW)
    expect(out.map(r => r.day)).toEqual([
      '2026-09-01', '2026-08-31', '2026-08-30', '2026-08-29', '2026-08-28', '2026-08-27', '2026-08-26',
    ])
    expect(out).toHaveLength(7)
    expect(out.some(r => r.day === '2026-08-25')).toBe(false)
  })

  it('"last 30 days" covers exactly 30 distinct calendar dates, not 31', () => {
    const days = Array.from({ length: 32 }, (_, i) => {
      const d = new Date(NOW - i * 86_400_000)
      return { day: d.toISOString().slice(0, 10) }
    })
    const out = lastNDays(days, 30, NOW)
    expect(out).toHaveLength(30)
  })
})

describe('dayRangeLabel', () => {
  it('states the exact span a "last N days" filter covers', () => {
    expect(dayRangeLabel(7, NOW)).toBe('2026-08-26 → 2026-09-01')
    expect(dayRangeLabel(1, NOW)).toBe('2026-09-01 → 2026-09-01')
  })
})

describe('the per-day table and the by-actor table cover the same days', () => {
  it('aggregateByDay, fed the same lastNDays(7) filter as the actor table, produces exactly the days lastNDays(actorRows,7) kept', () => {
    const laneRows = Array.from({ length: 10 }, (_, i) => {
      const d = new Date(NOW - i * 86_400_000).toISOString().slice(0, 10)
      return laneRow({ day: d, vendor: 'apify', usd_settled: 1, runs: 1 })
    })
    const actorRows: ActorDayRow[] = laneRows.map(r => ({ ...r, actor_or_service: 'some-actor' }))
    const filteredLane = lastNDays(laneRows, 7, NOW)
    const filteredActors = lastNDays(actorRows, 7, NOW)
    const periods = aggregateByDay(filteredLane, []).map(p => p.period).sort()
    const actorDays = [...new Set(filteredActors.map(r => r.day))].sort()
    expect(periods).toEqual(actorDays)
    expect(periods).toHaveLength(7)
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

  it('carries the vendor through so a token-priced line can be flagged', () => {
    const rows: ActorDayRow[] = [
      { ...laneRow({ vendor: 'anthropic_api' }), actor_or_service: 'claude-api', usd_settled: 12, runs: 300 },
    ]
    const out = topActors(rows)
    expect(out[0]).toMatchObject({ actor: 'claude-api', vendor: 'anthropic_api' })
    expect(isTokenPriced(out[0].vendor)).toBe(true)
  })

  it('falls back to the presettle estimate when usd_settled is null (anthropic_api never settles)', () => {
    const rows: ActorDayRow[] = [
      { ...laneRow({ vendor: 'anthropic_api', usd_settled: null, usd_presettle: 3.5 }), actor_or_service: 'claude-api', runs: 100 },
    ]
    const out = topActors(rows)
    expect(out[0]).toMatchObject({ usd: 3.5, usdPerRun: 0.035 })
  })

  it('renders usd (and usdPerRun) as null, not 0, when nothing usable was ever reported', () => {
    const rows: ActorDayRow[] = [
      { ...laneRow({ usd_settled: null, usd_presettle: null }), actor_or_service: 'ghost-actor', runs: 5 },
    ]
    const out = topActors(rows)
    expect(out[0].usd).toBeNull()
    expect(out[0].usdPerRun).toBeNull()
  })
})

describe('laneTotals', () => {
  it('splits apify (settled) and anthropic (token-priced presettle) into separate columns per lane', () => {
    const rows = [
      laneRow({ lane: 'ivan', vendor: 'apify', usd_settled: 10, runs: 3 }),
      laneRow({ lane: 'ivan', vendor: 'apify', usd_settled: 5, runs: 2 }),
      laneRow({ lane: 'ivan', vendor: 'anthropic_api', usd_presettle: 1.2, usd_settled: null }),
      laneRow({ lane: 'risedtc', vendor: 'apify', usd_settled: 100, runs: 40 }),
    ]
    const out = laneTotals(rows)
    expect(out.find(l => l.lane === 'ivan')).toMatchObject({ apifyUsd: 15, apifyRuns: 5, anthropicUsd: 1.2 })
    expect(out.find(l => l.lane === 'risedtc')).toMatchObject({ apifyUsd: 100, apifyRuns: 40, anthropicUsd: null })
  })
})

describe('laneTotalsGrandTotal — the row Section 5 checks every bucket against', () => {
  it('sums apify $, runs, and anthropic $ across every lane, unattributed included', () => {
    const totals = [
      { lane: 'ivan', apifyUsd: 100, apifyRuns: 10, apifyObservedAt: null, anthropicUsd: 2, anthropicObservedAt: null },
      { lane: 'risedtc', apifyUsd: 500, apifyRuns: 40, apifyObservedAt: null, anthropicUsd: null, anthropicObservedAt: null },
      { lane: 'unattributed', apifyUsd: 183, apifyRuns: 5, apifyObservedAt: null, anthropicUsd: null, anthropicObservedAt: null },
    ]
    expect(laneTotalsGrandTotal(totals)).toEqual({ apifyUsd: 783, apifyRuns: 55, anthropicUsd: 2 })
  })

  it('renders apifyUsd/anthropicUsd as null, not 0, when not one lane has a source', () => {
    const totals = [
      { lane: 'ivan', apifyUsd: null, apifyRuns: 0, apifyObservedAt: null, anthropicUsd: null, anthropicObservedAt: null },
    ]
    expect(laneTotalsGrandTotal(totals)).toEqual({ apifyUsd: null, apifyRuns: 0, anthropicUsd: null })
  })
})

describe('shareOfTotalPct / fmtShareOfTotal', () => {
  it('computes a share and states the base it was computed from', () => {
    expect(shareOfTotalPct(73, 783)).toBeCloseTo(9.323, 2)
    expect(fmtShareOfTotal(73, 783)).toBe('9.3% of $783')
  })

  it('refuses rather than fabricating a share when the part, the total, or the total itself is missing/zero', () => {
    expect(shareOfTotalPct(null, 783)).toBeNull()
    expect(shareOfTotalPct(73, null)).toBeNull()
    expect(shareOfTotalPct(73, 0)).toBeNull()
    expect(fmtShareOfTotal(null, 783)).toBeNull()
    expect(fmtShareOfTotal(73, 0)).toBeNull()
  })
})
