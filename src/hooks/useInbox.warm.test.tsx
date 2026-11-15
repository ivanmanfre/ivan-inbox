// @vitest-environment jsdom
// 2026-11-15 speed review: the mount starts from the device's last whole read plus the conversations
// that moved since (lib/inboxSnapshot), never the whole view again; every doubt falls back to it.
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxMessage } from '../lib/inbox'

const row = (id: string, pid: string, created_at: string, text = `t ${id}`): InboxMessage => ({
  id, prospect_id: pid, direction: 'inbound', message_text: text, message_type: 'dm', channel: 'linkedin',
  sent_at: created_at, approved_at: null, read_at: null, created_at, send_blocked_at: null, send_blocked_reason: null,
  unipile_chat_id: null, ai_model: null, prospect_name: pid, prospect_company: null, prospect_headline: null,
  prospect_stage: 'replied', prospect_email: null, profile_photo_url: null,
} as InboxMessage)

const h = vi.hoisted(() => ({
  snapshot: null as null | { user: string; rows: InboxMessage[]; watermark: string; fullAt: number },
  changed: [] as string[] | null,
  fresh: [] as InboxMessage[],
  fullReads: 0,
  fetched: [] as string[][],
  saved: [] as { rows: number; watermark: string; fullAt: number }[],
}))
vi.mock('../lib/supabase', () => ({ supabase: { channel: () => { const ch = { on: () => ch, subscribe: () => ch }; return ch }, removeChannel: () => {} } }))
vi.mock('../lib/inboxCache', () => ({ readInboxCache: () => null, writeInboxCache: () => {} }))
vi.mock('../lib/chime', () => ({ playChime: () => {} }))
vi.mock('../lib/swr', () => ({ currentUserId: () => 'u1' }))
vi.mock('../lib/inboxSnapshot', () => ({
  SNAPSHOT_READ_MS: 2500, SNAPSHOT_SAVE_EVERY_MS: 600_000,
  readInboxSnapshot: async () => h.snapshot,
  writeInboxSnapshot: async (s: { rows: InboxMessage[]; watermark: string; fullAt: number }) => { h.saved.push({ rows: s.rows.length, watermark: s.watermark, fullAt: s.fullAt }) },
}))
vi.mock('../lib/inboxDelta', async () => {
  const real = await vi.importActual<typeof import('../lib/inboxDelta')>('../lib/inboxDelta')
  return {
    ...real,
    changedSince: async (since: string | null) => ({ now: '2026-11-15T20:00:00.000Z', ids: since === null ? [] : h.changed }),
    fetchConversations: async (ids: string[]) => { h.fetched.push(ids); return h.fresh.filter(m => ids.includes(m.prospect_id)) },
  }
})
vi.mock('../lib/inboxLoad', async () => {
  const { groupThreads } = await vi.importActual<typeof import('../lib/inbox')>('../lib/inbox')
  const assemble = async (rows: InboxMessage[]) => ({ rows, threads: groupThreads(rows, new Set()) })
  return {
    assembleInbox: assemble,
    loadInbox: async () => {
      h.fullReads++
      const all = [row('a1', 'A', '2026-11-01T10:00:00+00:00'), row('z1', 'Z', '2026-11-15T19:00:00+00:00')]
      return { viewRows: all, ...(await assemble(all)) }
    },
  }
})
import { useInbox } from './useInbox'

const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(50) }) }
const snap = (fullAt = '2026-11-15T19:45:00.000Z') => ({ user: 'u1', watermark: '2026-11-15T19:50:00.000Z', fullAt: Date.parse(fullAt),
  rows: [row('a1', 'A', '2026-11-01T10:00:00+00:00'), row('b1', 'B', '2026-11-02T10:00:00+00:00', 'old text')] })

describe('useInbox warm start from the device snapshot', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-15T20:00:00.000Z'))
    h.snapshot = null; h.changed = []; h.fresh = []; h.fullReads = 0; h.fetched = []; h.saved = []
  })
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it('re-reads only the conversations that moved, lands live, and never reads the whole view', async () => {
    h.snapshot = snap()
    h.changed = ['B', 'C']
    h.fresh = [row('b1', 'B', '2026-11-02T10:00:00+00:00', 'edited text'), row('c1', 'C', '2026-11-15T19:50:00+00:00')]
    const { result } = renderHook(() => useInbox())
    await settle()
    expect(h.fullReads).toBe(0)
    expect(h.fetched).toEqual([['B', 'C']])
    expect(result.current.loadedAt).not.toBeNull()
    expect(result.current.threads.map(t => t.prospect_id).sort()).toEqual(['A', 'B', 'C'])
    expect(result.current.threads.find(t => t.prospect_id === 'B')!.last.message_text).toBe('edited text')
  })

  it('nothing moved: the snapshot lands as read, still with no whole read', async () => {
    h.snapshot = snap()
    const { result } = renderHook(() => useInbox())
    await settle()
    expect(h.fullReads).toBe(0)
    expect(h.fetched).toEqual([])
    expect(result.current.threads).toHaveLength(2)
    expect(result.current.loadedAt).not.toBeNull()
  })

  it('no snapshot, or one the server can no longer answer from: the whole read, then it is saved', async () => {
    const { result } = renderHook(() => useInbox())
    await settle()
    expect(h.fullReads).toBe(1)
    expect(result.current.threads.map(t => t.prospect_id).sort()).toEqual(['A', 'Z'])
    await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
    expect(h.saved).toEqual([{ rows: 2, watermark: '2026-11-15T20:00:00.000Z', fullAt: Date.parse('2026-11-15T20:00:00.000Z') }])
    cleanup()
    h.snapshot = snap(); h.changed = null; h.fullReads = 0
    renderHook(() => useInbox())
    await settle()
    expect(h.fullReads).toBe(1)
  })

  it('an empty re-read of a conversation we hold falls back to the whole read', async () => {
    h.snapshot = snap()
    h.changed = ['B']
    h.fresh = []
    renderHook(() => useInbox())
    await settle()
    expect(h.fullReads).toBe(1)
  })

  it('an explicit refresh after a warm start reads the whole view', async () => {
    h.snapshot = snap()
    const { result } = renderHook(() => useInbox())
    await settle()
    expect(h.fullReads).toBe(0)
    await act(async () => { result.current.refresh(); await vi.advanceTimersByTimeAsync(50) })
    expect(h.fullReads).toBe(1)
  })

  it('an overdue snapshot lands first, then the whole read follows two minutes later in the background', async () => {
    h.snapshot = snap('2026-11-15T19:00:00.000Z')
    const { result } = renderHook(() => useInbox())
    await settle()
    expect(h.fullReads).toBe(0)
    expect(result.current.loadedAt).not.toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(125_000) })
    expect(h.fullReads).toBe(1)
  })

  it('a warm start never rewrites the snapshot it started from', async () => {
    h.snapshot = snap()
    renderHook(() => useInbox())
    await settle()
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(h.saved).toEqual([])
  })

  it('a read that lands after unmount writes no snapshot', async () => {
    const { unmount } = renderHook(() => useInbox())
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(h.saved).toEqual([])
  })

  it('an explicit whole read cancels the overdue one', async () => {
    h.snapshot = snap('2026-11-15T19:00:00.000Z')
    const { result } = renderHook(() => useInbox())
    await settle()
    await act(async () => { result.current.refresh(); await vi.advanceTimersByTimeAsync(50) })
    expect(h.fullReads).toBe(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(125_000) })
    expect(h.fullReads).toBe(1)
  })
})
