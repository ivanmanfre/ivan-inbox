// @vitest-environment jsdom
// The desk's network edges (Sol desk-ui r4): every op is bounded by a timeout, and every realtime
// SUBSCRIBED (the first one too) asks the caller to re-read.
import { afterEach, describe, expect, it, vi } from 'vitest'

let subscribeCb: ((status: string) => void) | null = null
let readRows: Array<Record<string, unknown>> = []
const orCalls: string[] = []
const isCalls: unknown[][] = []
const pgHandlers: Array<(p: unknown) => void> = []
let sessionHangs = false
let sessionGate: Promise<void> | null = null
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => {
      if (sessionHangs) await new Promise(() => {})
      if (sessionGate) await sessionGate
      return { data: { session: { access_token: 'made-up-token' } } }
    } },
    from: () => {
      const b = {
        select: () => b,
        is: (column: string, value: unknown) => { isCalls.push([column, value]); return b },
        or: (f: string) => { orCalls.push(f); return b },
        order: () => b,
        limit: async () => ({ data: readRows, error: null }),
      }
      return b
    },
    channel: () => {
      const ch = {
        on: (_e: string, _f: unknown, h: (p: unknown) => void) => { pgHandlers.push(h); return ch },
        subscribe: (cb: (status: string) => void) => { subscribeCb = cb; return ch },
      }
      return ch
    },
    removeChannel: async () => {},
  },
}))

const api = await import('./api')
const { reportHeldSeen, heldSeenStore, resetHeldSeen } = await import('./heldSeen')
const { actionStore, resetActionGuards } = await import('./actionGuards')

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); sessionHangs = false; sessionGate = null; resetHeldSeen(); resetActionGuards() })

