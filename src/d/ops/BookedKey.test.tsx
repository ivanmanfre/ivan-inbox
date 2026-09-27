// @vitest-environment jsdom
// Booked on a book-their-link task (2026-09-27): only book_link tasks carry the key; Save sends the
// entered local time as a UTC instant to ops_task_mark_booked and closes the row; an RPC refusal shows.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { OpsDraft } from '../../lib/ops'

const rpc = vi.fn(async (_fn: string, _args: unknown) => ({ data: { ok: true, action: 'inserted', prospect: 'Ofir Bello' }, error: null }))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (fn: string, args: unknown) => rpc(fn, args) } }))
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
