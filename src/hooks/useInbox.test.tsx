// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxMessage } from '../lib/inbox'

const row = (id: string, pid: string, created_at: string): InboxMessage => ({
  id, prospect_id: pid, direction: 'inbound', message_text: `t ${id}`, message_type: 'dm', channel: 'linkedin',
  sent_at: created_at, approved_at: null, read_at: null, created_at, send_blocked_at: null, send_blocked_reason: null,
  unipile_chat_id: null, ai_model: null, prospect_name: pid, prospect_company: null, prospect_headline: null,
  prospect_stage: 'replied', prospect_email: null, profile_photo_url: null,
} as InboxMessage)

const h = vi.hoisted(() => ({ handler: null as null | ((p: unknown) => void), full: 0, convReads: [] as string[][], sweeps: [] as (string | null)[], delay: 0, chimes: 0, empty: false }))
vi.mock('../lib/supabase', () => ({
  supabase: {
    channel: () => {
      const ch = { on: (_e: string, _f: unknown, fn: (p: unknown) => void) => { h.handler = fn; return ch }, subscribe: () => ch }
      return ch
    },
    removeChannel: () => {},
  },
}))
vi.mock('../lib/inboxCache', () => ({ readInboxCache: () => null, writeInboxCache: () => {} }))
vi.mock('../lib/chime', () => ({ playChime: () => { h.chimes += 1 } }))
vi.mock('../lib/inboxLoad', async () => {
  const { groupThreads } = await vi.importActual<typeof import('../lib/inbox')>('../lib/inbox')
  const assemble = async (rows: InboxMessage[]) => ({ rows, threads: groupThreads(rows, new Set()) })
  return {
    loadInbox: async () => { h.full += 1; const v = [row('a1', 'A', '2026-09-28T10:00:00+00:00'), row('b1', 'B', '2026-09-28T10:01:00+00:00')]; return { viewRows: v, ...(await assemble(v)) } },
    assembleInbox: assemble,
  }
})
vi.mock('../lib/inboxDelta', async () => {
  const real = await vi.importActual<typeof import('../lib/inboxDelta')>('../lib/inboxDelta')
  return {
    ...real,
    changedSince: async (since: string | null) => { h.sweeps.push(since); return { now: '2026-09-28T10:05:00.000Z', ids: since === null ? [] : ['B'] } },
    fetchConversations: async (ids: string[]) => { h.convReads.push([...ids].sort()); if (h.delay) await new Promise(r => setTimeout(r, h.delay)); if (h.empty) return []; return ids.includes('A') ? [row('a1', 'A', '2026-09-28T10:00:00+00:00'), row('a2', 'A', '2026-09-28T10:04:00+00:00')] : [row('b1', 'B', '2026-09-28T10:01:00+00:00')] },
  }
})
import { useInbox } from './useInbox'

const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(2000) }) }

