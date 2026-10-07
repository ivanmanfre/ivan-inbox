// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fixture from '../lib/reply-source-v1.fixture.json'
import type { ReplyScope } from '../lib/replySources'
const { rpc, subscribe, unsubscribe } = vi.hoisted(() => ({ rpc: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc, auth: { onAuthStateChange: subscribe } } }))
import { useReplySources, useReplySource } from './useReplySources'
let auth: (event: string, session: unknown) => void
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(fixture.metrics.data.as_of)); subscribe.mockImplementation(cb => { auth = cb; return { data: { subscription: { unsubscribe } } } }); rpc.mockResolvedValue({ data: fixture.metrics, error: null }) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.resetAllMocks() })
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(r => { resolve = r }); return { promise, resolve } }
const scope = (clientId: string, campaignId?: string): ReplyScope => ({ kind: 'operator', clientId, campaignId })
const dataFor = (clientId: string) => ({ data: { ...fixture.metrics, data: { ...fixture.metrics.data, client_id: clientId } }, error: null })
it('keeps the latest client when the previous client resolves last', async () => {
 const old = deferred(), next = deferred(); rpc.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
 const h = renderHook(({ s }) => useReplySources(s, 30), { initialProps: { s: scope('risedtc') } })
 h.rerender({ s: scope('arch') }); await act(async () => next.resolve(dataFor('arch')))
 await waitFor(() => expect(h.result.current).toMatchObject({ kind: 'ready', data: { client_id: 'arch' } }))
 await act(async () => old.resolve(dataFor('risedtc')))
 expect(h.result.current).toMatchObject({ kind: 'ready', data: { client_id: 'arch' } })
})
it.each(['days', 'campaign', 'credential'] as const)('drops deferred old %s data', async axis => {
 const old = deferred(), next = deferred(); rpc.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
 const initial: { s: ReplyScope; days: 7 | 30 | 90 } = { s: axis === 'credential' ? { kind: 'board-token', slug: 'fixture', token: 'first' } : scope('ivan', 'a'), days: 30 }
 const h = renderHook(({ s, days }) => useReplySources(s, days), { initialProps: initial })
 h.rerender({ s: axis === 'credential' ? { kind: 'board-token', slug: 'fixture', token: 'second' } : scope('ivan', axis === 'campaign' ? 'b' : 'a'), days: axis === 'days' ? 7 : 30 })
 expect(h.result.current.kind).toBe('loading')
 await act(async () => next.resolve({ data: { status: 'not_configured', data: null }, error: null }))
 await act(async () => old.resolve(dataFor('ivan')))
 expect(h.result.current).toEqual({ kind: 'not_configured' })
})
it('clears loaded data on logout and rejects an in-flight response', async () => {
 const pending = deferred(); rpc.mockReturnValueOnce(pending.promise)
 const h = renderHook(() => useReplySources(scope('ivan'), 30))
 act(() => auth('SIGNED_OUT', null)); expect(h.result.current).toEqual({ kind: 'denied' })
 await act(async () => pending.resolve(dataFor('ivan'))); expect(h.result.current).toEqual({ kind: 'denied' })
 h.unmount(); expect(unsubscribe).toHaveBeenCalledOnce()
})
it('clears ready data on an auth change before a new request resolves', async () => {
 const h = renderHook(() => useReplySources(scope('ivan'), 30)); await waitFor(() => expect(h.result.current.kind).toBe('ready'))
 const next = deferred(); rpc.mockReturnValueOnce(next.promise)
 act(() => auth('TOKEN_REFRESHED', { user: { id: 'operator' } })); expect(h.result.current.kind).toBe('loading')
 await act(async () => next.resolve({ data: null, error: { code: '42501' } })); expect(h.result.current).toEqual({ kind: 'denied' })
})
it('clears ready metrics after a denied period read', async () => {
 const h = renderHook(({ days }) => useReplySources(scope('ivan'), days), { initialProps: { days: 30 as 7 | 30 | 90 } })
 await waitFor(() => expect(h.result.current.kind).toBe('ready')); rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } })
 h.rerender({ days: 7 }); expect(h.result.current.kind).toBe('loading'); await waitFor(() => expect(h.result.current.kind).toBe('denied'))
})
it('makes no request for preview or a closed source detail', async () => {
 const a = renderHook(() => useReplySources({ kind: 'preview' }, 30)); const b = renderHook(() => useReplySource(scope('ivan'), 'p-a', false))
 expect(a.result.current.kind).toBe('preview'); expect(b.result.current.kind).toBe('empty'); expect(rpc).not.toHaveBeenCalled()
})
it('does not replace the next prospect source with the previous prospect source', async () => {
 const old = deferred(), next = deferred(); rpc.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
 const h = renderHook(({ id }) => useReplySource(scope('ivan'), id, true), { initialProps: { id: 'p-a' } })
 h.rerender({ id: 'p-b' }); await act(async () => next.resolve({ data: { status: 'not_found', data: null }, error: null }))
 await act(async () => old.resolve({ data: fixture.detail, error: null })); expect(h.result.current).toEqual({ kind: 'empty' })
})

