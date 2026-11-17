// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChangeRateRows, ChangeRates } from './ChangeRates'
import type { AdjustmentCohort } from '../../lib/laneAdjustments'

// Invented rows: no real client figures.
const row = (over: Partial<AdjustmentCohort>): AdjustmentCohort => ({
  client_id: 'risedtc', period_from: '2026-03-02', period_to: '2026-03-08', label: '',
  invites: 200, accept_base: 200, accepted: 40, reply_base: 200, replied: 10, replied_so_far: 12, calls: 1, ...over,
})
const rows = [
  row({ period_from: '2026-03-09', period_to: '2026-03-15', label: 'Second filter (11 Mar)', invites: 90, accept_base: 60, accepted: 21, reply_base: 0, replied: 0, replied_so_far: 4, calls: 0 }),
  row({}),
  row({ client_id: 'arch', label: 'Other seat (3 Mar)', accepted: 100 }),
]
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn(async () => ({ data: rows, error: null })) } }))
afterEach(cleanup)

it('lists one seat week by week, oldest first, with the rate and its counts', () => {
  render(<ChangeRateRows rows={rows} seat="risedtc" />)
  const items = screen.getAllByRole('listitem')
  expect(items).toHaveLength(2)
  expect(within(items[0]).getByText('2 Mar to 8 Mar')).toBeTruthy()
  expect(within(items[0]).getByText('20.0%')).toBeTruthy()
  expect(within(items[0]).getByText('40 of 200 accepted')).toBeTruthy()
  expect(within(items[0]).getByText(/Replied within 7 days: 5\.0% \(10 of 200\) · 1 call$/)).toBeTruthy()
  expect(within(items[1]).getByText('9 Mar to 15 Mar')).toBeTruthy()
  expect(within(items[1]).getByText('35.0%')).toBeTruthy()
  expect(within(items[1]).getByText('30 under 72 hours')).toBeTruthy()
})
it('names a targeting change only under the week it took effect', () => {
  render(<ChangeRateRows rows={rows} seat="risedtc" />)
  const [plain, changed] = screen.getAllByRole('listitem')
  expect(within(changed).getByText('Second filter (11 Mar)')).toBeTruthy()
  expect(plain.querySelector('.dl-chg-l small')).toBeNull()
})
it('never shows a reply rate before any invite has had 7 days', () => {
  render(<ChangeRateRows rows={rows} seat="risedtc" />)
  const newest = screen.getAllByRole('listitem')[1]
  expect(within(newest).getByText(/^4 replied so far · 0 calls$/)).toBeTruthy()
  expect(within(newest).queryByText(/Replied within 7 days/)).toBeNull()
})
it('shows the raw reply count beside the rate while a week is still filling', () => {
  render(<ChangeRateRows rows={[row({ invites: 200, reply_base: 30, replied: 0, replied_so_far: 13, calls: 0 })]} seat="risedtc" />)
  expect(screen.getByText(/^Replied within 7 days: 0\.0% \(0 of 30\), 13 replied so far · 0 calls$/)).toBeTruthy()
})
it('shows no rate for a week with no invite old enough, and says when none was sent', () => {
  render(<ChangeRateRows rows={[
    row({ accept_base: 0, accepted: 0, invites: 12, reply_base: 0, replied: 0, replied_so_far: 0, calls: 0 }),
    row({ period_from: '2026-03-09', period_to: '2026-03-15', accept_base: 0, accepted: 0, invites: 0, reply_base: 0, replied: 0, replied_so_far: 0, calls: 0 }),
  ]} seat="risedtc" />)
  expect(screen.getByText('No invite old enough yet')).toBeTruthy()
  expect(screen.getByText('No invites sent')).toBeTruthy()
  expect(screen.queryByText(/%$/)).toBeNull()
})
it('opens on the first week with an invite and keeps an empty week after it', () => {
  const quiet = { accept_base: 0, accepted: 0, invites: 0, reply_base: 0, replied: 0, replied_so_far: 0, calls: 0 }
  render(<ChangeRateRows rows={[
    row({ period_from: '2026-02-16', period_to: '2026-02-22', ...quiet }), row({ period_from: '2026-02-23', period_to: '2026-03-01', ...quiet }),
    row({}), row({ period_from: '2026-03-09', period_to: '2026-03-15', ...quiet }),
  ]} seat="risedtc" />)
  const items = screen.getAllByRole('listitem')
  expect(items).toHaveLength(2)
  expect(within(items[0]).getByText('2 Mar to 8 Mar')).toBeTruthy()
  expect(within(items[1]).getByText('No invites sent')).toBeTruthy()
})
it('keeps another seat out and says when a seat sent nothing', () => {
  render(<ChangeRateRows rows={rows} seat="swishdm" />)
  expect(screen.getByText('No invite went out on this seat in the last 8 weeks.')).toBeTruthy()
  expect(screen.queryByRole('listitem')).toBeNull()
})
it('reads the weeks and mounts them under a named section', async () => {
  render(<ChangeRates seat="arch" />)
  const section = screen.getByRole('region', { name: 'Acceptance by week' })
  expect(await within(section).findByText('Other seat (3 Mar)')).toBeTruthy()
  expect(within(section).getAllByRole('listitem')).toHaveLength(1)
})
