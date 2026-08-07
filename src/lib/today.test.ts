import { describe, it, expect } from 'vitest'
import {
  checkedPhrase,
  asBrief, cacheSafe, cleanSnippet, countsFromBrief, isCountsShape, partitionUrgencies,
  projectBrief, rollupReplies, todayLoad, ageBandOf, ageTag, splitByAge,
  isLivePost, postsToday, cancelledToday, todayPlate, approvalsTotal,
  type Brief, type BriefCounts,
} from './today'

// A payload shaped like the real edge-fn response, including the capability
// tokens it carries (fake values — never the live ones).
const raw = {
  generated_at: '2026-07-25T00:36:14.487Z',
  urgencies: [
    {
      id: 'reply:1', kind: 'reply', name: 'A Person', company: 'Acme', title: 'CEO',
      snippet: 'hello', waiting_since: '2026-07-24T10:00:00Z', prospect_id: 'p1',
      action_url: 'https://n8n.example.com/webhook/approve?k=SECRET',
      linkedin_url: 'https://www.linkedin.com/in/someone',
    },
    {
      id: 'reply:2', kind: 'reply', name: 'Out Of Office', company: null, title: null,
      snippet: 'I am away', waiting_since: '2026-07-24T09:00:00Z', is_autoreply: true,
    },
    {
      id: 'reply:3', kind: 'reply', name: 'Rise Lead', company: 'Shop', title: 'Founder',
      snippet: 'interested', waiting_since: '2026-07-24T08:00:00Z', client_id: 'risedtc',
    },
  ],
  needs_you: {
    comment_drafts: [{ id: 'c1', post_author_name: 'X', comment_text: 'nice', post_url: 'https://linkedin.com/p/1' }],
    dm_drafts: [{ id: 'd1', prospect_name: 'A Person', message_text: 'hi', created_at: '2026-07-20T22:00:00Z' }],
    feed_drafts: [{
      id: 'f1', target_name: 'Y', draft: 'draft text', created_at: '2026-07-24T12:00:00Z',
      approve_url: 'https://n8n.example.com/webhook/comment-approve?k=SECRET',
      skip_url: 'https://n8n.example.com/webhook/comment-skip?k=SECRET',
    }],
  },
  today_content: { scheduled_posts: [] },
  outreach_queue: { total: 283 },
  outreach_health: { linkedin: { fresh_supply: 326, needs_reply: 7, stuck: 211 } },
  // Sections Today deliberately ignores.
  workflow_errors: [{ workflow: 'x', message: 'boom' }],
  client_errors: { fresh_count: 6, items: [] },
}

describe('asBrief', () => {
  it('normalises the live payload shape', () => {
    const b = asBrief(raw)!
    expect(b.urgencies).toHaveLength(3)
    expect(b.needs_you.dm_drafts).toHaveLength(1)
    expect(b.outreach_queue?.total).toBe(283)
  })
  it('returns null for a non-brief', () => {
    expect(asBrief({ mode: 'counts', urgencies_count: 3 })).toBeNull()
    expect(asBrief(null)).toBeNull()
  })
})

describe('isCountsShape', () => {
  it('detects the counts response (degraded-to-anon path)', () => {
    expect(isCountsShape({ mode: 'counts', urgencies_count: 3, approvals: {} })).toBe(true)
    expect(isCountsShape({ urgencies_count: 3 })).toBe(true)
    expect(isCountsShape(raw)).toBe(false)
  })
})

// SECURITY GUARD — the cache is a whitelist projection. If either of these
// tests ever fails, a capability token is about to be written to localStorage.
describe('cache projection', () => {
  it('drops every url / capability-token field from the cached copy', () => {
    const json = JSON.stringify(projectBrief(asBrief(raw)!))
    expect(json).not.toContain('approve_url')
    expect(json).not.toContain('skip_url')
    expect(json).not.toContain('action_url')
    expect(json).not.toContain('post_url')
    expect(json).not.toContain('linkedin_url')
    expect(json).not.toContain('SECRET')
  })
  it('keeps the fields the zones actually render', () => {
    const p = projectBrief(asBrief(raw)!)
    expect(p.urgencies[0].name).toBe('A Person')
    expect(p.urgencies[0].prospect_id).toBe('p1')
    expect(p.needs_you.dm_drafts[0].message_text).toBe('hi')
    expect(p.outreach_health?.linkedin?.stuck).toBe(211)
  })
  it('cacheSafe fails closed on any token pattern', () => {
    expect(cacheSafe('{"name":"A Person"}')).toBe(true)
    expect(cacheSafe('{"approve_url":"https://x/y"}')).toBe(false)
    expect(cacheSafe('{"skip_url":"https://x/y"}')).toBe(false)
    expect(cacheSafe('{"u":"https://x/y?k=abc"}')).toBe(false)
  })
})

