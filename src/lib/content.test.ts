import { describe, it, expect } from 'vitest'
import {
  bucketDrafts, isStuckScheduled, laneFilter, draftLane, ACTIVE_STATUSES,
  SKIP_STATUS, type ContentDraft,
} from './content'

const base: ContentDraft = {
  id: '1', client_id: null, status: 'review', type: 'single_image',
  title: 'A post', topic: null, post_body: 'body', scheduled_at: null,
  source_post_id: null, image_urls: [], taxonomy: null,
  updated_at: '2026-07-30T10:00:00Z', created_at: '2026-07-28T10:00:00Z',
}
const row = (o: Partial<ContentDraft>): ContentDraft => ({ ...base, ...o })
const now = Date.parse('2026-07-31T12:00:00Z')

describe('laneFilter', () => {
  // There is no 'ivan' literal anywhere in carousel_drafts.client_id: the live
  // values are NULL ×190 (Ivan) + 'risedtc' ×84, checked against the DB on
  // 2026-07-31. Every screen in this app coalesces NULL→'ivan' when it READS a
  // row, and the obvious next step — writing .eq('client_id','ivan') in the
  // QUERY — returns zero rows and renders a calm, wrong, empty board. This is
  // the pin on that.
  it('scopes the Ivan lane with IS NULL, never eq ivan', () => {
    expect(laneFilter('ivan')).toEqual({ column: 'client_id', op: 'is', value: null })
    expect(laneFilter('ivan').op).not.toBe('eq')
    expect(laneFilter('ivan').value).not.toBe('ivan')
  })
  it('scopes the Rise lane with the literal client_id', () => {
    expect(laneFilter('risedtc')).toEqual({ column: 'client_id', op: 'eq', value: 'risedtc' })
  })
  it('still reads a raw NULL row as the ivan lane at the consumption layer', () => {
    expect(draftLane({ client_id: null })).toBe('ivan')
    expect(draftLane({ client_id: 'risedtc' })).toBe('risedtc')
  })
})

describe('bucketDrafts', () => {
  it('routes every status the dashboard branches on into exactly one bucket', () => {
    const rows: ContentDraft[] = [
      row({ id: 'review', status: 'review' }),
      row({ id: 'error', status: 'error' }),
      row({ id: 'generating', status: 'generating' }),
      row({ id: 'approved-unsched', status: 'approved' }),
      row({ id: 'approved-timed', status: 'approved', scheduled_at: '2026-08-04T09:00:00Z' }),
      row({ id: 'stuck', status: 'scheduled', scheduled_at: '2026-07-29T09:00:00Z' }),
      row({ id: 'future', status: 'scheduled', scheduled_at: '2026-08-02T09:00:00Z' }),
      row({ id: 'published', status: 'published' }),
      row({ id: 'dq', status: 'disqualified' }),
      row({ id: 'skipped', status: 'skipped' }),
    ]
    const b = bucketDrafts(rows, now)
    expect(b.review.map(r => r.id)).toEqual(['review'])
    expect(b.error.map(r => r.id)).toEqual(['error'])
    expect(b.generating.map(r => r.id)).toEqual(['generating'])
    expect(b.approvedUnscheduled.map(r => r.id)).toEqual(['approved-unsched'])
    expect(b.stuckScheduled.map(r => r.id)).toEqual(['stuck'])
    expect(b.scheduled.map(r => r.id)).toEqual(['approved-timed', 'future'])
    expect(b.published.map(r => r.id)).toEqual(['published'])
    expect(b.archived.map(r => r.id)).toEqual(['dq', 'skipped'])
    expect(b.unknown).toEqual([])
    // Nothing may be dropped on the floor: buckets must re-add to the input.
    const total = Object.values(b).reduce((n, arr) => n + arr.length, 0)
    expect(total).toBe(rows.length)
  })

  it('gives approved-with-no-time its own bucket', () => {
    // Proven live black hole: the dashboard's review lane only renders
    // status='review' and its calendar only renders rows that HAVE a
    // scheduled_at, so an approved post with no time is on no surface at all.
    // The DB check on 2026-07-31 found 0 such rows — the trap is structural,
    // not empirical, so the bucket ships anyway. Deleting it re-opens the hole.
    const b = bucketDrafts([row({ id: 'x', status: 'approved', scheduled_at: null })], now)
    expect(b.approvedUnscheduled.map(r => r.id)).toEqual(['x'])
    expect(b.scheduled).toEqual([])
    expect(b.published).toEqual([])
  })

  it('surfaces an unrecognised status instead of dropping it', () => {
    // A status the vocabulary grew after this file was written (n8n writes
    // these, not the app) used to just vanish from every filtered list. It now
    // lands in `unknown`, which the UI renders. 'draft' and 'idea' are the two
    // KNOWN statuses that intentionally live here: no queue actions them.
    const b = bucketDrafts([
      row({ id: 'd', status: 'draft' }),
      row({ id: 'i', status: 'idea' }),
      row({ id: 'weird', status: 'awaiting_alien_review' }),
    ], now)
    expect(b.unknown.map(r => r.id)).toEqual(['d', 'i', 'weird'])
  })

  it('keeps a published scheduled row out of the stuck bucket', () => {
    // source_post_id is the urn:li:activity: the publisher stamps once the post
    // is really live. Past-due WITH a urn just means the flip to 'published'
    // lagged; past-due WITHOUT one is the silent failure worth carding.
    const b = bucketDrafts([
      row({ id: 'went-out', status: 'scheduled', scheduled_at: '2026-07-29T09:00:00Z', source_post_id: 'urn:li:activity:123' }),
    ], now)
    expect(b.stuckScheduled).toEqual([])
    expect(b.scheduled.map(r => r.id)).toEqual(['went-out'])
  })
})

