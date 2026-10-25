// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import type { LaneDayRow } from '../../lib/money'
import { ClientCost } from './ClientCost'
import { Section } from './Section'

const fetchRows = vi.fn<(_days: 7 | 30, _now: number, _signal?: AbortSignal) => Promise<LaneDayRow[]>>()
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('./clientCostData', async original => ({ ...(await original<typeof import('./clientCostData')>()), fetchCostLaneDays: (...args: Parameters<typeof fetchRows>) => fetchRows(...args) }))
const base: LaneDayRow = { day: '2026-10-01', lane: 'ivan', vendor: 'apify', runs: 1, settled_runs: 1, usd_settled: 1.25, usd_presettle: null, observed_at: '2026-10-01T08:00:00Z' }
afterEach(() => { cleanup(); fetchRows.mockReset() })

function Fold({ seat }: { seat: 'ivan' | 'swishdm' }) {
  const [open, setOpen] = useState(false)
  return <Section id="cost" title="Cost" open={open} onToggle={() => setOpen(v => !v)}><ClientCost seat={seat} /></Section>
}

it('reads nothing while collapsed and removes the data on close', async () => {
  fetchRows.mockResolvedValue([base])
  render(<Fold seat="ivan" />)
  expect(fetchRows).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cost' }))
  await screen.findByText('$1.25')
  expect(fetchRows).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Cost' }))
  expect(screen.queryByText('$1.25')).toBeNull()
})

it('shows selected seat, all four seats, shared unknowns and missing feeds', async () => {
  fetchRows.mockResolvedValue([base, { ...base, lane: 'swishdm', vendor: 'anthropic_api', usd_settled: 2 }, { ...base, lane: 'unattributed', usd_settled: null, settled_runs: 0 }])
  const view = render(<ClientCost seat="ivan" />)
  await screen.findByText('$1.25')
  expect(screen.queryByText('$2.00 estimate')).toBeNull()
  expect(screen.getByText('Unknown')).toBeTruthy()
  expect(screen.getByText(/Harvest and SC feed coverage is missing/)).toBeTruthy()
  expect(screen.getByText(/Engine spend can remain in unassigned shared usage/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'All clients' }))
  expect(screen.getByText('$2.00 estimate')).toBeTruthy()
  view.rerender(<ClientCost seat="swishdm" />)
  fireEvent.click(screen.getByRole('button', { name: 'SwishDM' }))
  expect(screen.queryByText('$1.25')).toBeNull()
  expect(screen.getByText('$2.00 estimate')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '30 days' }))
  await waitFor(() => expect(fetchRows).toHaveBeenLastCalledWith(30, expect.any(Number), expect.any(AbortSignal)))
})

it('shows failed reads and stale provider evidence with retry', async () => {
  fetchRows.mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce([base])
  render(<ClientCost seat="ivan" />)
  await screen.findByRole('alert')
  expect(screen.queryByText('$0.00')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByText('$1.25')
  expect(screen.getByText(/observed .* · stale/)).toBeTruthy()
})

it('shows a positive sub-cent amount distinctly from a true zero', async () => {
  fetchRows.mockResolvedValue([base, { ...base, vendor: 'tiny', usd_settled: 0.004 }, { ...base, vendor: 'free', usd_settled: 0 }])
  render(<ClientCost seat="ivan" />)
  expect(await screen.findByText('<$0.01')).toBeTruthy()
  expect(screen.getByText('$0.00')).toBeTruthy()
})

it('promotes an Anthropic presettle value to the primary estimate', async () => {
  fetchRows.mockResolvedValue([{ ...base, lane: 'arch', vendor: 'anthropic_api', settled_runs: 0, usd_settled: null, usd_presettle: 4.10 }])
  render(<ClientCost seat="arch" />)
  expect(await screen.findByText('$4.10 estimate')).toBeTruthy()
  expect(screen.queryByText('Unknown')).toBeNull()
  const provider = screen.getByText('anthropic_api').closest('.dl-cost-row')!
  expect(within(provider as HTMLElement).queryByText(/recorded run|unsettled/)).toBeNull()
})