describe('urgency partition + counts', () => {
  it('splits out-of-office autoreplies out of the visible list', () => {
    const { visible, autoreplies } = partitionUrgencies(asBrief(raw)!.urgencies)
    expect(visible.map(u => u.id)).toEqual(['reply:1', 'reply:3'])
    expect(autoreplies.map(u => u.id)).toEqual(['reply:2'])
  })
  it('scopes counts by client_id, coalescing null to ivan', () => {
    const b = asBrief(raw)!
    expect(countsFromBrief(b, 'all').urgencies_count).toBe(2)
    expect(countsFromBrief(b, 'ivan').urgencies_count).toBe(1)
    expect(countsFromBrief(b, 'risedtc').urgencies_count).toBe(1)
    expect(countsFromBrief(b, 'ivan').approvals).toEqual({ comments: 1, dms: 1, feed: 1 })
    expect(countsFromBrief(b, 'risedtc').approvals).toEqual({ comments: 0, dms: 0, feed: 0 })
  })
  it('counts autoreplies without showing them', () => {
    const b: Brief = asBrief(raw)!
    expect(countsFromBrief(b, 'all').autoreplies_count).toBe(1)
  })
})

describe('rollupReplies', () => {
  const now = new Date('2026-07-25T18:00:00')
  it('buckets inbound rows into today / week per client', () => {
    const rows = [
      { prospect_id: 'p1', client_id: null, created_at: '2026-07-25T09:00:00' },
      { prospect_id: 'p2', client_id: 'risedtc', created_at: '2026-07-25T10:00:00' },
      { prospect_id: 'p3', client_id: null, created_at: '2026-07-21T10:00:00' },
    ]
    const out = rollupReplies(rows, now)
    expect(out.find(r => r.client_id === 'ivan')).toEqual({ client_id: 'ivan', today: 1, week: 2 })
    expect(out.find(r => r.client_id === 'risedtc')).toEqual({ client_id: 'risedtc', today: 1, week: 1 })
  })
  it('counts a backfilled reply on the day it was SENT, not the day it was stored', () => {
    // Ronnie Teja et al, 2026-07-30: four replies written 07-29 were only captured the
    // next morning. Counting on created_at credited all of them to "today" and left the
    // day they actually arrived showing zero.
    const rows = [
      { prospect_id: 'p1', client_id: 'risedtc', sent_at: '2026-07-24T15:39:00', created_at: '2026-07-25T11:15:00' },
    ]
    const out = rollupReplies(rows, now)
    expect(out[0]).toEqual({ client_id: 'risedtc', today: 0, week: 1 })
  })
  it('collapses phantom duplicate rows (same prospect, same millisecond)', () => {
    const rows = [
      { prospect_id: 'p1', client_id: null, created_at: '2026-07-25T09:00:00' },
      { prospect_id: 'p1', client_id: null, created_at: '2026-07-25T09:00:00' },
    ]
    expect(rollupReplies(rows, now)[0].week).toBe(1)
  })
})

describe('todayLoad — the masthead cannot drift from its parts', () => {
  const counts = (over: Partial<BriefCounts> = {}): BriefCounts => ({
    generated_at: '2026-08-01T08:00:00Z',
    urgencies_count: 0,
    autoreplies_count: 0,
    aging_count: null,
    needs_reply: null,
    posts_today: 0,
    queue_total: null,
    approvals: { comments: 0, dms: 0, feed: 0 },
    ...over,
  })

  it('is exactly the sum of the three zone loads', () => {
    const l = todayLoad(counts({
      urgencies_count: 3,
      posts_today: 2,
      approvals: { comments: 4, dms: 5, feed: 1 },
    }))
    expect(l).toEqual({ urgent: 3, approvals: 10, going: 2, total: 15 })
    expect(l.total).toBe(l.urgent + l.approvals + l.going)
  })

  it('holds the sum property for arbitrary inputs', () => {
    for (const [u, c, d, f, p] of [[0, 0, 0, 0, 0], [1, 0, 0, 0, 0], [9, 2, 3, 4, 7], [0, 0, 0, 0, 11]]) {
      const l = todayLoad(counts({
        urgencies_count: u, posts_today: p, approvals: { comments: c, dms: d, feed: f },
      }))
      expect(l.total).toBe(l.urgent + l.approvals + l.going)
    }
  })

  it('treats a missing posts_today as zero rather than NaN', () => {
    expect(todayLoad(counts({ posts_today: null, urgencies_count: 2 })).total).toBe(2)
  })

  it('reads as all-zero before any payload has landed', () => {
    // The SCREEN renders '–' in that case; the load is not allowed to invent a
    // verified zero of its own.
    expect(todayLoad(null)).toEqual({ urgent: 0, approvals: 0, going: 0, total: 0 })
  })
})

