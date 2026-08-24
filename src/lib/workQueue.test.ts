import { describe, it, expect } from 'vitest'
import { groupThreads, type InboxMessage } from './inbox'
import type { OpsDraft } from './ops'
import {
  ageDaysOf, buildOpsItems, buildReplyItems, neverOpened, pileItems, rankQueue, type QueueItem,
} from './workQueue'

const NOW = Date.parse('2026-08-22T12:00:00Z')

const msg = (over: Partial<InboxMessage> = {}): InboxMessage => ({
  id: 'm1', prospect_id: 'p1', direction: 'inbound', message_text: 'hey',
  message_type: 'dm', channel: 'linkedin', sent_at: null, approved_at: null,
  read_at: null, created_at: '2026-08-01T10:00:00Z', send_blocked_at: null,
  send_blocked_reason: null, unipile_chat_id: null, ai_model: null,
  prospect_name: 'A Prospect', prospect_company: null,
  prospect_headline: null, prospect_stage: 'replied', prospect_email: null,
  profile_photo_url: null, campaign_name: 'c', client_id: 'ivan',
  prospect_linkedin_url: 'https://www.linkedin.com/in/a-prospect',
  snoozed_until: null, snoozed_at: null, ...over,
})

const opsDraft = (over: Partial<OpsDraft> = {}): OpsDraft => ({
  id: 'o1', client_id: 'ivan', kind: 'comment_outbound', slack_channel: '#x',
  body: 'a comment', context: null, created_at: '2026-08-01T10:00:00Z',
  approved_at: null, sent_at: null, send_blocked_reason: null, ...over,
})

describe('neverOpened', () => {
  it('true when every inbound message has read_at null', () => {
    const t = groupThreads([msg({ read_at: null })], new Set(), NOW)[0]
    expect(neverOpened(t)).toBe(true)
  })
  it('false once any inbound message has been read', () => {
    const t = groupThreads([msg({ read_at: '2026-08-02T00:00:00Z' })], new Set(), NOW)[0]
    expect(neverOpened(t)).toBe(false)
  })
  it('false for a thread with no inbound message at all', () => {
    const t = groupThreads(
      [msg({ direction: 'outbound', sent_at: '2026-08-01T10:00:00Z', read_at: null })],
      new Set(), NOW,
    )[0]
    expect(neverOpened(t)).toBe(false)
  })
})

describe('buildReplyItems', () => {
  it('ranks a never-opened waiting reply into tier 0', () => {
    const t = groupThreads([msg({ read_at: null })], new Set(), NOW)[0]
    const [item] = buildReplyItems([t], NOW)
    expect(item.tier).toBe(0)
    expect(item.kind).toBe('reply')
  })
  it('an opened-but-unanswered reply lands in tier 1', () => {
    const t = groupThreads([msg({ read_at: '2026-08-02T00:00:00Z' })], new Set(), NOW)[0]
    const [item] = buildReplyItems([t], NOW)
    expect(item.tier).toBe(1)
  })
  it('a thread Ivan already answered is not in the queue at all', () => {
    const rows = [
      msg({ read_at: '2026-08-02T00:00:00Z' }),
      msg({ id: 'm2', direction: 'outbound', sent_at: '2026-08-03T00:00:00Z', message_text: 'reply' }),
    ]
    const t = groupThreads(rows, new Set(), NOW)[0]
    expect(buildReplyItems([t], NOW)).toEqual([])
  })
})

describe('buildOpsItems', () => {
  it('an escalation is tier 2, a plain comment is tier 3', () => {
    const escalation = opsDraft({ id: 'e1', kind: 'escalation' })
    const comment = opsDraft({ id: 'c1', kind: 'comment_outbound' })
    const items = buildOpsItems([escalation, comment], NOW)
    const byId = Object.fromEntries(items.map(i => [i.id, i]))
    expect(byId['ops:e1'].tier).toBe(2)
    expect(byId['ops:c1'].tier).toBe(3)
  })
  it('an already-approved draft never appears (pendingOps excludes it)', () => {
    const approved = opsDraft({ id: 'a1', approved_at: '2026-08-02T00:00:00Z' })
    expect(buildOpsItems([approved], NOW)).toEqual([])
  })
})

describe('pileItems', () => {
  it('an aggregate card carries the count and the lane', () => {
    const [item] = pileItems(
      [{ lane: 'risedtc', n: 54, oldestCreatedAt: '2026-07-20T00:00:00Z', oldestTitle: 'A draft' }],
      'contentReview', NOW,
    )
    expect(item.tier).toBe(4)
    expect(item.n).toBe(54)
    expect(item.lane).toBe('risedtc')
    expect(item.openId).toBe('risedtc')
  })
  it('staged ideas sit one tier below the content pile', () => {
    const [item] = pileItems(
      [{ lane: 'risedtc', n: 148, oldestCreatedAt: '2026-07-20T00:00:00Z', oldestTitle: null }],
      'ideas', NOW,
    )
    expect(item.tier).toBe(5)
  })
})

describe('rankQueue', () => {
  it('sorts by tier first, then oldest-first within a tier', () => {
    const older: QueueItem = {
      id: 'a', tier: 1, kind: 'reply', title: 'Older', sub: null, lane: 'ivan',
      waitingSince: '', ageDays: 5, openId: 'a',
    }
    const newer: QueueItem = { ...older, id: 'b', title: 'Newer', ageDays: 1 }
    const tier0: QueueItem = { ...older, id: 'c', tier: 0, title: 'Silent', ageDays: 0.5 }
    const tier3: QueueItem = { ...older, id: 'd', tier: 3, kind: 'ops', title: 'Ops', ageDays: 40 }
    const ranked = rankQueue([newer, older, tier3, tier0])
    expect(ranked.map(i => i.id)).toEqual(['c', 'a', 'b', 'd'])
  })
})

describe('ageDaysOf', () => {
  it('never goes negative for a timestamp in the future', () => {
    expect(ageDaysOf(new Date(NOW + 1000).toISOString(), NOW)).toBe(0)
  })
  it('measures whole days elapsed', () => {
    expect(ageDaysOf(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBeCloseTo(2, 5)
  })
})
