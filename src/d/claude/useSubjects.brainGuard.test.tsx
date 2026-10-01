// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ContentDraftDetail } from '../../lib/content'
const mock = vi.hoisted(() => ({ fetchDraftDetail: vi.fn(), from: vi.fn(), safeRows: [] as { client_id: string | null }[] }))
vi.mock('../../lib/content', async orig => ({ ...(await orig<typeof import('../../lib/content')>()), ...mock }))
vi.mock('../../lib/supabase', () => ({ supabase: { from: mock.from, channel: () => { const chain = { on: () => chain, subscribe: () => chain }; return chain }, removeChannel: vi.fn() } }))
import { useGlanceCounts } from '../../exp/v2c/useGlanceCounts'
import { useSubjects } from './useSubjects'
import { clearClaudeHandoff } from '../ui/claudeHandoff'
const route = { place: 'content' as const, sub: 'now', query: new URLSearchParams('draft=member&lane=ivan') }
const draft = (member: boolean) => ({ id: 'member', cb34_p2_member: member, client_id: null, status: 'review', type: 'text', title: 'Stored ordinary or released draft', topic: null, post_body: 'Stored full body', scheduled_at: null, updated_at: '2026-10-01', qa: { verdict: 'PASS', score: 9 } }) as ContentDraftDetail
beforeEach(() => {
 mock.fetchDraftDetail.mockReset(); mock.from.mockReset(); mock.safeRows = []; clearClaudeHandoff()
 mock.from.mockImplementation((table: string) => {
  const chain: Record<string, unknown> = {}
  for (const key of ['select', 'eq', 'gte', 'is', 'in', 'or']) chain[key] = () => chain
  chain.then = (resolve: (value: unknown) => unknown) => {
   const rows = table === 'cb34_p2_safe_drafts' ? mock.safeRows : table === 'carousel_drafts' ? [{ client_id: null }] : []
   return Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve)
  }
  return chain
 })
})
afterEach(cleanup)
it('a held or missing draft produces no title, summary or body attachment', async () => {
 mock.fetchDraftDetail.mockResolvedValue(null)
 const { result } = renderHook(() => useSubjects(route))
 await waitFor(() => expect(mock.fetchDraftDetail).toHaveBeenCalledOnce())
 expect(result.current.some(subject => subject.kind === 'draft')).toBe(false)
 expect(JSON.stringify(result.current)).not.toContain('Stored full body')
})
it('clears a released member attachment immediately on external invalidation, then accepts missing', async () => {
 mock.fetchDraftDetail.mockResolvedValueOnce(draft(true))
 const { result } = renderHook(() => useSubjects(route))
 await waitFor(() => expect(result.current.find(subject => subject.kind === 'draft')?.full).toBe('Stored full body'))
 let resolve!: (value: null) => void
 mock.fetchDraftDetail.mockReturnValueOnce(new Promise(done => { resolve = done }))
 act(() => window.dispatchEvent(new Event('wb-rows-changed')))
 expect(result.current.some(subject => subject.kind === 'draft')).toBe(false)
 await waitFor(() => expect(mock.fetchDraftDetail).toHaveBeenCalledTimes(2))
 await act(async () => resolve(null))
 expect(result.current.some(subject => subject.kind === 'draft')).toBe(false)
})
it('ordinary draft subjects retain body and QA summary without external refetch', async () => {
 mock.fetchDraftDetail.mockResolvedValueOnce(draft(false))
 const { result } = renderHook(() => useSubjects(route))
 await waitFor(() => expect(result.current.some(subject => subject.kind === 'draft')).toBe(true))
 act(() => window.dispatchEvent(new Event('wb-rows-changed')))
 const subject = result.current.find(subject => subject.kind === 'draft')!
 expect(subject.full).toBe('Stored full body'); expect(subject.summary).toMatch(/quality check said.*9/)
 expect(mock.fetchDraftDetail).toHaveBeenCalledOnce()
})

it('glance counts exclude held rows and retain ordinary visible counts', async () => {
 const { result, unmount } = renderHook(() => useGlanceCounts())
 await waitFor(() => expect(result.current.loadedAt).not.toBeNull())
 expect(result.current.contentReview).toBe(0)
 expect(mock.from.mock.calls.map(call => call[0])).not.toContain('carousel_drafts')
 unmount(); mock.safeRows = [{ client_id: null }, { client_id: 'risedtc' }]
 const ordinary = renderHook(() => useGlanceCounts())
 await waitFor(() => expect(ordinary.result.current.contentReview).toBe(2))
 expect(ordinary.result.current.contentReviewByLane).toMatchObject({ ivan: 1, risedtc: 1 })
})
