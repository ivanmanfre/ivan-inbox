// @vitest-environment jsdom
// Booked on a book-their-link task (2026-09-27): only book_link tasks carry the key; Save sends the
// entered local time as a UTC instant to ops_task_mark_booked and closes the row; an RPC refusal shows.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { OpsDraft } from '../../lib/ops'

const rpc = vi.fn(async (_fn: string, _args: unknown) => ({ data: { ok: true, action: 'inserted', prospect: 'Ofir Bello' }, error: null }))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (fn: string, args: unknown) => rpc(fn, args), auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } } }))
import { BookedKey } from './BookedKey'

const task = (context: Record<string, unknown>): OpsDraft => ({
  id: 'card-1', client_id: 'ivan', kind: 'task', slack_channel: '', body: "Book Ofir Bello's calendar link, then tap Booked and enter the time",
  context, created_at: '2026-09-27T10:00:00Z', approved_at: null, sent_at: null, send_blocked_reason: null,
})
afterEach(() => { cleanup(); rpc.mockClear() })

describe('BookedKey', () => {
  it('renders nothing on an ordinary task', () => {
    const { container } = render(<BookedKey d={task({})} onDone={() => {}} />)
    expect(container.innerHTML).toBe('')
  })
  it('shows what the prospect asked for, verbatim, on a booking card', () => {
    const ask = 'can you prepare:\n1) proposed partnership structure\n2) examples of creators'
    const { container } = render(<BookedKey d={task({ action: 'book_link', their_ask: ask })} onDone={() => {}} />)
    const el = container.querySelector('[data-ask]')!
    expect(el.textContent).toBe('What they asked for' + ask)
    fireEvent.click(container.querySelector('[data-verb="booked"]')!)
    expect(container.querySelector('[data-ask]')).not.toBeNull()
  })
  it('draws no ask block when the card has none', () => {
    const { container } = render(<BookedKey d={task({ action: 'book_link' })} onDone={() => {}} />)
    expect(container.querySelector('[data-ask]')).toBeNull()
  })
  it('sends the local call time as UTC and closes the task', async () => {
    const done = vi.fn()
    const { container } = render(<BookedKey d={task({ action: 'book_link', prospect_name: 'Ofir Bello' })} onDone={done} />)
    fireEvent.click(container.querySelector('[data-verb="booked"]')!)
    const input = container.querySelector('input[type="datetime-local"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '2026-09-28T15:30' } })
    const expected = new Date('2026-09-28T15:30').toISOString()
    expect(container.textContent).toContain('Saves as ' + expected.slice(0, 16).replace('T', ' ') + ' UTC')
    fireEvent.click(container.querySelector('[data-verb="booked-save"]')!)
    await waitFor(() => expect(done).toHaveBeenCalled())
    expect(rpc).toHaveBeenCalledWith('ops_task_mark_booked', { p_draft_id: 'card-1', p_start_at: expected })
  })
  it('opens prefilled with the accepted time on a send-invite task', async () => {
    const done = vi.fn()
    const { container } = render(<BookedKey d={task({ action: 'book_link', kind_detail: 'send_invite', proposed_start_at: '2026-11-02T15:30:00.000Z' })} onDone={done} />)
    fireEvent.click(container.querySelector('[data-verb="booked"]')!)
    expect(container.textContent).toContain('Saves as 2026-11-02 15:30 UTC')
    fireEvent.click(container.querySelector('[data-verb="booked-save"]')!)
    await waitFor(() => expect(done).toHaveBeenCalled())
    expect(rpc).toHaveBeenCalledWith('ops_task_mark_booked', { p_draft_id: 'card-1', p_start_at: '2026-11-02T15:30:00.000Z' })
  })
  it('keeps the exact proposed instant in a repeated DST hour until edited', async () => {
    const done = vi.fn()
    const { container } = render(<BookedKey d={task({ action: 'book_link', proposed_start_at: '2026-11-01T06:30:00.000Z' })} onDone={done} />)
    fireEvent.click(container.querySelector('[data-verb="booked"]')!)
    expect(container.textContent).toContain('Saves as 2026-11-01 06:30 UTC')
    fireEvent.click(container.querySelector('[data-verb="booked-save"]')!)
    await waitFor(() => expect(done).toHaveBeenCalled())
    expect(rpc).toHaveBeenCalledWith('ops_task_mark_booked', { p_draft_id: 'card-1', p_start_at: '2026-11-01T06:30:00.000Z' })
  })
  it('shows the refusal and keeps the task open', async () => {
    rpc.mockResolvedValueOnce({ data: { ok: false, error: 'This task is already closed.' } as never, error: null })
    const done = vi.fn()
    const { container } = render(<BookedKey d={task({ action: 'book_link' })} onDone={done} />)
    fireEvent.click(container.querySelector('[data-verb="booked"]')!)
    fireEvent.change(container.querySelector('input[type="datetime-local"]')!, { target: { value: '2026-09-28T15:30' } })
    fireEvent.click(container.querySelector('[data-verb="booked-save"]')!)
    await waitFor(() => expect(container.textContent).toContain('This task is already closed.'))
    expect(done).not.toHaveBeenCalled()
  })
})

describe('Book key on an accepted-time card (BOOKING_CARD_OFFERED_SLOT_V1)', () => {
  const card = (extra: Record<string, unknown> = {}) => task({ action: 'book_link', kind_detail: 'book_offered_slot', prospect_name: 'Zech Strauser', booking: { label: 'this Thursday at 1pm ET', invite_email: 'zech@urture.com', start: '2026-11-05T18:00:00.000Z' }, ...extra })
  const fetchMock = vi.fn()
  afterEach(() => { fetchMock.mockReset() })
  it('names the time and the email on the key, and books only on the tap', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'booked', recorded: true, released: true }) })
    const done = vi.fn()
    const { container } = render(<BookedKey d={card()} onDone={done} />)
    const key = container.querySelector('[data-verb="book-slot"]')!
    expect(key.textContent).toContain('Book this Thursday at 1pm ET for zech@urture.com')
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(key)
    await waitFor(() => expect(done).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toMatchObject({ action: 'book_card', card_id: 'card-1', confirmed: true })
    expect(container.textContent).toContain('The confirm reply is ready in the thread.')
  })
  it('keeps the card open when the server books nothing', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'blocked', message: 'A call is already booked for this person. Nothing new was booked.' }) })
    const done = vi.fn()
    const { container } = render(<BookedKey d={card()} onDone={done} />)
    fireEvent.click(container.querySelector('[data-verb="book-slot"]')!)
    await waitFor(() => expect(container.textContent).toContain('Nothing new was booked.'))
    expect(done).not.toHaveBeenCalled()
  })
  it('a send-invite card without an accepted slot has no Book key', () => {
    const { container } = render(<BookedKey d={task({ action: 'book_link', kind_detail: 'send_invite' })} onDone={() => {}} />)
    expect(container.querySelector('[data-verb="book-slot"]')).toBeNull()
    expect(container.querySelector('[data-verb="booked"]')).not.toBeNull()
  })
})
