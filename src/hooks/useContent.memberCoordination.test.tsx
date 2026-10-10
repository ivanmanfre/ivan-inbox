// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const sdk = vi.hoisted(() => ({ read: vi.fn(), ids: [] as string[][], status: null as null | ((status: string) => void) }))
const lib = vi.hoisted(() => ({ fetchContentDrafts: vi.fn(), fetchLaneProbe: vi.fn() }))
vi.mock('../lib/content', async original => ({ ...(await original<typeof import('../lib/content')>()), ...lib }))
vi.mock('../lib/supabase', () => ({ supabase: {
 auth: { getSession: async () => ({ data: { session: { user: { id: 'operator' } } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) },
 channel: () => { const c = { on: () => c, subscribe: (callback?: (status: string) => void) => { if (callback) sdk.status = callback; return c } }; return c }, removeChannel: vi.fn(),
 from: () => { let ids: string[] = []; const q = { select: () => q, in: (_: string, values: string[]) => { ids = values; return q }, is: () => q, eq: () => q, abortSignal: () => { sdk.ids.push(ids); return sdk.read(ids) } }; return q },
} }))
// Both the real consumer and real singleton broker are exercised: neither is mocked.
import { useContent } from './useContent'
import type { ContentDraft, ContentPage } from '../lib/content'
const a = '11111111-1111-1111-1111-111111111111', b = '22222222-2222-2222-2222-222222222222', ordinary = '33333333-3333-3333-3333-333333333333'
const row = (id: string, member = true, client: string | null = null): ContentDraft => ({ id, cb34_p2_member: member, client_id: client, title: id, status: 'review', post_body: 'fresh '+id, qa: { verdict: 'PASS' }, taxonomy: null } as unknown as ContentDraft)
const page = (...rows: ContentDraft[]): ContentPage => ({ rows, count: rows.length })
beforeEach(() => { vi.useFakeTimers(); lib.fetchContentDrafts.mockReset(); lib.fetchLaneProbe.mockResolvedValue({ scoped: 2, total: 2 }); sdk.read.mockReset(); sdk.ids = []; sdk.status = null; Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'}) })
afterEach(() => { cleanup(); vi.useRealTimers() })
it('event admits new B through full A+B before subset A; older subset cannot delete B', async () => {
 let full!: (p: ContentPage) => void, subset!: (p: unknown) => void
 lib.fetchContentDrafts.mockResolvedValueOnce(page(row(a),row(ordinary,false))).mockReturnValueOnce(new Promise(resolve => { full = resolve }))
 sdk.read.mockReturnValueOnce(new Promise(resolve => { subset = resolve }))
 const { result } = renderHook(() => useContent('ivan'))
 await act(async () => {}); expect(result.current.drafts).toHaveLength(2)
 act(() => window.dispatchEvent(new Event('wb-rows-changed')))
 expect(result.current.drafts.map(r => r.id)).toEqual([ordinary])
 await act(async () => full(page(row(a),row(b),row(ordinary,false))))
 await act(async () => subset({ data: [row(a)], error: null }))
 expect(result.current.drafts.map(r => r.id)).toEqual([a,b,ordinary]); expect(result.current.matched).toBe(3)
})
it('subset A before slow full A+B stays hidden during the full read; repeated polls do not starve B', async () => {
 let full!: (p: ContentPage) => void
 lib.fetchContentDrafts.mockResolvedValueOnce(page(row(a),row(ordinary,false))).mockReturnValueOnce(new Promise(resolve => { full = resolve }))
 sdk.read.mockResolvedValueOnce({ data: [row(a)], error: null })
 const { result } = renderHook(() => useContent('ivan'))
 await act(async () => {}); expect(result.current.drafts).toHaveLength(2)
 await act(async () => window.dispatchEvent(new Event('wb-rows-changed')))
 expect(result.current.drafts.map(r => r.id)).toEqual([ordinary])
 await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
 expect(sdk.read).toHaveBeenCalledTimes(1)
 await act(async () => full(page(row(a),row(b),row(ordinary,false))))
 expect(result.current.drafts.map(r => r.id)).toEqual([a,b,ordinary])
})
it('hold supersedes an older full A+B and old subset A, while newer full B and ordinary remain', async () => {
 let oldFull!: (p: ContentPage) => void, oldSubset!: (p: unknown) => void
 lib.fetchContentDrafts.mockResolvedValueOnce(page(row(a),row(ordinary,false))).mockReturnValueOnce(new Promise(resolve => { oldFull = resolve })).mockResolvedValueOnce(page(row(b),row(ordinary,false)))
 sdk.read.mockReturnValueOnce(new Promise(resolve => { oldSubset = resolve })).mockResolvedValue({ data: [row(b)], error: null })
 const { result } = renderHook(() => useContent('ivan'))
 await act(async () => {}); expect(result.current.drafts).toHaveLength(2)
 act(() => window.dispatchEvent(new Event('wb-rows-changed')))
 await act(async () => window.dispatchEvent(new Event('wb-rows-changed')))
 await act(async () => { oldFull(page(row(a),row(b),row(ordinary,false))); oldSubset({ data: [row(a)], error: null }) })
 expect(result.current.drafts.map(r => r.id).sort()).toEqual([b,ordinary].sort())
 expect(result.current.drafts.some(r => r.id === a)).toBe(false)
})
it('Ivan member polling does not obsolete a slow ordinary Arch full read', async () => {
 let arch!: (p: ContentPage) => void
 lib.fetchContentDrafts.mockImplementation((lane: string) => lane === 'ivan' ? Promise.resolve(page(row(a))) : new Promise(resolve => { arch = resolve }))
 sdk.read.mockResolvedValue({ data: [row(a)], error: null })
 const { result } = renderHook(() => ({ ivan: useContent('ivan'), arch: useContent('arch') }))
 await act(async () => {}); expect(result.current.ivan.drafts).toHaveLength(1)
 await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
 expect(sdk.read).toHaveBeenCalledTimes(2)
 await act(async () => arch(page(row(ordinary,false,'arch'))))
 expect(result.current.arch.drafts.map(r => r.id)).toEqual([ordinary])
})

it('deferred subset IDs recover after a full transport failure while ordinary rows and the full-read error remain truthful', async () => {
 let failFull!: (e: Error) => void
 lib.fetchContentDrafts.mockResolvedValueOnce(page(row(a),row(ordinary,false))).mockReturnValueOnce(new Promise((_resolve,reject) => { failFull = reject }))
 sdk.read.mockResolvedValue({ data: [row(a)], error: null })
 const { result } = renderHook(() => useContent('ivan'))
 await act(async () => {}); expect(result.current.drafts).toHaveLength(2)
 await act(async () => window.dispatchEvent(new Event('wb-rows-changed')))
 expect(result.current.drafts.map(r => r.id)).toEqual([ordinary])
 await act(async () => failFull(new Error('full lane unavailable')))
 await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
 expect(sdk.read).toHaveBeenCalledTimes(2)
 expect(result.current.drafts.map(r => r.id).sort()).toEqual([a,ordinary].sort())
 expect(result.current.error).toBe('full lane unavailable'); expect(result.current.matched).toBeNull()
})

it('reconnect discovers B released during disconnect through a full safe refresh without error-status storms', async () => {
 lib.fetchContentDrafts.mockResolvedValueOnce(page(row(a),row(ordinary,false))).mockResolvedValueOnce(page(row(a),row(b),row(ordinary,false)))
 sdk.read.mockResolvedValue({ data: [row(a)], error: null })
 const { result } = renderHook(() => useContent('ivan'))
 await act(async () => {}); expect(result.current.drafts).toHaveLength(2)
 await act(async () => sdk.status?.('CHANNEL_ERROR'))
 expect(lib.fetchContentDrafts).toHaveBeenCalledTimes(1)
 await act(async () => sdk.status?.('SUBSCRIBED'))
 expect(lib.fetchContentDrafts).toHaveBeenCalledTimes(2)
 expect(result.current.drafts.map(r => r.id)).toEqual([a,b,ordinary])
 expect(result.current.matched).toBe(3)
})


it('routine rechecks keep the lane count steady while waiting and leave unchanged rows alone', async () => {
 lib.fetchContentDrafts.mockResolvedValue(page(row(a),row(ordinary,false)))
 sdk.read.mockResolvedValue({ data: [row(a)], error: null })
 const { result } = renderHook(() => useContent('ivan'))
 await act(async () => {})
 await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
 const checked = result.current.drafts
 let done!: (p: unknown) => void
 sdk.read.mockReturnValueOnce(new Promise(resolve => { done = resolve }))
 await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
 expect(result.current.drafts).toBe(checked)
 expect(result.current.drafts).toHaveLength(2)
 expect(result.current.memberReadState).toBe('partial')
 await act(async () => done({ data: [row(a)], error: null }))
 expect(result.current.drafts).toBe(checked)
})

it('a full read landing during a routine check keeps newly discovered members', async () => {
 lib.fetchContentDrafts.mockResolvedValueOnce(page(row(a),row(ordinary,false))).mockResolvedValueOnce(page(row(a),row(b),row(ordinary,false)))
 let done!: (p: unknown) => void
 sdk.read.mockReturnValueOnce(new Promise(resolve => { done = resolve }))
 const { result } = renderHook(() => useContent('ivan'))
 await act(async () => {})
 await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
 await act(async () => result.current.refresh())
 await act(async () => done({ data: [row(a)], error: null }))
 expect(result.current.drafts.map(r => r.id)).toEqual([a,b,ordinary])
 expect(result.current.matched).toBe(3)
})


it('an unchanged safe answer still replaces a differing full-read body', async () => {
 lib.fetchContentDrafts.mockResolvedValueOnce(page(row(a))).mockResolvedValueOnce(page({ ...row(a), post_body: 'different full-read body' }))
 sdk.read.mockResolvedValue({ data: [row(a)], error: null })
 const { result } = renderHook(() => useContent('ivan'))
 await act(async () => {})
 await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
 await act(async () => result.current.refresh())
 expect(result.current.drafts[0].post_body).toBe('different full-read body')
 await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
 expect(result.current.drafts[0].post_body).toBe('fresh '+a)
})


it('a failed old routine check cannot hide members verified by a newer full read', async () => {
 lib.fetchContentDrafts.mockResolvedValueOnce(page(row(a),row(ordinary,false))).mockResolvedValueOnce(page(row(a),row(b),row(ordinary,false)))
 let fail!: (e: Error) => void
 sdk.read.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject }))
 const { result } = renderHook(() => useContent('ivan'))
 await act(async () => {})
 await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
 await act(async () => result.current.refresh())
 await act(async () => fail(new Error('old check failed')))
 expect(result.current.drafts.map(r => r.id)).toEqual([a,b,ordinary])
 expect(result.current.matched).toBe(3)
})
