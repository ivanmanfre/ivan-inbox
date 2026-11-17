// @vitest-environment jsdom
// 2026-11-17 speed pass: off the DMs page the frame's inbox reads only the Needs-you conversations
// (scope 'priority'); the whole message view is read only once 'all' is asked for.
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxMessage } from '../lib/inbox'

const row = (id: string, pid: string, created_at: string, direction: 'inbound' | 'outbound' = 'inbound'): InboxMessage => ({
  id, prospect_id: pid, direction, message_text: `text ${id}`, message_type: 'dm', channel: 'linkedin',
  sent_at: created_at, approved_at: null, read_at: null, created_at, send_blocked_at: null, send_blocked_reason: null,
  unipile_chat_id: null, ai_model: null, prospect_name: `Person ${pid}`, prospect_company: null, prospect_headline: null,
  prospect_stage: 'replied', prospect_email: null, profile_photo_url: null,
} as InboxMessage)

const h = vi.hoisted(() => ({
  priority: [] as InboxMessage[] | null,
  whole: [] as InboxMessage[],
  priorityReads: 0,
  wholeReads: 0,
  snapshotReads: 0,
  cacheWrites: 0,
  snapshotWrites: 0,
  chimes: 0,
  holdPriority: null as null | Promise<void>,
  holdWhole: null as null | Promise<void>,
}))
vi.mock('../lib/supabase', () => ({ supabase: { channel: () => { const ch = { on: () => ch, subscribe: () => ch }; return ch }, removeChannel: () => {} } }))
vi.mock('../lib/inboxCache', () => ({ readInboxCache: () => null, writeInboxCache: () => { h.cacheWrites++ } }))
vi.mock('../lib/chime', () => ({ playChime: () => { h.chimes++ } }))
vi.mock('../lib/swr', () => ({ currentUserId: () => 'u1' }))
vi.mock('../lib/inboxSnapshot', () => ({
  SNAPSHOT_READ_MS: 2500, SNAPSHOT_SAVE_EVERY_MS: 600_000,
  readInboxSnapshot: async () => { h.snapshotReads++; return null },
  snapshotDelta: async () => null,
  writeInboxSnapshot: async () => { h.snapshotWrites++ },
}))
vi.mock('../lib/inboxDelta', async () => {
  const real = await vi.importActual<typeof import('../lib/inboxDelta')>('../lib/inboxDelta')
  return { ...real, changedSince: async () => ({ now: '2026-11-17T12:00:00.000Z', ids: [] }), fetchConversations: async () => [] }
})
vi.mock('../lib/inboxLoad', async () => {
  const { groupThreads } = await vi.importActual<typeof import('../lib/inbox')>('../lib/inbox')
  const assemble = async (rows: InboxMessage[]) => ({ rows, threads: groupThreads(rows, new Set()) })
  return {
    assembleInbox: assemble,
    loadPriority: async () => {
      h.priorityReads++
      if (h.holdPriority) await h.holdPriority
      return h.priority === null ? null : { viewRows: h.priority, ...(await assemble(h.priority)) }
    },
    loadInbox: async () => {
      h.wholeReads++
      if (h.holdWhole) await h.holdWhole
      return { viewRows: h.whole, ...(await assemble(h.whole)) }
    },
  }
})
import { useInbox, type InboxScope } from './useInbox'

const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(50) }) }
const NOW = '2026-11-17T12:00:00.000Z'
const recent = row('n1', 'N', '2026-11-16T09:00:00+00:00')
const old = row('o1', 'O', '2026-09-01T09:00:00+00:00')

