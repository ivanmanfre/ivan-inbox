// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ContentDraft, ContentDraftDetail, ContentPage } from '../lib/content'
const lib = vi.hoisted(() => ({ fetchContentDrafts: vi.fn(), fetchLaneProbe: vi.fn(), fetchDraftDetail: vi.fn() }))
const channels = vi.hoisted(() => ({ callbacks: new Map<string, () => void>() }))
vi.mock('../lib/content', async orig => ({ ...(await orig<typeof import('../lib/content')>()), ...lib }))
vi.mock('../lib/supabase', () => ({ supabase: { channel: (topic: string) => {
 const chain = { on: (_event: string, _filter: unknown, callback: () => void) => { channels.callbacks.set(topic, callback); return chain }, subscribe: () => chain }
 return chain
}, removeChannel: vi.fn() } }))
import { useContent, useDraftDetail } from './useContent'
const row = (id: string, member = false): ContentDraft => ({ id, cb34_p2_member: member, client_id: null, status: 'review', type: 'text', title: id, topic: null, post_body: 'Stored full body', scheduled_at: null, source_post_id: null, image_urls: null, taxonomy: null, created_at: '2026-10-01', updated_at: '2026-10-01' })
beforeEach(() => { vi.clearAllMocks(); channels.callbacks.clear(); lib.fetchLaneProbe.mockResolvedValue({ scoped: 0, total: 0 }) })
afterEach(cleanup)
it('an older member response cannot replace a newer empty validation result', async () => {
 let older!: (value: ContentPage) => void
 lib.fetchContentDrafts.mockReturnValueOnce(new Promise(resolve => { older = resolve }))
 const { result } = renderHook(() => useContent('ivan'))
 lib.fetchContentDrafts.mockResolvedValueOnce({ rows: [], count: 0 })
 act(() => result.current.refresh())
 await waitFor(() => expect(result.current.loadedAt).not.toBeNull())
 await act(async () => older({ rows: [row('obsolete', true)], count: 1 }))
 expect(result.current.drafts).toEqual([])
 expect(result.current.buckets.review).toEqual([])
 expect(result.current.loading).toBe(false)
})
it('an obsolete lane result and error cannot modify the active lane', async () => {
 let reject!: (error: Error) => void
 lib.fetchContentDrafts.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail }))
 const { result, rerender } = renderHook(({ lane }) => useContent(lane), { initialProps: { lane: 'ivan' as 'ivan' | 'arch' } })
 lib.fetchContentDrafts.mockResolvedValueOnce({ rows: [row('ordinary')], count: 1 })
 rerender({ lane: 'arch' })
 await waitFor(() => expect(result.current.drafts.map(r => r.id)).toEqual(['ordinary']))
 await act(async () => reject(new Error('obsolete lane error')))
 expect(result.current.error).toBeNull()
 expect(result.current.drafts.map(r => r.id)).toEqual(['ordinary'])
})
it('clears an open member synchronously on external invalidation and revalidates to missing', async () => {
 lib.fetchDraftDetail.mockResolvedValueOnce(row('member', true) as ContentDraftDetail)
 const { result } = renderHook(() => useDraftDetail('member'))
 await waitFor(() => expect(result.current.detail?.id).toBe('member'))
 let resolve!: (value: null) => void
 lib.fetchDraftDetail.mockReturnValueOnce(new Promise(done => { resolve = done }))
 act(() => window.dispatchEvent(new Event('wb-rows-changed')))
 expect(result.current.detail).toBeNull()
 expect(result.current.loading).toBe(true)
 await waitFor(() => expect(lib.fetchDraftDetail).toHaveBeenCalledTimes(2))
 await act(async () => resolve(null))
 expect(result.current.missing).toBe(true)
 expect(result.current.detail).toBeNull()
})
it('external invalidation leaves an ordinary editor mounted with its current detail', async () => {
 lib.fetchDraftDetail.mockResolvedValueOnce(row('ordinary') as ContentDraftDetail)
 const { result } = renderHook(() => useDraftDetail('ordinary'))
 await waitFor(() => expect(result.current.detail?.id).toBe('ordinary'))
 act(() => window.dispatchEvent(new Event('wb-rows-changed')))
 expect(result.current.detail?.id).toBe('ordinary')
 expect(lib.fetchDraftDetail).toHaveBeenCalledTimes(1)
})

it('keeps member invalidation subscribed while revalidation is pending and rejects that obsolete detail', async () => {
 lib.fetchDraftDetail.mockResolvedValueOnce(row('member', true) as ContentDraftDetail)
 const { result } = renderHook(() => useDraftDetail('member'))
 await waitFor(() => expect(result.current.detail?.id).toBe('member'))
 let older!: (value: ContentDraftDetail) => void
 lib.fetchDraftDetail.mockReturnValueOnce(new Promise(done => { older = done }))
 act(() => window.dispatchEvent(new Event('wb-rows-changed')))
 await waitFor(() => expect(lib.fetchDraftDetail).toHaveBeenCalledTimes(2))
 lib.fetchDraftDetail.mockResolvedValueOnce(null)
 act(() => window.dispatchEvent(new Event('wb-rows-changed')))
 await waitFor(() => expect(result.current.missing).toBe(true))
 await act(async () => older(row('member', true) as ContentDraftDetail))
 expect(result.current.detail).toBeNull(); expect(result.current.missing).toBe(true)
})

it('cancels refresh callbacks after unmount', async () => {
 lib.fetchContentDrafts.mockResolvedValue({ rows: [], count: 0 })
 const { result, unmount } = renderHook(() => useContent('ivan'))
 await waitFor(() => expect(result.current.loadedAt).not.toBeNull())
 const refresh = result.current.refresh
 unmount(); refresh()
 expect(lib.fetchContentDrafts).toHaveBeenCalledTimes(1)
})

it('membership-only wb invalidation synchronously clears list members but keeps ordinary rows while safe refresh is pending', async () => {
 lib.fetchContentDrafts.mockResolvedValueOnce({ rows: [row('member', true),row('ordinary')], count: 2 })
 const { result } = renderHook(() => useContent('ivan'))
 await waitFor(() => expect(result.current.drafts).toHaveLength(2))
 let done!: (p: ContentPage) => void
 lib.fetchContentDrafts.mockReturnValueOnce(new Promise(resolve => { done = resolve }))
 act(() => window.dispatchEvent(new Event('wb-rows-changed')))
 expect(result.current.drafts.map(r => r.id)).toEqual(['ordinary'])
 expect(result.current.buckets.review.map(r => r.id)).toEqual(['ordinary'])
 await act(async () => done({ rows: [row('ordinary')], count: 1 }))
 expect(result.current.drafts.map(r => r.id)).toEqual(['ordinary'])
})
