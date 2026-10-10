// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DateRates, RateComparisonTables } from './DateRates'
import type { RateComparisonRow } from '../../lib/rateComparison'

vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn(async (_name: string, args: { p_from: string; p_to: string }) => ({
  data: rows.map(r => ({ ...r, period_from: r.period === 'current' ? args.p_from : '2026-09-26', period_to: r.period === 'current' ? args.p_to : '2026-10-02' })), error: null,
})) } }))
const one = (channel: 'invitation' | 'dm', period: 'current' | 'previous', outcomes: number, mature: number, pending = 0): RateComparisonRow => ({
  client_id: 'ivan', lane: '__all__', channel, period, outcomes, mature, pending, people: mature + pending,
  rate_pct: mature ? outcomes / mature * 100 : null,
  period_from: period === 'current' ? '2026-10-03' : '2026-09-26', period_to: period === 'current' ? '2026-10-09' : '2026-10-02',
})
const rows = [one('invitation','current',2,4,1),one('invitation','previous',1,4),one('dm','current',1,4),one('dm','previous',0,0)]
afterEach(cleanup)
it('shows both rate comparisons, counts and pending samples without inventing an empty baseline', () => {
  render(<RateComparisonTables rows={rows} seat="ivan" />)
  const acceptance = screen.getByRole('table', { name: 'Acceptance rate comparison' })
  expect(within(acceptance).getByText('50.0%')).toBeTruthy()
  expect(within(acceptance).getByText('25.0%')).toBeTruthy()
  expect(within(acceptance).getByText('+25.0 pp')).toBeTruthy()
  expect(within(acceptance).getByText('1 pending')).toBeTruthy()
  const reply = screen.getByRole('table', { name: 'Reply rate comparison' })
  expect(within(reply).getByText('25.0%')).toBeTruthy()
  expect(within(reply).getByText('No mature sample')).toBeTruthy()
  expect(within(reply).getByText('No comparison')).toBeTruthy()
})
it('applies custom dates to both rate tables and exposes the equal-length previous period', async () => {
  render(<DateRates seat="ivan" range="7d" now={Date.parse('2026-10-10T12:00:00Z')} />)
  await screen.findByRole('table', { name: 'Reply rate comparison' })
  fireEvent.change(screen.getByLabelText('Rates from'), { target: { value: '2026-09-01' } })
  fireEvent.change(screen.getByLabelText('Rates to'), { target: { value: '2026-09-10' } })
  fireEvent.click(screen.getByRole('button', { name: 'Show rates' }))
  await waitFor(() => expect(screen.getByText(/2026-09-01 to 2026-09-10/)).toBeTruthy())
  expect(screen.getByText(/2026-08-22 to 2026-08-31/)).toBeTruthy()
  expect(screen.getAllByRole('table')).toHaveLength(2)
})
it('does not display another client\'s results when the selected seat changes', () => {
  render(<RateComparisonTables rows={rows} seat="arch" />)
  expect(screen.queryByText('50.0%')).toBeNull()
  expect(screen.getAllByText('No mature sample')).toHaveLength(4)
})
