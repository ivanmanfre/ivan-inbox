// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { ClientCost } from './ClientCost'
import { Section } from './Section'

const readCost = vi.fn<(_days: 7 | 30, _now: number, _signal?: AbortSignal) => Promise<unknown>>()
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('./clientCostData', async original => {
  const data = await original<typeof import('./clientCostData')>()
  return { ...data, fetchClientProviderCosts: (...args: Parameters<typeof readCost>) => readCost(...args).then(data.parseClientProviderCosts) }
})
const scopes = ['ivan', 'risedtc', 'arch', 'swishdm', 'unassigned_shared']
const providers = ['apify', 'harvestapi', 'scrapecreators']
const measures = () => ({ apify_settled_usd: null, apify_presettle_usd: null, harvest_booked_usd: null, supplier_credits: null, producer_credits: null, supplier_credit_value_usd: null, producer_credit_value_usd: null, cash_paid_usd: null, requests: null, producer_attempts: null, cache_hits: null, unsettled_runs: null })
function feed() {
  return { schema_version: 1, generated_at: '2026-10-25T12:00:00Z', window: { start: '2026-10-19', end: '2026-10-26', timezone: 'UTC' }, rows: scopes.flatMap(scope => providers.map(provider => ({ scope, provider, measures: measures(), evidence: [], coverage: 'missing', coverage_start: null, coverage_end: null, freshness: 'missing', last_success_at: null, last_event_at: null, flags: ['missing_feed'] }))), accounts: providers.map(provider => ({ provider, account_label: 'Shared account', coverage: 'missing', freshness: 'missing', last_success_at: null, source_observed_at: null, history_usd: null, history_credits: null, supplier_usd: null, supplier_credits: null, allocated_exact_usd: null, allocated_inferred_usd: null, allocated_exact_credits: null, unassigned_usd: null, unassigned_credits: null, producer_observed_credits: null, booked_usd: null, comparison: 'missing', flags: [], days: [] })), legacy_rows: [{ scope: 'ivan', provider: 'anthropic_api', basis: 'anthropic_token_estimate', usd_estimate: 0.5, coverage: 'partial', observed_at: '2026-10-25T08:00:00Z' }], credit_value_rate: { usd_per_credit: 0.00188, as_of: '2026-10-25', basis: 'dated_replacement_value_forecast' } }
}
function populated() {
  const f = feed()
  Object.assign(f.rows.find(r => r.scope === 'ivan' && r.provider === 'apify')!, { measures: { ...measures(), apify_settled_usd: 1.25, apify_presettle_usd: 2 }, coverage: 'partial', freshness: 'fresh', evidence: [{ basis: 'apify_usage_settled', ownership: 'inferred', confidence: 'inferred', method: 'structural', source: 'vendor_spend', observed_at: '2026-10-25T08:00:00Z', coverage: 'partial', freshness: 'fresh' }] })
  Object.assign(f.rows.find(r => r.scope === 'risedtc' && r.provider === 'scrapecreators')!, { measures: { ...measures(), producer_credits: 4, producer_credit_value_usd: 0.00752 }, coverage: 'partial', flags: ['unjoined_producer'] })
  Object.assign(f.rows.find(r => r.scope === 'unassigned_shared' && r.provider === 'scrapecreators')!, { measures: { ...measures(), supplier_credits: 10 }, coverage: 'partial' })
  Object.assign(f.rows.find(r => r.scope === 'swishdm' && r.provider === 'harvestapi')!, { measures: { ...measures(), harvest_booked_usd: 0.004 }, coverage: 'partial', freshness: 'fresh' })
  Object.assign(f.accounts[1], { supplier_usd: 1.5, freshness: 'stale', source_observed_at: '2026-10-23T14:39:00Z', flags: ['supplier_receipt_stale'] })
  Object.assign(f.accounts[2], { supplier_credits: 10, history_credits: 10, unassigned_credits: 10, producer_observed_credits: 4, comparison: 'mismatch' })
  return f
}
afterEach(() => { cleanup(); readCost.mockReset(); vi.useRealTimers() })
function Fold() { const [open, setOpen] = useState(false); return <Section id="cost" title="Cost" open={open} onToggle={() => setOpen(v => !v)}><ClientCost seat="ivan" /></Section> }

it('keeps the active V4 fold lazy and renders every provider only after opening', async () => {
  readCost.mockResolvedValue(populated())
  render(<Fold />)
  expect(readCost).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cost' }))
  await screen.findByText('$1.25')
  expect(screen.getAllByText('Apify').length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: 'Cost' }))
  expect(screen.queryByText('$1.25')).toBeNull()
})

it('shows all clients, shared supplier usage and account reconciliation once without adding producer credits', async () => {
  readCost.mockResolvedValue(populated())
  render(<ClientCost seat="ivan" />)
  await screen.findByText('$1.25')
  expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: 'All clients' }))
  expect(screen.getAllByText(/4 credits/).length).toBeGreaterThan(0)
  expect(screen.getAllByText('Unassigned / shared')).toHaveLength(1)
  expect(screen.getAllByText('Account reconciliation')).toHaveLength(1)
  expect(screen.getByText(/Producer observations overlap account usage/)).toBeTruthy()
  expect(screen.queryByText('14 credits')).toBeNull()
  expect(screen.getByText('Anthropic · token estimate')).toBeTruthy()
  const harvest = screen.getAllByText('HarvestAPI')[0].closest('.dl-cost-row')!
  expect(within(harvest as HTMLElement).queryByText(/actual charge/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '30 days' }))
  await waitFor(() => expect(readCost).toHaveBeenLastCalledWith(30, expect.any(Number), expect.any(AbortSignal)))
})

