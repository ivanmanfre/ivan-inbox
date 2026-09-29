// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ContentDraft } from '../../lib/content'

const lib = vi.hoisted(() => ({ fetchWeekDrafts: vi.fn() }))
vi.mock('../../lib/content', async orig => ({ ...(await orig<typeof import('../../lib/content')>()), ...lib }))
vi.mock('../../lib/supabase', () => {
  const ch = { on: () => ch, subscribe: () => ch }
  return { supabase: { channel: () => ch, removeChannel: () => Promise.resolve() } }
})

import { readSwr, writeSwr } from '../../lib/swr'
import { WEEK_CACHE, toSaved, useWeekRead } from './useWeek'

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
