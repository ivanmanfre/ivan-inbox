import { describe, it, expect } from 'vitest'
import {
  asBrief, cacheSafe, countsFromBrief, isCountsShape, partitionUrgencies,
  projectBrief, rollupReplies, type Brief,
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
  it('collapses phantom duplicate rows (same prospect, same millisecond)', () => {
    const rows = [
      { prospect_id: 'p1', client_id: null, created_at: '2026-07-25T09:00:00' },
      { prospect_id: 'p1', client_id: null, created_at: '2026-07-25T09:00:00' },
    ]
    expect(rollupReplies(rows, now)[0].week).toBe(1)
  })
})
