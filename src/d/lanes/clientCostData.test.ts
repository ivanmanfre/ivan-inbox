import { expect, it, vi } from 'vitest'
import { costWindow, fetchClientProviderCosts, summarizeClientCost } from './clientCostData'

const scopes = ['ivan', 'risedtc', 'arch', 'swishdm', 'unassigned_shared'] as const
const providers = ['apify', 'harvestapi', 'scrapecreators'] as const
const measures = () => ({ apify_settled_usd: null, apify_presettle_usd: null, harvest_booked_usd: null, supplier_credits: null, producer_credits: null, supplier_credit_value_usd: null, producer_credit_value_usd: null, cash_paid_usd: null, requests: null, producer_attempts: null, cache_hits: null, unsettled_runs: null })
const row = (scope: string, provider: string) => ({ scope, provider, measures: measures(), evidence: [], coverage: 'missing', coverage_start: null, coverage_end: null, freshness: 'missing', last_success_at: null, last_event_at: null, flags: ['missing_feed'] })
const account = (provider: string) => ({ provider, account_label: 'Shared account', coverage: 'missing', freshness: 'missing', last_success_at: null, source_observed_at: null, history_usd: null, history_credits: null, supplier_usd: null, supplier_credits: null, allocated_exact_usd: null, allocated_inferred_usd: null, allocated_exact_credits: null, unassigned_usd: null, unassigned_credits: null, producer_observed_credits: null, booked_usd: null, comparison: 'missing', flags: ['missing_feed'], days: [] })
function feed() {
  return { schema_version: 1, generated_at: '2026-10-25T12:00:00Z', window: { start: '2026-10-19', end: '2026-10-26', timezone: 'UTC' }, rows: scopes.flatMap(scope => providers.map(provider => row(scope, provider))), accounts: providers.map(account), legacy_rows: [], credit_value_rate: { usd_per_credit: 0.00188, as_of: '2026-10-25', basis: 'dated_replacement_value_forecast' } }
}
let reply: { data: unknown; error: { message: string } | null } = { data: null, error: null }
const calls: Array<{ name: string; args: unknown; signal?: AbortSignal }> = []
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (name: string, args: unknown) => {
  const call: (typeof calls)[number] = { name, args }; calls.push(call)
  return { abortSignal: (signal: AbortSignal) => { call.signal = signal; return Promise.resolve(reply) } }
} } }))

it('uses UTC calendar windows across the Warsaw DST change', () => {
  expect(costWindow(7, Date.parse('2026-10-25T23:40:00Z'))).toEqual({ start: '2026-10-19', end: '2026-10-26' })
  expect(costWindow(30, Date.parse('2026-10-25T12:00:00Z'))).toEqual({ start: '2026-09-26', end: '2026-10-26' })
})

it('reads the v1 RPC with dates and a cancellable signal', async () => {
  calls.length = 0; reply = { data: feed(), error: null }
  const result = await fetchClientProviderCosts(7, Date.parse('2026-10-25T12:00:00Z'))
  expect(result.rows).toHaveLength(15)
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({ name: 'client_provider_costs', args: { p_start: '2026-10-19', p_end: '2026-10-26' }, signal: expect.any(AbortSignal) })
  const cancelled = new AbortController(); cancelled.abort()
  await expect(fetchClientProviderCosts(7, Date.now(), cancelled.signal)).rejects.toMatchObject({ name: 'AbortError' })
})

it('keeps unknown rows unknown and producer credits separate from supplier credits', () => {
  const input = feed()
  Object.assign(input.rows.find(r => r.scope === 'risedtc' && r.provider === 'scrapecreators')!, { measures: { ...measures(), producer_credits: 4, producer_credit_value_usd: 0.00752 }, coverage: 'partial', freshness: 'fresh', flags: ['unjoined_producer'] })
  Object.assign(input.rows.find(r => r.scope === 'unassigned_shared' && r.provider === 'scrapecreators')!, { measures: { ...measures(), supplier_credits: 10, supplier_credit_value_usd: 0.0188 }, coverage: 'partial' })
  Object.assign(input.accounts[2], { supplier_credits: 10, history_credits: 10, unassigned_credits: 10, producer_observed_credits: 4 })
  const result = summarizeClientCost(input as never)
  expect(result.bySeat.risedtc.find(r => r.provider === 'scrapecreators')?.measures).toMatchObject({ supplier_credits: null, producer_credits: 4 })
  expect(result.shared.find(r => r.provider === 'scrapecreators')?.measures.supplier_credits).toBe(10)
  expect(result.accounts.find(a => a.provider === 'scrapecreators')?.supplier_credits).toBe(10)
  expect(result.bySeat.ivan.find(r => r.provider === 'apify')?.measures.apify_settled_usd).toBeNull()
})

it('retains signed mismatch and a stale Harvest receipt separately from fresh bookings', async () => {
  const input = feed()
  const day = { day: '2026-10-24', supplier_usd: null, supplier_credits: 49, supplier_requests: 49, history_usd: null, history_credits: 48, history_requests: 48, allocated_exact_usd: null, allocated_inferred_usd: null, allocated_exact_credits: null, unassigned_usd: null, unassigned_credits: 49, producer_observed_credits: 27, booked_usd: null, credit_discrepancy: 1, request_discrepancy: 1, comparison: 'mismatch', complete_day: false, coverage_start: null, coverage_end: '2026-10-24T14:39:00Z', source_observed_at: '2026-10-24T14:39:00Z', flags: ['daily_mismatch', 'partial_window'] }
  Object.assign(input.accounts[2], { comparison: 'mismatch', coverage: 'partial', days: [day] })
  Object.assign(input.accounts[1], { supplier_usd: 1.5, source_observed_at: '2026-10-23T14:39:00Z', freshness: 'stale', flags: ['supplier_receipt_stale'] })
  Object.assign(input.rows.find(r => r.scope === 'ivan' && r.provider === 'harvestapi')!, { measures: { ...measures(), harvest_booked_usd: 0.004 }, freshness: 'fresh', coverage: 'partial' })
  reply = { data: input, error: null }
  const result = await fetchClientProviderCosts(7)
  expect(result.accounts[2].days[0].credit_discrepancy).toBe(1)
  expect(result.accounts[2].days[0].complete_day).toBe(false)
  expect(result.accounts[1].supplier_usd).toBe(1.5)
  expect(result.rows.find(r => r.scope === 'ivan' && r.provider === 'harvestapi')?.measures.harvest_booked_usd).toBe(0.004)
})

it('rejects version, missing keys, duplicate rows and malformed measures', async () => {
  for (const mutate of [
    (f: ReturnType<typeof feed>) => { f.schema_version = 2 },
    (f: ReturnType<typeof feed>) => { f.rows.pop() },
    (f: ReturnType<typeof feed>) => { f.rows[1] = f.rows[0] },
    (f: ReturnType<typeof feed>) => { (f.rows[0].measures as Record<string, unknown>).supplier_credits = '0' },
    (f: ReturnType<typeof feed>) => { delete (f.accounts[0] as Record<string, unknown>).comparison },
  ]) {
    const input = feed(); mutate(input); reply = { data: input, error: null }
    await expect(fetchClientProviderCosts(7)).rejects.toThrow(/Cost feed/)
  }
  reply = { data: null, error: { message: 'permission denied' } }
  await expect(fetchClientProviderCosts(7)).rejects.toThrow('permission denied')
})
