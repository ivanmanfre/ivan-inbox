// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChangeRateRows, ChangeRates } from './ChangeRates'
import type { AdjustmentCohort } from '../../lib/laneAdjustments'

// Invented rows: no real client figures.
const row = (over: Partial<AdjustmentCohort>): AdjustmentCohort => ({
  client_id: 'risedtc', period_from: '2026-03-01', period_to: '2026-03-14', label: 'First filter',
  invites: 200, accept_base: 200, accepted: 40, reply_base: 200, replied: 10, replied_so_far: 12, calls: 1, ...over,
})
const rows = [
  row({ period_from: '2026-03-15', period_to: null, label: 'Second filter', invites: 90, accept_base: 60, accepted: 21, reply_base: 0, replied: 0, replied_so_far: 4, calls: 0 }),
  row({}),
  row({ client_id: 'arch', label: 'Other seat', accepted: 100 }),
]
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn(async () => ({ data: rows, error: null })) } }))
afterEach(cleanup)

it('lists one seat oldest first with the rate, its counts and the open newest period', () => {
  render(<ChangeRateRows rows={rows} seat="risedtc" />)
  const items = screen.getAllByRole('listitem')
  expect(items).toHaveLength(2)
  expect(within(items[0]).getByText('1 Mar to 14 Mar')).toBeTruthy()
  expect(within(items[0]).getByText('First filter')).toBeTruthy()
  expect(within(items[0]).getByText('20.0%')).toBeTruthy()
  expect(within(items[0]).getByText('40 of 200 accepted')).toBeTruthy()
  expect(within(items[0]).getByText(/Replied within 7 days: 5\.0% \(10 of 200\) · 1 call$/)).toBeTruthy()
  expect(within(items[1]).getByText('15 Mar on')).toBeTruthy()
  expect(within(items[1]).getByText('35.0%')).toBeTruthy()
  expect(within(items[1]).getByText('30 under 72 hours')).toBeTruthy()
})
it('never shows a reply rate before any invite has had 7 days', () => {
  render(<ChangeRateRows rows={rows} seat="risedtc" />)
  const newest = screen.getAllByRole('listitem')[1]
  expect(within(newest).getByText(/^4 replied so far · 0 calls$/)).toBeTruthy()
  expect(within(newest).queryByText(/Replied within 7 days/)).toBeNull()
})
it('shows the raw reply count beside the rate while a period is still filling', () => {
  render(<ChangeRateRows rows={[row({ period_to: null, invites: 200, reply_base: 30, replied: 0, replied_so_far: 13, calls: 0 })]} seat="risedtc" />)
  expect(screen.getByText(/^Replied within 7 days: 0\.0% \(0 of 30\), 13 replied so far · 0 calls$/)).toBeTruthy()
})
it('shows no rate for a period with no invite old enough', () => {
  render(<ChangeRateRows rows={[row({ accept_base: 0, accepted: 0, invites: 12, reply_base: 0, replied: 0, replied_so_far: 0, calls: 0 })]} seat="risedtc" />)
  expect(screen.getByText('No invite old enough yet')).toBeTruthy()
  expect(screen.queryByText(/%$/)).toBeNull()
})
it('keeps another seat out and says when a seat has no recorded change', () => {
  render(<ChangeRateRows rows={rows} seat="swishdm" />)
  expect(screen.getByText('No dated targeting change is recorded for this seat yet.')).toBeTruthy()
  expect(screen.queryByRole('listitem')).toBeNull()
})
it('reads the cohorts and mounts them under a named section', async () => {
  render(<ChangeRates seat="arch" />)
  const section = screen.getByRole('region', { name: 'Acceptance by targeting change' })
  expect(await within(section).findByText('Other seat')).toBeTruthy()
  expect(within(section).getAllByRole('listitem')).toHaveLength(1)
})