describe('checkedPhrase', () => {
  it('says "just now" instead of the "now ago" the raw formatter produced', () => {
    // ago() returns a bare "now" under a minute, so the old
    // `${ago(t)} ago` template rendered "Checked now ago" on the freshest and
    // most frequent read. This is the case that regressed in the field.
    expect(checkedPhrase(new Date().toISOString())).toBe('Checked just now')
  })

  it('still appends "ago" for real durations', () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    expect(checkedPhrase(tenMinAgo)).toBe('Checked 10m ago')
  })

  it('never renders a bare "now ago" for any timestamp in the last hour', () => {
    for (const mins of [0, 0.5, 1, 5, 30, 59]) {
      const t = new Date(Date.now() - mins * 60 * 1000).toISOString()
      expect(checkedPhrase(t)).not.toMatch(/now ago/)
    }
  })

  it('names the absent case rather than printing "never checked ago"', () => {
    expect(checkedPhrase(null)).toBe('Never checked')
    expect(checkedPhrase(undefined)).toBe('Never checked')
    expect(checkedPhrase('not-a-date')).toBe('Never checked')
  })
})

describe('cleanSnippet — D23/D24, the classifier tag and the HTML entities', () => {
  it('strips the classifier bracket tag the same way inbox.ts\'s DEAD_TAG detects it', () => {
    expect(cleanSnippet('[negative] nope Bill Boris-Schacter is not interested'))
      .toBe('nope Bill Boris-Schacter is not interested')
    expect(cleanSnippet('[negative_optout] Stop On Thu…')).toBe('Stop On Thu…')
    expect(cleanSnippet('[ooo_autoreply] I am on holiday')).toBe('I am on holiday')
  })

  it('decodes HTML entities leaking from email-channel replies', () => {
    expect(cleanSnippet('Ivan Manfredi &lt; iva…')).toBe('Ivan Manfredi < iva…')
    expect(cleanSnippet('Tom &amp; Jerry &quot;deal&quot;')).toBe('Tom & Jerry "deal"')
    expect(cleanSnippet('caf&#233; &#x2013; yes')).toBe('café – yes')
  })

  it('does both at once and leaves an untagged, entity-free snippet untouched', () => {
    expect(cleanSnippet('[negative] Ivan Manfredi &lt; iva…')).toBe('Ivan Manfredi < iva…')
    expect(cleanSnippet('plain snippet, nothing to clean')).toBe('plain snippet, nothing to clean')
  })

  it('is null-safe', () => {
    expect(cleanSnippet(null)).toBe('')
    expect(cleanSnippet(undefined)).toBe('')
    expect(cleanSnippet('')).toBe('')
  })
})

// ---- the age re-rank (2026-08-03, "the today stuff is all old shit") ----

