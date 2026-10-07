// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ContentDraft } from '../../lib/content'

const lib = vi.hoisted(() => ({ fetchWeekDrafts: vi.fn() }))
vi.mock('../../lib/content', async orig => ({ ...(await orig<typeof import('../../lib/content')>()), ...lib }))
vi.mock('../../lib/supabase', () => {
  const ch = { on: () => ch, subscribe: () => ch }
  return { supabase: { channel: () => ch, removeChannel: () => Promise.resolve() } }
})

import { readSwr, writeSwr } from '../../lib/swr'
import { WEEK_CACHE, toSaved, useWeekRead, memberFitsWeek } from './useWeek'

const NOW = Date.parse('2026-09-29T10:00:00Z')
const row = (o: Partial<ContentDraft>): ContentDraft => ({
  id: 'x', client_id: null, status: 'review', type: 'text', title: 'T', topic: null, post_body: 'Body',
  scheduled_at: null, published_at: null, source_post_id: null, image_urls: null, taxonomy: null,
  created_at: '2026-09-29T08:00:00Z', updated_at: '2026-09-29T08:00:00Z', board_visible: null, ...o,
} as ContentDraft)

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('sb-test-auth-token', JSON.stringify({ user: { id: 'u1' } }))
  lib.fetchWeekDrafts.mockReset()
})
afterEach(cleanup)

describe('the week read: saved copy first, then one small read', () => {
  it('paints the saved week on the first render, then replaces it with the live read and saves that', async () => {
    writeSwr(WEEK_CACHE, { rows: [row({ id: 'saved' })] })
    let resolve!: (v: { rows: ContentDraft[]; count: number }) => void
    lib.fetchWeekDrafts.mockReturnValue(new Promise(r => { resolve = r }))
    const { result } = renderHook(() => useWeekRead(true, NOW))
    expect(result.current.source).toBe('cache')
    expect(result.current.rows.map(r => r.id)).toEqual(['saved'])
    resolve({ rows: [row({ id: 'live' }), row({ id: 'other-tenant', client_id: 'audn' })], count: 2 })
    await waitFor(() => expect(result.current.source).toBe('live'))
    expect(result.current.rows.map(r => r.id)).toEqual(['live'])
    expect(readSwr<{ rows: ContentDraft[] }>(WEEK_CACHE)!.payload.rows.map(r => r.id)).toEqual(['live'])
  })

  it('reads only the week: one call, a window of a week back to nine days ahead', async () => {
    lib.fetchWeekDrafts.mockResolvedValue({ rows: [], count: 0 })
    renderHook(() => useWeekRead(true, NOW))
    await waitFor(() => expect(lib.fetchWeekDrafts).toHaveBeenCalledTimes(1))
    const [from, to] = lib.fetchWeekDrafts.mock.calls[0]
    expect(Date.parse(to) - Date.parse(from)).toBe(17 * 86_400_000)
  })

  it('an empty answer over a saved week that held posts is a failed refresh, never a truth', async () => {
    writeSwr(WEEK_CACHE, { rows: [row({ id: 'saved' })] })
    lib.fetchWeekDrafts.mockResolvedValue({ rows: [], count: 0 })
    const { result } = renderHook(() => useWeekRead(true, NOW))
    await waitFor(() => expect(result.current.settled).toBe(true))
    expect(result.current.rows.map(r => r.id)).toEqual(['saved'])
    expect(result.current.source).toBe('cache')
    expect(result.current.error).toMatch(/came back empty/)
    expect(readSwr<{ rows: ContentDraft[] }>(WEEK_CACHE)!.payload.rows).toHaveLength(1)
  })

  it('a failed read keeps the saved copy and writes nothing', async () => {
    writeSwr(WEEK_CACHE, { rows: [row({ id: 'saved' })] })
    lib.fetchWeekDrafts.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useWeekRead(true, NOW))
    await waitFor(() => expect(result.current.error).toBe('offline'))
    expect(result.current.rows.map(r => r.id)).toEqual(['saved'])
  })

  it('held (not Review): no read, no paint', () => {
    writeSwr(WEEK_CACHE, { rows: [row({ id: 'saved' })] })
    const { result } = renderHook(() => useWeekRead(false, NOW))
    expect(lib.fetchWeekDrafts).not.toHaveBeenCalled()
    expect(result.current.rows).toEqual([])
  })

  it('capability links never reach storage', () => {
    const saved = toSaved([row({ post_body: 'Grab it: https://x.com/a?k=SECRET here', source_ref: 'https://x.com/b?k=SECRET' })])
    expect(JSON.stringify(saved)).not.toContain('SECRET')
    expect(saved.rows[0].post_body).toBe('Grab it: [link] here')
    expect(saved.rows[0].source_ref).toBeNull()
  })
})

