// @vitest-environment jsdom
// The desk's races (Sol desk-ui r1 and r2, incl. the reviewer's r2 reproducers): Undo against a running commit,
// cache, a history snapshot older than a realtime row, a send dropped before its ack, and a
// failed answer that keeps its retry. Made-up rows only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DeskMessage } from './model'

const UID = '00000000-0000-4000-8000-000000000001'
const ops: { kind: string; id: string }[] = []
const sends: { text: string; client_key: string }[] = []
let uploadGate: Promise<void> | null = null
let cancelGate: Promise<void> | null = null
let finalGate: Promise<void> | null = null
let cancelAnswer: { ok: boolean; error?: string } = { ok: true }
let commitAnswer: { ok: boolean; error?: string } = { ok: true }
let readRows: () => Promise<DeskMessage[]> = async () => []
let realtime: ((m: DeskMessage) => void) | null = null
let sendMode: 'held' | 'drop-before-ack' | 'error-final' = 'held'

const row = (over: Partial<DeskMessage> & { id: string }): DeskMessage => ({
  role: 'assistant', origin: 'desk', body: '', status: 'done', meta: {}, client_key: null, created_at: new Date().toISOString(), ...over,
})

vi.mock('../../lib/swr', async orig => ({
  ...(await orig<typeof import('../../lib/swr')>()),
  currentUserId: () => UID,
}))
vi.mock('./api', () => ({
  readMessages: vi.fn(() => readRows()),
  readJobs: vi.fn(async () => []),
  warmDesk: vi.fn(async () => {}),
  subscribeDesk: vi.fn((_t: string, _u: string, on: { message: (m: DeskMessage) => void }) => { realtime = on.message; return () => {} }),
  uploadDeskPhoto: vi.fn(async () => { await uploadGate; return 'https://example.com/p.jpg' }),
  sendDesk: vi.fn(async (body: { text: string; client_key: string }, h: { onAck: (a: unknown) => void; onDelta: (t: string) => void; onFinal: (m: DeskMessage) => void; onError: (c: string, d?: string) => void }) => {
    sends.push(body)
    if (sendMode === 'drop-before-ack') return 'dropped'
    h.onAck({ user_message_id: `u-${body.client_key}`, client_key: body.client_key })
    if (sendMode === 'error-final') {
      h.onError('desk_llm_unavailable', 'The desk model did not answer.')
      h.onFinal(row({ id: `e-${body.client_key}`, status: 'error', body: 'The desk could not answer just now. Send it again in a moment.', meta: { error: 'desk_llm_unavailable', client_key: body.client_key } }))
      return 'error'
    }
    if (finalGate) await finalGate
    h.onFinal(row({ id: `a-${body.client_key}`, body: 'Approving it.', updated_at: '2026-11-18T12:00:01Z', meta: { actions: [{ id: 'act-live', kind: 'approve', label: 'Approve the trains post', state: 'held', undo: true, hold_ms: 8000 }] } }))
    return 'final'
  }),
  undoAction: vi.fn(async (id: string) => { ops.push({ kind: 'undo', id }); return { ok: true } }),
  commitAction: vi.fn(async (id: string) => { ops.push({ kind: 'commit', id }); return commitAnswer }),
  cancelAction: vi.fn(async (id: string) => { ops.push({ kind: 'cancel', id }); if (cancelGate) await cancelGate; return cancelAnswer }),
}))
vi.mock('../../exp/v2c/chat/useStt', () => ({
  useStt: () => ({ state: 'idle', elapsedMs: 0, note: null, supported: true, toggle: vi.fn(), clip: null, clearClip: vi.fn() }),
}))

const { Desk } = await import('./Desk')
const { resetActionGuards } = await import('./actionGuards')
const { resetLiveHolds } = await import('./useDesk')

