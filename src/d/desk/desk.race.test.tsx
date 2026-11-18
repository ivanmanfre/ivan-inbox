// @vitest-environment jsdom
// The desk's races (Sol desk-ui r1-r3, incl. the reviewer's reproducers). Since r4 the SERVER commits a held
// action when its hold ends (content-desk 0d7edb6a); the browser never commits by itself. Undo against a running commit,
// holds restored from the cache, a history snapshot older than a realtime row, a send dropped before its ack, and a
// failed answer that keeps its retry. Made-up rows only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DeskMessage } from './model'

const UID = '00000000-0000-4000-8000-000000000001'
const ops: { kind: string; id: string }[] = []
const sends: { text: string; client_key: string }[] = []
let uploadGate: Promise<void> | null = null
let ackGate: Promise<void> | null = null
let cancelGate: Promise<void> | null = null
let finalGate: Promise<void> | null = null
let cancelAnswer: { ok: boolean; error?: string } = { ok: true }
let commitAnswer: { ok: boolean; error?: string } = { ok: true }
let readRows: () => Promise<DeskMessage[]> = async () => []
let realtime: ((m: DeskMessage) => void) | null = null
let sendMode: 'held' | 'drop-before-ack' | 'error-final' | 'offline' | 'in-progress' | 'key-reused' = 'held'
// B11: what the stored error answer says the failed turn did (undefined = an older row without it).
let errorSideEffects: 'none' | 'some' | 'unknown' | undefined = 'none'

const row = (over: Partial<DeskMessage> & { id: string }): DeskMessage => ({
  role: 'assistant', origin: 'desk', body: '', status: 'done', meta: {}, client_key: null, created_at: new Date().toISOString(), ...over,
})

// held_seen: the server arms a hold when its row is first visibly on screen (made-up answers).
const seenCalls: string[][] = []
let heldSeenOk = true
let heldSeenEntry: ((id: string, at: number) => Record<string, unknown>) | null = null
let heldSeenGate: Promise<void> | null = null
function heldSeenAnswer(ids: string[]) {
  seenCalls.push(ids)
  if (heldSeenEntry) { const res = ids.map(id => ({ id, ...heldSeenEntry!(id, Date.now()) })); return { ok: res.every(x => !('error' in x)), results: res } }
  const at = Date.now()
  return heldSeenOk
    ? { ok: true, results: ids.map(id => ({ id, state: 'held', seen_at: new Date(at).toISOString(), hold_until: new Date(at + 8000).toISOString() })) }
    : { ok: false, error: 'No connection.' }
}

