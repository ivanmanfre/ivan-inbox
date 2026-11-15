import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxMessage } from './inbox'

const row = (id: string, pid: string, created_at: string): InboxMessage => ({
  id, prospect_id: pid, direction: 'inbound', message_text: `t ${id}`, message_type: 'dm', channel: 'linkedin',
  sent_at: created_at, approved_at: null, read_at: null, created_at, send_blocked_at: null, send_blocked_reason: null,
  unipile_chat_id: null, ai_model: null, prospect_name: pid, prospect_company: null, prospect_headline: null,
  prospect_stage: 'replied', prospect_email: null, profile_photo_url: null,
} as InboxMessage)

const h = vi.hoisted(() => ({ stored: null as unknown, written: [] as { rows: number; watermark: string; fullAt: number; user: string }[], wholeReads: 0, changed: [] as string[] | null, fresh: [] as InboxMessage[] }))
vi.mock('./handoff', () => ({
  readHandoff: async () => h.stored,
  writeHandoff: async (_k: string, v: { rows: unknown[]; watermark: string; fullAt: number; user: string }) => { h.written.push({ rows: v.rows.length, watermark: v.watermark, fullAt: v.fullAt, user: v.user }) },
}))
vi.mock('./inboxDelta', async () => {
  const real = await vi.importActual<typeof import('./inboxDelta')>('./inboxDelta')
  return { ...real, changedSince: async (since: string | null) => ({ now: '2026-11-15T22:00:00.000Z', ids: since === null ? [] : h.changed }), fetchConversations: async (ids: string[]) => h.fresh.filter(m => ids.includes(m.prospect_id)) }
})
vi.mock('./inboxLoad', async () => {
  const { groupThreads } = await vi.importActual<typeof import('./inbox')>('./inbox')
  const assemble = async (rows: InboxMessage[]) => ({ rows, threads: groupThreads(rows, new Set()) })
  return { assembleInbox: assemble, loadInbox: async () => { h.wholeReads++; const all = [row('w1', 'W', '2026-11-15T21:00:00+00:00')]; return { viewRows: all, ...(await assemble(all)) } } }
})
import { prefetchInboxThreads } from './inboxPrefetch'

const NOW = Date.parse('2026-11-15T22:00:00.000Z')
const snap = { user: 'u1', watermark: '2026-11-15T21:30:00.000Z', fullAt: Date.parse('2026-11-15T20:00:00.000Z'), rows: [row('a1', 'A', '2026-11-01T10:00:00+00:00')] }

describe('push-time prefetch', () => {
  beforeEach(() => { h.stored = null; h.written = []; h.wholeReads = 0; h.changed = []; h.fresh = [] })
  it('starts from the snapshot plus what moved, and moves the snapshot forward without touching fullAt', async () => {
    h.stored = snap; h.changed = ['B']; h.fresh = [row('b1', 'B', '2026-11-15T21:50:00+00:00')]
    const r = await prefetchInboxThreads('u1', 1, NOW)
    expect(r.via).toBe('snapshot'); expect(h.wholeReads).toBe(0)
    expect(r.threads.map(t => t.prospect_id).sort()).toEqual(['A', 'B'])
    expect(h.written).toEqual([{ rows: 2, watermark: '2026-11-15T22:00:00.000Z', fullAt: snap.fullAt, user: 'u1' }])
  })
  it('no usable snapshot (another user, or too old for the server): the whole read, then a fresh snapshot', async () => {
    h.stored = { ...snap, user: 'u2' }
    const r = await prefetchInboxThreads('u1', 1, NOW)
    expect(r.via).toBe('whole'); expect(h.wholeReads).toBe(1)
    expect(h.written).toHaveLength(1); expect(h.written[0].user).toBe('u1'); expect(h.written[0].rows).toBe(1)
    h.stored = snap; h.changed = null; h.written = []
    expect((await prefetchInboxThreads('u1', 1, NOW)).via).toBe('whole')
  })
})
