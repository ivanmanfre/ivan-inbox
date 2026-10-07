// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fixture from '../lib/reply-source-v1.fixture.json'
import type { ReplyScope } from '../lib/replySources'
const { rpc, subscribe, unsubscribe } = vi.hoisted(() => ({ rpc: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc, auth: { onAuthStateChange: subscribe } } }))
import { useReplySources, useReplySource } from './useReplySources'
let auth: (event: string, session: unknown) => void
beforeEach(() => { subscribe.mockImplementation(cb => { auth = cb; return { data: { subscription: { unsubscribe } } } }); rpc.mockResolvedValue({ data: fixture.metrics, error: null }) })
afterEach(() => { cleanup(); vi.resetAllMocks() })
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
