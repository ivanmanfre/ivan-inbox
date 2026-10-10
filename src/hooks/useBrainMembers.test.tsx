// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const sdk = vi.hoisted(() => ({ read: vi.fn(), queries: [] as { ids: string[]; client: string | null }[], events: [] as { filter: string; callback: (p: unknown) => void }[], status: null as null | ((s: string) => void), authChange: null as null | ((event: string, session: unknown) => void), remove: vi.fn(), unsubscribe: vi.fn(), subscribeFail: false }))
vi.mock('../lib/supabase', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'operator' } } } }), onAuthStateChange: (cb: typeof sdk.authChange) => { sdk.authChange = cb; return { data: { subscription: { unsubscribe: sdk.unsubscribe } } } } },
  channel: () => { const c = { on: (_: unknown, f: { filter: string }, cb: (p: unknown) => void) => { sdk.events.push({ filter: f.filter, callback: cb }); return c }, subscribe: (cb: typeof sdk.status) => { if (sdk.subscribeFail) throw new Error('subscription unavailable'); sdk.status = cb; return c } }; return c }, removeChannel: sdk.remove,
  from: (table: string) => { expect(table).toBe('cb34_p2_safe_drafts'); const info = { ids: [] as string[], client: null as string | null }; const q = { select: (cols: string) => { expect(cols).toBe('*'); return q }, in: (_: string, ids: string[]) => { info.ids = ids; return q }, is: (_: string, client: null) => { info.client = client; return q }, eq: (_: string, client: string) => { info.client = client; return q }, abortSignal: () => { sdk.queries.push(info); return sdk.read(info) } }; return q },
} }))
import { useBrainMembers, validMemberRows } from './useBrainMembers'
import type { ContentDraftDetail } from '../lib/content'
const a = '11111111-1111-1111-1111-111111111111', b = '22222222-2222-2222-2222-222222222222'
const row = (id = a, client: string | null = null, member = true): ContentDraftDetail => ({ id, client_id: client, cb34_p2_member: member, post_body: 'current body', qa: { verdict: 'PASS' }, title: 'current title', status: 'review', created_at: '2026-10-01' } as ContentDraftDetail)
function useRows(initial: ContentDraftDetail[]) { const [rows, setRows] = useState(initial); useBrainMembers(rows, () => setRows(p => p.filter(r => !r.cb34_p2_member)), fresh => setRows(p => [...p.filter(r => !r.cb34_p2_member), ...fresh]), 'fixture'); return rows }
beforeEach(() => { vi.useFakeTimers(); sdk.read.mockReset(); sdk.queries = []; sdk.events = []; sdk.status = null; sdk.subscribeFail = false; sdk.remove.mockClear(); sdk.unsubscribe.mockClear(); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }) })
afterEach(() => { cleanup(); vi.useRealTimers() })
it('missed-event fallback keeps verified members during a bounded read and removes revoked rows on completion', async () => {
 let done!: (x: unknown) => void; sdk.read.mockReturnValue(new Promise(resolve => { done = resolve }))
 const ordinary = row(b, null, false), { result } = renderHook(() => useRows([row(), ordinary]))
 await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
 expect(result.current.map(r => r.id)).toEqual([a,b]); expect(sdk.queries).toEqual([{ ids: [a], client: null }])
 await act(async () => { done({ data: [], error: null }) })
 await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
 expect(sdk.read).toHaveBeenCalledTimes(1); expect(result.current).toEqual([ordinary])
})
it('membership-only feed invalidates immediately, returns fresh body, and ignores malformed metadata', async () => {
 sdk.read.mockResolvedValue({ data: [row()], error: null }); const { result } = renderHook(() => useRows([row()]))
 await act(async () => {})
 expect(sdk.events.map(e => e.filter)).toEqual(['client_id=eq.ivan','client_id=eq.risedtc','client_id=eq.arch'])
 act(() => sdk.events[0].callback({ new: { event_id: 1, client_id: 'arch', draft_id: a } }))
 expect(sdk.read).not.toHaveBeenCalled()
 let done!: (x: unknown) => void; sdk.read.mockReturnValueOnce(new Promise(resolve => { done = resolve }))
 act(() => sdk.events[0].callback({ new: { event_id: 2, client_id: 'ivan', draft_id: a } }))
 expect(result.current).toEqual([])
 await act(async () => { done({ data: [{ ...row(), post_body: 'fresh verified body' }], error: null }) })
 expect(result.current[0].post_body).toBe('fresh verified body')
})
it('serial tenant batches reject a wrong-client second response without restoring any partial result', async () => {
 sdk.read.mockResolvedValueOnce({ data: [row()], error: null }).mockResolvedValueOnce({ data: [row(b, null)], error: null })
 const { result } = renderHook(() => useRows([row(), row(b, 'arch')]))
 await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
 expect(sdk.queries).toEqual([{ ids: [a], client: null },{ ids: [b], client: 'arch' }]); expect(result.current).toEqual([])
})
it('disconnect/reconnect supersedes old successful responses and does not overlap requests', async () => {
 let older!: (x: unknown) => void; sdk.read.mockReturnValueOnce(new Promise(resolve => { older = resolve })).mockResolvedValueOnce({ data: [], error: null })
 const { result } = renderHook(() => useRows([row()]))
 await act(async () => {})
 act(() => sdk.status?.('CHANNEL_ERROR')); expect(result.current).toEqual([])
 act(() => sdk.status?.('SUBSCRIBED')); expect(sdk.read).toHaveBeenCalledTimes(1)
 await act(async () => { older({ data: [row()], error: null }) })
 expect(sdk.read).toHaveBeenCalledTimes(2); expect(result.current).toEqual([])
})
it('hidden document clears without reading; visible recovery rechecks, and unmount removes bridge', async () => {
 sdk.read.mockResolvedValue({ data: [], error: null }); const { result, unmount } = renderHook(() => useRows([row(),row(b,null,false)]))
 await act(async () => {})
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'})
 act(() => document.dispatchEvent(new Event('visibilitychange')))
 expect(result.current.map(r => r.id)).toEqual([b]); expect(sdk.read).not.toHaveBeenCalled()
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'})
 await act(async () => document.dispatchEvent(new Event('visibilitychange')))
 expect(sdk.read).toHaveBeenCalledTimes(1)
 unmount(); expect(sdk.remove).toHaveBeenCalled(); expect(sdk.unsubscribe).toHaveBeenCalled()
 await act(async () => { await vi.advanceTimersByTimeAsync(10000) }); expect(sdk.read).toHaveBeenCalledTimes(1)
})
it('rejects duplicates, unexpected ids, wrong clients and nonmembers', () => {
 for(const rows of [[row(),row()],[row(b)],[row(a,'arch')],[row(a,null,false)]])expect(()=>validMemberRows(rows,[row()])).toThrow()
 expect(validMemberRows([], [row()])).toEqual([])
})

