import { describe, it, expect } from 'vitest'
import {
  bucketDrafts, isStuckScheduled, laneFilter, draftLane, ACTIVE_STATUSES,
  SKIP_STATUS, type ContentDraft,
  groupByStage, stageOf, countUndated, countBoardVisible,
  PIPELINE_STAGES, ALERT_STAGES, STAGE_LABEL,
  normalizeAgentLog, normalizeQa, taxonomyFields, normalizeKeyPoints,
  normalizeImageUrls, reviewActionable,
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

describe('reviewActionable', () => {
  // Round 2 renders the approve/skip pair from TWO surfaces (the queue card and
  // the draft detail screen). Two copies of the "is this actionable" condition
  // is how one of them ends up offering a Rise button that silently no-ops —
  // approveDraft/skipDraft are both scoped .is('client_id', null), so a Rise
  // approve would return success and change nothing (D7).
  it('actions only an Ivan-lane row that is waiting on review', () => {
    expect(reviewActionable('review', 'ivan')).toBe(true)
    expect(reviewActionable('review', 'risedtc')).toBe(false)
    expect(reviewActionable('approved', 'ivan')).toBe(false)
    expect(reviewActionable('error', 'ivan')).toBe(false)
    expect(reviewActionable('scheduled', 'ivan')).toBe(false)
  })
})

describe('groupByStage', () => {
  // The round-2 grouping: lifecycle order, not triage order. It lives ALONGSIDE
  // bucketDrafts (cand-b still renders that one), so the two must be allowed to
  // disagree — see the approved-with-a-date case below, which is 'scheduled' to
  // triage and 'approved' to the pipeline. Collapsing them into one function is
  // the change that would break a candidate.
  it('places every status on the lifecycle, dropping nothing', () => {
    const rows: ContentDraft[] = [
      row({ id: 'idea', status: 'idea' }),
      row({ id: 'gen', status: 'generating' }),
      row({ id: 'rev', status: 'review' }),
      row({ id: 'appr', status: 'approved' }),
      row({ id: 'appr-dated', status: 'approved', scheduled_at: '2026-08-04T09:00:00Z' }),
      row({ id: 'sched', status: 'scheduled', scheduled_at: '2026-08-02T09:00:00Z' }),
      row({ id: 'stuck', status: 'scheduled', scheduled_at: '2026-07-29T09:00:00Z' }),
      row({ id: 'pub', status: 'published' }),
      row({ id: 'err', status: 'error' }),
      row({ id: 'dq', status: 'disqualified' }),
      row({ id: 'sk', status: 'skipped' }),
      row({ id: 'draft', status: 'draft' }),
      row({ id: 'alien', status: 'awaiting_alien_review' }),
    ]
    const s = groupByStage(rows, now)
    expect(s.ideas.map(r => r.id)).toEqual(['idea'])
    expect(s.generating.map(r => r.id)).toEqual(['gen'])
    expect(s.review.map(r => r.id)).toEqual(['rev'])
    // Both approved rows, dated or not — a date does not move the stage.
    expect(s.approved.map(r => r.id)).toEqual(['appr', 'appr-dated'])
    expect(s.scheduled.map(r => r.id)).toEqual(['sched'])
    expect(s.stuck.map(r => r.id)).toEqual(['stuck'])
    expect(s.published.map(r => r.id)).toEqual(['pub'])
    expect(s.error.map(r => r.id)).toEqual(['err'])
    expect(s.archived.map(r => r.id)).toEqual(['dq', 'sk'])
    // The catch-all is rendered at the bottom of the queue, never dropped.
    expect(s.other.map(r => r.id)).toEqual(['draft', 'alien'])
    const total = Object.values(s).reduce((n, arr) => n + arr.length, 0)
    expect(total).toBe(rows.length)
  })

  it('tests stuck before scheduled, so a dead schedule can never look done', () => {
    // Past its time with no urn = it silently never went out. If that row sat
    // in the Scheduled section it would read as "handled, waiting" forever —
    // the exact failure the alert strip exists to lift out of the flow.
    expect(stageOf(row({ status: 'scheduled', scheduled_at: '2026-07-29T09:00:00Z' }), now)).toBe('stuck')
    expect(stageOf(row({ status: 'scheduled', scheduled_at: null }), now)).toBe('stuck')
    expect(stageOf(row({
      status: 'scheduled', scheduled_at: '2026-07-29T09:00:00Z', source_post_id: 'urn:li:activity:9',
    }), now)).toBe('scheduled')
  })

  it('keeps the approved-without-a-date black hole countable', () => {
    // bucketDrafts gave that row its own bucket; the pipeline gives it a
    // sub-line inside Approved instead. Losing the count loses the surface —
    // the dashboard's review lane and calendar both still hide these rows.
    const s = groupByStage([
      row({ id: 'a', status: 'approved' }),
      row({ id: 'b', status: 'approved', scheduled_at: '2026-08-04T09:00:00Z' }),
    ], now)
    expect(countUndated(s.approved)).toBe(1)
  })

  it('pins the rail order and keeps errors out of the pipeline', () => {
    // The rail and the sections both render off PIPELINE_STAGES; error/stuck
    // are deliberately NOT in it (they are the alert strip above the flow).
    expect([...PIPELINE_STAGES]).toEqual([
      'ideas', 'generating', 'review', 'approved', 'scheduled', 'published',
    ])
    expect([...ALERT_STAGES]).toEqual(['error', 'stuck'])
    for (const s of ALERT_STAGES) expect([...PIPELINE_STAGES]).not.toContain(s)
    for (const s of PIPELINE_STAGES) expect(STAGE_LABEL[s]).toBeTruthy()
  })

  it('counts only an explicit true as promoted onto the client board', () => {
    // board_visible NULL is the pre-promotion default on older Rise rows.
    // Treating "not false" as visible would tell Ivan a draft is on the
    // client's board when it isn't — the one claim this pill must never get
    // wrong (D7: Rise is read-only ambient visibility).
    expect(countBoardVisible([
      row({ id: 'on', board_visible: true }),
      row({ id: 'off', board_visible: false }),
      row({ id: 'null', board_visible: null }),
      row({ id: 'absent' }),
    ])).toBe(1)
  })
})

describe('normalizeAgentLog', () => {
  // The generation register on a live review row (2026-07-31):
  // [{"ts":"2026-07-31T12:00:08Z","body":"[Auto-promoted by LM Curator …]"}].
  // Every other shape below is something the same column holds on some other
  // row. None of them may throw inside a render pass — a shape guard that
  // crashes takes the whole screen black, which is strictly worse than showing
  // no register at all.
  it('reads the live array-of-{ts,body} shape', () => {
    expect(normalizeAgentLog([
      { ts: '2026-07-31T12:00:08Z', body: '[Auto-promoted by LM Curator — firing generation]\n\nWhy: …' },
    ])).toEqual([
      { ts: '2026-07-31T12:00:08Z', body: '[Auto-promoted by LM Curator — firing generation]\n\nWhy: …' },
    ])
  })
  it('orders a fully-timestamped log oldest first', () => {
    expect(normalizeAgentLog([
      { ts: '2026-07-31T12:00:08Z', body: 'second' },
      { ts: '2026-07-30T09:00:00Z', body: 'first' },
    ]).map(e => e.body)).toEqual(['first', 'second'])
  })
  it('leaves a partially-timestamped log in written order', () => {
    // Sorting only the entries that HAVE a ts would interleave the undated
    // ones at arbitrary points and invent a history the data never claimed.
    expect(normalizeAgentLog([
      { body: 'no stamp' },
      { ts: '2026-07-30T09:00:00Z', body: 'stamped' },
    ]).map(e => e.body)).toEqual(['no stamp', 'stamped'])
  })
  it('yields nothing for absent or unreadable logs instead of throwing', () => {
    expect(normalizeAgentLog(null)).toEqual([])
    expect(normalizeAgentLog(undefined)).toEqual([])
    expect(normalizeAgentLog([])).toEqual([])
    expect(normalizeAgentLog(42)).toEqual([])
    expect(normalizeAgentLog({ nope: 1 })).toEqual([])
    expect(normalizeAgentLog([{ ts: '2026-07-31T12:00:08Z' }])).toEqual([])
    expect(normalizeAgentLog('{not json')).toEqual([{ ts: null, body: '{not json' }])
  })
  it('unwraps a JSON-string column and a bare-string entry', () => {
    expect(normalizeAgentLog('[{"ts":"2026-07-31T12:00:08Z","body":"promoted"}]'))
      .toEqual([{ ts: '2026-07-31T12:00:08Z', body: 'promoted' }])
    expect(normalizeAgentLog(['bare line'])).toEqual([{ ts: null, body: 'bare line' }])
  })
})

describe('normalizeQa', () => {
  it('reads the live {score,verdict,feedback} shape', () => {
    expect(normalizeQa({ score: 82, verdict: 'PASS', feedback: 'VERDICT: REWRITE_OK…' }))
      .toEqual({ score: 82, verdict: 'PASS', feedback: 'VERDICT: REWRITE_OK…', pass: true })
  })
  it('only calls a literal PASS a pass', () => {
    // A live row carries verdict:"PASS" alongside feedback prose that opens
    // "VERDICT: REWRITE_OK". The chip reads the FIELD and the prose is shown
    // verbatim underneath — re-deriving the verdict from the feedback text is
    // how a green chip ends up on a rewrite.
    expect(normalizeQa({ verdict: 'REWRITE_OK' })?.pass).toBe(false)
    expect(normalizeQa({ verdict: 'FAIL' })?.pass).toBe(false)
    expect(normalizeQa({ score: 40 })?.pass).toBe(false)
    expect(normalizeQa({ verdict: ' pass ' })?.pass).toBe(true)
  })
  it('returns null when there is nothing to render', () => {
    expect(normalizeQa(null)).toBeNull()
    expect(normalizeQa({})).toBeNull()
    expect(normalizeQa('not json')).toBeNull()
    expect(normalizeQa([1, 2])).toBeNull()
  })
  it('coerces a stringified score and drops an unusable one', () => {
    expect(normalizeQa({ score: '82', verdict: 'PASS' })?.score).toBe(82)
    expect(normalizeQa({ score: 'n/a', verdict: 'PASS' })?.score).toBeNull()
  })
})

describe('taxonomyFields', () => {
  // Same live split styleKeysOf() guards: jsonb object on most rows, BARE
  // STRING on some. A bare string is a STRUCTURE value (that column predates
  // image_style), so it must land on structure_used and nowhere else.
  it('reads a jsonb taxonomy including the nested experiment arm', () => {
    expect(taxonomyFields({
      pillar: 'systems', source: 'calls', hook_type: 'contrarian',
      structure_used: 'TEARDOWN', image_style: 'Concept Visual',
      experiment: { arm: 'blank_v1' },
    })).toEqual({
      pillar: 'systems', source: 'calls', hook_type: 'contrarian',
      structure_used: 'TEARDOWN', image_style: 'Concept Visual', arm: 'blank_v1',
    })
  })
  it('reads a bare-string taxonomy as a structure value', () => {
    expect(taxonomyFields('Teardown')).toEqual({ structure_used: 'Teardown' })
  })
  it('yields nothing for empty, missing or malformed taxonomy', () => {
    expect(taxonomyFields(null)).toEqual({})
    expect(taxonomyFields({})).toEqual({})
    expect(taxonomyFields(['a'])).toEqual({})
    expect(taxonomyFields({ experiment: 'not-an-object' })).toEqual({})
    expect(taxonomyFields({ pillar: '   ' })).toEqual({})
  })
})

describe('key_points / image_urls guards', () => {
  it('reads an array, a newline string, and nothing else', () => {
    expect(normalizeKeyPoints(['a', 'b'])).toEqual(['a', 'b'])
    expect(normalizeKeyPoints('a\n\nb')).toEqual(['a', 'b'])
    expect(normalizeKeyPoints(null)).toEqual([])
    expect(normalizeKeyPoints({ a: 1 })).toEqual([])
  })
  it('lifts a single image URL string into a one-item list', () => {
    // A bare string here is the shape that renders as a row of one-character
    // images if it's mapped over as an array.
    expect(normalizeImageUrls('https://x/1.png')).toEqual(['https://x/1.png'])
    expect(normalizeImageUrls(['https://x/1.png', null])).toEqual(['https://x/1.png'])
    expect(normalizeImageUrls(null)).toEqual([])
  })
})
