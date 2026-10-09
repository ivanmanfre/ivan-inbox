// PERF-COLD (2026-10-08): the whole-view read is newest page first, counted, pooled. These pin that
// the result is the SAME list in the SAME order as the old created_at-asc read, that no page past the
// end is asked for, and that the empty-means-failure guard still throws.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxMessage } from './inbox'

type Row = Pick<InboxMessage, 'id' | 'prospect_id' | 'direction' | 'message_text' | 'sent_at' | 'created_at'>
const h = vi.hoisted(() => ({
  view: [] as Row[],
  count: null as number | null | 'error',
  reads: [] as number[],
  failAt: -1,
  inflight: 0,
  maxInflight: 0,
  onRead: null as null | ((offset: number) => void),
  rpcMode: 'missing' as 'missing' | 'ok' | 'error',
  rpcReads: [] as number[],
}))

vi.mock('./supabase', () => {
  const desc = (a: Row, b: Row) => (a.created_at !== b.created_at ? (a.created_at < b.created_at ? 1 : -1) : a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  return {
    supabase: {
      rpc: async (_name: string, args: { p_offset: number; p_limit: number }) => {
        h.rpcReads.push(args.p_offset)
        if (h.rpcMode === 'error') return { data: null, error: { code: '42501', message: 'permission denied' } }
        if (h.rpcMode === 'missing') return { data: null, error: { code: 'PGRST202', message: 'not installed' } }
        return { data: [...h.view].sort(desc).slice(args.p_offset, args.p_offset + args.p_limit), error: null }
      },
      from: () => ({
        select: (_cols: string, opts?: { head?: boolean; count?: string }) => {
          if (opts?.head) {
            return Promise.resolve(h.count === 'error' ? { count: null, error: { message: 'count failed' } } : { count: h.count ?? h.view.length, error: null })
          }
          const q = {
            order: () => q,
            range: async (from: number, to: number) => {
              h.reads.push(from)
              h.inflight += 1; h.maxInflight = Math.max(h.maxInflight, h.inflight)
              await new Promise(r => setTimeout(r, 1))
              h.inflight -= 1
              if (from === h.failAt) return { data: null, error: { message: 'page failed' } }
              const rows = [...h.view].sort(desc).slice(from, to + 1)
              h.onRead?.(from)
              return { data: rows, error: null }
            },
          }
          return q
        },
      }),
    },
  }
})

import { fetchMessages } from './inbox'

const iso = (i: number) => new Date(Date.UTC(2026, 3, 1) + i * 60_000).toISOString().replace('Z', '+00:00')
const mk = (n: number, at = 0): Row[] => Array.from({ length: n }, (_, i) => ({
  id: `m${String(at + i).padStart(6, '0')}`, prospect_id: `p${(at + i) % 37}`, direction: i % 3 ? 'outbound' : 'inbound',
  message_text: `text ${at + i}`, sent_at: iso(at + i), created_at: iso(at + i),
}))
const ascIds = (rows: Row[]) => [...rows].sort((a, b) => (a.created_at !== b.created_at ? (a.created_at < b.created_at ? -1 : 1) : a.id < b.id ? -1 : 1)).map(r => r.id)

describe('fetchMessages: newest page first, same result', () => {
  beforeEach(() => { h.view = []; h.count = null; h.reads = []; h.failAt = -1; h.inflight = 0; h.maxInflight = 0; h.onRead = null; h.rpcMode = 'missing'; h.rpcReads = [] })

  it('reads the first archive page through the original view, then RPC pages without losing any ascending ID', async () => {
    h.view = mk(2503)
    h.view[10].created_at = h.view[11].created_at
    h.rpcMode = 'ok'
    const got = await fetchMessages()
    expect(got.map(m => m.id)).toEqual(ascIds(h.view))
    expect([...h.rpcReads].sort((a, b) => a - b)).toEqual([1000, 2000])
    expect(h.reads).toEqual([0])
  })

  it('propagates a real RPC error without falling back to the old view', async () => {
    h.view = mk(1001)
    h.rpcMode = 'error'
    await expect(fetchMessages()).rejects.toMatchObject({ code: '42501', message: 'permission denied' })
    expect(h.rpcReads).toEqual([1000])
    expect(h.reads).toEqual([0])
  })

  it('returns the old created_at-asc order and asks for exactly the pages that exist', async () => {
    h.view = mk(2503)
    // Two rows share a timestamp: the id tiebreak must survive the desc read and the reverse.
    h.view[10].created_at = h.view[11].created_at
    const got = await fetchMessages()
    expect(got.map(m => m.id)).toEqual(ascIds(h.view))
    expect([...h.reads].sort((a, b) => a - b)).toEqual([0, 1000, 2000])
  })

  it('hands the newest page (oldest first) to onNewest before the rest, only when there is more', async () => {
    h.view = mk(2100)
    const early: string[][] = []
    const got = await fetchMessages(0, rows => { early.push(rows.map(r => r.id)); expect(h.reads).toEqual([0]) })
    expect(early).toHaveLength(1)
    expect(early[0]).toEqual(ascIds(h.view).slice(-1000))
    expect(got).toHaveLength(2100)
    h.reads = []
    h.view = mk(400)
    const small: unknown[] = []
    await fetchMessages(0, rows => { small.push(rows) })
    expect(small).toHaveLength(0)
    expect(h.reads).toEqual([0])
  })

  it('keeps at most four pages in flight', async () => {
    h.view = mk(9001)
    await fetchMessages()
    expect(h.maxInflight).toBeLessThanOrEqual(4)
    expect(h.reads).toHaveLength(10)
  })

  it('a failed count falls back to reading until a short page', async () => {
    h.view = mk(3000)
    h.count = 'error'
    const got = await fetchMessages()
    expect(got.map(m => m.id)).toEqual(ascIds(h.view))
    expect(Math.max(...h.reads)).toBeGreaterThanOrEqual(3000) // the short (empty) page that finds the end
  })

  it('rows that arrived after the count are still read (the last counted page came back full)', async () => {
    h.view = mk(3000)
    h.count = 2000
    const got = await fetchMessages()
    expect(got).toHaveLength(3000)
    expect([...h.reads].sort((a, b) => a - b)).toEqual([0, 1000, 2000, 3000])
  })

  it('an insert mid-read shifts the desc pages: the repeated row is kept once', async () => {
    h.view = mk(2500)
    h.onRead = from => { if (from === 0) h.view.push(...mk(1, 9999)) }
    const got = await fetchMessages()
    const ids = got.map(m => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const r of mk(2500)) expect(ids).toContain(r.id)
  })

  it('an empty read over a known-non-empty inbox is a failure; on a cold open it is empty', async () => {
    await expect(fetchMessages(12)).rejects.toThrow('came back empty')
    await expect(fetchMessages(0)).resolves.toEqual([])
  })

  it('one failed page fails the read and stops the other workers asking', async () => {
    h.view = mk(12000)
    h.failAt = 2000
    await expect(fetchMessages()).rejects.toBeTruthy()
    await new Promise(r => setTimeout(r, 20))
    expect(h.reads.length).toBeLessThan(12)
  })

  it('phantom duplicates still collapse as before', async () => {
    h.view = mk(1500)
    const twin = { ...h.view[5], id: 'zzz-twin' }
    h.view.push(twin)
    const got = await fetchMessages()
    expect(got).toHaveLength(1500)
  })
})