describe('useInbox reads incrementally after the first load', () => {
  beforeEach(() => { vi.useFakeTimers(); h.full = 0; h.convReads = []; h.sweeps = []; h.handler = null; h.delay = 0; h.chimes = 0; h.empty = false })
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it('mount = one whole read; a realtime insert = one conversation read, no second whole read', async () => {
    const { result } = renderHook(() => useInbox())
    await flush()
    expect(h.full).toBe(1)
    expect(result.current.threads.map(t => t.prospect_id).sort()).toEqual(['A', 'B'])
    act(() => { h.handler!({ eventType: 'INSERT', new: { id: 'a2', prospect_id: 'A' }, old: {} }) })
    await flush()
    expect(h.full).toBe(1)
    expect(h.convReads).toEqual([['A']])
    expect(result.current.threads.find(t => t.prospect_id === 'A')!.messages.map(m => m.id)).toEqual(['a1', 'a2'])
  })

  it('a burst of events on one conversation inside the coalesce window = one read', async () => {
    renderHook(() => useInbox())
    await flush()
    act(() => { for (let i = 0; i < 5; i++) h.handler!({ eventType: 'UPDATE', new: { id: 'a1', prospect_id: 'A' }, old: { id: 'a1' } }) })
    await flush()
    expect(h.convReads).toEqual([['A']])
    expect(h.full).toBe(1)
  })

  it('a delete carrying only the id is mapped through the held rows', async () => {
    renderHook(() => useInbox())
    await flush()
    act(() => { h.handler!({ eventType: 'DELETE', new: {}, old: { id: 'b1' } }) })
    await flush()
    expect(h.convReads).toEqual([['B']])
  })

  it('focus inside FULL_EVERY_MS = a changed-since sweep, not a whole read', async () => {
    renderHook(() => useInbox())
    await flush()
    act(() => { window.dispatchEvent(new Event('focus')) })
    await flush()
    expect(h.full).toBe(1)
    expect(h.sweeps.filter(s => s !== null).length).toBe(1)
    expect(h.convReads).toEqual([['B']])
  })

  it('refresh() is always a whole read', async () => {
    const { result } = renderHook(() => useInbox())
    await flush()
    act(() => { result.current.refresh() })
    await flush()
    expect(h.full).toBe(2)
  })

  it('an unknown event (no prospect, unknown id) falls back to a sweep', async () => {
    renderHook(() => useInbox())
    await flush()
    act(() => { h.handler!({ eventType: 'DELETE', new: {}, old: { id: 'zz' } }) })
    await flush()
    expect(h.sweeps.filter(s => s !== null).length).toBe(1)
    expect(h.full).toBe(1)
  })

  const upd = (pid: string, id = 'x') => ({ eventType: 'UPDATE', new: { id, prospect_id: pid, direction: 'outbound' }, old: { id } })

  it('events arriving during an in-flight re-read = one more read, after the gap', async () => {
    renderHook(() => useInbox())
    await flush()
    h.delay = 400
    act(() => { h.handler!(upd('A')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1600) }) // run started, read in flight
    for (let i = 0; i < 20; i++) { act(() => { h.handler!(upd(i % 2 ? 'A' : 'B')) }); await act(async () => { await vi.advanceTimersByTimeAsync(500) }) }
    expect(h.convReads.length).toBe(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(125_000) })
    expect(h.convReads.length).toBe(2)
    expect(h.convReads[1]).toEqual(['A', 'B'])
    expect(h.full).toBe(1)
  })

  it('a run owed while Ivan types waits for the typing hold', async () => {
    renderHook(() => useInbox())
    await flush()
    const input = document.createElement('textarea'); document.body.appendChild(input); input.focus()
    act(() => { h.handler!(upd('A')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    expect(h.convReads.length).toBe(0)
    input.blur(); input.remove()
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(h.convReads.length).toBe(1)
  })

  it('a new inbound message inside the gap is read at the coalesce and rings the chime', async () => {
    renderHook(() => useInbox())
    await flush()
    act(() => { h.handler!(upd('B')) })
    await flush()
    expect(h.convReads.length).toBe(1)
    act(() => { h.handler!({ eventType: 'INSERT', new: { id: 'a2', prospect_id: 'A', direction: 'inbound' }, old: {} }) })
    await flush()
    expect(h.convReads.length).toBe(2)
    expect(h.chimes).toBe(1)
  })

  it('a non-inbound event inside the gap waits for it', async () => {
    renderHook(() => useInbox())
    await flush()
    act(() => { h.handler!(upd('B')) })
    await flush()
    act(() => { h.handler!(upd('A')) })
    await flush()
    expect(h.convReads.length).toBe(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(h.convReads.length).toBe(2)
  })

  it('an empty re-read of a conversation we hold is a failed read: the whole view is read instead', async () => {
    renderHook(() => useInbox())
    await flush()
    h.empty = true
    act(() => { h.handler!(upd('A')) })
    await flush()
    expect(h.convReads).toEqual([['A']])
    expect(h.full).toBe(2)
  })

  it('a new inbound message arriving during a slow re-read still rings within seconds', async () => {
    renderHook(() => useInbox())
    await flush()
    h.delay = 3000
    act(() => { h.handler!(upd('B')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) }) // B's read in flight until ~4.5 s
    act(() => { h.handler!({ eventType: 'INSERT', new: { id: 'a2', prospect_id: 'A', direction: 'inbound' }, old: {} }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(8000) })
    expect(h.convReads.length).toBe(2)
    expect(h.chimes).toBe(1)
  })

  it('refresh() during a slow re-read runs the whole read right after it', async () => {
    const { result } = renderHook(() => useInbox())
    await flush()
    h.delay = 3000
    act(() => { h.handler!(upd('B')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    act(() => { result.current.refresh() })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(h.full).toBe(2)
  })
})