it.each(['aggregate', 'source'] as const)('makes one %s read with the asynchronous SDK INITIAL_SESSION event', async kind => {
 const pending = deferred(); rpc.mockReturnValueOnce(pending.promise)
 const h = renderHook(() => kind === 'aggregate' ? useReplySources(scope('ivan'), 30) : useReplySource(scope('ivan'), 'p-a', true))
 expect(rpc).toHaveBeenCalledOnce()
 await act(async () => { await Promise.resolve(); auth('INITIAL_SESSION', { user: { id: 'operator' }, access_token: 'fixture-session' }) })
 expect(rpc).toHaveBeenCalledOnce()
 expect(h.result.current.kind).toBe('loading')
 await act(async () => pending.resolve({ data: kind === 'aggregate' ? fixture.metrics : fixture.detail, error: null }))
 await waitFor(() => expect(h.result.current.kind).toBe('ready'))
 expect(rpc).toHaveBeenCalledOnce()
})
it('denies an asynchronously resolved empty initial operator session', async () => {
 const pending = deferred(); rpc.mockReturnValueOnce(pending.promise)
 const h = renderHook(() => useReplySource(scope('ivan'), 'p-a', true))
 await act(async () => { await Promise.resolve(); auth('INITIAL_SESSION', null) })
 expect(h.result.current.kind).toBe('denied')
 await act(async () => pending.resolve({ data: fixture.detail, error: null }))
 expect(h.result.current.kind).toBe('denied'); expect(rpc).toHaveBeenCalledOnce()
})

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
const timers = () => { vi.useRealTimers(); vi.useFakeTimers(); vi.setSystemTime(new Date(fixture.metrics.data.as_of)) }
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
it.each(['aggregate', 'source'] as const)('polls visible %s reads every 60 seconds without loading flicker or overlapping RPCs', async kind => {
 timers(); rpc.mockResolvedValue({ data: kind === 'aggregate' ? fixture.metrics : fixture.detail, error: null })
 const h = renderHook(() => kind === 'aggregate' ? useReplySources(scope('ivan'), 30) : useReplySource(scope('ivan'), 'p-a', true))
 await flush(); expect(h.result.current.kind).toBe('ready'); expect(rpc).toHaveBeenCalledOnce()
 const next = deferred(); rpc.mockReturnValueOnce(next.promise)
 await advance(59999); expect(rpc).toHaveBeenCalledOnce()
 await advance(1); expect(rpc).toHaveBeenCalledTimes(2); expect(h.result.current.kind).toBe('ready')
 act(() => window.dispatchEvent(new Event('focus'))); await advance(60000)
 expect(rpc).toHaveBeenCalledTimes(2)
 await act(async () => next.resolve({ data: { status: 'unavailable', data: null }, error: null }))
 expect(h.result.current).toEqual({ kind: 'unavailable' })
 h.unmount(); await advance(120000); act(() => window.dispatchEvent(new Event('focus')))
 expect(rpc).toHaveBeenCalledTimes(2)
})
it('makes focus reads only when due and stops polling hidden or closed details', async () => {
 timers(); let visibility: DocumentVisibilityState = 'visible'
 vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
 rpc.mockResolvedValue({ data: fixture.detail, error: null })
 const h = renderHook(({ enabled }) => useReplySource(scope('ivan'), 'p-a', enabled), { initialProps: { enabled: false } })
 await advance(120000); expect(rpc).not.toHaveBeenCalled()
 h.rerender({ enabled: true }); await flush(); expect(rpc).toHaveBeenCalledOnce()
 await advance(30000); act(() => window.dispatchEvent(new Event('focus'))); expect(rpc).toHaveBeenCalledOnce()
 visibility = 'hidden'; act(() => document.dispatchEvent(new Event('visibilitychange')))
 await advance(60000); act(() => window.dispatchEvent(new Event('focus'))); expect(rpc).toHaveBeenCalledOnce()
 visibility = 'visible'; act(() => document.dispatchEvent(new Event('visibilitychange'))); await flush()
 expect(rpc).toHaveBeenCalledTimes(2)
 act(() => window.dispatchEvent(new Event('focus'))); expect(rpc).toHaveBeenCalledTimes(2)
 h.rerender({ enabled: false }); await advance(120000); expect(h.result.current.kind).toBe('empty'); expect(rpc).toHaveBeenCalledTimes(2)
})
it.each(['aggregate', 'source'] as const)('marks %s data delayed after five minutes and expires it above fifteen during an in-flight refresh', async kind => {
 timers(); rpc.mockResolvedValueOnce({ data: kind === 'aggregate' ? fixture.metrics : fixture.detail, error: null })
 const pending = deferred(); rpc.mockReturnValue(pending.promise)
 const h = renderHook(() => kind === 'aggregate' ? useReplySources(scope('ivan'), 30) : useReplySource(scope('ivan'), 'p-a', true))
 await flush(); await advance(300000); expect(h.result.current.kind).toBe('ready'); expect(h.result.current).not.toMatchObject({ delayed: true })
 await advance(1); expect(h.result.current).toMatchObject({ kind: 'ready', delayed: true })
 await advance(599999); expect(h.result.current.kind).toBe('ready')
 await advance(1); expect(h.result.current).toEqual({ kind: 'unavailable' })
 await act(async () => pending.resolve({ data: kind === 'aggregate' ? fixture.metrics : fixture.detail, error: null }))
 expect(h.result.current).toEqual({ kind: 'unavailable' })
})
it('expires data on hidden-tab return before an outstanding refresh resolves', async () => {
 timers(); let visibility: DocumentVisibilityState = 'visible'
 vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
 const h = renderHook(() => useReplySources(scope('ivan'), 30)); await flush()
 const pending = deferred(); rpc.mockReturnValueOnce(pending.promise); await advance(60000)
 visibility = 'hidden'; act(() => document.dispatchEvent(new Event('visibilitychange')))
 // Clock advances without timers, as when the browser suspends a hidden tab.
 vi.setSystemTime(new Date(Date.parse(fixture.metrics.data.as_of) + 900001))
 visibility = 'visible'; act(() => document.dispatchEvent(new Event('visibilitychange')))
 expect(h.result.current).toEqual({ kind: 'unavailable' }); expect(rpc).toHaveBeenCalledTimes(2)
 await act(async () => pending.resolve({ data: fixture.metrics, error: null }))
 expect(h.result.current).toEqual({ kind: 'unavailable' })
})
it.each(['42501', 'PGRST202', '57014'])('clears valid data after a background RPC error %s', async code => {
 timers(); const h = renderHook(() => useReplySources(scope('ivan'), 30)); await flush()
 expect(h.result.current.kind).toBe('ready')
 rpc.mockResolvedValueOnce({ data: null, error: { code } }); await advance(60000)
 expect(h.result.current.kind).toBe(code === '42501' ? 'denied' : code === 'PGRST202' ? 'unavailable' : 'error')
 expect(h.result.current).not.toHaveProperty('data')
})
it('does not replace a new board session with a late periodic read from the previous session', async () => {
 timers(); const initial: ReplyScope = { kind: 'board-session', slug: 'fixture', session: 'first' }
 const h = renderHook(({ s }) => useReplySources(s, 30), { initialProps: { s: initial } }); await flush()
 const old = deferred(); rpc.mockReturnValueOnce(old.promise); await advance(60000)
 rpc.mockResolvedValueOnce({ data: { status: 'unavailable', data: null }, error: null })
 h.rerender({ s: { ...initial, session: 'second' } }); await flush()
 await act(async () => old.resolve({ data: fixture.metrics, error: null }))
 expect(h.result.current).toEqual({ kind: 'unavailable' })
})

it('waits for visibility before the initial request and keeps one call on focus', async () => {
 timers(); let visibility: DocumentVisibilityState = 'hidden'
 vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
 const h = renderHook(() => useReplySources(scope('ivan'), 30)); await flush(); expect(rpc).not.toHaveBeenCalled()
 visibility = 'visible'; act(() => document.dispatchEvent(new Event('visibilitychange'))); await flush()
 expect(h.result.current.kind).toBe('ready'); expect(rpc).toHaveBeenCalledOnce()
 act(() => window.dispatchEvent(new Event('focus'))); expect(rpc).toHaveBeenCalledOnce()
})
it('clears data on logout during a periodic read and rejects its late result', async () => {
 timers(); const h = renderHook(() => useReplySources(scope('ivan'), 30)); await flush()
 const pending = deferred(); rpc.mockReturnValueOnce(pending.promise); await advance(60000)
 act(() => auth('SIGNED_OUT', null)); expect(h.result.current).toEqual({ kind: 'denied' })
 await act(async () => pending.resolve(dataFor('ivan'))); expect(h.result.current).toEqual({ kind: 'denied' })
 await advance(120000); expect(rpc).toHaveBeenCalledTimes(2)
})