beforeEach(() => {
  ops.length = 0; sends.length = 0; cancelGate = null; commitAnswer = { ok: true }
  readRows = async () => []; realtime = null; sendMode = 'held'; finalGate = null; uploadGate = null; cancelAnswer = { ok: true }
  localStorage.clear(); resetLiveHolds(); resetActionGuards()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

function type(text: string) {
  fireEvent.change(screen.getByLabelText('Message the desk'), { target: { value: text } })
  fireEvent.click(screen.getByLabelText('Send'))
}

describe('desk races', () => {
  it('#1 Undo disarms the hold at once: a slow cancel never lets the timer commit', async () => {
    render(<Desk layout="phone" />)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    type('approve the trains one')
    await waitFor(() => expect(document.querySelector('[data-state="held"]')?.textContent).toMatch(/in \d+s/))
    let release!: () => void
    cancelGate = new Promise<void>(r => { release = r })
    await act(async () => { vi.advanceTimersByTime(7500) })
    fireEvent.click(screen.getByText('Undo'))
    await act(async () => { vi.advanceTimersByTime(3000) })
    expect(ops).toEqual([{ kind: 'cancel', id: 'act-live' }])
    await act(async () => { release() })
    expect(ops.filter(o => o.kind === 'commit')).toHaveLength(0)
  })

  it('#1 a commit that lost the race reads back instead of showing an error', async () => {
    commitAnswer = { ok: false, error: 'not_held' }
    let reads = 0
    readRows = async () => { reads++; return [] }
    render(<Desk layout="phone" />)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    type('approve the trains one')
    await waitFor(() => expect(document.querySelector('[data-state="held"]')).toBeTruthy())
    const before = reads
    await act(async () => { vi.advanceTimersByTime(9000) })
    await waitFor(() => expect(ops).toEqual([{ kind: 'commit', id: 'act-live' }]))
    await waitFor(() => expect(reads).toBeGreaterThan(before))
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('#2 a hold restored from the saved copy never commits by itself; it waits for "Do it now"', async () => {
    localStorage.setItem(`swr1:${UID}:desk:messages:v1`, JSON.stringify({
      savedAt: new Date().toISOString(), user: UID,
      payload: [row({ id: 'old', body: 'Approving it.', created_at: new Date(Date.now() - 20_000).toISOString(),
        meta: { actions: [{ id: 'act-old', kind: 'approve', label: 'Approve the quiet post', state: 'held', undo: true, hold_ms: 8000 }] } })],
    }))
    readRows = () => new Promise(() => {}) // the live read never answers
    render(<Desk layout="phone" />)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await act(async () => { vi.advanceTimersByTime(20_000) })
    expect(ops).toEqual([])
    expect(screen.getByText(/Not done: Approve the quiet post/)).toBeTruthy()
    fireEvent.click(screen.getByText('Do it now'))
    await waitFor(() => expect(ops).toEqual([{ kind: 'commit', id: 'act-old' }]))
  })

  it('#3 a history snapshot older than a realtime row neither erases nor rolls it back', async () => {
    let answer!: (rows: DeskMessage[]) => void
    readRows = () => new Promise(r => { answer = r })
    render(<Desk layout="phone" />)
    await waitFor(() => expect(realtime).toBeTruthy())
    // While the read is in flight: a new proactive row, and a newer write of an existing row.
    await act(async () => {
      realtime!(row({ id: 'p1', origin: 'proactive', body: 'A made up week plan.', updated_at: '2026-11-18T12:00:05Z', created_at: '2026-11-18T12:00:05Z' }))
      realtime!(row({ id: 'x1', body: 'Newer text.', updated_at: '2026-11-18T12:00:04Z', created_at: '2026-11-18T11:00:00Z' }))
    })
    // The snapshot was taken before both: it lacks p1 and holds the older x1.
    await act(async () => { answer([row({ id: 'x1', body: 'Older text.', updated_at: '2026-11-18T12:00:00Z', created_at: '2026-11-18T11:00:00Z' })]) })
    expect(screen.getByText('A made up week plan.')).toBeTruthy()
    expect(screen.getByText('Newer text.')).toBeTruthy()
    expect(screen.queryByText('Older text.')).toBeNull()
  })

  it('#4 a send dropped before its ack, with no stored row, shows "Not sent" and a retry', async () => {
    sendMode = 'drop-before-ack'
    render(<Desk layout="phone" />)
    type('whats going out this week')
    await screen.findByText('Not sent', {}, { timeout: 3000 })
    expect(screen.queryByText('Sending')).toBeNull()
    sendMode = 'held'
    fireEvent.click(screen.getByText('Retry'))
    await waitFor(() => expect(sends).toHaveLength(2))
    expect(sends[1].text).toBe('whats going out this week')
    expect(sends[1].client_key).not.toBe(sends[0].client_key)
  })

  it('#5 a failed answer row keeps a retry tied to the send it failed', async () => {
    sendMode = 'error-final'
    render(<Desk layout="phone" />)
    type('how did the made up post do')
    await screen.findByText(/could not answer just now/)
    sendMode = 'held'
    fireEvent.click(screen.getByText('Try again'))
    await waitFor(() => expect(sends).toHaveLength(2))
    expect(sends[1].text).toBe('how did the made up post do')
    await waitFor(() => expect(screen.queryByText(/could not answer just now/)).toBeNull())
  })
})

describe('round 2 independent reproducers', () => {
  it('leaving during the hold disarms automatic commit on same-tab return', async () => {
    readRows = () => new Promise(() => {})
    const { unmount } = render(<Desk layout="phone" />)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    type('approve the trains one')
    await waitFor(() => expect(screen.getByText('Undo')).toBeTruthy())
    unmount()
    await act(async () => { vi.advanceTimersByTime(15000) })
    render(<Desk layout="phone" />)
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(ops).toEqual([])
  })

  it('a failed cancel offers a way to retry cancel without rearming commit', async () => {
    cancelAnswer = { ok: false, error: 'No connection.' }
    render(<Desk layout="phone" />)
    type('approve the trains one')
    fireEvent.click(await screen.findByText('Undo'))
    await screen.findByText('No connection.')
    expect(screen.queryByRole('button', { name: /undo|retry cancellation/i })).toBeTruthy()
  })

  it('a stale SSE final must not erase the newer realtime row from the in-flight history journal', async () => {
    let readDone!: (rows: DeskMessage[]) => void
    let finalDone!: () => void
    readRows = () => new Promise(r => { readDone = r })
    finalGate = new Promise(r => { finalDone = r })
    render(<Desk layout="phone" />)
    type('approve the trains one')
    const id = 'a-' + sends[0].client_key
    await act(async () => { realtime!(row({ id, body: 'Newer realtime answer.', updated_at: '2026-11-18T12:00:02Z' })) })
    await act(async () => { finalDone() })
    expect(screen.getByText('Newer realtime answer.')).toBeTruthy()
    await act(async () => { readDone([]) })
    expect(screen.queryByText('Newer realtime answer.')).toBeTruthy()
  })

  it('a pre-ack socket drop and failed history read leave a retry instead of Sending', async () => {
    sendMode = 'drop-before-ack'
    let reads = 0
    readRows = async () => { if (++reads > 1) throw Error('offline'); return [] }
    render(<Desk layout="phone" />)
    await screen.findByText(/Ask about this week/)
    type('whats going out this week')
    await screen.findByText(/Offline, showing the saved copy/)
    expect(screen.queryByText('Sending')).toBeNull()
    expect(screen.queryByText('Retry')).toBeTruthy()
  })

  it('does not erase text typed while a photo is uploading', async () => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:review-test' })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} })
    let uploadDone!: () => void
    uploadGate = new Promise(r => { uploadDone = r })
    const { container } = render(<Desk layout="phone" />)
    fireEvent.change(container.querySelector('[data-desk-photo]')!, {
      target: { files: [new File(['photo'], 'photo.png', { type: 'image/png' })] }
    })
    type('photo caption')
    await screen.findByText('Sending your photo')
    const input = screen.getByLabelText('Message the desk') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'my new draft' } })
    await act(async () => { uploadDone() })
    expect(sends[0].text).toBe('photo caption')
    expect(input.value).toBe('my new draft')
  })

  it('a stored failure whose question could not be saved has no inert retry button', async () => {
    readRows = async () => [row({
      id: 'orphan-error', status: 'error', body: 'Could not save the turn.',
      meta: { error: 'desk_failed', client_key: 'missing-question' },
    })]
    render(<Desk layout="phone" />)
    await screen.findByText('Could not save the turn.')
    expect(screen.queryByText('Try again')).toBeNull()
  })
})