describe('isStuckScheduled', () => {
  it('counts a scheduled row with no time at all as stuck', () => {
    // The dashboard's stuck filter requires a truthy scheduledAt
    // (PostWorkSurface.tsx:117), so a status='scheduled' row with a NULL time
    // is invisible there AND can never fire. It is the worst case, not an
    // exempt one.
    expect(isStuckScheduled(row({ status: 'scheduled', scheduled_at: null }), now)).toBe(true)
  })
  it('never calls a future schedule stuck, and never judges another status', () => {
    expect(isStuckScheduled(row({ status: 'scheduled', scheduled_at: '2026-08-02T09:00:00Z' }), now)).toBe(false)
    expect(isStuckScheduled(row({ status: 'approved', scheduled_at: '2026-07-01T09:00:00Z' }), now)).toBe(false)
  })
  it('treats an unparseable time as unknown, not as a stall', () => {
    expect(isStuckScheduled(row({ status: 'scheduled', scheduled_at: 'soon' }), now)).toBe(false)
  })
})

describe('write vocabulary', () => {
  // The dashboard's 's' key skip writes NOTHING — it is a React Set that dies
  // on reload (PostWorkSurface.tsx:240). Its persisted equivalent is reject:
  // status='disqualified' (PostWorkSurface.tsx:236). Naming the constant keeps
  // a future edit from inventing a 'skipped' value the engine never reads.
  it('persists a skip as the dashboard\'s disqualified', () => {
    expect(SKIP_STATUS).toBe('disqualified')
  })
  it('keeps approved out of the active-status set by accident-proofing the list', () => {
    // ACTIVE_STATUSES is what makes an old row still get fetched. Drop
    // 'approved' from it and a 90-day-old approved-with-no-time backlog stops
    // being fetched at all, which is exactly how it hid in the first place.
    expect([...ACTIVE_STATUSES]).toContain('approved')
    expect([...ACTIVE_STATUSES]).toContain('scheduled')
    expect([...ACTIVE_STATUSES]).toContain('error')
  })
})
