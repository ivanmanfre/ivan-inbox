// @vitest-environment jsdom
import { act, fireEvent, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fetchBrief, readCache, writeCache, type Brief } from '../lib/today'
import { useToday } from './useToday'

vi.mock('../lib/today', async orig => ({
  ...await orig<typeof import('../lib/today')>(),
  fetchBrief: vi.fn(), readCache: vi.fn(), writeCache: vi.fn(), fetchReplyCounts: vi.fn(async () => []),
}))
vi.mock('../lib/kpis', () => ({
  fetchAccept: vi.fn(async () => []), fetchPipeline: vi.fn(async () => []), fetchGovernor: vi.fn(async () => []),
}))

const oldAt = '2026-10-01T08:00:00Z'
const rankedAt = '2026-10-09T18:30:00Z'
const brief: Brief = {
  generated_at: rankedAt,
  urgencies: [], needs_you: { comment_drafts: [], dm_drafts: [], feed_drafts: [] },
  today_content: { scheduled_posts: [] },
}
const full = { ...brief, _cache: { generated_at: rankedAt, from_cache: true } }
const counts = { mode: 'counts', urgencies_count: 0, approvals: { comments: 0, dms: 0, feed: 0 } }

beforeEach(() => {
  vi.mocked(readCache).mockReturnValue({ brief, fetched_at: oldAt })
  vi.mocked(fetchBrief).mockImplementation(async mode => mode === 'counts' ? counts : full)
})
afterEach(() => { vi.restoreAllMocks(); vi.mocked(fetchBrief).mockReset(); vi.mocked(readCache).mockReset(); vi.mocked(writeCache).mockReset() })

it('uses cached transport on mount and throttled focus, but forces explicit refresh', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(100_000)
  const read = renderHook(() => useToday())
  expect(read.result.current.brief).toEqual(brief)
  expect(read.result.current.cachedAt).toBe(oldAt)
  await waitFor(() => expect(read.result.current.refreshing).toBe(false))
  expect(vi.mocked(fetchBrief).mock.calls.slice(0, 2)).toEqual([['counts', false], ['full', false]])

  now.mockReturnValue(150_000)
  fireEvent.focus(window)
  expect(fetchBrief).toHaveBeenCalledTimes(2)
  now.mockReturnValue(161_000)
  fireEvent.focus(window)
  await waitFor(() => expect(fetchBrief).toHaveBeenCalledTimes(4))
  expect(vi.mocked(fetchBrief).mock.calls.slice(2, 4)).toEqual([['counts', false], ['full', false]])

  await act(async () => { await read.result.current.refresh() })
  expect(vi.mocked(fetchBrief).mock.calls.slice(4)).toEqual([['counts', true], ['full', true]])
})

it('keeps the server cache timestamp instead of claiming the refresh happened now', async () => {
  const read = renderHook(() => useToday())
  expect(read.result.current.cachedAt).toBe(oldAt)
  await waitFor(() => expect(read.result.current.refreshing).toBe(false))
  expect(read.result.current.cachedAt).toBe(rankedAt)
  expect(read.result.current.fromCache).toBe(true)
  expect(writeCache).toHaveBeenCalledWith(expect.objectContaining({ generated_at: rankedAt }), rankedAt)
})
