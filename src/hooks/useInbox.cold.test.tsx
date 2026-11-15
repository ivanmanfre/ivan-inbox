// @vitest-environment jsdom
// PERF-COLD (2026-10-08): a cold screen paints the newest page while the rest is read. That paint is
// provisional: no cache write, no loadedAt, loading stays true, and a failed read takes it back off.
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxMessage, Thread } from '../lib/inbox'

const row = (id: string, pid: string, created_at: string): InboxMessage => ({
  id, prospect_id: pid, direction: 'inbound', message_text: `t ${id}`, message_type: 'dm', channel: 'linkedin',
  sent_at: created_at, approved_at: null, read_at: null, created_at, send_blocked_at: null, send_blocked_reason: null,
  unipile_chat_id: null, ai_model: null, prospect_name: pid, prospect_company: null, prospect_headline: null,
  prospect_stage: 'replied', prospect_email: null, profile_photo_url: null,
} as InboxMessage)

const h = vi.hoisted(() => ({
  seed: null as null | { savedAt: string; cache: { threads: Thread[] } },
  writes: [] as number[],
  gotCallback: [] as boolean[],
  release: null as null | (() => void),
  fail: false,
  lateNewest: false,
  priority: false,
}))
vi.mock('../lib/supabase', () => ({
  supabase: {
    channel: () => { const ch = { on: () => ch, subscribe: () => ch }; return ch },
    removeChannel: () => {},
  },
}))
vi.mock('../lib/inboxCache', () => ({ readInboxCache: () => h.seed, writeInboxCache: (t: Thread[]) => { h.writes.push(t.length) } }))
vi.mock('../lib/chime', () => ({ playChime: () => {} }))
vi.mock('../lib/inboxDelta', async () => {
  const real = await vi.importActual<typeof import('../lib/inboxDelta')>('../lib/inboxDelta')
  return { ...real, changedSince: async () => ({ now: '2026-10-08T10:00:00.000Z', ids: [] }), fetchConversations: async () => [] }
})
vi.mock('../lib/inboxLoad', async () => {
  const { groupThreads } = await vi.importActual<typeof import('../lib/inbox')>('../lib/inbox')
  const assemble = async (rows: InboxMessage[]) => ({ rows, threads: groupThreads(rows, new Set()) })
  const newestRows = () => [row('c1', 'C', '2026-10-08T09:00:00+00:00')]
  const allRows = () => [row('a1', 'A', '2026-06-01T10:00:00+00:00'), row('b1', 'B', '2026-07-01T10:00:00+00:00'), ...newestRows()]
  return {
    assembleInbox: assemble,
    loadInbox: async (_known: number, onNewest?: (t: Thread[], priority?: boolean) => void) => {
      const newest = newestRows(), all = allRows()
      h.gotCallback.push(Boolean(onNewest))
      if (onNewest && !h.lateNewest) onNewest((await assemble(newest)).threads, h.priority)
      await new Promise<void>(r => { h.release = r })
      if (h.fail) throw new Error('page failed')
      const res = { viewRows: all, ...(await assemble(all)) }
      if (onNewest && h.lateNewest) setTimeout(() => { void assemble(newest).then(r => onNewest(r.threads)) }, 0)
      return res
    },
  }
})
import { useInbox } from './useInbox'

const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(50) }) }

describe('useInbox cold open: the newest page paints first', () => {
  beforeEach(() => { vi.useFakeTimers(); h.seed = null; h.writes = []; h.gotCallback = []; h.release = null; h.fail = false; h.lateNewest = false; h.priority = false })
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it('paints the newest page provisionally, then the whole list; only the whole list is cached', async () => {
    const { result } = renderHook(() => useInbox())
    await tick()
    expect(result.current.threads.map(t => t.prospect_id)).toEqual(['C'])
    expect(result.current.loading).toBe(true)
    expect(result.current.loadedAt).toBeNull()
    expect(result.current.fromCache).toBe(false)
    expect(h.writes).toEqual([])
    await act(async () => { h.release!(); await vi.advanceTimersByTimeAsync(50) })
    expect(result.current.threads.map(t => t.prospect_id).sort()).toEqual(['A', 'B', 'C'])
    expect(result.current.loading).toBe(false)
    expect(result.current.loadedAt).not.toBeNull()
    expect(h.writes).toEqual([3])
  })

  it('a failed read takes the provisional page back off the screen', async () => {
    h.fail = true
    const { result } = renderHook(() => useInbox())
    await tick()
    expect(result.current.threads).toHaveLength(1)
    await act(async () => { h.release!(); await vi.advanceTimersByTimeAsync(50) })
    expect(result.current.threads).toEqual([])
    expect(result.current.error).toBe('page failed')
    expect(result.current.loadedAt).toBeNull()
    expect(h.writes).toEqual([])
  })

  it('a newest page that lands after the whole list never replaces it', async () => {
    h.lateNewest = true
    const { result } = renderHook(() => useInbox())
    await tick()
    await act(async () => { h.release!(); await vi.advanceTimersByTimeAsync(50) })
    await tick()
    expect(result.current.threads).toHaveLength(3)
  })

  // 2026-11-15 (Ivan: "is not updating"): a warm phone sat on "Saved copy from 17:03 · reading…" for the
  // whole 25-page archive read (pages up to 17 s on mobile). The complete Needs-you conversations now land
  // over the saved copy first; the rest of the saved copy stays until the whole read lands.
  it('a screen with a saved copy takes the Needs-you read over it, never the partial newest page', async () => {
    h.seed = { savedAt: '2026-10-08T08:00:00.000Z', cache: { threads: [{ prospect_id: 'S' } as Thread, { prospect_id: 'C', stale: true } as unknown as Thread] } }
    h.priority = true
    const { result } = renderHook(() => useInbox())
    await tick()
    expect(h.gotCallback).toEqual([true])
    expect(result.current.threads.map(t => t.prospect_id)).toEqual(['S', 'C'])
    expect((result.current.threads[1] as unknown as { stale?: boolean }).stale).toBeUndefined()
    expect(result.current.priorityAt).not.toBeNull()
    expect(result.current.loadedAt).toBeNull()
    expect(h.writes).toEqual([])
    await act(async () => { h.release!(); await vi.advanceTimersByTimeAsync(50) })
    expect(result.current.threads.map(t => t.prospect_id).sort()).toEqual(['A', 'B', 'C'])
    expect(h.writes).toEqual([3])
  })

  it('a saved copy ignores the partial newest page', async () => {
    h.seed = { savedAt: '2026-10-08T08:00:00.000Z', cache: { threads: [{ prospect_id: 'S' } as Thread] } }
    const { result } = renderHook(() => useInbox())
    await tick()
    expect(result.current.threads.map(t => t.prospect_id)).toEqual(['S'])
    expect(result.current.priorityAt).toBeNull()
  })

  it('a failed read over a saved copy puts the saved copy back', async () => {
    h.seed = { savedAt: '2026-10-08T08:00:00.000Z', cache: { threads: [{ prospect_id: 'S' } as Thread] } }
    h.priority = true
    h.fail = true
    const { result } = renderHook(() => useInbox())
    await tick()
    expect(result.current.threads.map(t => t.prospect_id)).toEqual(['S', 'C'])
    await act(async () => { h.release!(); await vi.advanceTimersByTimeAsync(50) })
    expect(result.current.threads.map(t => t.prospect_id)).toEqual(['S'])
    expect(result.current.priorityAt).toBeNull()
    expect(result.current.error).toBe('page failed')
    expect(h.writes).toEqual([])
  })
})
