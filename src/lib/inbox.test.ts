import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isDraft, isFollowUp, snoozeActive, snoozeTarget, SNOOZE_PRESETS, SNOOZE_HOUR, eventTime, groupThreads, filterThreads, dedupeMessages, searchThreads, threadChatId, needsAnswer, inboxBreakdown, inboxWaitingCount, isLeadMagnet, threadBucket, filterByStatus, messageChannel, isMixedChannel, channelFamilies, canRestore, isDiscarded, applyDraftGuard, DISCARD_GUARD, RESTORE_GUARD, DISCARD_REASON, RACE_HOLD_PREFIX, type InboxMessage, type Status, type DraftGuard } from './inbox'

// inbox.ts:191 gates needsAnswer on a 14-day wall-clock staleness window
// (STALE_DAYS), measured against Date.now() by default -- and most callers
// here (threadBucket, inboxBreakdown, filterByStatus, inboxWaitingCount) call
// needsAnswer(t) with no `now` argument, so they can only ever see the real
// clock. Every fixture below is dated 2026-07-20/21/22. Freeze the clock a
// couple of days after the fixtures (comfortably inside the 14-day window)
// instead of injecting `now` per-call or rewriting fixtures to relative
// dates -- either of those would either miss the no-clock-param callers or
// silently delete staleness coverage.
const FROZEN_NOW = new Date('2026-07-22T20:00:00Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FROZEN_NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

const base: InboxMessage = {
  id: '1', prospect_id: 'p1', direction: 'outbound', message_text: 'hey',
  message_type: 'dm', channel: 'linkedin', sent_at: null, approved_at: null,
  read_at: null, created_at: '2026-07-22T10:00:00Z', send_blocked_at: null,
  send_blocked_reason: null, unipile_chat_id: null, ai_model: null,
  prospect_name: 'A', prospect_company: null,
  prospect_headline: null, prospect_stage: 'replied', prospect_email: null,
  profile_photo_url: null, campaign_name: 'c', client_id: 'ivan',
  prospect_linkedin_url: 'https://www.linkedin.com/in/a',
  snoozed_until: null, snoozed_at: null,
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
  it('a dispatcher race-hold stays a pending draft; a discard does not', () => {
    expect(isDraft({ ...base, send_blocked_at: '2026-07-22T11:00:00Z', send_blocked_reason: 'post_approval_race:outbound' })).toBe(true)
    expect(isDraft({ ...base, send_blocked_at: '2026-07-22T11:00:00Z', send_blocked_reason: 'post_approval_race:inbound' })).toBe(true)
    expect(isDraft({ ...base, send_blocked_at: '2026-07-22T11:00:00Z', send_blocked_reason: 'discarded_in_inbox' })).toBe(false)
    expect(isDraft({ ...base, send_blocked_at: '2026-07-22T11:00:00Z', send_blocked_reason: 'manual_reply_raced' })).toBe(false)
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
  // REVERSED 2026-08-03 (second pass, measured): the flag is NOT evidence of a
  // reply. Of 52 flagged prospects only 5 have any inbound row at all; the rest
  // sit at enriched / inmail_ready / dm_sent with reply_count 0. An
  // outbound-only thread stays OUT of the DM list no matter what the flag says.
  it('drops an outbound-only thread even when needs_manual_reply is flagged', () => {
    const rows: InboxMessage[] = [
      { ...base, id: 'dm1', prospect_id: 'p1', prospect_stage: 'dm_sent', sent_at: '2026-07-22T10:00:00Z' },
    ]
    expect(filterThreads(groupThreads(rows), 'all')).toHaveLength(0)
    const flagged = groupThreads(rows, new Set(['p1']))
    // The flag is still carried on the thread (it can rank a real conversation);
    // it just cannot conjure one into the list.
    expect(flagged[0].needsManualReply).toBe(true)
    expect(filterThreads(flagged, 'all')).toHaveLength(0)
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
  // Reading a message is not answering it. Mattan's seat stamps read_at on all
  // 22 inbound rows (he reads in the LinkedIn app), so an unread test scored his
  // whole lane at zero. What answers a message is a send that comes after it.
  it('a READ but unanswered reply is still waiting on Ivan', () => {
    expect(needsAnswer(groupThreads([inbound('b', '2026-07-21T10:00:00Z', true)])[0])).toBe(true)
  })
  it('an outbound-only thread is never waiting', () => {
    expect(needsAnswer(groupThreads([sent('a', '2026-07-20T10:00:00Z')])[0])).toBe(false)
  })
  // STALE_DAYS = 14 (inbox.ts:191): a reply nobody answered eventually ages
  // out of the badge -- it stays reachable via search/'waiting', it just
  // stops driving a "today" count. Gate had zero intentional coverage.
  it('an inbound reply older than STALE_DAYS drops out of needsAnswer', () => {
    // FROZEN_NOW is 2026-07-22T20:00:00Z; 15 days earlier is outside the window.
    const t = groupThreads([inbound('old', '2026-07-07T19:00:00Z')])[0]
    expect(needsAnswer(t)).toBe(false)
  })
  it('an inbound reply just inside STALE_DAYS still needs an answer', () => {
    // 13 days before FROZEN_NOW -- well inside the 14-day window.
    const t = groupThreads([inbound('fresh', '2026-07-09T20:00:00Z')])[0]
    expect(needsAnswer(t)).toBe(true)
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
    // p3: flagged needs_manual_reply, nothing inbound in the view -> NO bucket
    { ...base, id: 'p3s', prospect_id: 'p3', prospect_stage: 'dm_sent', sent_at: '2026-07-22T10:00:00Z', created_at: '2026-07-22T10:00:00Z' },
    // p4: they wrote, we answered after -> waiting on them
    { ...base, id: 'p4r', prospect_id: 'p4', direction: 'inbound', sent_at: '2026-07-21T10:00:00Z', created_at: '2026-07-21T10:00:00Z', read_at: '2026-07-21T10:05:00Z' },
    { ...base, id: 'p4s', prospect_id: 'p4', sent_at: '2026-07-22T10:00:00Z', created_at: '2026-07-22T10:00:00Z' },
    // p5: outbound-only echo -> in no bucket at all
    { ...base, id: 'p5s', prospect_id: 'p5', prospect_stage: 'dm_sent', sent_at: '2026-07-22T10:00:00Z', created_at: '2026-07-22T10:00:00Z' },
  ]
  const threads = groupThreads(rows, new Set(['p3']))
  it('buckets are non-overlapping, and a flag with no inbound counts nowhere', () => {
    expect(inboxBreakdown(threads)).toEqual({ answer: 1, approve: 1, flagged: 0, waiting: 1 })
  })
  it('the badge is exactly the sum of what waits on Ivan', () => {
    expect(inboxWaitingCount(threads)).toBe(2)
  })
  it('a thread both flagged and unanswered counts once, as answer', () => {
    const t = groupThreads(rows, new Set(['p1', 'p3']))
    expect(inboxBreakdown(t)).toEqual({ answer: 1, approve: 1, flagged: 0, waiting: 1 })
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
    // p3 flagged by the reply detector, zero inbound rows in the view -> not a
    // conversation at all now: the flag alone cannot put a row in the DM list
    { ...base, id: 'p3s', prospect_id: 'p3', prospect_stage: 'dm_sent', sent_at: '2026-07-22T10:00:00Z', created_at: '2026-07-22T10:00:00Z' },
    // p4 they wrote, we answered after -> waiting on them
    { ...base, id: 'p4r', prospect_id: 'p4', direction: 'inbound', sent_at: '2026-07-21T10:00:00Z', created_at: '2026-07-21T10:00:00Z', read_at: '2026-07-21T10:05:00Z' },
    { ...base, id: 'p4s', prospect_id: 'p4', sent_at: '2026-07-22T10:00:00Z', created_at: '2026-07-22T10:00:00Z' },
    // p5 outbound-only echo -> not a conversation, lives in Sends
    { ...base, id: 'p5s', prospect_id: 'p5', prospect_stage: 'dm_sent', sent_at: '2026-07-22T10:00:00Z', created_at: '2026-07-22T10:00:00Z' },
  ]
  const convos = filterThreads(groupThreads(rows, new Set(['p3'])), 'all')
  const ids = (s: Status) => filterByStatus(convos, s).map(t => t.prospect_id).sort()

  it('assigns each conversation exactly one bucket', () => {
    expect(Object.fromEntries(convos.map(t => [t.prospect_id, threadBucket(t)])))
      .toEqual({ p1: 'answer', p2: 'approve', p4: 'waiting' })
  })

  it('every bucket filter returns exactly the rows the bar counted', () => {
    const b = inboxBreakdown(convos)
    for (const k of ['answer', 'approve', 'flagged', 'waiting'] as const) {
      expect(filterByStatus(convos, k)).toHaveLength(b[k])
    }
    expect(ids('answer')).toEqual(['p1'])
    expect(ids('flagged')).toEqual([])
  })

  it('the default view is exactly what the badge counts — no more, no less', () => {
    expect(filterByStatus(convos, 'needs')).toHaveLength(inboxWaitingCount(convos))
    expect(ids('needs')).toEqual(['p1', 'p2'])
  })

  // 'all' means all PENDING now (2026-08-03) — the answered-and-waiting rows
  // left the browsable surface. They are still reachable two ways, which is why
  // this is a narrowing and not a deletion: the 'waiting' bucket itself still
  // resolves, and InboxScreen bypasses this filter entirely while a search
  // query is typed.
  it('all == the three pending buckets, and waiting is off the browsable views', () => {
    expect(ids('all')).toEqual(['p1', 'p2'])
    expect(ids('needs')).toEqual(ids('all'))
    expect(ids('waiting')).toEqual(['p4'])
    expect([...ids('all'), ...ids('waiting')].sort()).toEqual(['p1', 'p2', 'p4'])
  })

  it('a send echo is in no view at all — it belongs to Sends', () => {
    expect(ids('all')).not.toContain('p5')
  })
})

// Lead-magnet deliveries (2026-08-15). They are outbound-only until the person
// writes back, so every rule that requires an inbound row hid them: Ivan asked
// for a magnet gate on 08-14, three DMs went out, and none of them appeared.
describe('lead magnet deliveries', () => {
  const lm: InboxMessage = {
    ...base, id: 'lm1', prospect_id: 'lm', direction: 'outbound',
    message_text: "hey! here's the kit: https://resources.risedtc.com/x/",
    sent_at: '2026-07-22T11:00:00Z', approved_at: '2026-07-22T11:00:00Z',
    ai_model: 'lm_gate_v1', prospect_name: 'Magnet Asker', prospect_stage: 'lm_delivered',
  }

  it('shows in the conversation list even with no inbound row', () => {
    const [t] = groupThreads([lm])
    expect(isLeadMagnet(t)).toBe(true)
    expect(filterThreads([t], 'all').map(x => x.prospect_id)).toEqual(['lm'])
  })

  it('an ordinary outbound-only send stays hidden', () => {
    const echo = { ...lm, id: 'e1', prospect_id: 'echo', ai_model: null }
    const [t] = groupThreads([echo])
    expect(isLeadMagnet(t)).toBe(false)
    expect(filterThreads([t], 'all')).toEqual([])
  })

  it("rides the 'all' status view but never the badge", () => {
    const [t] = groupThreads([lm])
    expect(threadBucket(t)).toBe('waiting')
    expect(filterByStatus([t], 'all').map(x => x.prospect_id)).toEqual(['lm'])
    expect(filterByStatus([t], 'needs')).toEqual([])
    expect(inboxWaitingCount([t])).toBe(0)
  })
})

// Per-message channel (2026-08-19). The George Gazzard thread is the live shape:
// a connection note, their DM, our DM, our email mirror, then their next DM —
// which is a LinkedIn reply landing 20 minutes AFTER the email, not an answer to it.
describe('messageChannel + isMixedChannel', () => {
  const invite: InboxMessage = { ...base, id: 'c1', message_type: 'connection_note', channel: 'linkedin' }
  const dmIn: InboxMessage = { ...base, id: 'd1', direction: 'inbound', message_type: 'dm', channel: 'linkedin' }
  const dmOut: InboxMessage = { ...base, id: 'd2', message_type: 'dm', channel: 'linkedin' }
  const email: InboxMessage = { ...base, id: 'e1', message_type: 'email', channel: 'email', ai_model: 'rise_email_mirror_v1' }
  const inmail: InboxMessage = { ...base, id: 'i1', message_type: 'inmail', channel: 'linkedin_inmail' }

  it('reads the channel off the row, not off the thread', () => {
    expect(messageChannel(invite)).toBe('invite')
    expect(messageChannel(dmIn)).toBe('dm')
    expect(messageChannel(email)).toBe('email')
    expect(messageChannel(inmail)).toBe('inmail')
    // message_type left null by a mirror still resolves by channel
    expect(messageChannel({ ...email, message_type: null })).toBe('email')
    expect(messageChannel({ ...inmail, message_type: null })).toBe('inmail')
  })

  it('an invite plus DMs is ONE surface, so not mixed', () => {
    expect(isMixedChannel([invite, dmIn, dmOut])).toBe(false)
    expect(channelFamilies([invite, dmIn, dmOut])).toEqual(['linkedin'])
  })

  it('the email mirror makes the thread mixed', () => {
    expect(isMixedChannel([invite, dmIn, dmOut, email, dmIn])).toBe(true)
    expect(channelFamilies([invite, dmOut, email])).toEqual(['linkedin', 'email'])
  })

  it('InMail counts as its own surface', () => {
    expect(isMixedChannel([inmail, dmIn])).toBe(true)
    expect(channelFamilies([inmail, dmIn, email])).toEqual(['linkedin', 'inmail', 'email'])
  })

  it('an empty thread is not mixed', () => {
    expect(isMixedChannel([])).toBe(false)
  })
})

// ---- follow-up drafts are not stale drafts (Ivan, 2026-08-20) ----------------
// The live shape on the day: Marilou Hamer, Alec Lorenzo and Sharon Beckman all
// carried a `rise_stall_bump_time_ask_v1` draft, all three wore "you already
// replied", and all three were one bulk tap away from an unrecoverable discard.
describe('isFollowUp / draftStale', () => {
  const inbound: InboxMessage = {
    ...base, id: 'i', direction: 'inbound', message_text: 'sounds good',
    sent_at: '2026-07-20T09:00:00Z', created_at: '2026-07-20T09:00:00Z',
  }
  const ourReply: InboxMessage = {
    ...base, id: 's', sent_at: '2026-07-20T10:00:00Z',
    approved_at: '2026-07-20T10:00:00Z', created_at: '2026-07-20T10:00:00Z',
  }
  const pending = (ai_model: string | null): InboxMessage => ({
    ...base, id: 'd', ai_model, created_at: '2026-07-22T10:00:00Z',
  })

  it('tags every bump/follow-up drafter, and no reply drafter', () => {
    for (const m of ['stall_bump_v1', 'rise_stall_bump_time_ask_v1', 'rise_stall_bump_ctx_v1',
      'content_system_bump_v1', 'content_system_followup_v1', 'template/agency_followup_v1',
      'inmail_followup_connect_v1']) {
      expect(isFollowUp({ ...base, ai_model: m })).toBe(true)
    }
    for (const m of ['rise_reply_draft_v1', 'warm_reply_auto_v1', 'manual_mirror', null]) {
      expect(isFollowUp({ ...base, ai_model: m })).toBe(false)
    }
  })

  it('a REPLY draft written after our own send is still stale', () => {
    const t = groupThreads([inbound, ourReply, pending('rise_reply_draft_v1')])[0]
    expect(t.draftStale).toBe(true)
  })

  it('a FOLLOW-UP draft in the identical thread shape is NOT stale', () => {
    const t = groupThreads([inbound, ourReply, pending('rise_stall_bump_time_ask_v1')])[0]
    expect(t.draft?.id).toBe('d')
    expect(t.draftStale).toBe(false)
  })
})

// ---- push to later (db/037) --------------------------------------------------
describe('snooze', () => {
  const inbound = (at: string): InboxMessage => ({
    ...base, id: `i${at}`, direction: 'inbound', message_text: 'im travelling, back soon',
    sent_at: at, created_at: at,
  })
  const pushed = (until: string, at: string): InboxMessage => ({
    ...base, id: 'd', created_at: '2026-07-22T10:00:00Z', snoozed_until: until, snoozed_at: at,
  })
  const PUSHED_AT = '2026-07-22T12:00:00Z'
  const RETURNS = '2026-07-29T08:00:00Z'
  const NOW = FROZEN_NOW.getTime()

  it('a live push parks the draft: out of the badge, off Needs you, still on its thread', () => {
    const t = groupThreads([inbound('2026-07-21T09:00:00Z'), pushed(RETURNS, PUSHED_AT)], new Set(), NOW)[0]
    expect(t.draft?.id).toBe('d')            // never hidden
    expect(t.draftSnoozedUntil).toBe(RETURNS)
    expect(threadBucket(t)).toBe('waiting')  // not 'approve', not 'answer'
    expect(needsAnswer(t)).toBe(false)
    expect(inboxWaitingCount([t])).toBe(0)
    expect(filterByStatus([t], 'needs' as Status)).toHaveLength(0)
    expect(filterByStatus([t], 'all' as Status)).toHaveLength(0)
    // reachable: it is a conversation, it just isn't work
    expect(filterByStatus([t], 'waiting' as Status)).toHaveLength(1)
  })

  it('an expired push is no push at all — the draft is back in the queue', () => {
    const t = groupThreads([inbound('2026-07-21T09:00:00Z'), pushed('2026-07-22T08:00:00Z', PUSHED_AT)], new Set(), NOW)[0]
    expect(t.draftSnoozedUntil).toBeNull()
    // 'answer', not 'approve': this thread also has an unanswered inbound, and
    // answer outranks approve. Either way it is back in the count, which is
    // what the expiry has to guarantee.
    expect(threadBucket(t)).toBe('answer')
    expect(inboxWaitingCount([t])).toBe(1)
  })

  it('a thread with no inbound at all comes back as a draft to approve', () => {
    const sent: InboxMessage = { ...base, id: 's', sent_at: '2026-07-20T10:00:00Z', approved_at: '2026-07-20T10:00:00Z' }
    const live = groupThreads([sent, pushed(RETURNS, PUSHED_AT)], new Set(), NOW)[0]
    expect(threadBucket(live)).toBe('waiting')
    const expired = groupThreads([sent, pushed('2026-07-22T08:00:00Z', PUSHED_AT)], new Set(), NOW)[0]
    expect(threadBucket(expired)).toBe('approve')
    expect(inboxWaitingCount([expired])).toBe(1)
  })

  it('THEY WRITE BACK: an inbound after the push voids it immediately', () => {
    const rows = [inbound('2026-07-21T09:00:00Z'), pushed(RETURNS, PUSHED_AT), inbound('2026-07-22T15:00:00Z')]
    const t = groupThreads(rows, new Set(), NOW)[0]
    expect(t.draftSnoozedUntil).toBeNull()
    // and the thread owes an answer again, because their message is last
    expect(needsAnswer(t, NOW)).toBe(true)
    expect(threadBucket(t)).toBe('answer')
  })

  it('an inbound BEFORE the push does not void it', () => {
    const rows = [inbound('2026-07-22T11:00:00Z'), pushed(RETURNS, PUSHED_AT)]
    expect(groupThreads(rows, new Set(), NOW)[0].draftSnoozedUntil).toBe(RETURNS)
  })

  it('snoozeActive: needs a target, and honours both conditions', () => {
    expect(snoozeActive({ ...base, snoozed_until: null, snoozed_at: null }, null, NOW)).toBe(false)
    expect(snoozeActive(pushed(RETURNS, PUSHED_AT), null, NOW)).toBe(true)
    expect(snoozeActive(pushed(RETURNS, PUSHED_AT), '2026-07-22T15:00:00Z', NOW)).toBe(false)
    expect(snoozeActive(pushed('2026-07-22T08:00:00Z', PUSHED_AT), null, NOW)).toBe(false)
  })

  it('presets land at 08:00 local on the target day, never inside the window they skip', () => {
    // 04:00 local + "3 days" must not resolve to a moment before +3 days
    const from = new Date(2026, 6, 22, 4, 0, 0)
    for (const p of SNOOZE_PRESETS) {
      const d = new Date(snoozeTarget(p.days, from))
      expect(d.getHours()).toBe(SNOOZE_HOUR)
      expect(d.getTime()).toBeGreaterThan(from.getTime() + (p.days - 1) * 86_400_000)
    }
    // late-night push still lands on the morning, not at 23:40 a week on
    const late = new Date(2026, 6, 22, 23, 40, 0)
    expect(new Date(snoozeTarget(7, late)).getHours()).toBe(SNOOZE_HOUR)
  })
})

// ---- discard and restore (phase 4a) -----------------------------------------
// The data layer behind the restore control. Every case here is about ONE
// question: can a row this app un-discards reach a real person without a fresh,
// explicit human approve. The answer has to stay no.
describe('isDiscarded + canRestore', () => {
  const at = (s: string) => `2026-07-22T${s}:00Z`
  // their question, unanswered
  const theirs: InboxMessage = {
    ...base, id: 'in', direction: 'inbound', message_text: 'can you send pricing?',
    sent_at: at('09:00'), created_at: at('09:00'),
  }
  // the drafted reply, discarded at 10:00
  const disc = (over: Partial<InboxMessage> = {}): InboxMessage => ({
    ...base, id: 'disc', message_text: 'happy to walk you through it',
    created_at: at('09:30'), send_blocked_at: at('10:00'),
    send_blocked_reason: DISCARD_REASON, ...over,
  })
  const thread = (rows: InboxMessage[]) => groupThreads(rows)[0]

  it('reads a discard off the row, and nothing else', () => {
    expect(isDiscarded(disc())).toBe(true)
    expect(isDiscarded({ ...disc(), direction: 'inbound' })).toBe(false)
    expect(isDiscarded({ ...disc(), sent_at: at('10:30') })).toBe(false)
    expect(isDiscarded({ ...disc(), approved_at: at('09:45') })).toBe(false)
    expect(isDiscarded({ ...base, send_blocked_reason: DISCARD_REASON, send_blocked_at: null })).toBe(false)
  })

  it('a plain discard that is the newest outbound event can come back', () => {
    const d = disc()
    expect(canRestore(thread([theirs, d]), d)).toBe(true)
  })

  // 🔴 THE composeReply CASE. Ivan hand-types his own reply, the app inserts it
  // approved (approved_at set, sent_at null) and THEN discards the draft, so the
  // human answer is a few hundred ms OLDER than the discard. Restoring here and
  // approving would send a SECOND reply to a real person.
  it('is refused while a hand-typed reply is still queued, even though it is older', () => {
    const manual: InboxMessage = {
      ...base, id: 'manual', message_type: 'manual_reply', message_text: 'sure, sending now',
      created_at: at('09:59'), approved_at: at('09:59'), sent_at: null,
    }
    const d = disc()
    const t = thread([theirs, manual, d])
    expect(eventTime(manual) < d.send_blocked_at!).toBe(true) // older, and still refused
    expect(canRestore(t, d)).toBe(false)
  })

  it('is refused once that reply has actually gone out', () => {
    const manual: InboxMessage = {
      ...base, id: 'manual', message_type: 'manual_reply',
      created_at: at('09:59'), approved_at: at('09:59'), sent_at: at('10:01'),
    }
    const d = disc()
    expect(canRestore(thread([theirs, manual, d]), d)).toBe(false)
  })

  it('is refused when any send is newer than the discard', () => {
    const later: InboxMessage = { ...base, id: 'sent', sent_at: at('11:00'), created_at: at('11:00') }
    const d = disc()
    expect(canRestore(thread([theirs, d, later]), d)).toBe(false)
    // ...and an older send does not block it
    const older: InboxMessage = { ...base, id: 'old', sent_at: at('08:00'), created_at: at('08:00') }
    expect(canRestore(thread([older, theirs, d]), d)).toBe(true)
  })

  it('is refused when a fresh pending draft was written after the discard', () => {
    const fresh: InboxMessage = { ...base, id: 'fresh', created_at: at('10:30') }
    const d = disc()
    expect(canRestore(thread([theirs, d, fresh]), d)).toBe(false)
  })

  it('an inbound reply after the discard does NOT block it', () => {
    // They wrote again. The thread owes an answer, and the drafted one is the
    // obvious candidate. Only OUR side speaking after the ruling blocks it.
    const again: InboxMessage = {
      ...base, id: 'in2', direction: 'inbound', sent_at: at('12:00'), created_at: at('12:00'),
    }
    const d = disc()
    expect(canRestore(thread([theirs, d, again]), d)).toBe(true)
  })

  // Every other block reason is somebody else's state, and clearing it would be
  // a live defect: a verified send failure may already have landed on the
  // platform, a geo gate is still queued upstream, a race hold is ALREADY a
  // pending draft with nothing to undo.
  it('refuses every block reason that is not our own discard', () => {
    for (const reason of ['send_failed_verified:unipile_422', 'geo_gate_v2:country_missing',
      `${RACE_HOLD_PREFIX}outbound`, `${RACE_HOLD_PREFIX}inbound`, 'manual_reply_raced', null]) {
      const row = disc({ send_blocked_reason: reason })
      expect(isDiscarded(row)).toBe(false)
      expect(canRestore(thread([theirs, row]), row)).toBe(false)
    }
  })

  it('refuses an approved row and a sent row outright', () => {
    const approved = disc({ approved_at: at('09:45') })
    expect(canRestore(thread([theirs, approved]), approved)).toBe(false)
    const sent = disc({ sent_at: at('10:30') })
    expect(canRestore(thread([theirs, sent]), sent)).toBe(false)
  })

  it('an unparseable timestamp holds the restore rather than allowing it', () => {
    const d = disc({ send_blocked_at: 'not a date' })
    expect(canRestore(thread([theirs, d]), d)).toBe(false)
    const good = disc()
    const junk: InboxMessage = { ...base, id: 'junk', sent_at: 'x', created_at: 'x' }
    expect(canRestore(thread([theirs, good, junk]), good)).toBe(false)
  })

  // The round trip: what restoreDraft writes is exactly the two nulls, and a row
  // in that state is a pending draft again by isDraft's own definition.
  it('clearing the discard block makes the row a pending draft again', () => {
    const d = disc()
    expect(isDraft(d)).toBe(false)
    const restored = { ...d, send_blocked_reason: null, send_blocked_at: null }
    expect(isDraft(restored)).toBe(true)
    expect(thread([theirs, restored]).draft?.id).toBe('disc')
    // and the thread owes an answer again, which is the ruling restore reverses
    expect(needsAnswer(thread([theirs, d]))).toBe(false)
    expect(needsAnswer(thread([theirs, restored]))).toBe(true)
  })
})

// The guards are declared as data and applied by applyDraftGuard, so these
// assert the filters the REAL write sends, not a copy of them.
describe('discard + restore guards', () => {
  type Call = [string, string, string | null]
  type FakeQuery = {
    eq(column: string, value: string): FakeQuery
    is(column: string, value: null): FakeQuery
  }
  const recorder = () => {
    const calls: Call[] = []
    const q: FakeQuery = {
      eq(column, value) { calls.push(['eq', column, value]); return q },
      is(column, value) { calls.push(['is', column, value]); return q },
    }
    return { q, calls }
  }

  it('restore matches one row: this id, unsent, unapproved, discarded by us', () => {
    const { q, calls } = recorder()
    applyDraftGuard(q, 'msg-1', RESTORE_GUARD)
    expect(calls).toEqual([
      ['eq', 'id', 'msg-1'],
      ['is', 'sent_at', null],
      ['is', 'approved_at', null],
      ['eq', 'send_blocked_reason', 'discarded_in_inbox'],
    ])
    // NEVER `send_blocked_at is not null`: that guard would also match
    // send_failed_verified:* and geo_gate_v2:* rows.
    expect(RESTORE_GUARD.some(g => g.column === 'send_blocked_at')).toBe(false)
  })

  it('discard now carries the approved_at guard that closed the fail-open', () => {
    const { q, calls } = recorder()
    applyDraftGuard(q, 'msg-2', DISCARD_GUARD)
    expect(calls).toEqual([
      ['eq', 'id', 'msg-2'],
      ['is', 'sent_at', null],
      ['is', 'approved_at', null],
    ])
  })

  // What the guard MEANS, not just its shape. A race-held row keeps
  // approved_at NULL (the dispatcher's bounce writes approved_at=null), which is
  // why the simple guard does not break the race-hold discard path.
  it('admits every row the callers actually pass, and refuses an approved one', () => {
    const passes = (m: InboxMessage, guard: readonly DraftGuard[]) => guard.every(g =>
      g.op === 'is'
        ? (m as unknown as Record<string, unknown>)[g.column] === null
        : (m as unknown as Record<string, unknown>)[g.column] === g.value)
    const pending: InboxMessage = { ...base, id: 'p' }
    const raceHeld: InboxMessage = {
      ...base, id: 'r', send_blocked_at: '2026-07-22T11:00:00Z',
      send_blocked_reason: `${RACE_HOLD_PREFIX}outbound`,
    }
    const approved: InboxMessage = { ...base, id: 'a', approved_at: '2026-07-22T11:00:00Z' }
    const sent: InboxMessage = { ...base, id: 's', sent_at: '2026-07-22T11:00:00Z' }
    // every discardDraft caller passes thread.draft, which is isDraft by
    // construction, so both of these are the live shapes
    expect(isDraft(pending) && isDraft(raceHeld)).toBe(true)
    expect(passes(pending, DISCARD_GUARD)).toBe(true)
    expect(passes(raceHeld, DISCARD_GUARD)).toBe(true)
    // the fail-open that is now closed: an approved row is a queued send
    expect(passes(approved, DISCARD_GUARD)).toBe(false)
    expect(passes(sent, DISCARD_GUARD)).toBe(false)
    // restore only ever matches a row we discarded
    const discarded: InboxMessage = {
      ...base, id: 'd', send_blocked_at: '2026-07-22T11:00:00Z', send_blocked_reason: DISCARD_REASON,
    }
    expect(passes(discarded, RESTORE_GUARD)).toBe(true)
    expect(passes(raceHeld, RESTORE_GUARD)).toBe(false)
    expect(passes({ ...discarded, approved_at: '2026-07-22T11:30:00Z' }, RESTORE_GUARD)).toBe(false)
    expect(passes({ ...discarded, sent_at: '2026-07-22T11:30:00Z' }, RESTORE_GUARD)).toBe(false)
  })
})
