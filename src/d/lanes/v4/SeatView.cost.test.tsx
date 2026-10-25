// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BandCtx } from '../bandCells'
import type { LaneDayRow } from '../../../lib/money'
import { SeatView4 } from './SeatView'

const readCost = vi.fn<(_days: 7 | 30, _now: number, _signal?: AbortSignal) => Promise<LaneDayRow[]>>()
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../clientCostData', async original => ({ ...(await original<typeof import('../clientCostData')>()), fetchCostLaneDays: (...args: Parameters<typeof readCost>) => readCost(...args) }))
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
  readCost.mockResolvedValue([{ day: '2026-10-25', lane: 'ivan', vendor: 'apify', runs: 1, settled_runs: 1, usd_settled: 2.3, usd_presettle: null, observed_at: '2026-10-25T08:00:00Z' }])
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