it('keeps last good data with a read error on refresh and refreshes when visible again', async () => {
  readCost.mockResolvedValueOnce(populated()).mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(populated())
  render(<ClientCost seat="ivan" />)
  await screen.findByText('$1.25')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByRole('alert')
  expect(screen.getByText('$1.25')).toBeTruthy()
  expect(screen.getByText(/Last good read/)).toBeTruthy()
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
  fireEvent(document, new Event('visibilitychange'))
  expect(readCost).toHaveBeenCalledTimes(2)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  fireEvent(document, new Event('visibilitychange'))
  await waitFor(() => expect(readCost).toHaveBeenCalledTimes(3))
})

it('aborts obsolete reads on period change and never renders an older response', async () => {
  let resolveOld: (value: unknown) => void = () => {}
  readCost.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve })).mockResolvedValueOnce(populated())
  render(<ClientCost seat="ivan" />)
  const oldSignal = readCost.mock.calls[0][2]!
  fireEvent.click(screen.getByRole('button', { name: '30 days' }))
  await screen.findByText('$1.25')
  expect(oldSignal.aborted).toBe(true)
  const stale = feed(); Object.assign(stale.rows[0], { measures: { ...measures(), apify_settled_usd: 99 } })
  resolveOld(stale)
  await waitFor(() => expect(screen.queryByText('$99.00')).toBeNull())
})

it('shows malformed-feed errors instead of a missing zero or an incomplete day marked complete, retaining last good data', async () => {
  const badZero = feed()
  Object.assign(badZero.rows[0].measures, { apify_settled_usd: 0 })
  const good = populated()
  const badDay = populated()
  Object.assign(badDay.accounts[2], { days: [{ day: '2026-10-24', supplier_usd: null, supplier_credits: 49, supplier_requests: 49, history_usd: null, history_credits: 48, history_requests: 48, allocated_exact_usd: null, allocated_inferred_usd: null, allocated_exact_credits: null, unassigned_usd: null, unassigned_credits: 49, producer_observed_credits: 27, booked_usd: null, credit_discrepancy: 1, request_discrepancy: 1, comparison: 'mismatch', complete_day: true, coverage_start: '2026-10-24T00:00:00Z', coverage_end: '2026-10-24T14:39:00Z', source_observed_at: '2026-10-24T14:39:00Z', flags: ['daily_mismatch', 'partial_window'] }] })
  readCost.mockResolvedValueOnce(badZero).mockResolvedValueOnce(good).mockResolvedValueOnce(badDay)
  render(<ClientCost seat="ivan" />)
  await screen.findByRole('alert')
  expect(screen.queryByText('$0.00')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByText('$1.25')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByRole('alert')
  expect(screen.getByText('$1.25')).toBeTruthy()
  expect(screen.queryByText(/2026-10-24 UTC · complete day/)).toBeNull()
})

it('keeps the last-good failure qualifier through a pending retry until a valid feed replaces it', async () => {
  let resolvePending: (value: unknown) => void = () => {}
  readCost.mockResolvedValueOnce(populated()).mockRejectedValueOnce(new Error('denied')).mockImplementationOnce(() => new Promise(resolve => { resolvePending = resolve }))
  render(<ClientCost seat="ivan" />)
  await screen.findByText('$1.25')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(screen.getByRole('alert').textContent).toContain('Last good read')
  expect(screen.getByText('$1.25')).toBeTruthy()
  resolvePending(populated())
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
})

it('discloses absolute UTC Harvest receipt time, covered days and partial cutoff', async () => {
  const input = populated()
  Object.assign(input.accounts[1], { days: [{ day: '2026-10-23', supplier_usd: 0.5, supplier_credits: null, supplier_requests: null, history_usd: null, history_credits: null, history_requests: null, allocated_exact_usd: null, allocated_inferred_usd: null, allocated_exact_credits: null, unassigned_usd: null, unassigned_credits: null, producer_observed_credits: null, booked_usd: null, credit_discrepancy: null, request_discrepancy: null, comparison: 'not_comparable', complete_day: false, coverage_start: '2026-10-23T00:00:00Z', coverage_end: '2026-10-23T14:39:00Z', source_observed_at: '2026-10-23T14:39:00Z', flags: ['partial_window'] }] })
  readCost.mockResolvedValue(input)
  render(<ClientCost seat="ivan" />)
  await screen.findByText('$1.25')
  const details = screen.getByText('Receipt coverage and cutoff')
  fireEvent.click(details)
  expect(screen.getAllByText(/2026-10-23 14:39:00 UTC/).length).toBeGreaterThan(0)
  expect(screen.getByText(/2026-10-23 UTC · partial day/)).toBeTruthy()
})