it('does not auto-commit a hold whose final first arrived in the background', async () => {
  let visibility = 'hidden'
  const override = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility as DocumentVisibilityState)
  try {
    const { unmount } = render(<Desk layout="phone" />)
    await screen.findByText(/Ask about this week/)
    readRows = () => new Promise(() => {})
    vi.useFakeTimers({ shouldAdvanceTime: true })
    type('approve the trains one')
    await act(async () => { vi.advanceTimersByTime(5000) })
    visibility = 'visible'
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { vi.advanceTimersByTime(4000) })
    unmount()
    expect(ops).toEqual([])
  } finally {
    override.mockRestore()
  }
})

it('pins the latest line on resize only while the list is pinned', async () => {
  let resize!: () => void
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe() {}
    disconnect() {}
  })
  try {
    const { container } = render(<Desk layout="phone" />)
    await screen.findByText(/Ask about this week/)
    const list = container.querySelector('[data-desk-list]') as HTMLElement
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1200 })
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 530 })
    list.scrollTop = 450
    resize()
    expect(list.scrollTop).toBe(1200)
    list.scrollTop = 400
    fireEvent.scroll(list)
    resize()
    expect(list.scrollTop).toBe(400)
  } finally {
    vi.unstubAllGlobals()
  }
})

it('a network failure during manual commit leaves the held action explicitly retryable', async () => {
  commitAnswer = { ok: false, error: 'No connection.' }
  readRows = async () => [row({
    id: 'restored-held', meta: {
      actions: [{ id: 'remote-hold', kind: 'approve', label: 'Approve the quiet post', state: 'held', undo: false }],
    },
  })]
  render(<Desk layout="phone" />)
  fireEvent.click(await screen.findByText('Do it now'))
  await screen.findByText('No connection.')
  expect(screen.queryByText('Do it now')).toBeTruthy()
})
