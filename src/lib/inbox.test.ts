import { describe, it, expect } from 'vitest'
import { isDraft, groupThreads, filterThreads, dedupeMessages, threadChatId, type InboxMessage } from './inbox'

const base: InboxMessage = {
  id: '1', prospect_id: 'p1', direction: 'outbound', message_text: 'hey',
  message_type: 'dm', channel: 'linkedin', sent_at: null, approved_at: null,
  read_at: null, created_at: '2026-07-22T10:00:00Z', send_blocked_at: null,
  send_blocked_reason: null, unipile_chat_id: null,
  prospect_name: 'A', prospect_company: null,
  prospect_headline: null, prospect_stage: 'replied', prospect_email: null,
  profile_photo_url: null, campaign_name: 'c', client_id: 'ivan',
}

describe('isDraft', () => {
  it('unsent unapproved unblocked outbound is a draft', () => {
    expect(isDraft(base)).toBe(true)
  })
  it('sent, approved, blocked, or inbound rows are not drafts', () => {
    expect(isDraft({ ...base, sent_at: '2026-07-22T11:00:00Z' })).toBe(false)
    expect(isDraft({ ...base, approved_at: '2026-07-22T11:00:00Z' })).toBe(false)
    expect(isDraft({ ...base, send_blocked_at: '2026-07-22T11:00:00Z' })).toBe(false)
    expect(isDraft({ ...base, direction: 'inbound' })).toBe(false)
  })
})

describe('groupThreads', () => {
  it('groups by prospect, counts unread inbound, surfaces newest draft, sorts desc', () => {
    const rows: InboxMessage[] = [
      { ...base, id: 'a', sent_at: '2026-07-21T09:00:00Z', created_at: '2026-07-21T09:00:00Z' },
      { ...base, id: 'b', direction: 'inbound', created_at: '2026-07-22T09:39:00Z' },
      { ...base, id: 'c', created_at: '2026-07-22T09:40:00Z' }, // draft
      { ...base, id: 'd', prospect_id: 'p2', prospect_name: 'B', client_id: 'risedtc', channel: 'email', sent_at: '2026-07-20T08:00:00Z', created_at: '2026-07-20T08:00:00Z' },
    ]
    const t = groupThreads(rows)
    expect(t).toHaveLength(2)
    expect(t[0].prospect_id).toBe('p1')
    expect(t[0].unread).toBe(1)
    expect(t[0].draft?.id).toBe('c')
    expect(t[0].messages.map(m => m.id)).toEqual(['a', 'b', 'c'])
    expect(t[1].client_id).toBe('risedtc')
  })
})

describe('draftStale', () => {
  it('flags a draft as stale when a real send is newer than the last inbound', () => {
    const rows: InboxMessage[] = [
      { ...base, id: 'in1', direction: 'inbound', created_at: '2026-07-22T04:47:00Z' },
      { ...base, id: 'sent1', sent_at: '2026-07-22T13:29:00Z', created_at: '2026-07-22T13:29:00Z', message_text: 'OK sounds good' },
      { ...base, id: 'dr1', created_at: '2026-07-22T05:00:00Z', message_text: 'stale drafted reply' },
    ]
    expect(groupThreads(rows)[0].draftStale).toBe(true)
  })
  it('fresh draft (no send after the last inbound) is not stale', () => {
    const rows: InboxMessage[] = [
      { ...base, id: 'sent1', sent_at: '2026-07-21T10:00:00Z', created_at: '2026-07-21T10:00:00Z' },
      { ...base, id: 'in1', direction: 'inbound', created_at: '2026-07-22T09:00:00Z' },
      { ...base, id: 'dr1', created_at: '2026-07-22T09:30:00Z' },
    ]
    expect(groupThreads(rows)[0].draftStale).toBe(false)
  })
  it('thread with no inbound at all is never stale-flagged', () => {
    const rows: InboxMessage[] = [
      { ...base, id: 'sent1', sent_at: '2026-07-21T10:00:00Z', created_at: '2026-07-21T10:00:00Z' },
      { ...base, id: 'dr1', created_at: '2026-07-22T09:30:00Z' },
    ]
    expect(groupThreads(rows)[0].draftStale).toBe(false)
  })
})

describe('dedupeMessages', () => {
  it('collapses phantom duplicates (same prospect+direction+text+timestamp)', () => {
    const rows: InboxMessage[] = Array.from({ length: 17 }).map((_, i) => ({
      ...base, id: `dup-${i}`, sent_at: '2026-06-13T16:02:46.991Z', message_text: 'Hi Brian',
    }))
    expect(dedupeMessages(rows)).toHaveLength(1)
    expect(dedupeMessages(rows)[0].id).toBe('dup-0') // keeps first seen
  })
  it('keeps real repeats sent at different times, and different prospects', () => {
    const rows: InboxMessage[] = [
      { ...base, id: 'a', sent_at: '2026-06-13T16:00:00Z', message_text: 'ping' },
      { ...base, id: 'b', sent_at: '2026-06-14T16:00:00Z', message_text: 'ping' }, // same text, later time
      { ...base, id: 'c', prospect_id: 'p2', sent_at: '2026-06-13T16:00:00Z', message_text: 'ping' }, // other person
    ]
    expect(dedupeMessages(rows)).toHaveLength(3)
  })
})

describe('threadChatId + archived drafts', () => {
  it('finds the newest chat id in the thread (InMail reply-routing)', () => {
    const rows: InboxMessage[] = [
      { ...base, id: 'a', message_type: 'inmail', unipile_chat_id: 'chat-1', sent_at: '2026-07-22T14:00:00Z', created_at: '2026-07-22T14:00:00Z' },
      { ...base, id: 'b', direction: 'inbound', unipile_chat_id: 'chat-1', created_at: '2026-07-22T17:00:00Z' },
      { ...base, id: 'c', created_at: '2026-07-22T18:00:00Z' }, // draft, no chat id
    ]
    const t = groupThreads(rows)[0]
    expect(threadChatId(t)).toBe('chat-1')
    expect(t.draft?.id).toBe('c')
  })
  it('archived prospects never surface a draft', () => {
    const rows: InboxMessage[] = [
      { ...base, id: 'dr', prospect_stage: 'archived', created_at: '2026-04-26T10:00:00Z' },
    ]
    expect(groupThreads(rows)[0].draft).toBeNull()
  })
})

describe('filterThreads', () => {
  it('filters by client and by email channel', () => {
    const rows: InboxMessage[] = [
      { ...base, id: 'a', sent_at: 'x', created_at: '2026-07-21T09:00:00Z' },
      { ...base, id: 'd', prospect_id: 'p2', client_id: 'risedtc', channel: 'email', sent_at: 'x', created_at: '2026-07-20T08:00:00Z' },
    ]
    const t = groupThreads(rows)
    expect(filterThreads(t, 'all')).toHaveLength(2)
    expect(filterThreads(t, 'ivan')).toHaveLength(1)
    expect(filterThreads(t, 'risedtc')).toHaveLength(1)
    expect(filterThreads(t, 'email')[0].channel).toBe('email')
  })
})
