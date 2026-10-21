import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTH_MS, NoAnswerError, READ_MS, SLOW_RPC_MS, WRITE_MS, bounded, deadlineFor, isNoAnswer, timedFetch } from './noAnswer'

const REST = 'https://x.supabase.co/rest/v1'
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('which requests get a deadline', () => {
  it('writes and write RPCs 20 s, reads a 30 s backstop, the slow RPCs their own room, auth a backstop', () => {
    expect(deadlineFor(`${REST}/outreach_messages?id=eq.1`, { method: 'PATCH' })).toBe(WRITE_MS)
    expect(deadlineFor(`${REST}/outreach_messages`, { method: 'POST' })).toBe(WRITE_MS)
    expect(deadlineFor(`${REST}/rpc/approve_inbox_pipeline_draft`, { method: 'POST' })).toBe(WRITE_MS)
    expect(deadlineFor(`${REST}/rpc/send_rejected_inbox_draft`, { method: 'POST' })).toBe(WRITE_MS)
    expect(deadlineFor(`${REST}/inbox_messages_v?select=*`, { method: 'GET' })).toBe(READ_MS)
    expect(deadlineFor(`${REST}/inbox_messages_v?select=*`)).toBe(READ_MS)
    expect(deadlineFor(`${REST}/rpc/cb39_verdict_set`, { method: 'POST' })).toBe(SLOW_RPC_MS)
    expect(deadlineFor('https://x.supabase.co/auth/v1/token?grant_type=refresh_token', { method: 'POST' })).toBe(AUTH_MS)
  })
  it('leaves alone a request with its own signal, edge functions, storage uploads and realtime', () => {
    expect(deadlineFor(`${REST}/outreach_messages`, { method: 'POST', signal: new AbortController().signal })).toBeNull()
    expect(deadlineFor('https://x.supabase.co/functions/v1/inbox-dm-draft', { method: 'POST' })).toBeNull()
    expect(deadlineFor('https://x.supabase.co/storage/v1/object/media/a.png', { method: 'POST' })).toBeNull()
    expect(deadlineFor('https://x.supabase.co/realtime/v1/api/broadcast', { method: 'POST' })).toBeNull()
  })
})

describe('timedFetch', () => {
  it('a write that never answers ends after 20 s with a no-answer error, and the request is aborted', async () => {
    let signal: AbortSignal | undefined
    const base = vi.fn((_: RequestInfo | URL, init?: RequestInit) => { signal = init?.signal ?? undefined; return new Promise<Response>(() => {}) })
    const out = timedFetch(`${REST}/rpc/approve_inbox_pipeline_draft`, { method: 'POST', body: '{}' }, base as unknown as typeof fetch).catch(e => e)
    await vi.advanceTimersByTimeAsync(WRITE_MS - 1)
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const e = await out
    expect(isNoAnswer(e)).toBe(true)
    expect((e as Error).name).toBe('AbortError')
    expect(signal?.aborted).toBe(true)
  })
  it('an answer in time passes through untouched; a caller signal is passed through without a deadline', async () => {
    const res = new Response('[]')
    const base = vi.fn(async () => res)
    await expect(timedFetch(`${REST}/outreach_messages`, { method: 'PATCH' }, base as unknown as typeof fetch)).resolves.toBe(res)
    const own = new AbortController().signal
    await timedFetch(`${REST}/outreach_messages`, { method: 'PATCH', signal: own }, base as unknown as typeof fetch)
    expect((base.mock.calls[1] as unknown[])[1]).toEqual({ method: 'PATCH', signal: own })
  })
  it('reads the supabase-js error shape a timed-out call comes back as', () => {
    expect(isNoAnswer({ message: 'AbortError: No answer from the server in 20s.', code: '' })).toBe(true)
    expect(isNoAnswer(new NoAnswerError(20_000))).toBe(true)
    expect(isNoAnswer({ message: 'The draft changed before approval' })).toBe(false)
    expect(isNoAnswer(new TypeError('Load failed'))).toBe(false)
  })
})

it('bounded ends a check on its own clock and aborts it', async () => {
  let seen: AbortSignal | undefined
  const out = bounded(signal => { seen = signal; return new Promise(() => {}) }, 10_000).catch(e => e)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(isNoAnswer(await out)).toBe(true)
  expect(seen?.aborted).toBe(true)
  await expect(bounded(async () => 7, 10_000)).resolves.toBe(7)
})
