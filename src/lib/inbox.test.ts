import { describe, it, expect } from 'vitest'
import { isDraft, groupThreads, filterThreads, type InboxMessage } from './inbox'

const base: InboxMessage = {
  id: '1', prospect_id: 'p1', direction: 'outbound', message_text: 'hey',
  message_type: 'dm', channel: 'linkedin', sent_at: null, approved_at: null,
  read_at: null, created_at: '2026-07-22T10:00:00Z', send_blocked_at: null,
  send_blocked_reason: null, prospect_name: 'A', prospect_company: null,
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
