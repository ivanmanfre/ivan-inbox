// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CalendarPanel } from './Calendar'
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
const request = vi.hoisted(() => vi.fn())
vi.mock('../../lib/inboxCalendar', async original => ({ ...await original<typeof import('../../lib/inboxCalendar')>(), requestCalendar: request }))
const slots = [{ start: '2026-10-20T18:00:00.000Z', end: '2026-10-20T18:30:00.000Z' }, { start: '2026-10-21T18:00:00.000Z', end: '2026-10-21T18:30:00.000Z' }]
const result = { owner: 'Mattan', booking_url: 'https://meetings.hubspot.com/mattan5/rise-intro-call--li', email: 'ada@example.com', calendar: { owner: 'Mattan', checked_at: '2026-10-17T00:00:00Z', duration_minutes: 30, timezone: 'UTC', slots, can_book: true } }
beforeEach(() => { cleanup(); request.mockReset(); request.mockResolvedValue(result) })
function open(props: Partial<Parameters<typeof CalendarPanel>[0]> = {}) {
 const onInsert = vi.fn()
 const view = render(<CalendarPanel prospectId="ada" clientId="risedtc" onInsert={onInsert} {...props} />)
 fireEvent.click(screen.getByText('Calendar'))
 return { ...view, onInsert }
}
describe('conversation calendar panel', () => {
 it('opens live availability and inserts two exact, timezone-labelled proposals without booking', async () => {
  const { onInsert } = open(); fireEvent.change(screen.getByLabelText('Calendar timezone'), { target: { value: 'UTC' } }); const choices = await screen.findAllByRole('checkbox', { name: /Oct/ })
  fireEvent.click(choices[0]); fireEvent.click(choices[1]); fireEvent.click(screen.getByRole('button', { name: 'Insert times into reply' }))
  expect(onInsert).toHaveBeenCalledWith(expect.stringMatching(/20.*October.*18:00.*UTC.*or.*21.*October.*18:00.*UTC/s))
  expect(request.mock.calls.every(c => c[0].action === 'availability')).toBe(true)
  expect(screen.getByText(/Prospect’s timezone is unconfirmed/)).toBeInTheDocument()
 })
 it('requires one slot, email and explicit agreement before the invite action', async () => {
  open(); const choices = await screen.findAllByRole('checkbox', { name: /Oct/ }); fireEvent.click(choices[0])
  fireEvent.click(screen.getByRole('button', { name: 'Book agreed time' }))
  const book = screen.getByRole('button', { name: 'Book and send invite' }); expect(book).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: /They agreed/ })); expect(book).toBeEnabled()
  request.mockResolvedValue({ ...result, booking: { status: 'confirmed', calendar_event_id: 'event', ...slots[0], handoff: true } })
  fireEvent.click(book); expect(await screen.findByText(/Invite confirmed/)).toBeInTheDocument()
  expect(request.mock.calls[1][0]).toMatchObject({ action: 'book', start: slots[0].start, email: 'ada@example.com', confirmed: true })
 })
 it('already booked and uncertain threads never expose another booking action', async () => {
  request.mockResolvedValue({ ...result, calendar: undefined, existing_booking: { status: 'uncertain' } }); open()
  expect(await screen.findByText(/Check.*calendar before trying again/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Book agreed time' })).not.toBeInTheDocument()
 })
 it('errors offer refresh and the correct owner link without claiming availability', async () => {
  request.mockRejectedValue(Error('Calendar is offline.')); open()
  expect(await screen.findByRole('alert')).toHaveTextContent('Calendar is offline.')
  expect(screen.getByRole('link', { name: /Open Mattan/ })).toHaveAttribute('href', result.booking_url)
  expect(screen.getByRole('button', { name: 'Refresh availability' })).toBeInTheDocument()
 })
 it('clears previous slot selections and ignores late responses when switching conversations', async () => {
  let resolve!: (v: unknown) => void; request.mockReturnValueOnce(new Promise(r => { resolve = r }))
  const { rerender } = open()
  request.mockResolvedValue({ ...result, owner: 'Davorin', calendar: { ...result.calendar, owner: 'Davorin' } })
  rerender(<CalendarPanel prospectId="grace" clientId="arch" onInsert={vi.fn()} />)
  resolve(result)
  expect(await screen.findByText(/Davorin’s live calendar/)).toBeInTheDocument()
  expect(screen.queryByText(/Mattan’s live calendar/)).not.toBeInTheDocument()
 })
 it('unsupported direct booking remains useful through owner link and insertion', async () => {
  request.mockResolvedValue({ ...result, calendar: { ...result.calendar, can_book: false } }); open({ clientId: 'ivan' })
  await screen.findAllByRole('checkbox', { name: /Oct/ })
  expect(screen.queryByRole('button', { name: 'Book agreed time' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Open .*booking page/ })).toBeInTheDocument()
 })
})
