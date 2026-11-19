// @vitest-environment jsdom
// Content Desk follow-ups (2026-11-19): post cards that open their post, Stop, Ask again, and the server's own
// sentence on a refused Undo. Made-up rows only (public repo).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DeskMessage } from './model'

type Body = { text: string; client_key: string; regen_of?: string }
const sent: Body[] = []
const stopped: string[] = []
let gate: (() => void) | null = null
const stored = (over: Partial<DeskMessage> & { id: string }): DeskMessage => ({
  role: 'assistant', origin: 'desk', body: '', status: 'done', meta: {}, client_key: null, created_at: '2026-11-19T09:00:00Z', ...over,
})
const history = (): DeskMessage[] => [
  stored({ id: 'q1', role: 'user', origin: 'operator', body: 'whats going out this week', client_key: 'k1', created_at: '2026-11-19T08:59:00Z' }),
  stored({ id: 'a1', body: 'Two posts: "A made up post about trains" and "A made up post about a quiet Monday".', meta: { client_key: 'k1', reply_to: 'q1', drafts: [
    { handle: '#a1', id: '00000000-0000-4000-8000-0000000000a1', first_line: 'A made up post about trains in the rain.', status: 'scheduled', scheduled_at: '2026-11-24T08:30:00Z' },
    { handle: '#d3', first_line: 'An older card with no id.', status: 'review', scheduled_at: null },
  ] } }),
]

vi.mock('../../lib/swr', async orig => ({ ...(await orig<typeof import('../../lib/swr')>()), currentUserId: () => '00000000-0000-4000-8000-000000000001' }))
vi.mock('./api', () => ({
  readMessages: vi.fn(async () => history()),
  readJobs: vi.fn(async () => []),
  warmDesk: vi.fn(async () => {}),
  markHeldSeen: vi.fn(async (ids: string[]) => ({ ok: true, results: ids.map(id => ({ id, state: 'held', seen_at: new Date().toISOString(), hold_until: null })) })),
  subscribeDesk: vi.fn(() => () => {}),
  uploadDeskPhoto: vi.fn(async () => 'https://example.com/p.jpg'),
  stopDesk: vi.fn(async (key: string) => { stopped.push(key); return true }),
  sendDesk: vi.fn(async (body: Body, h: { onAck: (a: unknown) => void; onDelta: (t: string) => void; onFinal: (m: DeskMessage) => void }) => {
    sent.push(body)
    h.onAck({ user_message_id: `u-${body.client_key}`, client_key: body.client_key })
    h.onDelta('Partial ')
    await new Promise<void>(r => { gate = r })
    const stop = stopped.includes(body.client_key)
    h.onFinal(stored({ id: `a-${body.client_key}`, created_at: new Date().toISOString(),
      body: stop ? 'Partial' : body.regen_of ? 'A fresh answer to the same question, long enough to copy it.' : 'A whole answer.',
      meta: { client_key: body.client_key, reply_to: `u-${body.client_key}`, ...(stop ? { stopped: true } : {}), ...(body.regen_of ? { regen_of: body.regen_of } : {}) } }))
    return 'final'
  }),
  undoAction: vi.fn(async () => ({ ok: false, error: 'too_late', detail: 'Its time is under 15 minutes away or past, so I left it off the schedule. Date it again in the calendar.' })),
  commitAction: vi.fn(async () => ({ ok: true })),
  cancelAction: vi.fn(async () => ({ ok: true })),
}))
vi.mock('../../exp/v2c/chat/useStt', () => ({
  useStt: () => ({ state: 'idle', elapsedMs: 0, note: null, supported: true, toggle: vi.fn(), clip: null, clearClip: vi.fn() }),
}))

const api = await import('./api')
const { Desk } = await import('./Desk')
const { resetActionGuards } = await import('./actionGuards')
const { resetHeldSeen } = await import('./heldSeen')
const { resetLiveHolds } = await import('./useDesk')
const { installVisibility, removeVisibility } = await import('./testVisibility')

beforeEach(() => { sent.length = 0; stopped.length = 0; gate = null; localStorage.clear(); resetActionGuards(); resetHeldSeen(); resetLiveHolds(); installVisibility() })
afterEach(() => { cleanup(); removeVisibility() })

describe('Desk follow-ups', () => {
  it('a post card with an id is a link that opens that post in Content; an old card without one is not', async () => {
    render(<Desk layout="phone" />)
    const link = await screen.findByRole('link', { name: /Open the post: A made up post about trains/ })
    expect(link.getAttribute('href')).toBe('#exp/d/content/now?draft=00000000-0000-4000-8000-0000000000a1&lane=ivan')
    expect(screen.getByText('An older card with no id.').closest('a')).toBeNull()
    // no handle is shown on a card
    expect(screen.queryByText('#a1')).toBeNull()
  })

  it('Stop replaces Send while an answer is written, and the stopped answer says nothing changed', async () => {
    render(<Desk layout="phone" />)
    await screen.findByText(/Two posts/)
    fireEvent.change(screen.getByLabelText('Message the desk'), { target: { value: 'explain the week' } })
    fireEvent.click(screen.getByLabelText('Send'))
    const stop = await screen.findByLabelText('Stop the answer')
    expect(screen.queryByLabelText('Send')).toBeNull()
    fireEvent.click(stop)
    expect(stopped).toEqual([sent[0].client_key])
    expect(screen.getByLabelText('Stopping the answer')).toHaveProperty('disabled', true)
    await act(async () => { gate?.() })
    await screen.findByText('Stopped. Nothing was changed.')
    expect(await screen.findByLabelText('Send')).toBeTruthy()
  })

  it('Ask again re-asks the stored question read-only: the question is not shown twice and the new answer says so', async () => {
    const { container } = render(<Desk layout="phone" />)
    await screen.findByText(/Two posts/)
    fireEvent.click(screen.getByRole('button', { name: 'Ask the same question again' }))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ text: 'whats going out this week', regen_of: 'a1' })
    expect(sent[0].client_key).not.toBe('k1')   // a new key: never the old turn's
    expect(screen.getAllByText('whats going out this week')).toHaveLength(1)
    await act(async () => { gate?.() })
    await screen.findByText(/A fresh answer to the same question/)
    expect(container.querySelectorAll('.dk-by span')[container.querySelectorAll('.dk-by span').length - 1].textContent).toBe('Asked again')
    // only the newest answer offers it: the old one does not any more
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Ask the same question again' })).toHaveLength(1))
  })

  it('no Ask again on an answer with change cards, and none while another answer is written', async () => {
    vi.mocked(api.readMessages).mockResolvedValueOnce([...history().slice(0, 1), stored({ id: 'a2', body: '', meta: { client_key: 'k1', reply_to: 'q1', notes: [],
      actions: [{ id: 'act-1', kind: 'approve', label: 'Approved "A made up post"', state: 'done', undo: true }] } })])
    render(<Desk layout="phone" />)
    await screen.findByRole('button', { name: 'Undo' })
    expect(screen.queryByRole('button', { name: 'Ask the same question again' })).toBeNull()
  })

  it('a refused Undo shows the server sentence, never a code', async () => {
    vi.mocked(api.readMessages).mockResolvedValueOnce([stored({ id: 'a3', body: '', meta: { notes: [],
      actions: [{ id: 'act-p', kind: 'pull', label: 'Took "A made up post" off the schedule', state: 'done', undo: true }] } })])
    render(<Desk layout="phone" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await screen.findByText(/Its time is under 15 minutes away or past/)
    expect(screen.queryByText('too_late')).toBeNull()
  })
})
