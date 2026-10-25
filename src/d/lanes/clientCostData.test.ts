import { expect, it, vi } from 'vitest'
import type { LaneDayRow } from '../../lib/money'
import { costWindow, fetchCostLaneDays, summarizeClientCost } from './clientCostData'

const reads: Array<{ cols: string; from?: number; to?: number; orders: string[]; signal?: AbortSignal }> = []
let rowCount = 0
let broken = false
vi.mock('../../lib/supabase', () => ({ supabase: { from: () => ({ select: (cols: string) => {
  const read: (typeof reads)[number] = { cols, orders: [] }
  reads.push(read)
  const query = {
    gte: () => query, lt: () => query,
    order: (col: string) => { read.orders.push(col); return query },
    range: (from: number, to: number) => { read.from = from; read.to = to; return query },
    abortSignal: (signal: AbortSignal) => { read.signal = signal; return Promise.resolve({ data: broken ? [] : Array.from({ length: Math.max(0, Math.min(rowCount - (read.from ?? 0), (read.to ?? 0) - (read.from ?? 0) + 1)) }, (_, i) => ({ day: '2026-10-25', lane: 'ivan', vendor: `vendor-${(read.from ?? 0) + i}` })), error: null }) },
  }
  return query
} }) } }))

const row = (patch: Partial<LaneDayRow> = {}): LaneDayRow => ({ day: '2026-10-25', lane: 'ivan', vendor: 'apify', runs: 1, settled_runs: 1, usd_settled: 2, usd_presettle: null, observed_at: '2026-10-25T08:00:00Z', ...patch })

it('keeps inferred seat allocations, unassigned usage, estimates and unknown amounts separate', () => {
  const result = summarizeClientCost([
    row(), row({ lane: 'risedtc', usd_settled: 3 }),
    row({ lane: 'swishdm', settled_runs: 0, usd_settled: null, usd_presettle: 5 }),
    row({ lane: 'unattributed', usd_settled: 7 }),
    row({ lane: 'arch', usd_settled: Number.NaN }),
    row({ lane: 'ivan', vendor: 'anthropic_api', usd_settled: 0.5 }),
  ])
  expect(result.bySeat.ivan.find(x => x.vendor === 'apify')).toMatchObject({ recorded: 2, tokenEstimate: null })
  expect(result.bySeat.ivan.find(x => x.vendor === 'anthropic_api')).toMatchObject({ recorded: null, tokenEstimate: 0.5 })
  expect(result.bySeat.risedtc[0].recorded).toBe(3)
  expect(result.bySeat.swishdm[0]).toMatchObject({ recorded: null, presettle: 5, unsettledRuns: 1 })
  expect(result.bySeat.arch[0]).toMatchObject({ recorded: null, malformed: 1 })
  expect(result.unassigned[0].recorded).toBe(7)
})

it('uses Anthropic presettle as the primary estimate, with no double count when both fields exist', () => {
  const result = summarizeClientCost([
    row({ lane: 'arch', vendor: 'anthropic_api', settled_runs: 0, usd_settled: null, usd_presettle: 4.10 }),
    row({ lane: 'arch', vendor: 'anthropic_api', settled_runs: 0, usd_settled: 9, usd_presettle: 2 }),
  ])
  expect(result.bySeat.arch[0]).toMatchObject({ recorded: null, tokenEstimate: 6.10, presettle: null, unsettledRuns: 2 })
  expect(summarizeClientCost([row({ lane: 'arch', vendor: 'anthropic_api', usd_settled: null, usd_presettle: Number.NaN })]).bySeat.arch[0])
    .toMatchObject({ recorded: null, tokenEstimate: null, malformed: 1 })
})

it('uses whole UTC calendar days through the end of today', () => {
  expect(costWindow(7, Date.parse('2026-10-25T23:40:00Z'))).toEqual({ start: '2026-10-19', end: '2026-10-26' })
  expect(costWindow(30, Date.parse('2026-10-25T12:00:00Z'))).toEqual({ start: '2026-09-26', end: '2026-10-26' })
})

it('pages daily aggregates in stable order with cancellation and a size guard', async () => {
  reads.length = 0; rowCount = 501; broken = false
  expect(await fetchCostLaneDays(7)).toHaveLength(501)
  expect(reads.map(r => [r.from, r.to])).toEqual([[0, 499], [500, 999]])
  expect(reads.every(r => r.orders.join(',') === 'day,lane,vendor' && r.signal instanceof AbortSignal)).toBe(true)
  rowCount = 5001
  await expect(fetchCostLaneDays(30)).rejects.toThrow('safe read limit')
  const cancelled = new AbortController(); cancelled.abort()
  await expect(fetchCostLaneDays(7, Date.now(), cancelled.signal)).rejects.toMatchObject({ name: 'AbortError' })
  rowCount = 1; broken = true
  expect(await fetchCostLaneDays(7)).toHaveLength(0)
})
