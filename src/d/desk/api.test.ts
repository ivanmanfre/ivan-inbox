// @vitest-environment jsdom
// The desk's network edges (Sol desk-ui r4): every op is bounded by a timeout, and every realtime
// SUBSCRIBED (the first one too) asks the caller to re-read.
import { afterEach, describe, expect, it, vi } from 'vitest'

let subscribeCb: ((status: string) => void) | null = null
let sessionHangs = false
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: () => (sessionHangs ? new Promise(() => {}) : Promise.resolve({ data: { session: { access_token: 'made-up-token' } } })) },
    channel: () => {
      const ch = {
        on: () => ch,
        subscribe: (cb: (status: string) => void) => { subscribeCb = cb; return ch },
      }
      return ch
    },
    removeChannel: async () => {},
  },
}))

const api = await import('./api')

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); sessionHangs = false })

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
