// @vitest-environment jsdom
// Sol desk-ui round 6 regression probes (the reviewer's file, review-round6.test.tsx). Probes 1 and 2 are
// verbatim. Probes 3 and 4 asserted the r6 buttons ("Try again" on a stored error, Retry after
// key_mismatch), which the r7 decision removed; they are rewritten to the same intent: no fresh key and
// no resend for an existing question, ever. Made-up rows only.
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
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
  subscribeDesk: vi.fn(() => () => {}),
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
const { installVisibility, removeVisibility, setVisibleRatio } = await import('./testVisibility')
const { resetActionGuards } = await import('./actionGuards')
const { resetLiveHolds } = await import('./useDesk')

beforeEach(() => {
  ops.length = 0; sends.length = 0; cancelGate = null; commitAnswer = { ok: true }
  readRows = async () => []; sendMode = 'held'; errorSideEffects = 'none'; finalGate = null; uploadGate = null; ackGate = null; cancelAnswer = { ok: true }
  localStorage.clear(); resetLiveHolds(); resetActionGuards(); resetHeldSeen(); seenCalls.length = 0; heldSeenOk = true; heldSeenEntry = null; heldSeenGate = null; installVisibility()
})
afterEach(() => { cleanup(); vi.useRealTimers(); removeVisibility() })

function type(text: string) {
  fireEvent.change(screen.getByLabelText('Message the desk'), { target: { value: text } })
  fireEvent.click(screen.getByLabelText('Send'))
}


it('does not arm a manual hold when a failed cancel brings back Try Undo again', async () => {
  heldSeenOk = false
  render(<Desk layout="phone" />)
  type('approve the trains one')
  await waitFor(() => expect(document.querySelector('[data-seen="failed"]')).toBeTruthy())
  expect(seenCalls).toEqual([['act-live']])
  readRows = () => new Promise(() => {})
  cancelAnswer = { ok: false, error: 'No connection.' }
  heldSeenOk = true
  fireEvent.click(screen.getByText('Undo'))
  await screen.findByText('Try Undo again')
  await act(async () => {})
  expect(document.querySelector('.dk-count')).toBeNull()
  expect(ops).toEqual([{ kind: 'cancel', id: 'act-live' }])
  expect(seenCalls).toEqual([['act-live']])
})

it('does not arm from a stale full observation when the tab returns with a clipped edge', async () => {
  const original = Object.getOwnPropertyDescriptor(document, 'visibilityState')
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
  try {
    render(<Desk layout="phone" />)
    type('approve the trains one')
    await screen.findByText('Undo')
    await act(async () => { setVisibleRatio(1) })
    expect(seenCalls).toEqual([])
    // Between layout shifting and the next IO callback, current hit-testing
    // excludes the last pixel of the button, while the last IO entry was full.
    const hitTest = document.elementFromPoint
    const r = screen.getByText('Undo').getBoundingClientRect()
    document.elementFromPoint = (x, y) => y > r.bottom - 1 ? null : hitTest(x, y)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(seenCalls).toEqual([])
  } finally {
    if (original) Object.defineProperty(document, 'visibilityState', original)
    else Reflect.deleteProperty(document, 'visibilityState')
  }
})

it('does not reenable fresh retry on an original error restored by a history read', async () => {
  sendMode = 'error-final'
  render(<Desk layout="phone" />)
  const command = 'approve the trains one'
  type(command)
  await screen.findByText(/could not answer just now/)
  expect(screen.queryByText('Try again')).toBeNull()
  const key = sends[0].client_key
  const question = row({ id: 'u-' + key, role: 'user', origin: 'operator', body: command, client_key: key })
  const failed = row({ id: 'e-' + key, status: 'error', body: 'Original error', meta: { client_key: key, side_effects: 'none' } })
  sendMode = 'held'
  readRows = async () => [question, failed]
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  await screen.findByText('Original error')
  expect(screen.queryByText('Try again')).toBeNull()
  expect(screen.queryByText('Retry')).toBeNull()
  fireEvent.click(screen.getByText('Check again'))
  fireEvent.click(screen.getByText('Edit and send'))
  await act(async () => {})
  expect(sends).toHaveLength(1)
  expect((screen.getByLabelText('Message the desk') as HTMLTextAreaElement).value).toBe(command)
})

it('does not turn a redacted cached question into a fresh replay after key_mismatch', async () => {
  const command = 'approve the trains post at https://example.invalid/preview?k=fixture-secret'
  sendMode = 'drop-before-ack'
  const desk = render(<Desk layout="phone" />)
  readRows = async () => [row({ id: 'u-stored', role: 'user', origin: 'operator', body: command, client_key: sends[0].client_key })]
  type(command)
  await screen.findByText('No answer yet.')
  desk.unmount()
  readRows = () => new Promise(() => {})
  render(<Desk layout="phone" />)
  await screen.findByText('approve the trains post at [link]')
  sendMode = 'key-reused'
  fireEvent.click(screen.getByText('Retry'))
  expect(sends[1]).toMatchObject({ text: 'approve the trains post at [link]', client_key: sends[0].client_key })
  await screen.findByText(/Not sent: this text does not match/)
  sendMode = 'held'
  // key_mismatch is final for that key: no Retry, only Check again and Edit and send (which sends nothing).
  expect(screen.queryByText('Retry')).toBeNull()
  fireEvent.click(screen.getByText('Edit and send'))
  await act(async () => {})
  expect(sends).toHaveLength(2)
  expect(sends.every(s => s.client_key === sends[0].client_key)).toBe(true)
})