it('transient failure retains hidden known IDs and recovers on next timer without focus', async () => {
 sdk.read.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce({ data: [row()], error: null })
 const { result } = renderHook(() => useRows([row(),row(b,null,false)]))
 await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
 expect(result.current.map(r => r.id)).toEqual([b])
 await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
 expect(sdk.read).toHaveBeenCalledTimes(2); expect(result.current.map(r => r.id)).toEqual([b,a])
})
it('subscription failure hides members without wiping ordinary rows and uses serial fallback', async () => {
 sdk.subscribeFail = true; sdk.read.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: [], error: null })
 const ordinary = row(b,null,false), { result } = renderHook(() => useRows([row(),ordinary]))
 await act(async () => {})
 expect(result.current).toEqual([ordinary])
 await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
 expect(sdk.read).toHaveBeenCalledTimes(2); expect(result.current).toEqual([ordinary])
})
it('signout cancels old member restoration and discards previous authenticated IDs', async () => {
 let older!: (x: unknown) => void; sdk.read.mockReturnValueOnce(new Promise(resolve => { older = resolve }))
 const { result } = renderHook(() => useRows([row(),row(b,null,false)]))
 await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
 act(() => sdk.authChange?.('SIGNED_OUT',null))
 await act(async () => { older({ data: [row()], error: null }) })
 await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
 expect(sdk.read).toHaveBeenCalledTimes(1); expect(result.current.map(r => r.id)).toEqual([b])
})

it('timer-started pending IDs survive an event and old completion, then retry fresh without overlap', async () => {
 let older!: (x: unknown) => void
 sdk.read.mockReturnValueOnce(new Promise(resolve => { older = resolve })).mockResolvedValueOnce({ data: [{ ...row(), post_body: 'new verified body' }], error: null })
 const { result } = renderHook(() => useRows([row()]))
 await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
 expect(result.current.map(r => r.id)).toEqual([a])
 act(() => window.dispatchEvent(new Event('wb-rows-changed')))
 expect(result.current).toEqual([])
 expect(sdk.read).toHaveBeenCalledTimes(1)
 await act(async () => older({ data: [row()], error: null }))
 expect(sdk.read).toHaveBeenCalledTimes(2)
 expect(result.current[0].post_body).toBe('new verified body')
})


it('unchanged fallback results keep the same visible rows across repeated checks', async () => {
 sdk.read.mockResolvedValue({ data: [row()], error: null })
 const { result } = renderHook(() => useRows([row(),row(b,null,false)]))
 await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
 const checked = result.current
 await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
 expect(result.current).toBe(checked)
 expect(result.current.map(r => r.id)).toEqual([b,a])
})

it('a changed body with unchanged membership replaces the visible draft after verification', async () => {
 sdk.read.mockResolvedValueOnce({ data: [row()], error: null })
 const { result } = renderHook(() => useRows([row()]))
 await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
 let done!: (x: unknown) => void
 sdk.read.mockReturnValueOnce(new Promise(resolve => { done = resolve }))
 await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
 expect(result.current[0].post_body).toBe('current body')
 await act(async () => done({ data: [{ ...row(), post_body: 'edited verified body' }], error: null }))
 expect(result.current[0].post_body).toBe('edited verified body')
})


it('background verification commits without an intermediate missing-draft render', async () => {
 sdk.read.mockResolvedValue({ data: [row()], error: null })
 const counts: number[] = []
 renderHook(() => { const rows = useRows([row(),row(b,null,false)]); counts.push(rows.length); return rows })
 await act(async () => { await vi.advanceTimersByTimeAsync(20000) })
 expect(counts.every(n => n === 2)).toBe(true)
})
