// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BandCtx } from '../bandCells'
import { SeatView4 } from './SeatView'

const readCost = vi.fn<(_days: 7 | 30, _now: number, _signal?: AbortSignal) => Promise<unknown>>()
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../clientCostData', async original => ({ ...(await original<typeof import('../clientCostData')>()), fetchClientProviderCosts: (...args: Parameters<typeof readCost>) => readCost(...args) }))
vi.mock('../../../ds/Segmented', () => ({ Segmented: () => null }))
vi.mock('../supply', () => ({ supplyOf: () => ({ ready: null, lanes: [], rate: 0, runwayDays: null, refill: null, in7: 0, out7: 0, emptyIn: null, days: null }) }))
vi.mock('../bandCells', () => ({ InboundCell: () => null }))
vi.mock('../seatCells', () => ({ TodayCell: () => null, ControlCell: () => null }))
vi.mock('../ChannelsSheet', () => ({ ChannelsSheet: () => null }))
vi.mock('../LogSheet', () => ({ LogSheet: () => null }))
vi.mock('../ProblemsSheet', () => ({ ProblemsSheet: () => null }))
vi.mock('./Numbers', () => ({ Numbers: () => null }))
vi.mock('./Supply', () => ({ Supply: () => null }))
vi.mock('./Sending', () => ({ Sending: () => null }))
vi.mock('./History', () => ({ History: () => null, Rates: () => null }))
vi.mock('./InterestPerformance', () => ({ InterestPerformance: () => null }))

beforeEach(() => { localStorage.clear(); readCost.mockReset() })
afterEach(cleanup)

it('mounts Cost in the active V4 More fold and reads provider data only after opening', async () => {
  const scopes = ['ivan', 'risedtc', 'arch', 'swishdm', 'unassigned_shared']
  const providers = ['apify', 'harvestapi', 'scrapecreators']
  const measures = { apify_settled_usd: null, apify_presettle_usd: null, harvest_booked_usd: null, supplier_credits: null, producer_credits: null, supplier_credit_value_usd: null, producer_credit_value_usd: null, cash_paid_usd: null, requests: null, producer_attempts: null, cache_hits: null, unsettled_runs: null }
  readCost.mockResolvedValue({ schema_version: 1, generated_at: '2026-10-25T12:00:00Z', window: { start: '2026-10-19', end: '2026-10-26', timezone: 'UTC' }, rows: scopes.flatMap(scope => providers.map(provider => ({ scope, provider, measures: { ...measures, apify_settled_usd: scope === 'ivan' && provider === 'apify' ? 2.3 : null }, evidence: [], coverage: 'partial', coverage_start: null, coverage_end: null, freshness: 'fresh', last_success_at: null, last_event_at: null, flags: [] }))), accounts: providers.map(provider => ({ provider, account_label: 'Shared account', coverage: 'missing', freshness: 'missing', last_success_at: null, source_observed_at: null, history_usd: null, history_credits: null, supplier_usd: null, supplier_credits: null, allocated_exact_usd: null, allocated_inferred_usd: null, allocated_exact_credits: null, unassigned_usd: null, unassigned_credits: null, producer_observed_credits: null, booked_usd: null, comparison: 'missing', flags: [], days: [] })), legacy_rows: [], credit_value_rate: { usd_per_credit: 0.00188, as_of: '2026-10-25', basis: 'dated_replacement_value_forecast' } })
  const ctx = { d: { cc: { value: null }, inbound: { value: null } }, now: Date.parse('2026-10-25T12:00:00Z'), range: '7d' } as unknown as BandCtx
  render(<SeatView4 seat="ivan" ctx={ctx} range="7d" setRange={() => {}} onCustom={() => {}} retry={() => {}} />)
  expect(screen.getByRole('heading', { name: 'More' })).toBeTruthy()
  const cost = screen.getByRole('button', { name: /Cost/ })
  expect(cost.getAttribute('aria-expanded')).toBe('false')
  expect(readCost).not.toHaveBeenCalled()
  fireEvent.click(cost)
  await screen.findByText('$2.30')
  await waitFor(() => expect(readCost).toHaveBeenCalledTimes(1))
  expect(cost.getAttribute('aria-expanded')).toBe('true')
})
