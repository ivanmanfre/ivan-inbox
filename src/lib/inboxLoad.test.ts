// PERF-COLD (2026-10-08): loadInbox's early paint is assembled like the full list, its probes start
// with the read, and it can never be delivered after the full result.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxMessage, Thread } from './inbox'

const h = vi.hoisted(() => ({ probes: 0, order: [] as string[], slowEarly: false, priorityRows: null as InboxMessage[] | null }))
vi.mock('./inbox', async () => {
  const real = await vi.importActual<typeof import('./inbox')>('./inbox')
  const row = (id: string, pid: string): InboxMessage => ({ id, prospect_id: pid, direction: 'inbound', message_text: id, created_at: `2026-10-0${id.length}T00:00:00+00:00`, sent_at: null, prospect_name: pid } as InboxMessage)
  return {
    ...real,
    fetchManualReplyIds: async () => { h.probes += 1; h.order.push('probe'); if (h.slowEarly && h.probes === 1) await new Promise(r => setTimeout(r, 30)); return new Set<string>() },
    fetchDraftEmailStamps: async () => new Map(),
    fetchEmailRecipients: async () => new Map(),
    fetchDraftEvidence: async () => new Map(),
    fetchDraftContextGaps: async () => new Map(),
    fetchMessages: async (_k: number, onNewest?: (rows: InboxMessage[]) => void | Promise<unknown>) => {
      h.order.push('page0')
      const early = onNewest?.([row('n', 'N')])
      if (!h.slowEarly && early) await early
      h.order.push('rest')
      return [...(h.priorityRows ?? []), row('o', 'O'), row('n', 'N')]
    },
  }
})
vi.mock('./supabase', () => ({ supabase: { rpc: async () => h.priorityRows ? { data: h.priorityRows, error: null } : { data: null, error: { code: 'PGRST202' } } } }))
import { loadInbox } from './inboxLoad'

describe('loadInbox early paint', () => {
  beforeEach(() => { h.probes = 0; h.order = []; h.slowEarly = false; h.priorityRows = null })

  it('flags priority rows first and still returns the complete history', async () => {
    h.priorityRows = [{ id: 'p', prospect_id: 'P', direction: 'inbound', message_text: 'priority', created_at: '2026-10-09T00:00:00+00:00', sent_at: null, prospect_name: 'P' } as InboxMessage]
    const seen: { ids: string[]; priority?: boolean }[] = []
    const res = await loadInbox(0, (threads, priority) => seen.push({ ids: threads.map(t => t.prospect_id), priority }))
    expect(seen).toEqual([{ ids: ['P'], priority: true }])
    expect(res.threads.map(t => t.prospect_id).sort()).toEqual(['N', 'O', 'P'])
    expect(h.order).toContain('page0')
    expect(h.order).toContain('rest')
  })

  it('delivers the newest page grouped, before the full list, with probes started up front', async () => {
    const seen: Thread[][] = []
    const res = await loadInbox(0, t => { seen.push(t) })
    expect(seen.map(t => t.map(x => x.prospect_id))).toEqual([['N']])
    expect(res.threads.map(t => t.prospect_id).sort()).toEqual(['N', 'O'])
    expect(h.order[0]).toBe('probe') // the early probes go out with the read, not after page 0
    expect(h.probes).toBe(2) // the full list still runs its own, after the whole read
  })

  it('without a callback nothing changes: one set of probes, after the read', async () => {
    await loadInbox(5)
    expect(h.probes).toBe(1)
    expect(h.order).toEqual(['page0', 'rest', 'probe'])
  })

  it('an early paint still pending when the full list is ready is dropped', async () => {
    h.slowEarly = true // the early probes answer 30 ms late, after the full list has assembled
    const seen: Thread[][] = []
    const res = await loadInbox(0, t => { seen.push(t) })
    await new Promise(r => setTimeout(r, 60))
    expect(res.threads).toHaveLength(2)
    expect(seen).toEqual([])
  })
})