const NOW = new Date('2026-08-03T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600000).toISOString()

const plateBrief = (over: Partial<Brief> = {}): Brief => ({
  generated_at: NOW.toISOString(),
  urgencies: [
    { id: 'u1', kind: 'reply', name: 'Fresh Reply', waiting_since: hoursAgo(3) },
    { id: 'u2', kind: 'reply', name: 'Old Reply', waiting_since: hoursAgo(70) },
    { id: 'u3', kind: 'reply', name: 'OOO', waiting_since: hoursAgo(2), is_autoreply: true },
  ],
  needs_you: {
    comment_drafts: [{ id: 'c1', drafted_at: hoursAgo(864) }],
    dm_drafts: [
      { id: 'd1', prospect_name: 'New Guy', message_text: 'hi', created_at: hoursAgo(2) },
      { id: 'd2', prospect_name: 'Old Guy', message_text: 'hi', created_at: hoursAgo(400) },
    ],
    feed_drafts: [{ id: 'f1', created_at: hoursAgo(1) }],
  },
  today_content: { scheduled_posts: [] },
  content_calendar: { entries: [] },
  outreach_queue: { total: null },
  outreach_health: null,
  ...over,
})

describe('age banding', () => {
  it('splits at 24h, and an undated row is never accused of being old', () => {
    expect(ageBandOf(hoursAgo(1), NOW)).toBe('new')
    expect(ageBandOf(hoursAgo(23.9), NOW)).toBe('new')
    expect(ageBandOf(hoursAgo(25), NOW)).toBe('carried')
    expect(ageBandOf(null, NOW)).toBe('new')
    expect(ageBandOf(undefined, NOW)).toBe('new')
  })

  it('prints an age instead of hiding one', () => {
    expect(ageTag(hoursAgo(0.2), NOW)).toBe('now')
    expect(ageTag(hoursAgo(5), NOW)).toBe('5h')
    expect(ageTag(hoursAgo(72), NOW)).toBe('3d')
    expect(ageTag(null, NOW)).toBe(null)
  })

  it('splitByAge keeps every row — it partitions, it never drops', () => {
    const rows = [{ at: hoursAgo(1) }, { at: hoursAgo(100) }, { at: null }]
    const s = splitByAge(rows, r => r.at, NOW)
    expect(s.fresh.length + s.carried.length).toBe(rows.length)
  })
})

describe('a cancelled slot is not a thing going out', () => {
  it('rejects cancelled/skipped on the DIRECT path too (the live 2026-08-03 defect)', () => {
    expect(isLivePost({ id: 'p', status: 'cancelled' })).toBe(false)
    expect(isLivePost({ id: 'p', status: 'Canceled' })).toBe(false)
    expect(isLivePost({ id: 'p', status: 'skipped' })).toBe(false)
    expect(isLivePost({ id: 'p', status: 'scheduled' })).toBe(true)
    expect(isLivePost({ id: 'p', status: null })).toBe(true)
    const b = plateBrief({
      today_content: { scheduled_posts: [{ id: 'p1', status: 'cancelled', scheduled_at: NOW.toISOString() }] },
    })
    expect(postsToday(b, 'all', NOW)).toHaveLength(0)
    expect(cancelledToday(b, 'all', NOW)).toHaveLength(1)
  })
})

describe('todayPlate — the re-rank preserves the totals exactly', () => {
  it('leads with what arrived since yesterday', () => {
    const p = todayPlate(plateBrief(), 'all', NOW)
    expect(p.urgencies.fresh.map(u => u.id)).toEqual(['u1'])
    expect(p.urgencies.carried.map(u => u.id)).toEqual(['u2'])
    // an out-of-office is neither: it was already demoted out of the count
    expect(p.autoreplies.map(u => u.id)).toEqual(['u3'])
    expect(p.dms.fresh.map(d => d.id)).toEqual(['d1'])
    expect(p.dms.carried.map(d => d.id)).toEqual(['d2'])
    expect(p.oldest).toBe('36d')
  })

  it('new + carried is EXACTLY the masthead total — a re-rank is not a filter', () => {
    const b = plateBrief()
    const p = todayPlate(b, 'all', NOW)
    const load = todayLoad(countsFromBrief(b, 'all', NOW))
    expect(p.newCount + p.carriedCount).toBe(load.total)
    // and it is genuinely split, not all-in-one-bucket
    expect(p.newCount).toBe(3)
    expect(p.carriedCount).toBe(3)
  })

  it('holds when everything is old (the actual Monday Ivan complained about)', () => {
    const b = plateBrief({
      urgencies: [{ id: 'u', kind: 'reply', name: 'x', waiting_since: hoursAgo(70) }],
      needs_you: {
        comment_drafts: [{ id: 'c', drafted_at: hoursAgo(864) }],
        dm_drafts: [{ id: 'd', prospect_name: 'x', message_text: 'y', created_at: hoursAgo(400) }],
        feed_drafts: [],
      },
    })
    const p = todayPlate(b, 'all', NOW)
    expect(p.newCount).toBe(0)
    expect(p.carriedCount).toBe(3)
    expect(p.newCount + p.carriedCount).toBe(todayLoad(countsFromBrief(b, 'all', NOW)).total)
    expect(p.oldest).toBe('36d')
  })

  it('every approval still lands in exactly one band', () => {
    const b = plateBrief()
    const p = todayPlate(b, 'all', NOW)
    const approvals = approvalsTotal(countsFromBrief(b, 'all', NOW))
    const banded = p.dms.fresh.length + p.dms.carried.length
      + p.comments.fresh.length + p.comments.carried.length
      + p.feed.fresh.length + p.feed.carried.length
    expect(banded).toBe(approvals)
  })

  it('a null brief is an empty plate, not a crash', () => {
    const p = todayPlate(null, 'all', NOW)
    expect(p.newCount + p.carriedCount).toBe(0)
    expect(p.oldest).toBe(null)
  })
})
