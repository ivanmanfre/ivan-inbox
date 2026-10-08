// @vitest-environment jsdom
// PERF-SMOOTH (2026-10-08): a second useContent mount opens on the first one's ordinary rows, never on
// a member draft (a member waits for its own validation), and still reads; a hung read over the
// remembered copy keeps `fromMemo` true so the callers' stall clock still runs.
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ContentDraft } from '../lib/content'
const lib = vi.hoisted(() => ({ fetchContentDrafts: vi.fn(), fetchLaneProbe: vi.fn(), fetchDraftDetail: vi.fn() }))
vi.mock('../lib/content', async orig => ({ ...(await orig<typeof import('../lib/content')>()), ...lib }))
vi.mock('../lib/supabase', () => ({ supabase: { channel: () => { const chain = { on: () => chain, subscribe: () => chain }; return chain }, removeChannel: vi.fn() } }))
import { forget } from '../lib/pageMemo'
import { useContent } from './useContent'

const row = (id: string, member = false): ContentDraft => ({ id, cb34_p2_member: member, client_id: null, status: 'review', type: 'text', title: id, topic: null, post_body: 'Body', scheduled_at: null, source_post_id: null, image_urls: null, taxonomy: null, created_at: '2026-10-01', updated_at: '2026-10-01' })
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.setItem('sb-test-auth-token', JSON.stringify({ user: { id: 'u1' } }))
  lib.fetchLaneProbe.mockResolvedValue({ scoped: 2, total: 5 })
})
afterEach(() => { cleanup(); forget(); localStorage.clear() })

it('the second mount paints the ordinary rows at once, without the member draft, and reads again', async () => {
  lib.fetchContentDrafts.mockResolvedValueOnce({ rows: [row('a'), row('m', true)], count: 2 })
  const first = renderHook(() => useContent('ivan'))
  await waitFor(() => expect(first.result.current.loadedAt).not.toBeNull())
  expect(first.result.current.drafts.map(r => r.id)).toEqual(['a', 'm'])
  expect(first.result.current.fromMemo).toBe(false)
  first.unmount()
  lib.fetchContentDrafts.mockReturnValueOnce(new Promise(() => {}))
  const second = renderHook(() => useContent('ivan'))
  expect(second.result.current.drafts.map(r => r.id)).toEqual(['a'])
  expect(second.result.current.buckets).toBeDefined()
  expect(second.result.current.loadedAt).not.toBeNull()
  expect(second.result.current.fromMemo).toBe(true)
  expect(second.result.current.loading).toBe(true)
  expect(second.result.current.matched).toBe(2)
  expect(second.result.current.laneTotal).toBe(5)
  expect(lib.fetchContentDrafts).toHaveBeenCalledTimes(2)
})

it('a held read (enabled false) opens empty, as before', async () => {
  lib.fetchContentDrafts.mockResolvedValueOnce({ rows: [row('a')], count: 1 })
  const first = renderHook(() => useContent('ivan'))
  await waitFor(() => expect(first.result.current.loadedAt).not.toBeNull())
  first.unmount()
  const held = renderHook(() => useContent('ivan', false))
  expect(held.result.current.drafts).toEqual([])
  expect(held.result.current.loadedAt).toBeNull()
})

it('another lane never opens on this lane\'s copy, and an empty read never replaces a full copy', async () => {
  lib.fetchContentDrafts.mockResolvedValueOnce({ rows: [row('a')], count: 1 })
  const first = renderHook(() => useContent('ivan'))
  await waitFor(() => expect(first.result.current.loadedAt).not.toBeNull())
  first.unmount()
  lib.fetchContentDrafts.mockReturnValueOnce(new Promise(() => {}))
  const arch = renderHook(() => useContent('arch'))
  expect(arch.result.current.drafts).toEqual([])
  arch.unmount()
  lib.fetchContentDrafts.mockResolvedValueOnce({ rows: [], count: 0 })
  const empty = renderHook(() => useContent('ivan'))
  await waitFor(() => expect(empty.result.current.fromMemo).toBe(false))
  expect(empty.result.current.drafts).toEqual([])
  empty.unmount()
  lib.fetchContentDrafts.mockReturnValueOnce(new Promise(() => {}))
  const again = renderHook(() => useContent('ivan'))
  expect(again.result.current.drafts.map(r => r.id)).toEqual(['a'])
})
