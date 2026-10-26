import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: { from: vi.fn() } }))
import { supabase } from './supabase'
import { restoreDraft, type InboxMessage } from './inbox'
const discarded: Partial<InboxMessage> = { id: 'draft', direction: 'outbound', created_at: '2026-10-26T08:00:00Z', sent_at: null, approved_at: null, send_blocked_reason: 'discarded_in_inbox', send_blocked_at: '2026-10-26T09:00:00Z' }
let current: Partial<InboxMessage>[], writes: object[]
beforeEach(() => {
  current = [discarded]; writes = []
  vi.mocked(supabase.from).mockImplementation(() => {
    let write = false, kind = false
    const q: any = { select: vi.fn((columns: string) => { kind = columns === 'ai_model'; return q }), eq: vi.fn(() => q), is: vi.fn(() => q),
      update: vi.fn((body: object) => { write = true; writes.push(body); return q }), maybeSingle: vi.fn(async () => ({ data: { ai_model: null }, error: null })),
      then: (done: (v: object) => unknown) => Promise.resolve({ data: write ? [{ id: 'draft' }] : kind ? { ai_model: null } : current, error: null }).then(done) }
    return q
  })
})
it('checks current prospect history and restores a fresh discard without approval', async () => {
  expect(await restoreDraft('draft', 'person')).toBe(true)
  expect(writes).toEqual([{ send_blocked_reason: null, send_blocked_at: null, discard_mode: null }])
})
it('refuses Undo after a hand reply has been queued even when its timestamp precedes discard', async () => {
  current.push({ id: 'reply', direction: 'outbound', created_at: '2026-10-26T08:59:59Z', approved_at: '2026-10-26T09:00:05Z', sent_at: null })
  expect(await restoreDraft('draft', 'person')).toBe(false)
  expect(writes).toEqual([])
})
it('refuses Undo after a newer outbound send or replacement draft', async () => {
  current.push({ id: 'new', direction: 'outbound', created_at: '2026-10-26T09:00:05Z', approved_at: null, sent_at: null })
  expect(await restoreDraft('draft', 'person')).toBe(false)
  expect(writes).toEqual([])
})
