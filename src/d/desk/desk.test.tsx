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

// held_seen: the server arms a hold when its row is first visibly on screen (made-up answers).
const seenCalls: string[][] = []
let heldSeenOk = true
function heldSeenAnswer(ids: string[]) {
  seenCalls.push(ids)
  const at = Date.now()
  return heldSeenOk
    ? { ok: true, results: ids.map(id => ({ id, state: 'held', seen_at: new Date(at).toISOString(), hold_until: new Date(at + 8000).toISOString() })) }
    : { ok: false, error: 'No connection.' }
}

vi.mock('../../lib/swr', async orig => ({
  ...(await orig<typeof import('../../lib/swr')>()),
  currentUserId: () => '00000000-0000-4000-8000-000000000001',
}))
vi.mock('./api', () => ({
  readMessages: vi.fn(async () => [stored({ id: 'h1', body: 'Saved answer from yesterday.', created_at: '2026-11-17T10:00:00Z' })]),
  readJobs: vi.fn(async () => []),
  warmDesk: vi.fn(async () => {}),
  markHeldSeen: vi.fn(async (ids: string[]) => heldSeenAnswer(ids)),
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
          : { chips: [{ label: 'Show the draft', send: 'move #a1b2c to thursday' }] },
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

const api = await import('./api')
const { Desk } = await import('./Desk')
const { resetHeldSeen } = await import('./heldSeen')
const { installVisibility, removeVisibility } = await import('./testVisibility')
const { resetActionGuards } = await import('./actionGuards')

beforeEach(() => { sent.length = 0; ops.length = 0; streamGate = null; localStorage.clear(); resetActionGuards(); resetHeldSeen(); seenCalls.length = 0; heldSeenOk = true; installVisibility() })
afterEach(() => { cleanup(); vi.useRealTimers(); removeVisibility() })

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
    // B1: a chip shows exactly the text it sends; a label that differs is never shown.
    fireEvent.click(await screen.findByText('move #a1b2c to thursday', { selector: 'button' }))
    expect(screen.queryByText('Show the draft')).toBeNull()
    await waitFor(() => expect(sent).toHaveLength(2))
    expect((sent[1].body as { text: string; chip: boolean })).toMatchObject({ text: 'move #a1b2c to thursday', chip: true })
  })

  it('a held action counts down and the browser never commits it; Undo during the hold cancels', async () => {
    render(<Desk layout="phone" />)
    await screen.findByText('Saved answer from yesterday.')
    vi.useFakeTimers({ shouldAdvanceTime: true })
    type('approve the trains one')
    await act(async () => { streamGate?.() })
    await waitFor(() => expect(document.querySelector('[data-state="held"]')?.textContent).toMatch(/Doing it in \d+s.*Approve #a1b2c/))
    fireEvent.click(screen.getByText('Undo'))
    await act(async () => { vi.advanceTimersByTime(9000) })
    await waitFor(() => expect(ops).toEqual([{ kind: 'cancel', id: 'act-1' }]))
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

describe('Desk polish (review of the new layout)', () => {
  it('a photo still uploading holds every other send: a chip waits', async () => {
    vi.mocked(api.readMessages).mockResolvedValueOnce([stored({ id: 'h2', body: 'Two match.', meta: { chips: [{ send: 'move #a1b2c to thursday' }] } })])
    let release: (u: string) => void = () => {}
    vi.mocked(api.uploadDeskPhoto).mockImplementationOnce(() => new Promise<string>(r => { release = r }))
    const { container } = render(<Desk layout="phone" />)
    await screen.findByText('Two match.')
    const file = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' })
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x'); globalThis.URL.revokeObjectURL = vi.fn()
    fireEvent.change(container.querySelector('[data-desk-photo]')!, { target: { files: [file] } })
    fireEvent.click(screen.getByLabelText('Send'))
    await waitFor(() => expect((screen.getByText('move #a1b2c to thursday', { selector: 'button' }) as HTMLButtonElement).disabled).toBe(true))
    expect(sent).toHaveLength(0)
    await act(async () => { release('https://example.com/p.jpg') })
    await waitFor(() => expect(sent).toHaveLength(1))
  })

  it('a failed first read with nothing saved is an error with Try again, never the empty starter screen', async () => {
    vi.mocked(api.readMessages).mockRejectedValueOnce(new Error('offline'))
    const { container } = render(<Desk layout="desktop" />)
    await screen.findByText(/Could not read the desk/)
    expect(container.querySelector('[data-desk-hero]')).toBeNull()
    expect(screen.getByText('Try again')).toBeTruthy()
  })

  it('an old long answer shows a readable preview and a real disclosure (Show all / Show less, aria-expanded)', async () => {
    const paras = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} about a made up train ride, long enough to count.`)
    vi.mocked(api.readMessages).mockResolvedValueOnce([
      stored({ id: 'o1', body: paras.join('\n\n'), created_at: '2026-11-17T09:00:00Z' }),
      ...['a', 'b', 'c', 'd'].map((k, i) => stored({ id: `n${k}`, body: `Short ${k}.`, created_at: `2026-11-17T10:0${i}:00Z` })),
    ])
    const { container } = render(<Desk layout="desktop" />)
    const key = await screen.findByText('Show all')
    expect(key.getAttribute('aria-expanded')).toBe('false')
    const box = container.querySelector('#dk-t-o1')!
    expect(box.hasAttribute('inert')).toBe(false)
    expect(box.textContent).toContain('Paragraph 0')
    expect(box.textContent).not.toContain('Paragraph 11')
    fireEvent.click(key)
    expect(screen.getByText('Show less').getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('#dk-t-o1')!.textContent).toContain('Paragraph 11')
  })

  it('a long list of choices shows six, then Show N more', async () => {
    vi.mocked(api.readMessages).mockResolvedValueOnce([stored({ id: 'h3', body: 'Many match.', meta: { chips: Array.from({ length: 10 }, (_, i) => ({ send: `move #a${i} to thursday` })) } })])
    render(<Desk layout="phone" />)
    await screen.findByText('Many match.')
    expect(document.querySelectorAll('.dk-chip')).toHaveLength(6)
    fireEvent.click(screen.getByText('Show 4 more'))
    expect(document.querySelectorAll('.dk-chip')).toHaveLength(10)
  })

  it('a change turn shows its cards and not their echo text; a note from the server sits on its card', async () => {
    const label = 'Saved as an idea: "A made up idea about slow trains". The scorer picks it up next.'
    vi.mocked(api.readMessages).mockResolvedValueOnce([stored({ id: 'p1',
      body: `${label} It is already in Ideas from Monday.`,
      meta: { actions: [{ id: 'act-p', kind: 'idea', label, detail: 'It is already in Ideas from Monday.', state: 'done', undo: true }] } })])
    render(<Desk layout="phone" />)
    await screen.findByText('It is already in Ideas from Monday.')
    expect(document.querySelectorAll('[data-msg="p1"] .dk-text')).toHaveLength(0)
    expect(screen.getByText(label)).toBeTruthy()
  })

  it('beside its cards, a turn shows the server notes (a post it could not match, a save warning) and no receipt', async () => {
    const proposal = 'Proposed (ref 1a2b3c4d): move "A made up post about trains in the rain and a long platform wait."'
    vi.mocked(api.readMessages).mockResolvedValueOnce([stored({ id: 'p3',
      // as the server cuts it: the proposal split over two paragraphs, then a line with no card, then the save notice
      body: `${proposal}\n\n(no date) to Thu 26 Nov, 09:30 (UTC+01:00). It runs only when you tap Do it now.\n\nNo draft matches "the ferry one". Say its first words.\n\n(I could not save this answer. The held actions were cancelled.)`,
      meta: { actions: [{ id: 'act-r', kind: 'date', label: 'Cancelled: I could not save this answer.', state: 'cancelled', undo: false }],
        notes: ['No draft matches "the ferry one". Say its first words.', '(I could not save this answer. The held actions were cancelled.)'] } })])
    render(<Desk layout="phone" />)
    await screen.findByText(/No draft matches "the ferry one"/)
    expect(screen.getByText(/I could not save this answer\. The held actions were cancelled/)).toBeTruthy()
    expect(screen.queryByText(/Proposed \(ref/)).toBeNull()
    expect(screen.queryByText(/It runs only when you tap/)).toBeNull()
  })

  it('a folded preview never ends inside a code fence', async () => {
    const code = ['```', 'line one', '', 'line two after a blank', '```'].join('\n')
    const long = [code, ...Array.from({ length: 12 }, (_, i) => `Paragraph ${i} about a made up train ride, long enough to count.`)].join('\n\n')
    vi.mocked(api.readMessages).mockResolvedValueOnce([
      stored({ id: 'f1', body: long, created_at: '2026-11-17T09:00:00Z' }),
      ...['a', 'b', 'c', 'd'].map((k, i) => stored({ id: `g${k}`, body: `Short ${k}.`, created_at: `2026-11-17T10:0${i}:00Z` })),
    ])
    const { container } = render(<Desk layout="desktop" />)
    await screen.findByText('Show all')
    expect(container.querySelector('#dk-t-f1')!.textContent).toContain('line two after a blank')
  })

  it('a finished change undone later does not keep its old "Moved (ref …)" sentence', async () => {
    vi.mocked(api.readMessages).mockResolvedValueOnce([stored({ id: 'p4',
      body: 'Moved (ref 1a2b3c4d) "A made up post about trains.\n\nNobody looked up." (no date) to Tue 9 Mar, 10:45',
      meta: { actions: [{ id: 'act-s', kind: 'date', label: 'Undone.', state: 'undone', undo: false }] } })])
    render(<Desk layout="phone" />)
    await screen.findByText('Back as it was.')
    expect(screen.queryByText(/Moved \(ref/)).toBeNull()
    expect(screen.queryByText(/Nobody looked up/)).toBeNull()
  })

  it('an idea undone later does not bring its old receipt back above the card', async () => {
    vi.mocked(api.readMessages).mockResolvedValueOnce([stored({ id: 'p5',
      body: 'Saved as an idea: "A made up idea about slow trains". The scorer picks it up next.',
      meta: { actions: [{ id: 'act-t', kind: 'idea', label: 'Undone.', state: 'undone', undo: false }], notes: [] } })])
    render(<Desk layout="phone" />)
    await screen.findByText('Back as it was.')
    expect(screen.queryByText(/The scorer picks it up next/)).toBeNull()
  })

  it('a held delete says before the tap that it cannot be undone', async () => {
    vi.mocked(api.readMessages).mockResolvedValueOnce([stored({ id: 'p6', body: '',
      meta: { actions: [{ id: 'act-d', kind: 'delete', label: 'Deleting "A made up post"', state: 'held', undo: false }], notes: [] } })])
    render(<Desk layout="phone" />)
    await screen.findByText("Deleting can't be undone.")
  })

  it('two look-alike held deletes show their whole openers and their own refs', async () => {
    const a = 'A made up post about trains. Line two. Line three. Line four ends with the ferry.'
    const b = 'A made up post about trains. Line two. Line three. Line four ends with the tram.'
    vi.mocked(api.readMessages).mockResolvedValueOnce([stored({ id: 'p7', body: '', meta: { notes: [], actions: [
      { id: 'act-a', kind: 'delete', label: `Proposed (ref 1a2b3c4d): delete "${a}" (no date).`, state: 'held', undo: false, target: { kind: 'draft', handle: '#target', first_line: a } },
      { id: 'act-b', kind: 'delete', label: `Proposed (ref 5e6f7a8b): delete "${b}" (no date).`, state: 'held', undo: false, target: { kind: 'draft', handle: '#target', first_line: b } },
    ] } })])
    render(<Desk layout="phone" />)
    await screen.findByText('ref 1a2b3c4d')
    expect(screen.getByText('ref 5e6f7a8b')).toBeTruthy()
    expect(screen.getByText(/ends with the ferry/)).toBeTruthy()
    expect(screen.getByText(/ends with the tram/)).toBeTruthy()
    expect(document.querySelectorAll('.dk-act-post-full')).toHaveLength(2)
    expect(screen.queryByText('#target')).toBeNull()
  })

  it('a reply that started before the desk opened and finished during the first read is announced', async () => {
    const started = new Date(Date.now() - 5000).toISOString()
    vi.mocked(api.readMessages).mockResolvedValueOnce([
      stored({ id: 'old1', body: 'An old answer.', created_at: '2026-11-17T09:00:00Z', updated_at: '2026-11-17T09:00:05Z' }),
      stored({ id: 'late1', body: 'A late answer.', created_at: started, updated_at: new Date(Date.now() + 1000).toISOString() }),
    ])
    const { container } = render(<Desk layout="phone" />)
    await screen.findByText('A late answer.')
    await waitFor(() => expect(container.querySelector('.dk-sr')!.textContent).toBe('The desk answered.'))
  })

  it('a cancelled proposal never keeps "It runs only when you tap Do it now" above its card', async () => {
    vi.mocked(api.readMessages).mockResolvedValueOnce([stored({ id: 'p2',
      body: 'Proposed (ref 1a2b3c4d): move "A made up post about trains." (no date) to Thu 26 Nov, 09:30 (UTC+01:00). It runs only when you tap Do it now.',
      meta: { actions: [{ id: 'act-q', kind: 'date', label: 'Cancelled. Nothing changed.', state: 'cancelled', undo: false }] } })])
    render(<Desk layout="phone" />)
    await screen.findByText('Nothing changed.')
    expect(screen.queryByText(/It runs only when you tap/)).toBeNull()
  })

  it('Retry waits while another turn runs', async () => {
    vi.mocked(api.readMessages).mockResolvedValueOnce([stored({ id: 'h4', body: 'Ready.' })])
    vi.mocked(api.sendDesk).mockImplementationOnce(async (_b, h) => { h.onError?.('offline', 'No connection. Your message is kept.'); return 'error' })
    render(<Desk layout="phone" />)
    await screen.findByText('Ready.')
    type('first try')
    const retry = await screen.findByText('Retry')
    expect((retry as HTMLButtonElement).disabled).toBe(false)
    type('second message')
    await waitFor(() => expect((screen.getByText('Retry') as HTMLButtonElement).disabled).toBe(true))
    await act(async () => { streamGate?.() })
    await waitFor(() => expect((screen.getByText('Retry') as HTMLButtonElement).disabled).toBe(false))
  })

  it('a change card shows the server sentence once, without a ref or a doubled state word', async () => {
    vi.mocked(api.readMessages).mockResolvedValueOnce([stored({ id: 'u1', body: '', meta: { actions: [{ id: 'act-u', kind: 'date', label: 'Undone.', state: 'undone', undo: false }] } })])
    render(<Desk layout="phone" />)
    await screen.findByText('Back as it was.')
    expect(screen.queryByText(/Undone: Undone/)).toBeNull()
  })
})