describe('useInbox scope', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(NOW))
    h.priority = [recent]; h.whole = [old, recent]
    h.priorityReads = 0; h.wholeReads = 0; h.snapshotReads = 0; h.cacheWrites = 0; h.snapshotWrites = 0; h.chimes = 0
    h.holdPriority = null; h.holdWhole = null
  })
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it("'priority' reads only the Needs-you conversations, lands live, and never touches the saved copy or the snapshot", async () => {
    const { result } = renderHook(() => useInbox(true, true, 'priority'))
    await settle()
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(h.priorityReads).toBe(1)
    expect(h.wholeReads).toBe(0)
    expect(h.snapshotReads).toBe(0)
    expect(h.cacheWrites).toBe(0)
    expect(h.snapshotWrites).toBe(0)
    expect(result.current.threads.map(t => t.prospect_id)).toEqual(['N'])
    expect(result.current.loadedAt).not.toBeNull()
    expect(result.current.liveAt).toBe(result.current.loadedAt)
    expect(result.current.loading).toBe(false)
    expect(result.current.scope).toBe('priority')
  })

  it("turning 'all' reads the whole view (snapshot first) and reports the Needs-you rows as an early paint until it lands", async () => {
    let release!: () => void
    const { result, rerender } = renderHook(({ scope }: { scope: InboxScope }) => useInbox(true, true, scope), { initialProps: { scope: 'priority' as InboxScope } })
    await settle()
    const live = result.current.liveAt
    h.holdWhole = new Promise(r => { release = r })
    rerender({ scope: 'all' })
    await settle()
    expect(h.snapshotReads).toBe(1)
    expect(h.wholeReads).toBe(1)
    expect(result.current.loadedAt).toBeNull()
    expect(result.current.loading).toBe(true)
    expect(result.current.priorityAt).not.toBeNull()
    expect(result.current.liveAt).toBe(live)
    expect(result.current.threads.map(t => t.prospect_id)).toEqual(['N'])
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(50) })
    expect(result.current.loadedAt).not.toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.threads.map(t => t.prospect_id).sort()).toEqual(['N', 'O'])
    expect(h.cacheWrites).toBeGreaterThan(0)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(h.snapshotWrites).toBe(1)
    // An inbound older than the Needs-you window is not a new message.
    expect(h.chimes).toBe(0)
    // 'all' stays: going back to 'priority' never drops to the part list.
    rerender({ scope: 'priority' })
    await settle()
    expect(result.current.scope).toBe('all')
    expect(h.priorityReads).toBe(1)
  })

  it("'all' asked while the Needs-you read is still out: the whole read follows it", async () => {
    let release!: () => void
    h.holdPriority = new Promise(r => { release = r })
    const { result, rerender } = renderHook(({ scope }: { scope: InboxScope }) => useInbox(true, true, scope), { initialProps: { scope: 'priority' as InboxScope } })
    await settle()
    rerender({ scope: 'all' })
    await settle()
    expect(h.wholeReads).toBe(0)
    h.holdPriority = null
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(50) })
    expect(h.priorityReads).toBe(1)
    expect(h.wholeReads).toBe(1)
    expect(result.current.loadedAt).not.toBeNull()
    expect(result.current.threads.map(t => t.prospect_id).sort()).toEqual(['N', 'O'])
  })

  it('a newer inbound inside the window rings when the whole read lands', async () => {
    const { rerender } = renderHook(({ scope }: { scope: InboxScope }) => useInbox(true, true, scope), { initialProps: { scope: 'priority' as InboxScope } })
    await settle()
    h.whole = [old, recent, row('n2', 'M', '2026-11-17T11:00:00+00:00')]
    rerender({ scope: 'all' })
    await settle()
    expect(h.chimes).toBe(1)
  })

  it('no first-rows RPC: the whole read, as before', async () => {
    h.priority = null
    const { result } = renderHook(() => useInbox(true, true, 'priority'))
    await settle()
    expect(h.priorityReads).toBe(1)
    expect(h.wholeReads).toBe(1)
    expect(result.current.threads.map(t => t.prospect_id).sort()).toEqual(['N', 'O'])
  })

  it("default 'all' never reads the Needs-you read on its own", async () => {
    const { result } = renderHook(() => useInbox())
    await settle()
    expect(h.priorityReads).toBe(0)
    expect(h.snapshotReads).toBe(1)
    expect(h.wholeReads).toBe(1)
    expect(result.current.loadedAt).not.toBeNull()
  })
})
