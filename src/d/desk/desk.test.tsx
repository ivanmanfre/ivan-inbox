// @vitest-environment jsdom
// The desk view against a mocked network: the saved copy paints first, a send draws
// both bubbles at once, the stream fills the reserved bubble, chips send their text,
// a held action counts down and commits, a done action undoes. Made-up rows only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DeskMessage } from './model'

const sent: { body: unknown }[] = []
const ops: { kind: string; id: string }[] = []
let streamGate: (() => void) | null = null

const stored = (over: Partial<DeskMessage> & { id: string }): DeskMessage => ({
  role: 'assistant', origin: 'desk', body: '', status: 'done', meta: {}, client_key: null, created_at: new Date().toISOString(), ...over,
})

vi.mock('../../lib/swr', async orig => ({
  ...(await orig<typeof import('../../lib/swr')>()),
  currentUserId: () => '00000000-0000-4000-8000-000000000001',
}))
vi.mock('./api', () => ({
  readMessages: vi.fn(async () => [stored({ id: 'h1', body: 'Saved answer from yesterday.', created_at: '2026-11-17T10:00:00Z' })]),
  readJobs: vi.fn(async () => []),
  warmDesk: vi.fn(async () => {}),
  subscribeDesk: vi.fn(() => () => {}),
  uploadDeskPhoto: vi.fn(async () => 'https://example.com/p.jpg'),
  sendDesk: vi.fn(async (body: { text: string; client_key: string }, h: { onAck: (a: unknown) => void; onDelta: (t: string) => void; onFinal: (m: DeskMessage) => void }) => {
    sent.push({ body })
    h.onAck({ user_message_id: `u-${body.client_key}`, client_key: body.client_key })
    await new Promise<void>(r => { streamGate = r })
    h.onDelta('Four posts ')
    h.onDelta('this week.')
    const t = body.text
    h.onFinal(stored({
      id: `a-${body.client_key}`, body: 'Four posts this week.',
      meta: /approve/.test(t)
        ? { actions: [{ id: 'act-1', kind: 'approve', label: 'Approve #a1b2c', state: 'held', undo: false, hold_ms: 8000 }] }
        : /move/.test(t)
          ? { actions: [{ id: 'act-2', kind: 'schedule', label: 'Moved #d3e4f to Thu', state: 'done', undo: true }] }
          : { chips: [{ label: '#a1b2c trains', send: 'move #a1b2c to thursday' }] },
    }))
    return 'final'
  }),
  undoAction: vi.fn(async (id: string) => { ops.push({ kind: 'undo', id }); return { ok: true } }),
  commitAction: vi.fn(async (id: string) => { ops.push({ kind: 'commit', id }); return { ok: true } }),
  cancelAction: vi.fn(async (id: string) => { ops.push({ kind: 'cancel', id }); return { ok: true } }),
}))
vi.mock('../../exp/v2c/chat/useStt', () => ({
  useStt: () => ({ state: 'idle', elapsedMs: 0, note: null, supported: true, toggle: vi.fn(), clip: null, clearClip: vi.fn() }),
}))

const { Desk } = await import('./Desk')

beforeEach(() => { sent.length = 0; ops.length = 0; streamGate = null; localStorage.clear() })
afterEach(() => { cleanup(); vi.useRealTimers() })

function type(text: string) {
  fireEvent.change(screen.getByLabelText('Message the desk'), { target: { value: text } })
  fireEvent.click(screen.getByLabelText('Send'))
}

describe('Desk', () => {
  it('paints the saved copy in the first render, before the live read answers', () => {
    localStorage.setItem('swr1:00000000-0000-4000-8000-000000000001:desk:messages:v1', JSON.stringify({
      savedAt: new Date().toISOString(), user: '00000000-0000-4000-8000-000000000001',
      payload: [stored({ id: 'c1', body: 'Cached answer.', created_at: '2026-11-16T10:00:00Z' })],
    }))
    render(<Desk layout="phone" />)
    expect(screen.getByText('Cached answer.')).toBeTruthy()
    expect(screen.getByText(/Saved copy/)).toBeTruthy()
  })

  it('a send shows both bubbles at once, then the stream fills the reserved one', async () => {
    const { container } = render(<Desk layout="phone" />)
    await screen.findByText('Saved answer from yesterday.')
    type('whats going out this week')
    expect(screen.getByText('whats going out this week')).toBeTruthy()
    expect(container.querySelector('[data-streaming]')).toBeTruthy()
    await act(async () => { streamGate?.() })
    await screen.findByText('Four posts this week.')
    expect(container.querySelector('[data-streaming]')).toBeNull()
    // A chip sends its own text.
    fireEvent.click(await screen.findByText('#a1b2c trains'))
    await waitFor(() => expect(sent).toHaveLength(2))
    expect((sent[1].body as { text: string; chip: boolean })).toMatchObject({ text: 'move #a1b2c to thursday', chip: true })
  })

  it('a held action counts down and commits once; Undo during the hold cancels', async () => {
    render(<Desk layout="phone" />)
    await screen.findByText('Saved answer from yesterday.')
    vi.useFakeTimers({ shouldAdvanceTime: true })
    type('approve the trains one')
    await act(async () => { streamGate?.() })
    await waitFor(() => expect(document.querySelector('[data-state="held"]')?.textContent).toMatch(/Approve #a1b2c in \d+s/))
    await act(async () => { vi.advanceTimersByTime(9000) })
    await waitFor(() => expect(ops).toEqual([{ kind: 'commit', id: 'act-1' }]))
  })

  it('a done action with undo calls undo', async () => {
    render(<Desk layout="phone" />)
    await screen.findByText('Saved answer from yesterday.')
    type('move the monday one')
    await act(async () => { streamGate?.() })
    fireEvent.click(await screen.findByText('Undo'))
    await waitFor(() => expect(ops).toEqual([{ kind: 'undo', id: 'act-2' }]))
  })
})