it('never caches a member draft, even when its mutable taxonomy was erased', () => {
  expect(toSaved([row({ id: 'ordinary' }), row({ id: 'member', cb34_p2_member: true, taxonomy: null })]).rows.map(r => r.id)).toEqual(['ordinary'])
})
it('hides a previously released member while a revalidation fails, keeping ordinary rows', async () => {
  lib.fetchWeekDrafts.mockResolvedValueOnce({ rows: [row({ id: 'ordinary' }), row({ id: 'member', cb34_p2_member: true, taxonomy: null })], count: 2 })
  const { result } = renderHook(() => useWeekRead(true, NOW))
  await waitFor(() => expect(result.current.source).toBe('live'))
  expect(result.current.rows).toHaveLength(2)
  lib.fetchWeekDrafts.mockRejectedValueOnce(new Error('guard unavailable'))
  act(() => result.current.refresh())
  await waitFor(() => expect(result.current.error).toBe('guard unavailable'))
  expect(result.current.rows.map(r => r.id)).toEqual(['ordinary'])
})
it('accepts the safe empty response after the only member draft was invalidated', async () => {
  lib.fetchWeekDrafts.mockResolvedValueOnce({ rows: [row({ id: 'member', cb34_p2_member: true })], count: 1 })
  const { result } = renderHook(() => useWeekRead(true, NOW))
  await waitFor(() => expect(result.current.source).toBe('live'))
  lib.fetchWeekDrafts.mockResolvedValueOnce({ rows: [], count: 0 })
  act(() => result.current.refresh())
  await waitFor(() => expect(result.current.rows).toEqual([]))
  expect(result.current.error).toBeNull()
})

it('rejects an obsolete delayed member response after a newer safe empty read', async () => {
 let older!: (page: { rows: ContentDraft[]; count: number }) => void
 lib.fetchWeekDrafts.mockReturnValueOnce(new Promise(resolve => { older = resolve }))
 const { result } = renderHook(() => useWeekRead(true, NOW))
 lib.fetchWeekDrafts.mockResolvedValueOnce({ rows: [], count: 0 })
 act(() => result.current.refresh())
 await waitFor(() => expect(result.current.source).toBe('live'))
 await act(async () => older({ rows: [row({ id: 'obsolete-member', cb34_p2_member: true })], count: 1 }))
 expect(result.current.rows).toEqual([])
 expect(result.current.error).toBeNull()
 expect(result.current.loading).toBe(false)
})
it('an obsolete failure/finally cannot settle a newer pending refresh', async () => {
 let fail!: (error: Error) => void
 lib.fetchWeekDrafts.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject }))
 const { result } = renderHook(() => useWeekRead(true, NOW))
 let newer!: (page: { rows: ContentDraft[]; count: number }) => void
 lib.fetchWeekDrafts.mockReturnValueOnce(new Promise(resolve => { newer = resolve }))
 act(() => result.current.refresh())
 await act(async () => fail(new Error('obsolete failure')))
 expect(result.current.error).toBeNull(); expect(result.current.loading).toBe(true); expect(result.current.settled).toBe(false)
 await act(async () => newer({ rows: [], count: 0 }))
 expect(result.current.loading).toBe(false)
})

it('external week invalidation hides members immediately before its debounced reread', async () => {
 lib.fetchWeekDrafts.mockResolvedValueOnce({ rows: [row({ id: 'ordinary' }), row({ id: 'member', cb34_p2_member: true })], count: 2 })
 const { result } = renderHook(() => useWeekRead(true, NOW))
 await waitFor(() => expect(result.current.source).toBe('live'))
 act(() => window.dispatchEvent(new Event('wb-rows-changed')))
 expect(result.current.rows.map(r => r.id)).toEqual(['ordinary'])
 expect(result.current.loading).toBe(true)
})

it('does not paint or cache a late member response after unmount', async () => {
 let resolve!: (page: { rows: ContentDraft[]; count: number }) => void
 lib.fetchWeekDrafts.mockReturnValueOnce(new Promise(done => { resolve = done }))
 const { result, unmount } = renderHook(() => useWeekRead(true, NOW))
 const refresh = result.current.refresh
 unmount(); refresh()
 await act(async () => resolve({ rows: [row({ id: 'member', cb34_p2_member: true })], count: 1 }))
 expect(lib.fetchWeekDrafts).toHaveBeenCalledTimes(1)
 expect(readSwr(WEEK_CACHE)).toBeNull()
})

it('fresh members moving outside the exact week or to an unrelated tenant are not restored', () => {
 expect(memberFitsWeek(row({ status: 'review', scheduled_at: null }), NOW)).toBe(true)
 expect(memberFitsWeek(row({ status: 'scheduled', scheduled_at: '2026-09-30T10:00:00Z' }), NOW)).toBe(true)
 expect(memberFitsWeek(row({ status: 'scheduled', scheduled_at: '2026-11-01T10:00:00Z' }), NOW)).toBe(false)
 expect(memberFitsWeek(row({ status: 'published', scheduled_at: null }), NOW)).toBe(false)
 expect(memberFitsWeek(row({ client_id: 'unrelated' }), NOW)).toBe(false)
})