describe('held_seen after Undo (Sol desk-ui r7 P1): the taps are checked after the token resolves', () => {
  const heldAnswer = (ids: string[]) => new Response(JSON.stringify({ ok: true, results: ids.map(id => ({ id, state: 'held', seen_at: '2026-01-01T10:00:00.000Z', hold_until: '2026-01-01T10:00:08.000Z' })) }), { status: 200 })

  it('Undo while the report waits for the session token: that id is left out of the request', async () => {
    let release!: () => void
    sessionGate = new Promise(r => { release = r })
    const bodies: { action_ids: string[] }[] = []
    vi.spyOn(window, 'fetch').mockImplementation(async (_u, init) => {
      const b = JSON.parse(String((init as RequestInit).body)); bodies.push(b); return heldAnswer(b.action_ids)
    })
    reportHeldSeen('a1'); reportHeldSeen('a2')
    await new Promise(r => setTimeout(r, 0)) // the batch is now waiting for the token
    actionStore.markUndoTapped('a1')
    release()
    await vi.waitFor(() => expect(heldSeenStore.get('a2')?.state).toBe('armed'))
    expect(bodies).toEqual([{ op: 'held_seen', action_ids: ['a2'] }])
    expect(heldSeenStore.get('a1')).toBeUndefined()
  })

  it('Undo on every id while the report waits for the token: no request at all', async () => {
    let release!: () => void
    sessionGate = new Promise(r => { release = r })
    const fetch = vi.spyOn(window, 'fetch')
    reportHeldSeen('a1')
    await new Promise(r => setTimeout(r, 0))
    actionStore.markUndoTapped('a1')
    release()
    await new Promise(r => setTimeout(r, 10))
    expect(fetch).not.toHaveBeenCalled()
    expect(heldSeenStore.get('a1')).toBeUndefined()
  })

  it('markHeldSeen checks stillWanted after the token: an id dropped meanwhile is not sent, none left = no request', async () => {
    let release!: () => void
    sessionGate = new Promise(r => { release = r })
    const fetch = vi.spyOn(window, 'fetch')
    const gone = new Set<string>()
    const p = api.markHeldSeen(['b1'], id => !gone.has(id))
    gone.add('b1')
    release()
    expect(await p).toEqual({ ok: true, results: [] })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('desk api', () => {
  it('an op that never answers ends as "timeout" after 15 s, and its request is aborted', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    vi.spyOn(window, 'fetch').mockImplementation((_u, init) => {
      signal = (init as RequestInit).signal ?? undefined
      return new Promise(() => {}) // the server never answers
    })
    const p = api.cancelAction('made-up-id')
    await vi.advanceTimersByTimeAsync(14_900)
    let done = false
    void p.then(() => { done = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    expect(await p).toEqual({ ok: false, error: 'timeout' })
    expect(signal?.aborted).toBe(true)
    expect(api.OP_TIMEOUT_MS).toBe(15_000)
  })

  it('the deadline covers the session read too: a hung token read ends as "timeout"', async () => {
    vi.useFakeTimers()
    sessionHangs = true
    const fetch = vi.spyOn(window, 'fetch')
    const p = api.commitAction('made-up-id')
    await vi.advanceTimersByTimeAsync(15_100)
    expect(await p).toEqual({ ok: false, error: 'timeout' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a body that never arrives after the headers also ends as "timeout"', async () => {
    vi.useFakeTimers()
    vi.spyOn(window, 'fetch').mockResolvedValue({ ok: true, status: 200, json: () => new Promise(() => {}) } as unknown as Response)
    const p = api.undoAction('made-up-id')
    await vi.advanceTimersByTimeAsync(15_100)
    expect(await p).toEqual({ ok: false, error: 'timeout' })
  })

  it('held_seen sends the ids and returns the server per-id results, also when one id failed', async () => {
    let body: unknown
    vi.spyOn(window, 'fetch').mockImplementation(async (_u, init) => {
      body = JSON.parse(String((init as RequestInit).body))
      return new Response(JSON.stringify({ ok: false, results: [
        { id: 'a1', state: 'held', seen_at: '2026-01-01T10:00:00.000Z', hold_until: '2026-01-01T10:00:08.000Z' },
        { id: 'a2', error: 'not_found' },
      ] }), { status: 200 })
    })
    const r = await api.markHeldSeen(['a1', 'a2'])
    expect(body).toEqual({ op: 'held_seen', action_ids: ['a1', 'a2'] })
    expect(r.ok).toBe(false)
    expect(r.results).toEqual([
      { id: 'a1', state: 'held', seen_at: '2026-01-01T10:00:00.000Z', hold_until: '2026-01-01T10:00:08.000Z' },
      { id: 'a2', error: 'not_found' },
    ])
  })

  it('a plain network failure stays "No connection."', async () => {
    vi.spyOn(window, 'fetch').mockRejectedValue(new TypeError('failed to fetch'))
    expect(await api.commitAction('made-up-id')).toEqual({ ok: false, error: 'No connection.' })
  })

  it('test rows (meta.test) are filtered out of the history read and realtime outside eval mode', async () => {
    localStorage.removeItem('desk-eval'); orCalls.length = 0; isCalls.length = 0; pgHandlers.length = 0
    readRows = [
      { id: 'm2', role: 'assistant', body: 'Made-up eval answer.', status: 'done', meta: { test: true }, created_at: '2026-11-18T12:00:02Z' },
      { id: 'm1', role: 'assistant', body: 'Made-up real answer.', status: 'done', meta: {}, created_at: '2026-11-18T12:00:01Z' },
    ]
    const rows = await api.readMessages()
    expect(isCalls).toEqual([['meta->>main_thread', null]])
    expect(orCalls).toEqual(['meta->>test.is.null,meta->>test.neq.true'])
    expect(rows.map(r => r.id)).toEqual(['m1'])
    const message = vi.fn()
    const stop = api.subscribeDesk('desk:test', '00000000-0000-4000-8000-000000000001', { message, job: vi.fn(), resubscribed: vi.fn() })
    pgHandlers[0]({ new: { id: 'm3', role: 'assistant', body: 'x', status: 'done', meta: { test: true } } })
    pgHandlers[0]({ new: { id: 'main-only', role: 'assistant', status: 'done', meta: { main_thread: 'private' } } })
    pgHandlers[0]({ new: { id: 'm4', role: 'assistant', body: 'y', status: 'done', meta: {} } })
    expect(message.mock.calls.map(c => c[0].id)).toEqual(['m4'])
    stop()
  })

  it('eval mode keeps test rows visible (the eval and G9 read them)', async () => {
    localStorage.setItem('desk-eval', '1'); orCalls.length = 0
    readRows = [{ id: 'm2', role: 'assistant', body: 'Made-up eval answer.', status: 'done', meta: { test: true }, created_at: '2026-11-18T12:00:02Z' }]
    const rows = await api.readMessages()
    expect(orCalls).toEqual([])
    expect(rows.map(r => r.id)).toEqual(['m2'])
    localStorage.removeItem('desk-eval')
  })

  it('the first SUBSCRIBED re-reads too, so a settlement between the read and the subscription is not missed', () => {
    const resubscribed = vi.fn()
    const stop = api.subscribeDesk('desk:test', '00000000-0000-4000-8000-000000000001', { message: vi.fn(), job: vi.fn(), resubscribed })
    subscribeCb?.('SUBSCRIBED')
    expect(resubscribed).toHaveBeenCalledTimes(1)
    subscribeCb?.('SUBSCRIBED')
    expect(resubscribed).toHaveBeenCalledTimes(2)
    stop()
  })
})
