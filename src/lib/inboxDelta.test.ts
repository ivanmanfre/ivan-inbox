import { describe, expect, it, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))
import { byCreatedThenId, mergeConversations, prospectOfEvent, withOverlap } from './inboxDelta'
import { dedupeMessages, type InboxMessage } from './inbox'

const row = (id: string, pid: string, created_at: string, over: Partial<InboxMessage> = {}): InboxMessage => ({
  id, prospect_id: pid, direction: 'outbound', message_text: `text ${id}`, message_type: 'dm', channel: 'linkedin',
  sent_at: null, approved_at: null, read_at: null, created_at, send_blocked_at: null, send_blocked_reason: null,
  unipile_chat_id: null, ai_model: null, prospect_name: pid, prospect_company: null, prospect_headline: null,
  prospect_stage: 'dm1_sent', prospect_email: null, profile_photo_url: null, ...over,
} as InboxMessage)

// What a whole read of `rows` returns: the view's order, deduped.
const fullRead = (rows: InboxMessage[]) => dedupeMessages(rows.slice().sort(byCreatedThenId))

const base = [
  row('a1', 'A', '2026-09-28T10:00:00+00:00'),
  row('b1', 'B', '2026-09-28T10:01:00+00:00'),
  row('a2', 'A', '2026-09-28T10:02:00+00:00'),
  row('c1', 'C', '2026-09-28T10:03:00+00:00'),
]

describe('mergeConversations equals a whole read', () => {
  it('insert: a new message lands in its conversation, in view order', () => {
    const after = [...base, row('b2', 'B', '2026-09-28T10:04:00+00:00', { direction: 'inbound' })]
    const fresh = after.filter(m => m.prospect_id === 'B')
    expect(mergeConversations(fullRead(base), new Set(['B']), fresh)).toEqual(fullRead(after))
  })
  it('insert of a brand-new conversation', () => {
    const after = [...base, row('d1', 'D', '2026-09-28T09:59:00+00:00')]
    expect(mergeConversations(fullRead(base), new Set(['D']), after.filter(m => m.prospect_id === 'D'))).toEqual(fullRead(after))
  })
  it('update: an edited / approved / sent row replaces the held one', () => {
    const after = base.map(m => m.id === 'a2' ? { ...m, message_text: 'edited', approved_at: '2026-09-28T11:00:00+00:00', sent_at: '2026-09-28T11:01:00+00:00' } : m)
    const merged = mergeConversations(fullRead(base), new Set(['A']), after.filter(m => m.prospect_id === 'A'))
    expect(merged).toEqual(fullRead(after))
    expect(merged.find(m => m.id === 'a2')?.message_text).toBe('edited')
  })
  it('discard / delete: a row gone from the view is gone from the merge', () => {
    const after = base.filter(m => m.id !== 'a2')
    expect(mergeConversations(fullRead(base), new Set(['A']), after.filter(m => m.prospect_id === 'A'))).toEqual(fullRead(after))
  })
  it('discard of the last row drops the conversation', () => {
    const after = base.filter(m => m.prospect_id !== 'C')
    expect(mergeConversations(fullRead(base), new Set(['C']), [])).toEqual(fullRead(after))
  })
  it('reorder: a re-stamped created_at moves the row to its new place; ties break on id', () => {
    const after = base.map(m => m.id === 'a1' ? { ...m, created_at: '2026-09-28T10:03:00+00:00' } : m)
    const merged = mergeConversations(fullRead(base), new Set(['A']), after.filter(m => m.prospect_id === 'A'))
    expect(merged).toEqual(fullRead(after))
    expect(merged.map(m => m.id)).toEqual(['b1', 'a2', 'a1', 'c1'])
  })
  it('phantom duplicates dedupe exactly as the whole read does', () => {
    const dup = row('a9', 'A', '2026-09-28T10:00:00+00:00', { message_text: 'text a1', sent_at: null })
    const after = [...base, dup]
    expect(mergeConversations(fullRead(base), new Set(['A']), after.filter(m => m.prospect_id === 'A'))).toEqual(fullRead(after))
  })
  it('rows of conversations not named are never touched, even if the re-read returned them', () => {
    const stray = row('b1', 'B', '2026-09-28T10:01:00+00:00', { message_text: 'should not land' })
    const merged = mergeConversations(fullRead(base), new Set(['A']), [...base.filter(m => m.prospect_id === 'A'), stray])
    expect(merged).toEqual(fullRead(base))
  })
  it('nothing changed = the held rows', () => {
    expect(mergeConversations(fullRead(base), new Set(), [])).toEqual(fullRead(base))
  })
})

describe('prospectOfEvent', () => {
  const byId = new Map([['a1', 'A']])
  it('insert / update carry prospect_id', () => {
    expect(prospectOfEvent({ eventType: 'INSERT', new: { id: 'x', prospect_id: 'P' } }, byId)).toBe('P')
    expect(prospectOfEvent({ eventType: 'UPDATE', new: { id: 'a1', prospect_id: 'A' }, old: { id: 'a1' } }, byId)).toBe('A')
  })
  it('delete carries only the id: the held rows name the prospect', () => {
    expect(prospectOfEvent({ eventType: 'DELETE', new: {}, old: { id: 'a1' } }, byId)).toBe('A')
  })
  it('unknown row = null (caller sweeps)', () => {
    expect(prospectOfEvent({ eventType: 'DELETE', new: {}, old: { id: 'zz' } }, byId)).toBeNull()
    expect(prospectOfEvent({ eventType: 'UPDATE', new: null, old: null }, byId)).toBeNull()
  })
})

describe('withOverlap', () => {
  it('reaches two minutes behind the watermark', () => {
    expect(withOverlap('2026-09-28T10:02:00.000Z')).toBe('2026-09-28T10:00:00.000Z')
  })
})
