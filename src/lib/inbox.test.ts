import { describe, it, expect } from 'vitest'
import { isDraft, eventTime, groupThreads, filterThreads, dedupeMessages, searchThreads, threadChatId, needsAnswer, inboxBreakdown, inboxWaitingCount, threadBucket, filterByStatus, type InboxMessage, type Status } from './inbox'

const base: InboxMessage = {
  id: '1', prospect_id: 'p1', direction: 'outbound', message_text: 'hey',
  message_type: 'dm', channel: 'linkedin', sent_at: null, approved_at: null,
  read_at: null, created_at: '2026-07-22T10:00:00Z', send_blocked_at: null,
  send_blocked_reason: null, unipile_chat_id: null, ai_model: null,
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

describe('eventTime', () => {
  it('is when the human spoke, falling back to storage time for unsent drafts', () => {
    // Ronnie's reply: written 07-29 15:39, only stored 07-30 11:15.
    expect(eventTime({ ...base, sent_at: '2026-07-29T15:39:38Z', created_at: '2026-07-30T11:15:52Z' }))
      .toBe('2026-07-29T15:39:38Z')
    // an unsent draft has no sent_at, so storage time is the only clock it has
    expect(eventTime({ ...base, sent_at: null, created_at: '2026-07-30T12:05:00Z' }))
      .toBe('2026-07-30T12:05:00Z')
  })
})

describe('groupThreads', () => {
  // Ronnie Teja, 2026-07-30. He replied 24s after accepting the invite, but that reply
  // sat uncaptured for a day and was backfilled at 11:15 the next morning. Ordering by
  // created_at (insertion time) therefore rendered his reply BELOW a DM we sent 19h after
  // he wrote it, so the thread read as if he had answered our pitch. He had not.
  // sent_at is when the human actually spoke; created_at is when our detector wrote the row.
  it('orders a backfilled reply by when it was SENT, not when it was stored', () => {
    const rows: InboxMessage[] = [
      { ...base, id: 'note', sent_at: '2026-07-29T15:39:14Z', created_at: '2026-07-29T15:39:14Z' },
      { ...base, id: 'reply', direction: 'inbound', sent_at: '2026-07-29T15:39:38Z', created_at: '2026-07-30T11:15:52Z' },
      { ...base, id: 'dm', sent_at: '2026-07-30T10:04:47Z', created_at: '2026-07-30T10:04:47Z' },
    ]
    expect(groupThreads(rows)[0].messages.map(m => m.id)).toEqual(['note', 'reply', 'dm'])
  })

  // draftStale compared lastInbound (created_at) against lastSent (sent_at) -- two different
  // clocks. A backfilled reply made an unsent draft look stale when it was not.
  it('does not mark a draft stale when the newest human message is their reply', () => {
    const rows: InboxMessage[] = [
      { ...base, id: 'dm', sent_at: '2026-07-30T10:04:47Z', created_at: '2026-07-30T10:04:47Z' },
      { ...base, id: 'reply', direction: 'inbound', sent_at: '2026-07-30T12:00:00Z', created_at: '2026-07-30T12:00:00Z' },
      { ...base, id: 'draft', created_at: '2026-07-30T12:05:00Z' },
    ]
    expect(groupThreads(rows)[0].draftStale).toBe(false)
  })

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

describe('searchThreads', () => {
  const threads = groupThreads([
    { ...base, id: 'a', prospect_id: 'p1', prospect_name: 'Brian Gerstner', prospect_company: 'Acme', sent_at: 'x', message_text: 'we run a Shopify store and need help', created_at: '2026-07-21T09:00:00Z' },
    { ...base, id: 'b', prospect_id: 'p2', prospect_name: 'Karen Levin', prospect_company: 'LevinCo', sent_at: 'x', message_text: 'thanks but not now', created_at: '2026-07-20T09:00:00Z' },
  ])
  it('matches message text case-insensitively ("that guy who mentioned Shopify")', () => {
    expect(searchThreads(threads, 'shopify').map(t => t.prospect_id)).toEqual(['p1'])
  })
  it('matches name and company', () => {
    expect(searchThreads(threads, 'karen')).toHaveLength(1)
    expect(searchThreads(threads, 'acme')).toHaveLength(1)
  })
  it('multi-word queries require every word (across name+text)', () => {
    expect(searchThreads(threads, 'brian shopify')).toHaveLength(1)
    expect(searchThreads(threads, 'karen shopify')).toHaveLength(0)
  })
  it('empty query returns everything', () => {
    expect(searchThreads(threads, '  ')).toHaveLength(2)
  })
})

describe('filterThreads', () => {
  it('hides unaccepted connection invites (no inbound, no draft) from every filter', () => {
    const rows: InboxMessage[] = [
      // pure invite-in-the-void thread (Eric Osman case)
      { ...base, id: 'inv', prospect_id: 'p9', prospect_stage: 'connection_sent', message_type: 'connection_note', sent_at: '2026-07-22T10:00:00Z' },
      // connection_sent but the prospect wrote back -> stays visible
      { ...base, id: 'inv2', prospect_id: 'p10', prospect_stage: 'connection_sent', message_type: 'connection_note', sent_at: '2026-07-21T10:00:00Z' },
      { ...base, id: 'in10', prospect_id: 'p10', prospect_stage: 'connection_sent', direction: 'inbound', created_at: '2026-07-22T11:00:00Z' },
    ]
    const shown = filterThreads(groupThreads(rows), 'all')
    expect(shown.map(t => t.prospect_id)).toEqual(['p10'])
  })
  // Ask 11 — 1,072 of 1,169 listed threads were outbound-only send echoes.
  // A sent DM nobody ever answered is a send (Sends owns it), not a conversation.
  it('hides outbound-only send echoes at ANY stage, not just connection_sent', () => {
    const rows: InboxMessage[] = [
      { ...base, id: 'dm1', prospect_id: 'p1', prospect_stage: 'dm_sent', sent_at: '2026-07-22T10:00:00Z' },
      { ...base, id: 'dm2', prospect_id: 'p2', prospect_stage: 'replied', sent_at: '2026-07-21T10:00:00Z' },
      // real inbound -> stays
      { ...base, id: 'dm3', prospect_id: 'p3', prospect_stage: 'dm_sent', sent_at: '2026-07-20T10:00:00Z' },
      { ...base, id: 'in3', prospect_id: 'p3', direction: 'inbound', created_at: '2026-07-21T11:00:00Z' },
      // pending draft -> stays (that is work waiting on Ivan)
      { ...base, id: 'dm4', prospect_id: 'p4', sent_at: '2026-07-20T10:00:00Z' },
      { ...base, id: 'dr4', prospect_id: 'p4', created_at: '2026-07-21T09:00:00Z' },
    ]
    const shown = filterThreads(groupThreads(rows), 'all')
    expect(shown.map(t => t.prospect_id).sort()).toEqual(['p3', 'p4'])
  })
  // The reply-blindspot case: 43 of 45 flagged prospects had ZERO inbound rows
  // in the view. The flag is the only evidence — it must keep the thread listed.
  it('keeps an outbound-only thread when needs_manual_reply is flagged', () => {
    const rows: InboxMessage[] = [
      { ...base, id: 'dm1', prospect_id: 'p1', prospect_stage: 'dm_sent', sent_at: '2026-07-22T10:00:00Z' },
    ]
    expect(filterThreads(groupThreads(rows), 'all')).toHaveLength(0)
    const flagged = groupThreads(rows, new Set(['p1']))
    expect(flagged[0].needsManualReply).toBe(true)
    expect(filterThreads(flagged, 'all')).toHaveLength(1)
  })
  it('filters by client and by email channel', () => {
    // every thread carries an inbound row: this test pins the client/email
    // axes, not the conversation predicate above
    const rows: InboxMessage[] = [
      { ...base, id: 'a', sent_at: 'x', created_at: '2026-07-21T09:00:00Z' },
      { ...base, id: 'ain', direction: 'inbound', created_at: '2026-07-21T10:00:00Z' },
      { ...base, id: 'd', prospect_id: 'p2', client_id: 'risedtc', channel: 'email', sent_at: 'x', created_at: '2026-07-20T08:00:00Z' },
      { ...base, id: 'din', prospect_id: 'p2', client_id: 'risedtc', channel: 'email', direction: 'inbound', created_at: '2026-07-20T09:00:00Z' },
    ]
    const t = groupThreads(rows)
    expect(filterThreads(t, 'all')).toHaveLength(2)
    expect(filterThreads(t, 'ivan')).toHaveLength(1)
    expect(filterThreads(t, 'risedtc')).toHaveLength(1)
    expect(filterThreads(t, 'email')[0].channel).toBe('email')
  })
})

describe('needsAnswer', () => {
  const inbound = (id: string, at: string, read = false): InboxMessage =>
    ({ ...base, id, direction: 'inbound', sent_at: at, created_at: at, read_at: read ? at : null })
  const sent = (id: string, at: string): InboxMessage =>
    ({ ...base, id, sent_at: at, created_at: at })
  it('unread inbound with no later send is waiting on Ivan', () => {
    const t = groupThreads([sent('a', '2026-07-20T10:00:00Z'), inbound('b', '2026-07-21T10:00:00Z')])[0]
    expect(needsAnswer(t)).toBe(true)
  })
  // 28 of the 56 "unread" threads: Ivan answered in the LinkedIn app (the
  // mirror writes the outbound row, nothing stamps read_at). Answered is not waiting.
  it('unread inbound already answered by a later send is NOT waiting', () => {
    const t = groupThreads([inbound('b', '2026-07-21T10:00:00Z'), sent('c', '2026-07-22T10:00:00Z')])[0]
    expect(needsAnswer(t)).toBe(false)
  })
  it('read threads and outbound-only threads are not waiting', () => {
    expect(needsAnswer(groupThreads([inbound('b', '2026-07-21T10:00:00Z', true)])[0])).toBe(false)
    expect(needsAnswer(groupThreads([sent('a', '2026-07-20T10:00:00Z')])[0])).toBe(false)
  })
})

describe('inboxBreakdown + inboxWaitingCount', () => {
  const rows: InboxMessage[] = [
    // p1: unanswered reply -> answer
    { ...base, id: 'p1s', prospect_id: 'p1', sent_at: '2026-07-20T10:00:00Z', created_at: '2026-07-20T10:00:00Z' },
    { ...base, id: 'p1r', prospect_id: 'p1', direction: 'inbound', sent_at: '2026-07-21T10:00:00Z', created_at: '2026-07-21T10:00:00Z' },
    // p2: unread but answered after, plus a pending draft -> approve (not answer)
    { ...base, id: 'p2r', prospect_id: 'p2', direction: 'inbound', sent_at: '2026-07-21T10:00:00Z', created_at: '2026-07-21T10:00:00Z' },
    { ...base, id: 'p2s', prospect_id: 'p2', sent_at: '2026-07-22T10:00:00Z', created_at: '2026-07-22T10:00:00Z' },
    { ...base, id: 'p2d', prospect_id: 'p2', created_at: '2026-07-22T11:00:00Z' },
    // p3: flagged needs_manual_reply, nothing inbound in the view -> flagged
    { ...base, id: 'p3s', prospect_id: 'p3', prospect_stage: 'dm_sent', sent_at: '2026-07-22T10:00:00Z', created_at: '2026-07-22T10:00:00Z' },
    // p4: read conversation, nothing pending -> waiting on them
    { ...base, id: 'p4r', prospect_id: 'p4', direction: 'inbound', sent_at: '2026-07-21T10:00:00Z', created_at: '2026-07-21T10:00:00Z', read_at: '2026-07-21T10:05:00Z' },
    { ...base, id: 'p4s', prospect_id: 'p4', sent_at: '2026-07-22T10:00:00Z', created_at: '2026-07-22T10:00:00Z' },
    // p5: outbound-only echo -> in no bucket at all
    { ...base, id: 'p5s', prospect_id: 'p5', prospect_stage: 'dm_sent', sent_at: '2026-07-22T10:00:00Z', created_at: '2026-07-22T10:00:00Z' },
  ]
  const threads = groupThreads(rows, new Set(['p3']))
  it('buckets are non-overlapping (priority answer > approve > flagged) and echoes count nowhere', () => {
    expect(inboxBreakdown(threads)).toEqual({ answer: 1, approve: 1, flagged: 1, waiting: 1 })
  })
  it('the badge is exactly the sum of what waits on Ivan', () => {
    expect(inboxWaitingCount(threads)).toBe(3)
  })
  it('a thread both flagged and unanswered counts once, as answer', () => {
    const t = groupThreads(rows, new Set(['p1', 'p3']))
    expect(inboxBreakdown(t)).toEqual({ answer: 1, approve: 1, flagged: 1, waiting: 1 })
  })
})

// The Inbox job was removed on 2026-08-03 and DMs absorbed the conversation
// list, so the breakdown bar became the STATUS FILTER. These assertions are the
// reason that is safe: the bar's printed number and the list a click produces
// come from one function, so a segment can never advertise 42 and hand back 7.
describe('threadBucket + filterByStatus (the DMs status axis)', () => {
  const rows: InboxMessage[] = [
    // p1 unanswered reply -> answer
    { ...base, id: 'p1s', prospect_id: 'p1', sent_at: '2026-07-20T10:00:00Z', created_at: '2026-07-20T10:00:00Z' },
    { ...base, id: 'p1r', prospect_id: 'p1', direction: 'inbound', sent_at: '2026-07-21T10:00:00Z', created_at: '2026-07-21T10:00:00Z' },
    // p2 answered, with a pending draft -> approve
    { ...base, id: 'p2r', prospect_id: 'p2', direction: 'inbound', sent_at: '2026-07-21T10:00:00Z', created_at: '2026-07-21T10:00:00Z' },
    { ...base, id: 'p2s', prospect_id: 'p2', sent_at: '2026-07-22T10:00:00Z', created_at: '2026-07-22T10:00:00Z' },
    { ...base, id: 'p2d', prospect_id: 'p2', created_at: '2026-07-22T11:00:00Z' },
    // p3 flagged by the reply detector, zero inbound rows in the view -> flagged
    { ...base, id: 'p3s', prospect_id: 'p3', prospect_stage: 'dm_sent', sent_at: '2026-07-22T10:00:00Z', created_at: '2026-07-22T10:00:00Z' },
    // p4 read conversation -> waiting on them
    { ...base, id: 'p4r', prospect_id: 'p4', direction: 'inbound', sent_at: '2026-07-21T10:00:00Z', created_at: '2026-07-21T10:00:00Z', read_at: '2026-07-21T10:05:00Z' },
    { ...base, id: 'p4s', prospect_id: 'p4', sent_at: '2026-07-22T10:00:00Z', created_at: '2026-07-22T10:00:00Z' },
    // p5 outbound-only echo -> not a conversation, lives in Sends
    { ...base, id: 'p5s', prospect_id: 'p5', prospect_stage: 'dm_sent', sent_at: '2026-07-22T10:00:00Z', created_at: '2026-07-22T10:00:00Z' },
  ]
  const convos = filterThreads(groupThreads(rows, new Set(['p3'])), 'all')
  const ids = (s: Status) => filterByStatus(convos, s).map(t => t.prospect_id).sort()

  it('assigns each conversation exactly one bucket', () => {
    expect(Object.fromEntries(convos.map(t => [t.prospect_id, threadBucket(t)])))
      .toEqual({ p1: 'answer', p2: 'approve', p3: 'flagged', p4: 'waiting' })
  })

  it('every bucket filter returns exactly the rows the bar counted', () => {
    const b = inboxBreakdown(convos)
    for (const k of ['answer', 'approve', 'flagged', 'waiting'] as const) {
      expect(filterByStatus(convos, k)).toHaveLength(b[k])
    }
    expect(ids('answer')).toEqual(['p1'])
    expect(ids('flagged')).toEqual(['p3'])
  })

  it('the default view is exactly what the badge counts — no more, no less', () => {
    expect(filterByStatus(convos, 'needs')).toHaveLength(inboxWaitingCount(convos))
    expect(ids('needs')).toEqual(['p1', 'p2', 'p3'])
  })

  it('nothing is lost between the views: needs + waiting == all', () => {
    expect(ids('all')).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect([...ids('needs'), ...ids('waiting')].sort()).toEqual(ids('all'))
  })

  it('a send echo is in no view at all — it belongs to Sends', () => {
    expect(ids('all')).not.toContain('p5')
  })
})
