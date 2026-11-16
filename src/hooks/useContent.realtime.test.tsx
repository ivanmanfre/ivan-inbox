// @vitest-environment jsdom
// 2026-11-16 speed review: a lane re-reads on a carousel_drafts change only when the change can move ITS
// list, and on any change while its own read is still in flight (that answer may predate the change).
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ContentDraft } from '../lib/content'
const lib = vi.hoisted(() => ({ fetchContentDrafts: vi.fn(), fetchLaneProbe: vi.fn(), fetchDraftDetail: vi.fn(), onChange: [] as ((p: unknown) => void)[] }))
vi.mock('../lib/content', async orig => ({ ...(await orig<typeof import('../lib/content')>()), fetchContentDrafts: lib.fetchContentDrafts, fetchLaneProbe: lib.fetchLaneProbe, fetchDraftDetail: lib.fetchDraftDetail }))
vi.mock('../lib/supabase', () => ({ supabase: { channel: (topic: string) => { const chain = { on: (_e: unknown, f: { table?: string }, cb: (p: unknown) => void) => { if (topic.startsWith('carousel_drafts:ivan') && f.table === 'carousel_drafts') lib.onChange.push(cb); return chain }, subscribe: () => chain }; return chain }, removeChannel: vi.fn() } }))
import { forget } from '../lib/pageMemo'
import { useContent } from './useContent'

const row = (id: string): ContentDraft => ({ id, cb34_p2_member: false, client_id: null, status: 'review', type: 'text', title: id, topic: null, post_body: 'Body', scheduled_at: null, source_post_id: null, image_urls: null, taxonomy: null, created_at: '2026-10-01', updated_at: '2026-10-01' })
const change = (p: unknown) => act(() => { lib.onChange.forEach(cb => cb(p)) })
beforeEach(() => { vi.clearAllMocks(); lib.onChange = []; lib.fetchLaneProbe.mockResolvedValue({ scoped: 1, total: 1 }) })
afterEach(() => { cleanup(); forget() })

it('any change while the first read is in flight re-reads; after it, only changes that touch the lane do', async () => {
  let first!: (v: unknown) => void
  lib.fetchContentDrafts.mockReturnValueOnce(new Promise(resolve => { first = resolve })).mockResolvedValue({ rows: [row('a')], count: 1 })
  const h = renderHook(() => useContent('ivan'))
  await change({ new: {}, old: { id: 'a' } }) // a delete the pending answer may still hold
  expect(lib.fetchContentDrafts).toHaveBeenCalledTimes(2)
  await act(async () => { first({ rows: [row('a')], count: 1 }) })
  await waitFor(() => expect(h.result.current.loading).toBe(false))
  const n = lib.fetchContentDrafts.mock.calls.length
  await change({ new: { id: 'x', client_id: 'arch' }, old: { id: 'x' } })
  await change({ new: {}, old: { id: 'not-ours' } })
  expect(lib.fetchContentDrafts).toHaveBeenCalledTimes(n)
  await change({ new: { id: 'y', client_id: null }, old: { id: 'y' } })
  expect(lib.fetchContentDrafts).toHaveBeenCalledTimes(n + 1)
  await waitFor(() => expect(h.result.current.loading).toBe(false))
  await change({ new: { id: 'a', client_id: 'arch' }, old: { id: 'a' } }) // moved out
  expect(lib.fetchContentDrafts).toHaveBeenCalledTimes(n + 2)
})