vi.mock('../../lib/swr', async orig => ({
  ...(await orig<typeof import('../../lib/swr')>()),
  currentUserId: () => UID,
}))
vi.mock('./api', () => ({
  readMessages: vi.fn(() => readRows()),
  readJobs: vi.fn(async () => []),
  warmDesk: vi.fn(async () => {}),
  markHeldSeen: vi.fn(async (ids: string[]) => { if (heldSeenGate) await heldSeenGate; return heldSeenAnswer(ids) }),
  subscribeDesk: vi.fn((_t: string, _u: string, on: { message: (m: DeskMessage) => void }) => { realtime = on.message; return () => {} }),
  uploadDeskPhoto: vi.fn(async () => { await uploadGate; return 'https://example.com/p.jpg' }),
  sendDesk: vi.fn(async (body: { text: string; client_key: string }, h: { onAck: (a: unknown) => void; onDelta: (t: string) => void; onFinal: (m: DeskMessage) => void; onError: (c: string, d?: string) => void }) => {
    sends.push(body)
    if (sendMode === 'drop-before-ack') return 'dropped'
    if (sendMode === 'offline') { h.onError('offline', 'No connection. Your message is kept.'); return 'error' }
    if (sendMode === 'key-reused') { h.onError('key_mismatch', 'That message id was already used for a different message.'); return 'error' }
    if (ackGate) await ackGate
    h.onAck({ user_message_id: `u-${body.client_key}`, client_key: body.client_key })
    if (sendMode === 'in-progress') { h.onError('turn_in_progress', 'That message is still being answered.'); return 'error' }
    if (sendMode === 'error-final') {
      h.onError('desk_llm_unavailable', 'The desk model did not answer.')
      h.onFinal(row({ id: `e-${body.client_key}`, status: 'error', body: 'The desk could not answer just now. Send it again in a moment.', meta: { error: 'desk_llm_unavailable', client_key: body.client_key, reply_to: `u-${body.client_key}`, ...(errorSideEffects ? { side_effects: errorSideEffects } : {}) } }))
      return 'error'
    }
    if (finalGate) await finalGate
    h.onFinal(row({ id: `a-${body.client_key}`, body: 'Approving it.', updated_at: '2026-11-18T12:00:01Z', meta: { client_key: body.client_key, reply_to: `u-${body.client_key}`, actions: [{ id: 'act-live', kind: 'approve', label: 'Approve the trains post', state: 'held', undo: true, hold_ms: 8000 }] } }))
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
const { resetHeldSeen } = await import('./heldSeen')
const { installVisibility, removeVisibility, setVisibleRatio, setCovered, setRatioQuiet, queueStaleEntry, discardedRecords } = await import('./testVisibility')
const { resetActionGuards } = await import('./actionGuards')
const { resetLiveHolds } = await import('./useDesk')

beforeEach(() => {
  ops.length = 0; sends.length = 0; cancelGate = null; commitAnswer = { ok: true }
  readRows = async () => []; realtime = null; sendMode = 'held'; errorSideEffects = 'none'; finalGate = null; uploadGate = null; ackGate = null; cancelAnswer = { ok: true }
  localStorage.clear(); resetLiveHolds(); resetActionGuards(); resetHeldSeen(); seenCalls.length = 0; heldSeenOk = true; heldSeenEntry = null; heldSeenGate = null; installVisibility()
})
afterEach(() => { cleanup(); vi.useRealTimers(); removeVisibility() })

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

  it('#1 a "Do it now" that lost the race to the server reads back instead of showing an error', async () => {
    commitAnswer = { ok: false, error: 'not_held' }
    let reads = 0
    readRows = async () => { reads++; return [row({ id: 'restored', meta: { actions: [{ id: 'act-r', kind: 'approve', label: 'Approve the quiet post', state: 'held', undo: false }] } })] }
    render(<Desk layout="phone" />)
    fireEvent.click(await screen.findByText('Do it now'))
    const before = reads
    await waitFor(() => expect(ops).toEqual([{ kind: 'commit', id: 'act-r' }]))
    await waitFor(() => expect(reads).toBeGreaterThan(before))
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('#1 the browser never commits a live hold by itself: the countdown ends and the server commits', async () => {
    render(<Desk layout="phone" />)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    type('approve the trains one')
    await waitFor(() => expect(document.querySelector('[data-state="held"]')?.textContent).toMatch(/in \d+s/))
    await act(async () => { vi.advanceTimersByTime(30_000) })
    expect(ops).toEqual([])
  })

  it('#2 a hold restored from the saved copy never commits in the browser; "Do it now" commits it early', async () => {
    localStorage.setItem(`swr1:${UID}:desk:messages:v1`, JSON.stringify({
      savedAt: new Date().toISOString(), user: UID,
      payload: [row({ id: 'old', body: 'Approving it.', created_at: new Date(Date.now() - 20_000).toISOString(),
        meta: { actions: [{ id: 'act-old', kind: 'approve', label: 'Approve the quiet post', state: 'held', undo: true, hold_ms: 8000 }] } })],
    }))
    readRows = () => new Promise(() => {}) // the live read never answers
    render(<Desk layout="phone" />)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await act(async () => { vi.advanceTimersByTime(20_000) })
    // Seen on screen: the server was told (held_seen) and arms its own timer; the browser commits nothing.
    expect(seenCalls).toEqual([['act-old']])
    expect(ops).toEqual([])
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

  it('#4 a send dropped before its ack, with an empty read, stays unconfirmed (never "Not sent") and retries under its key', async () => {
    sendMode = 'drop-before-ack'
    render(<Desk layout="phone" />)
    type('whats going out this week')
    // r4 #2: the request may still be on its way, so an empty read does not call it failed.
    await screen.findByText('Not confirmed yet.', {}, { timeout: 3000 })
    expect(screen.queryByText('Not sent')).toBeNull()
    expect(screen.queryByText('Sending')).toBeNull()
    expect(screen.getByText('Check again')).toBeTruthy()
    sendMode = 'held'
    fireEvent.click(screen.getByText('Retry'))
    await waitFor(() => expect(sends).toHaveLength(2))
    expect(sends[1].text).toBe('whats going out this week')
    // r4 #2: an unsent message retries under its ORIGINAL key (the server answers a known key idempotently).
    expect(sends[1].client_key).toBe(sends[0].client_key)
  })

  it('#5 a failed answer row is tied to the send it failed: Edit and send puts that text in the composer, sends nothing', async () => {
    sendMode = 'error-final'
    render(<Desk layout="phone" />)
    type('how did the made up post do')
    await screen.findByText(/could not answer just now/)
    sendMode = 'held'
    fireEvent.click(screen.getByText('Edit and send'))
    expect((screen.getByLabelText('Message the desk') as HTMLTextAreaElement).value).toBe('how did the made up post do')
    await act(async () => {})
    expect(sends).toHaveLength(1)
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

  it('a failed cancel offers a way to retry cancel without rearming commit (after the row is read back)', async () => {
    cancelAnswer = { ok: false, error: 'No connection.' }
    render(<Desk layout="phone" />)
    type('approve the trains one')
    const answer = row({ id: 'a-' + sends[0].client_key, body: 'Approving it.', meta: { actions: [{ id: 'act-live', kind: 'approve', label: 'Approve the trains post', state: 'held', undo: true, hold_ms: 8000 }] } })
    readRows = async () => [answer] // the server still holds it
    fireEvent.click(await screen.findByText('Undo'))
    await screen.findByText('No connection.')
    await waitFor(() => expect(screen.queryByRole('button', { name: /undo|retry cancellation/i })).toBeTruthy())
    expect(ops.filter(o => o.kind === 'commit')).toHaveLength(0)
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

  it('a pre-ack socket drop and failed history read leave "Check again", and Retry reuses the original key', async () => {
    sendMode = 'drop-before-ack'
    let reads = 0
    readRows = async () => { if (++reads > 1) throw Error('offline'); return [] }
    render(<Desk layout="phone" />)
    await screen.findByText(/Ask about this week/)
    type('whats going out this week')
    await screen.findByText(/Offline, showing the saved copy/)
    expect(screen.queryByText('Sending')).toBeNull()
    expect(screen.queryByText('Check again')).toBeTruthy()
    fireEvent.click(screen.getByText('Retry'))
    await waitFor(() => expect(sends).toHaveLength(2))
    expect(sends[1].client_key).toBe(sends[0].client_key)
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

it('r3 review (server-commit design): expiry, then a hide and a show, never makes the browser commit', async () => {
  let visibility: DocumentVisibilityState = 'visible'
  let now = Date.now()
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
  const override = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  try {
    render(<Desk layout="phone" />)
    await screen.findByText(/Ask about this week/)
    readRows = () => new Promise(() => {})
    type('approve the trains one')
    await screen.findByText('Undo')
    now += 9000
    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(screen.getByText(/Doing it: Approve the trains post/)).toBeTruthy())
    expect(ops).toEqual([])
    // Past the grace with no server answer, the row offers the explicit tap.
    now += 5000
    await waitFor(() => expect(screen.getByText('Do it now')).toBeTruthy())
    expect(ops).toEqual([])
  } finally {
    clock.mockRestore()
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

it('r3 review: a failed cancel after remount leaves Undo retry available', async () => {
  let release!: () => void
  cancelGate = new Promise(r => { release = r })
  cancelAnswer = { ok: false, error: 'No connection.' }
  const first = render(<Desk layout="phone" />)
  await screen.findByText(/Ask about this week/)
  type('approve the trains one')
  fireEvent.click(await screen.findByText('Undo'))
  expect(screen.getByText('Cancelling: Approve the trains post')).toBeTruthy()
  first.unmount()
  readRows = async () => [row({ id: 'a-' + sends[0].client_key, body: 'Approving it.', meta: {
    actions: [{ id: 'act-live', kind: 'approve', label: 'Approve the trains post', state: 'held', undo: true, hold_ms: 8000 }],
  } })]
  render(<Desk layout="phone" />)
  await screen.findByText('Knows your week, drafts and calls')
  expect(screen.getByText('Cancelling: Approve the trains post')).toBeTruthy()
  await act(async () => { release() })
  await waitFor(() => expect(screen.queryByText('Try Undo again')).toBeTruthy())
})

it('r3 review: an unconfirmed write cannot resend under a fresh key', async () => {
  sendMode = 'drop-before-ack'
  let reads = 0
  readRows = async () => { if (++reads > 1) throw Error('offline'); return [] }
  render(<Desk layout="phone" />)
  await screen.findByText(/Ask about this week/)
  type('approve the trains one')
  const original = sends[0].client_key
  await screen.findByText(/Not confirmed/)
  const retry = screen.queryByRole('button', { name: 'Retry' })
  if (retry) fireEvent.click(retry)
  expect(sends.filter(s => s.client_key !== original)).toEqual([])
})

it('r3 review: the same text re-entered during upload is a new draft', async () => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:review-test' })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} })
  let release!: () => void
  uploadGate = new Promise(r => { release = r })
  const { container } = render(<Desk layout="phone" />)
  fireEvent.change(container.querySelector('[data-desk-photo]')!, {
    target: { files: [new File(['photo'], 'photo.png', { type: 'image/png' })] },
  })
  type('look at this')
  await screen.findByText('Sending your photo')
  const field = screen.getByLabelText('Message the desk') as HTMLTextAreaElement
  fireEvent.change(field, { target: { value: '' } })
  fireEvent.change(field, { target: { value: 'look at this' } })
  await act(async () => { release() })
  expect(sends[0].text).toBe('look at this')
  expect(field.value).toBe('look at this')
})

it('r3 review: an old read preserves an ack and final batched together', async () => {
  let readDone!: (rows: DeskMessage[]) => void
  let streamDone!: () => void
  readRows = () => new Promise(r => { readDone = r })
  ackGate = new Promise(r => { streamDone = r })
  render(<Desk layout="phone" />)
  type('approve the trains one')
  await act(async () => { streamDone(); readDone([]) })
  expect(screen.queryByText('Approving it.')).toBeTruthy()
  expect(screen.queryByText('approve the trains one')).toBeTruthy()
})

it('r3 review: hiding an active countdown leaves the hold manual when the page returns', async () => {
  let visibility: DocumentVisibilityState = 'visible'
  const override = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  try {
    render(<Desk layout="phone" />)
    await screen.findByText(/Ask about this week/)
    readRows = () => new Promise(() => {})
    vi.useFakeTimers({ shouldAdvanceTime: true })
    type('approve the trains one')
    await waitFor(() => expect(screen.getByText('Undo')).toBeTruthy())
    await act(async () => {
      vi.advanceTimersByTime(7500)
      visibility = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(async () => {
      visibility = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
      vi.advanceTimersByTime(1500)
    })
    expect(ops).toEqual([])
    expect(screen.getByText(/Doing it: Approve the trains post/)).toBeTruthy()
  } finally {
    override.mockRestore()
  }
})


describe('round 4', () => {
  it('r4 #1: a held row seen later (reopened desk) offers Undo as well as Do it now', async () => {
    readRows = async () => [row({ id: 'reopened', meta: { actions: [{ id: 'act-re', kind: 'approve', label: 'Approve the quiet post', state: 'held', undo: false }] } })]
    render(<Desk layout="phone" />)
    await screen.findByText('Do it now')
    fireEvent.click(screen.getByText('Undo'))
    await waitFor(() => expect(ops).toEqual([{ kind: 'cancel', id: 'act-re' }]))
  })

  it('r4 #2: a connection lost before any answer is unconfirmed, and Retry reuses the original key', async () => {
    sendMode = 'offline'
    render(<Desk layout="phone" />)
    await screen.findByText(/Ask about this week/)
    type('whats going out this week')
    await screen.findByText(/Not confirmed: the connection dropped/)
    expect(screen.getByText('Check again')).toBeTruthy()
    sendMode = 'held'
    fireEvent.click(screen.getByText('Retry'))
    await waitFor(() => expect(sends).toHaveLength(2))
    expect(sends[1].client_key).toBe(sends[0].client_key)
  })

  it('r4 #2: a turn still being answered says so and offers Check again', async () => {
    sendMode = 'in-progress'
    render(<Desk layout="phone" />)
    await screen.findByText(/Ask about this week/)
    type('whats going out this week')
    await screen.findByText('Still working, check again.')
    expect(screen.getByText('Check again')).toBeTruthy()
    expect(document.querySelector('[data-streaming]')).toBeNull()
  })

  it('r6 #2: a refused key (key_mismatch) is never resent: Check again and Edit and send only; only Ivan\'s own Send makes a new key', async () => {
    sendMode = 'key-reused'
    render(<Desk layout="phone" />)
    await screen.findByText(/Ask about this week/)
    type('whats going out this week')
    await screen.findByText(/Not sent: this text does not match/)
    expect(screen.queryByText('Retry')).toBeNull()
    expect(screen.getByText('Check again')).toBeTruthy()
    sendMode = 'held'
    fireEvent.click(screen.getByText('Edit and send'))
    await act(async () => {})
    expect(sends).toHaveLength(1)
    expect((screen.getByLabelText('Message the desk') as HTMLTextAreaElement).value).toBe('whats going out this week')
    fireEvent.click(screen.getByLabelText('Send'))
    await waitFor(() => expect(sends).toHaveLength(2))
    expect(sends[1].client_key).not.toBe(sends[0].client_key)
  })

  it('r6 #3: a stored error with side_effects "none" offers no automatic rerun either, only Check again and Edit and send', async () => {
    sendMode = 'error-final'
    render(<Desk layout="phone" />)
    type('how did the made up post do')
    await screen.findByText(/could not answer just now/)
    expect(screen.getByText('Nothing was changed.')).toBeTruthy()
    expect(screen.queryByText('Try again')).toBeNull()
    expect(screen.queryByText('Retry')).toBeNull()
    fireEvent.click(screen.getByText('Check again'))
    fireEvent.click(screen.getByText('Edit and send'))
    await act(async () => {})
    expect(sends).toHaveLength(1)
  })

  it('r4 #3: a timed-out cancel clears the in-flight state, reads the row back, then offers Undo again', async () => {
    cancelAnswer = { ok: false, error: 'timeout' }
    render(<Desk layout="phone" />)
    type('approve the trains one')
    const answer = row({ id: 'a-' + sends[0].client_key, body: 'Approving it.', meta: { actions: [{ id: 'act-live', kind: 'approve', label: 'Approve the trains post', state: 'held', undo: true, hold_ms: 8000 }] } })
    let reads = 0
    readRows = async () => { reads++; return [answer] }
    fireEvent.click(await screen.findByText('Undo'))
    await screen.findByText(/No answer from the desk/)
    await waitFor(() => expect(reads).toBeGreaterThan(0))
    await waitFor(() => expect(screen.getByText('Try Undo again')).toBeTruthy())
    expect(screen.queryByText(/Cancelling/)).toBeNull()
  })
})


describe('held_seen (the server arms a hold when Ivan can first see it)', () => {
  it('a live hold is reported once when its row is visibly rendered, and the countdown starts then', async () => {
    render(<Desk layout="phone" />)
    type('approve the trains one')
    await waitFor(() => expect(document.querySelector('[data-seen="armed"]')).toBeTruthy())
    expect(seenCalls).toEqual([['act-live']])
    expect(document.querySelector('[data-state="held"]')?.textContent).toMatch(/in [1-8]s/)
  })

  it('a hold rendered while the tab is hidden is reported only once the tab is visible', async () => {
    let visibility: DocumentVisibilityState = 'hidden'
    const override = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    try {
      render(<Desk layout="phone" />)
      type('approve the trains one')
      await screen.findByText(/Approving it\./)
      await act(async () => {})
      expect(seenCalls).toEqual([])
      visibility = 'visible'
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
      await waitFor(() => expect(seenCalls).toEqual([['act-live']]))
    } finally {
      override.mockRestore()
    }
  })

  it('a reopened desk does not report the same hold twice', async () => {
    const first = render(<Desk layout="phone" />)
    type('approve the trains one')
    await waitFor(() => expect(seenCalls).toHaveLength(1))
    first.unmount()
    readRows = async () => [row({ id: 'a-' + sends[0].client_key, body: 'Approving it.', meta: { actions: [{ id: 'act-live', kind: 'approve', label: 'Approve the trains post', state: 'held', undo: true, hold_ms: 8000 }] } })]
    render(<Desk layout="phone" />)
    await screen.findByText(/Approving it\./)
    await act(async () => {})
    expect(seenCalls).toHaveLength(1)
  })

  it('if held_seen fails, the row shows no countdown and keeps Undo and Do it now', async () => {
    heldSeenOk = false
    render(<Desk layout="phone" />)
    type('approve the trains one')
    await waitFor(() => expect(document.querySelector('[data-seen="failed"]')).toBeTruthy())
    expect(document.querySelector('.dk-count')).toBeNull()
    expect(screen.getByText('Undo')).toBeTruthy()
    expect(screen.getByText('Do it now')).toBeTruthy()
    expect(ops).toEqual([])
  })
})


describe('held_seen answers (server r3: per id {state, seen_at, hold_until} or {error})', () => {
  it('the countdown runs to the server hold_until, not a fresh local 8 s', async () => {
    heldSeenEntry = (_id, at) => ({ state: 'held', seen_at: new Date(at - 6000).toISOString(), hold_until: new Date(at + 2500).toISOString() })
    render(<Desk layout="phone" />)
    type('approve the trains one')
    await waitFor(() => expect(document.querySelector('[data-seen="armed"]')).toBeTruthy())
    expect(document.querySelector('.dk-count')?.textContent).toMatch(/^[1-3]s$/)
  })

  it('a per-id error shows no countdown and keeps Undo and Do it now', async () => {
    heldSeenEntry = () => ({ error: 'not_found' })
    render(<Desk layout="phone" />)
    type('approve the trains one')
    await waitFor(() => expect(document.querySelector('[data-seen="failed"]')).toBeTruthy())
    expect(document.querySelector('.dk-count')).toBeNull()
    expect(screen.getByText('Undo')).toBeTruthy()
    expect(screen.getByText('Do it now')).toBeTruthy()
  })

  it('a row the server already settled is read back', async () => {
    heldSeenEntry = (_id, at) => ({ state: 'done', seen_at: new Date(at - 20000).toISOString(), hold_until: new Date(at - 12000).toISOString() })
    let release!: () => void
    heldSeenGate = new Promise(r => { release = r })
    let reads = 0
    let stored: DeskMessage[] = []
    readRows = async () => { reads++; return stored }
    render(<Desk layout="phone" />)
    type('approve the trains one')
    await waitFor(() => expect(document.querySelector('[data-seen="pending"]')).toBeTruthy())
    await act(async () => {})
    // The server committed it before the row was seen: the stored row now says done.
    stored = [row({ id: 'a-' + sends[0].client_key, body: 'Approving it.', meta: { actions: [{ id: 'act-live', kind: 'approve', label: 'Approve the trains post', state: 'done', undo: true }] } })]
    const before = reads
    await act(async () => { release() })
    await waitFor(() => expect(reads).toBeGreaterThan(before))
    await screen.findByText('Done: Approve the trains post')
    expect(screen.queryByText('Do it now')).toBeNull()
    expect(ops).toEqual([])
  })
})


describe('round 5 (Sol desk-ui r4 follow-ups)', () => {
  it('r4 #3: a cancel left unanswered while the desk is reopened ends on its timeout and reads back in the OPEN desk', async () => {
    let release!: () => void
    cancelGate = new Promise(r => { release = r })
    cancelAnswer = { ok: false, error: 'timeout' } // what the bounded op returns after 15 s with no answer
    const first = render(<Desk layout="phone" />)
    await screen.findByText(/Ask about this week/)
    type('approve the trains one')
    fireEvent.click(await screen.findByText('Undo'))
    first.unmount()
    let reads = 0
    readRows = async () => { reads++; return [row({ id: 'a-' + sends[0].client_key, body: 'Approving it.', meta: {
      actions: [{ id: 'act-live', kind: 'approve', label: 'Approve the trains post', state: 'held', undo: true, hold_ms: 8000 }],
    } })] }
    render(<Desk layout="phone" />)
    await screen.findByText('Cancelling: Approve the trains post')
    const before = reads
    await act(async () => { release() })
    await waitFor(() => expect(reads).toBeGreaterThan(before)) // read back by the reopened desk
    await waitFor(() => expect(screen.getByText('Try Undo again')).toBeTruthy())
    expect(screen.queryByText(/Cancelling/)).toBeNull()
    expect(screen.getByText('No answer from the desk.')).toBeTruthy()
  })

  it('r4 #3: if the read-back shows the server already cancelled it, no action and no stale error is offered', async () => {
    cancelAnswer = { ok: false, error: 'timeout' }
    render(<Desk layout="phone" />)
    type('approve the trains one')
    readRows = async () => [row({ id: 'a-' + sends[0].client_key, body: 'Approving it.', meta: {
      actions: [{ id: 'act-live', kind: 'approve', label: 'Approve the trains post', state: 'cancelled', undo: false }],
    } })]
    fireEvent.click(await screen.findByText('Undo'))
    await screen.findByText('Cancelled: Approve the trains post')
    expect(screen.queryByText('Undo')).toBeNull()
    expect(screen.queryByText('Do it now')).toBeNull()
    expect(screen.queryByText('No answer from the desk.')).toBeNull()
  })

  it('r4 #2: a retry under the original key shows the stored answer once (the server replays it, nothing runs twice)', async () => {
    sendMode = 'offline'
    render(<Desk layout="phone" />)
    await screen.findByText(/Ask about this week/)
    type('whats going out this week')
    await screen.findByText(/Not confirmed: the connection dropped/)
    sendMode = 'held'
    fireEvent.click(screen.getByText('Retry'))
    await screen.findByText(/Approving it\./)
    expect(sends.map(x => x.client_key)).toEqual([sends[0].client_key, sends[0].client_key])
    expect(screen.getAllByText(/Approving it\./)).toHaveLength(1)
    expect(screen.queryByText('Retry')).toBeNull()
  })

  it('held_seen: more than 10 held rows are sent in calls of at most 10 ids, each row answered', async () => {
    const actions = Array.from({ length: 12 }, (_, i) => ({ id: `act-${i}`, kind: 'approve', label: `Approve post ${i}`, state: 'held' as const, undo: true, hold_ms: 8000 }))
    readRows = async () => [row({ id: 'many', body: 'Approving them.', meta: { actions } })]
    render(<Desk layout="phone" />)
    await waitFor(() => expect(document.querySelectorAll('[data-seen="armed"]')).toHaveLength(12))
    expect(seenCalls.map(c => c.length)).toEqual([10, 2])
    expect(screen.getAllByText('Undo')).toHaveLength(12)
  })
})

it('held_seen: a failed report is sent again when the tab returns, and the countdown then starts', async () => {
  heldSeenOk = false
  render(<Desk layout="phone" />)
  type('approve the trains one')
  await waitFor(() => expect(document.querySelector('[data-seen="failed"]')).toBeTruthy())
  expect(document.querySelector('.dk-count')).toBeNull()
  heldSeenOk = true
  // the return to the app also re-reads; the server still holds the row
  readRows = async () => [row({ id: 'a-' + sends[0].client_key, body: 'Approving it.', meta: { actions: [{ id: 'act-live', kind: 'approve', label: 'Approve the trains post', state: 'held', undo: true, hold_ms: 8000 }] } })]
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  await waitFor(() => expect(document.querySelector('[data-seen="armed"]')).toBeTruthy())
  expect(seenCalls).toEqual([['act-live'], ['act-live']])
  expect(document.querySelector('.dk-count')).toBeTruthy()
  expect(ops).toEqual([])
})


describe('round 6 (Sol desk-ui r5 U1-U4, backend B11 on the client)', () => {
  it('U1: a clipped Undo (part of the button off screen) is not reported seen; once fully visible it is', async () => {
    render(<Desk layout="phone" />)
    setVisibleRatio(0.5)
    type('approve the trains one')
    await screen.findByText(/Approving it\./)
    await act(async () => { setVisibleRatio(0.5) })
    expect(seenCalls).toEqual([])
    expect(document.querySelector('.dk-count')).toBeNull()
    expect(screen.getByText('Undo')).toBeTruthy()
    await act(async () => { setVisibleRatio(1) })
    await waitFor(() => expect(seenCalls).toEqual([['act-live']]))
  })

  it('U1: an Undo covered by something else is not reported seen', async () => {
    setCovered(true)
    render(<Desk layout="phone" />)
    type('approve the trains one')
    await screen.findByText(/Approving it\./)
    await act(async () => { setVisibleRatio(1) })
    expect(seenCalls).toEqual([])
    setCovered(false)
    await act(async () => { setVisibleRatio(1) })
    await waitFor(() => expect(seenCalls).toEqual([['act-live']]))
  })

  it('U1: without IntersectionObserver held_seen is never sent; the hold stays manual', async () => {
    removeVisibility()
    render(<Desk layout="phone" />)
    type('approve the trains one')
    await screen.findByText(/Approving it\./)
    // a return to the tab (which re-reads; the server still holds the row) does not send it either
    readRows = async () => [row({ id: 'a-' + sends[0].client_key, body: 'Approving it.', meta: { client_key: sends[0].client_key, actions: [{ id: 'act-live', kind: 'approve', label: 'Approve the trains post', state: 'held', undo: true, hold_ms: 8000 }] } })]
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await screen.findByText('Undo')
    expect(seenCalls).toEqual([])
    expect(document.querySelector('.dk-count')).toBeNull()
    expect(screen.getByText('Undo')).toBeTruthy()
    expect(screen.getByText('Do it now')).toBeTruthy()
    expect(ops).toEqual([])
  })

  it('U2: a failed cancel shows "Try Undo again" at once, even while the read-back hangs', async () => {
    render(<Desk layout="phone" />)
    type('approve the trains one')
    await screen.findByText('Undo')
    cancelAnswer = { ok: false, error: 'No connection.' }
    readRows = () => new Promise(() => {}) // the history read never answers
    fireEvent.click(screen.getByText('Undo'))
    await screen.findByText('Try Undo again')
    expect(screen.queryByText(/Cancelling/)).toBeNull()
    cancelAnswer = { ok: true }
    fireEvent.click(screen.getByText('Try Undo again'))
    await waitFor(() => expect(ops.filter(o => o.kind === 'cancel')).toHaveLength(2))
    expect(ops.filter(o => o.kind === 'commit')).toHaveLength(0)
  })

  it('U3: a stored error that may have done something offers only Check again, never a new run', async () => {
    errorSideEffects = 'some'
    sendMode = 'error-final'
    render(<Desk layout="phone" />)
    type('how did the made up post do')
    await screen.findByText(/could not answer just now/)
    expect(screen.queryByText('Try again')).toBeNull()
    expect(screen.getByText('Check Review before repeating.')).toBeTruthy()
    let reads = 0
    readRows = async () => { reads++; return [] }
    fireEvent.click(screen.getByText('Check again'))
    await waitFor(() => expect(reads).toBeGreaterThan(0))
    expect(sends).toHaveLength(1)
  })

  it('U3: a stored error without side_effects (unknown) is treated the same: no Try again', async () => {
    errorSideEffects = undefined
    sendMode = 'error-final'
    render(<Desk layout="phone" />)
    type('how did the made up post do')
    await screen.findByText(/could not answer just now/)
    expect(screen.queryByText('Try again')).toBeNull()
    expect(screen.getByText('Check again')).toBeTruthy()
  })

  it('U3: side_effects "unknown" offers only Check again too', async () => {
    errorSideEffects = 'unknown'
    sendMode = 'error-final'
    render(<Desk layout="phone" />)
    type('how did the made up post do')
    await screen.findByText(/could not answer just now/)
    expect(screen.queryByText('Try again')).toBeNull()
  })

  it('U4: a read that finds the stored question without its answer keeps Check again and a same-key Retry', async () => {
    sendMode = 'drop-before-ack'
    render(<Desk layout="phone" />)
    await screen.findByText(/Ask about this week/)
    readRows = async () => [row({ id: 'u-stored', role: 'user', origin: 'operator', body: 'whats going out this week', client_key: sends[0].client_key })]
    type('whats going out this week')
    await screen.findByText('No answer yet.', {}, { timeout: 3000 })
    expect(screen.getByText('Check again')).toBeTruthy()
    sendMode = 'held'
    fireEvent.click(screen.getByText('Retry'))
    await waitFor(() => expect(sends).toHaveLength(2))
    expect(sends[1].client_key).toBe(sends[0].client_key)
    await screen.findByText(/Approving it\./)
    expect(screen.queryByText('No answer yet.')).toBeNull()
    expect(screen.queryByText('Retry')).toBeNull()
  })

  it('U4: the wait ends when the answer arrives by realtime', async () => {
    sendMode = 'drop-before-ack'
    render(<Desk layout="phone" />)
    await screen.findByText(/Ask about this week/)
    type('whats going out this week')
    const key = sends[0].client_key
    readRows = async () => [row({ id: 'u-stored', role: 'user', origin: 'operator', body: 'whats going out this week', client_key: key })]
    await screen.findByText('No answer yet.', {}, { timeout: 3000 })
    await act(async () => { realtime?.(row({ id: 'late-answer', body: 'Four posts are out this week.', meta: { client_key: key, reply_to: 'u-stored' }, created_at: new Date(Date.now() + 1000).toISOString() })) })
    await screen.findByText('Four posts are out this week.')
    expect(screen.queryByText('No answer yet.')).toBeNull()
    expect(screen.queryByText('Retry')).toBeNull()
  })
})


describe('round 7 (Sol desk-ui r6 #1-#4)', () => {
  const heldRow = () => row({ id: 'a-' + sends[0].client_key, body: 'Approving it.', meta: { client_key: sends[0].client_key, actions: [{ id: 'act-live', kind: 'approve', label: 'Approve the trains post', state: 'held', undo: true, hold_ms: 8000 }] } })

  it('r6 #1: after an Undo tap no held_seen is ever sent for that id, across a remount, and the row keeps "Try Undo again"', async () => {
    heldSeenOk = false
    const first = render(<Desk layout="phone" />)
    type('approve the trains one')
    await waitFor(() => expect(document.querySelector('[data-seen="failed"]')).toBeTruthy())
    cancelAnswer = { ok: false, error: 'No connection.' }
    heldSeenOk = true
    fireEvent.click(screen.getByText('Undo'))
    await screen.findByText('Try Undo again')
    expect(JSON.parse(sessionStorage.getItem('desk:undo-tapped:v1') ?? '[]')).toEqual(['act-live'])
    first.unmount()
    readRows = async () => [heldRow()]
    render(<Desk layout="phone" />)
    await screen.findByText('Try Undo again')
    await act(async () => { setVisibleRatio(1); document.dispatchEvent(new Event('visibilitychange')) })
    expect(seenCalls).toEqual([['act-live']]) // only the one before the tap
    expect(document.querySelector('.dk-count')).toBeNull()
  })

  it('r6 #1: a successful cancel that the server has not settled yet still says "Try Undo again" and never reports seen', async () => {
    render(<Desk layout="phone" />)
    type('approve the trains one')
    await waitFor(() => expect(seenCalls).toHaveLength(1))
    resetHeldSeen() // as if the first report never happened in this tab
    seenCalls.length = 0
    fireEvent.click(screen.getByText('Undo'))
    await screen.findByText('Try Undo again')
    await act(async () => { setVisibleRatio(1) })
    expect(seenCalls).toEqual([])
  })

  it('r6 #1: a tapped Undo kept in sessionStorage is honoured by a fresh module load (a reloaded tab)', async () => {
    sessionStorage.setItem('desk:undo-tapped:v1', JSON.stringify(['act-reloaded']))
    vi.resetModules()
    const fresh = await import('./actionGuards')
    expect(fresh.actionStore.undoTapped('act-reloaded')).toBe(true)
    expect(fresh.actionStore.undoTapped('act-other')).toBe(false)
  })

  it('r6 #1: sessionStorage that throws does not break Undo; the tap is still held in memory', async () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    try {
      heldSeenOk = false
      render(<Desk layout="phone" />)
      type('approve the trains one')
      await waitFor(() => expect(document.querySelector('[data-seen="failed"]')).toBeTruthy())
      cancelAnswer = { ok: false, error: 'No connection.' }
      heldSeenOk = true
      fireEvent.click(screen.getByText('Undo'))
      await screen.findByText('Try Undo again')
      await act(async () => { setVisibleRatio(1); document.dispatchEvent(new Event('visibilitychange')) })
      expect(seenCalls).toEqual([['act-live']])
    } finally { set.mockRestore() }
  })

  it('r6 #4: a tab return drops the cached full observation; a fresh clipped entry does not report, a fresh full one does', async () => {
    let visibility: DocumentVisibilityState = 'hidden'
    const override = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    try {
      render(<Desk layout="phone" />)
      type('approve the trains one')
      await screen.findByText('Undo')
      await act(async () => { setVisibleRatio(1) }) // full, but the tab is hidden
      expect(seenCalls).toEqual([])
      setRatioQuiet(0.9) // layout moved while hidden: the next observation is clipped
      readRows = async () => [heldRow()] // the return re-reads; the server still holds it
      visibility = 'visible'
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
      expect(seenCalls).toEqual([])
      await act(async () => { setVisibleRatio(1) })
      await waitFor(() => expect(seenCalls).toEqual([['act-live']]))
    } finally { override.mockRestore() }
  })
})


describe('round 8 (Sol desk-ui r7 P1, P2)', () => {
  const heldRow = () => row({ id: 'a-' + sends[0].client_key, body: 'Approving it.', meta: { client_key: sends[0].client_key, actions: [{ id: 'act-live', kind: 'approve', label: 'Approve the trains post', state: 'held', undo: true, hold_ms: 8000 }] } })

  it('r7 P1: Undo on a row whose report is queued behind an earlier batch takes it out of that batch', async () => {
    const actions = Array.from({ length: 12 }, (_, i) => ({ id: `act-${i}`, kind: 'approve', label: `Approve post ${i}`, state: 'held' as const, undo: true, hold_ms: 8000 }))
    readRows = async () => [row({ id: 'many', body: 'Approving them.', meta: { actions } })]
    let release!: () => void
    heldSeenGate = new Promise(r => { release = r })
    render(<Desk layout="phone" />)
    await waitFor(() => expect(document.querySelectorAll('[data-seen="pending"]')).toHaveLength(12))
    // the first batch (10 ids) is on its way; act-11 waits for the second batch
    fireEvent.click(document.querySelector('[data-action="act-11"] .dk-pill') as HTMLElement)
    await screen.findByText('Try Undo again')
    heldSeenGate = null
    await act(async () => { release() })
    await waitFor(() => expect(seenCalls).toHaveLength(2))
    expect(seenCalls[0]).toHaveLength(10)
    expect(seenCalls[1]).toEqual(['act-10'])
    expect(document.querySelector('[data-action="act-11"]')?.getAttribute('data-seen')).toBeNull()
  })

  it('r7 P1: when every id of a queued batch was undone, that batch sends nothing', async () => {
    const actions = Array.from({ length: 11 }, (_, i) => ({ id: `act-${i}`, kind: 'approve', label: `Approve post ${i}`, state: 'held' as const, undo: true, hold_ms: 8000 }))
    readRows = async () => [row({ id: 'many', body: 'Approving them.', meta: { actions } })]
    let release!: () => void
    heldSeenGate = new Promise(r => { release = r })
    render(<Desk layout="phone" />)
    await waitFor(() => expect(document.querySelectorAll('[data-seen="pending"]')).toHaveLength(11))
    fireEvent.click(document.querySelector('[data-action="act-10"] .dk-pill') as HTMLElement)
    await screen.findByText('Try Undo again')
    heldSeenGate = null
    await act(async () => { release() })
    await waitFor(() => expect(document.querySelectorAll('[data-seen="armed"]')).toHaveLength(10))
    await act(async () => {})
    expect(seenCalls).toHaveLength(1)
  })

  it('r7 P2: on a tab return a queued (stale) full entry is discarded by takeRecords and cannot arm the hold', async () => {
    let visibility: DocumentVisibilityState = 'hidden'
    const override = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    try {
      render(<Desk layout="phone" />)
      type('approve the trains one')
      await screen.findByText('Undo')
      await act(async () => { setVisibleRatio(1) }) // full while hidden: not reported
      setRatioQuiet(0.9) // the layout moved while hidden
      queueStaleEntry(1) // but a full entry from before is still queued for the callback
      readRows = async () => [heldRow()]
      visibility = 'visible'
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
      await act(async () => { await new Promise(r => setTimeout(r, 5)) }) // the queued entry's turn
      expect(discardedRecords()).toBeGreaterThan(0)
      expect(seenCalls).toEqual([])
      await act(async () => { setVisibleRatio(1) })
      await waitFor(() => expect(seenCalls).toEqual([['act-live']]))
    } finally { override.mockRestore() }
  })
})
