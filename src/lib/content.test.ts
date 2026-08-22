import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import {
  bucketDrafts, isStuckScheduled, laneFilter, draftLane,
  SKIP_STATUS, type ContentDraft,
  groupByStage, stageOf, countUndated, countBoardVisible,
  PIPELINE_STAGES, ALERT_STAGES, STAGE_LABEL,
  normalizeAgentLog, normalizeQa, taxonomyFields, normalizeKeyPoints,
  normalizeImageUrls, reviewActionable,
  CONTENT_LANES, LANE_LABEL, LANE_POSSESSIVE, isBackfillEntry, parseLogEntry,
  scoreProgression, groupLogByAgent, normalizeSourceDetail, taxonomyExtras, taxonomyValue, queueFailed,
  stampHumanEdit, stampOperatorDelete, operatorDeleted, selfContainedHtml,
  errorAt, isRecentError, ERROR_ALARM_HOURS,
  listStills,
  draftFailure, draftFailureReason, draftFinished,
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
    // An errored (QA-blocked) row IS actionable — Ivan overrides the verdict or
    // skips the row; before this it was the only backlog he could not clear.
    expect(reviewActionable('error', 'ivan')).toBe(true)
    expect(reviewActionable('error', 'risedtc')).toBe(false)
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
      {
        ts: '2026-07-31T12:00:08Z',
        body: '[Auto-promoted by LM Curator — firing generation]\n\nWhy: …',
        agent: null, source: null, comment_id: null,
      },
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
    expect(normalizeAgentLog('{not json'))
      .toEqual([{ ts: null, body: '{not json', agent: null, source: null, comment_id: null }])
  })
  it('unwraps a JSON-string column and a bare-string entry', () => {
    expect(normalizeAgentLog('[{"ts":"2026-07-31T12:00:08Z","body":"promoted"}]'))
      .toEqual([{ ts: '2026-07-31T12:00:08Z', body: 'promoted', agent: null, source: null, comment_id: null }])
    expect(normalizeAgentLog(['bare line']))
      .toEqual([{ ts: null, body: 'bare line', agent: null, source: null, comment_id: null }])
  })
})

describe('normalizeQa', () => {
  it('reads the live {score,verdict,feedback} shape', () => {
    expect(normalizeQa({ score: 82, verdict: 'PASS', feedback: 'VERDICT: REWRITE_OK…' }))
      .toMatchObject({ score: 82, verdict: 'PASS', feedback: 'VERDICT: REWRITE_OK…', pass: true })
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

// ---------------------------------------------------------------------------
// Phase 1B — the fields the shipped surface dropped, and the lane rename.
// ---------------------------------------------------------------------------

describe('lane labels', () => {
  // 'risedtc' is a DATABASE VALUE. Lane B is called "Mattan Danino" everywhere a
  // human reads it (IA §0), and the mapping lives in exactly one place so a
  // rename cannot half-land the way the shipped "Rise" chips did.
  it('names client lanes after the person, never after the account', () => {
    expect(LANE_LABEL.risedtc).toBe('Mattan Danino')
    expect(LANE_LABEL.arch).toBe('Davorin Smit')
    expect(LANE_LABEL.ivan).toBe('Ivan')
    expect(Object.values(LANE_LABEL).join(' ')).not.toMatch(/Rise/)
    expect(Object.values(LANE_LABEL).join(' ')).not.toMatch(/ARCH/)
    expect(LANE_POSSESSIVE.risedtc).toBe('Mattan’s')
    expect(LANE_POSSESSIVE.arch).toBe('Davorin’s')
  })
  it('keeps exactly three lanes', () => {
    expect(CONTENT_LANES).toEqual(['ivan', 'risedtc', 'arch'])
  })
})

describe('normalizeAgentLog attribution (AMENDMENTS §A4.1)', () => {
  // `agent` is present on 2 999 of 2 999 live entries and `source` on 2 996.
  // The shipped normalizer returned {ts, body} and threw both away, so the proof
  // row's 37 entries rendered as 37 anonymous paragraphs.
  it('carries agent, source and comment_id through', () => {
    expect(normalizeAgentLog([{
      ts: '2026-07-13T22:30:51.006Z',
      body: 'Generation stuck — no completion within 23 minutes.',
      agent: 'Stuck Sentinel',
      source: 'n8n',
    }])).toEqual([{
      ts: '2026-07-13T22:30:51.006Z',
      body: 'Generation stuck — no completion within 23 minutes.',
      agent: 'Stuck Sentinel',
      source: 'n8n',
      comment_id: null,
    }])
  })
  it('marks a clickup_backfill entry as reconstruction, not a live step', () => {
    const [live, back] = normalizeAgentLog([
      { body: 'a', agent: 'QA Agent', source: 'n8n' },
      { body: 'b', agent: 'QA Agent', source: 'clickup_backfill', comment_id: '86ahjhub4' },
    ])
    expect(isBackfillEntry(live)).toBe(false)
    expect(isBackfillEntry(back)).toBe(true)
    expect(back.comment_id).toBe('86ahjhub4')
  })
  it('still never throws on the shapes that carry no attribution', () => {
    expect(normalizeAgentLog(['bare'])[0].agent).toBeNull()
    expect(normalizeAgentLog([{ body: 'x', agent: 42 }])[0].agent).toBe('42')
  })
})

describe('parseLogEntry', () => {
  const entry = (body: string, agent: string | null = null) =>
    ({ ts: null, agent, body, source: null, comment_id: null })

  it('classifies a verdict line and keeps the scale it was written on', () => {
    const p = parseLogEntry(entry('VERDICT: REWRITE_OK\nSCORE: 68/90\nISSUES: 3'))
    expect(p.status).toBe('REWRITE_OK')
    expect(p.score).toBe(68)
    // 74/90 is a live form. Assuming 100 is what turns it into a wrong percentage.
    expect(p.scoreMax).toBe(90)
    expect(p.issues).toBe(3)
  })
  it('reads a HALT out of the agent name, as the dashboard does', () => {
    expect(parseLogEntry(entry('stopping here', 'HALT Sentinel')).status).toBe('HALT')
  })
  it('surfaces a substantial REWRITE block and ignores a stub', () => {
    expect(parseLogEntry(entry('REWRITE: short')).rewrite).toBeNull()
    expect(parseLogEntry(entry(`REWRITE: ${'x'.repeat(60)}`)).rewrite).toHaveLength(60)
  })
  it('humanises a JSON body but keeps the raw payload reachable', () => {
    const p = parseLogEntry(entry('{"qa_feedback":"too long","word_cap":"171 words"}'))
    expect(p.text).toBe('too long')
    // The dashboard drops the payload because it truncates to 160 chars. This
    // register does not truncate, so the payload stays in place.
    expect(p.json?.word_cap).toBe('171 words')
  })
  it('leaves an unparseable body whole', () => {
    const p = parseLogEntry(entry('Publisher wrote urn:li:activity:123'))
    expect(p.status).toBeNull()
    expect(p.text).toBe('Publisher wrote urn:li:activity:123')
  })
  it('reads the score progression across attempts', () => {
    const log = normalizeAgentLog([
      { body: 'VERDICT: REWRITE_OK SCORE: 68/90', agent: 'QA Agent' },
      { body: 'no numbers here', agent: 'Lint Gate' },
      { body: 'VERDICT: REWRITE_OK SCORE: 74/90', agent: 'QA Agent' },
    ])
    expect(scoreProgression(log).map(s => s.score)).toEqual([68, 74])
  })

  // 🔴 The live QA body: a total on a scale the bare pattern never knew, and a
  // "Scores:" block of ten-point subscores directly under it. Before the
  // anchored patterns, this returned 7/10 — the VOICE subscore — as the post's
  // score, which is a wrong number rather than a missing one.
  it('reads the total off any scale and never off a subscore', () => {
    const qa = parseLogEntry(entry(
      'VERDICT: NEEDS_REGENERATE (total 93/120)\n\nScores:\n VOICE: 7/10\n SUBSTANCE: 7/10',
    ))
    expect(qa.score).toBe(93)
    expect(qa.scoreMax).toBe(120)
  })
  it('reads a parenthesised score, the regen loop\'s own form', () => {
    const p = parseLogEntry(entry('Attempt 1/2: RECOVERED on the QA rewrite (74/90, clears floor 60).'))
    expect(p.score).toBe(74)
    expect(p.scoreMax).toBe(90)
  })
})

describe('groupLogByAgent — the register compressed (Ivan, 2026-08-04)', () => {
  const log = normalizeAgentLog([
    { body: 'promoted', agent: 'Promoter', ts: '2026-07-25T12:00:00Z' },
    { body: 'VERDICT: PASS', agent: 'Lint Gate', ts: '2026-07-25T12:13:00Z' },
    { body: 'VERDICT: NEEDS_REGENERATE (total 62/90)', agent: 'QA Agent', ts: '2026-07-25T12:19:00Z' },
    { body: 'VERDICT: FAIL', agent: 'Lint Gate', ts: '2026-07-30T10:48:00Z' },
    { body: 'VERDICT: NEEDS_REGENERATE (total 93/120)', agent: 'QA Agent', ts: '2026-07-30T11:30:00Z' },
    { body: 'VERDICT: PASS', agent: 'Lint Gate', ts: '2026-08-03T15:31:00Z' },
    { body: 'unattributed note' },
  ])

  it('collapses repeats of one agent into a single group', () => {
    const g = groupLogByAgent(log)
    expect(g).toHaveLength(4)
    expect(g.map(x => x.agent)).toEqual(['Promoter', 'Lint Gate', 'QA Agent', null])
    expect(g[1].entries).toHaveLength(3)
  })
  it('orders groups by first appearance, so the pipeline still reads in order', () => {
    expect(groupLogByAgent(log)[0].agent).toBe('Promoter')
  })
  it('carries the LAST status, because a gate that failed then passed passed', () => {
    const lint = groupLogByAgent(log).find(g => g.agent === 'Lint Gate')!
    expect(lint.status).toBe('PASS')
  })
  it('collects every score in order, across scales', () => {
    const qa = groupLogByAgent(log).find(g => g.agent === 'QA Agent')!
    expect(qa.scores).toEqual([62, 93])
    expect(qa.scoreMax).toBe(120)
  })
  it('spans first to last timestamp', () => {
    const lint = groupLogByAgent(log).find(g => g.agent === 'Lint Gate')!
    expect(lint.firstTs).toBe('2026-07-25T12:13:00Z')
    expect(lint.lastTs).toBe('2026-08-03T15:31:00Z')
  })
  it('keeps unattributed entries as their own group rather than dropping them', () => {
    expect(groupLogByAgent(log).find(g => g.agent === null)!.entries).toHaveLength(1)
  })
  it('preserves original indices so the entry rows keep their position', () => {
    const qa = groupLogByAgent(log).find(g => g.agent === 'QA Agent')!
    expect(qa.entries.map(e => e.i)).toEqual([2, 4])
  })
  it('is empty for an empty log', () => {
    expect(groupLogByAgent([])).toEqual([])
  })
})

describe('normalizeQa — the full register (IA §5.2)', () => {
  // The live proof row's qa object carries exactly these keys.
  const live = {
    score: 82, verdict: 'PASS', feedback: 'VERDICT: REWRITE_OK…',
    rewrite_text: 'the copy that actually shipped', rewrite_total: 2,
    auto_promoted: true, parse_success: true, failing_slides: [2, 5],
    published_version: 3, regenerate_instruction: 'tighten the hook',
    qa_regen_history: [{ iteration: 1, score: 68, issues: 4, rewrite_applied: true }],
    qa_regen_attempts: 1, backfilled: 'true', some_new_key_2026: 'kept',
  }
  it('carries the applied rewrite — what actually shipped', () => {
    const q = normalizeQa(live)!
    expect(q.rewriteText).toBe('the copy that actually shipped')
    expect(q.rewriteTotal).toBe(2)
  })
  it('carries the regeneration history per attempt', () => {
    const q = normalizeQa(live)!
    expect(q.regenAttempts).toBe(1)
    expect(q.regenHistory[0]).toMatchObject({ iteration: 1, score: 68, issues: 4, rewriteApplied: true })
  })
  it('carries gate detail and the provenance of the verdict itself', () => {
    const q = normalizeQa(live)!
    expect(q.gates.map(([k]) => k)).toContain('failing_slides')
    expect(q.backfilled).toBe(true)
    expect(q.parseSuccess).toBe(true)
    expect(q.autoPromoted).toBe(true)
  })
  it('keeps a key nobody has written code for yet', () => {
    // ~23 qa keys are live and the generator adds more. An unnamed key appears
    // the day it appears instead of the day someone edits a constant.
    expect(normalizeQa(live)!.rest).toContainEqual(['some_new_key_2026', 'kept'])
  })
  it('renders a row whose only QA content is a rewrite', () => {
    expect(normalizeQa({ rewrite_text: 'x' })?.rewriteText).toBe('x')
  })
})

describe('normalizeSourceDetail (AMENDMENTS §A4.2 — a live crash class)', () => {
  // source_detail is an OBJECT on 71 of 282 rows, 63 of them Mattan's. The
  // shipped pane pushed it into a JSX child, which throws and blanks the pane.
  it('reads the call-quote shape the client board shows as its source chip', () => {
    const s = normalizeSourceDetail({
      kind: 'call', label: 'From your sales calls',
      call_title: 'RISE ↔ merchant, 07-24', quote: 'we lose the second order',
    })!
    expect(s.kind).toBe('call')
    expect(s.quote).toBe('we lose the second order')
    expect(s.callTitle).toBe('RISE ↔ merchant, 07-24')
  })
  it('links only a resolvable URL and keeps every other key as a row', () => {
    const s = normalizeSourceDetail({
      kind: 'portfolio', label: 'From RISE DTC’s portfolio',
      metric: '+38% repeat rate', slug: 'repeat-rate', source_url: 'https://x/y',
    })!
    expect(s.links).toEqual([['source_url', 'https://x/y']])
    // A slug is a reference, not a URL. Linking one produces a dead anchor that
    // looks like a working one.
    expect(s.rows.map(([k]) => k)).toEqual(['metric', 'slug'])
  })
  it('drops nothing from a shape no code has seen', () => {
    const s = normalizeSourceDetail({ born_gated: true, gate_keyword: 'KIT', goal_run: 'x' })!
    expect(s.rows.map(([k]) => k)).toEqual(['born_gated', 'gate_keyword', 'goal_run'])
  })
  it('still reads the 3 rows that hold a bare string', () => {
    expect(normalizeSourceDetail('Hand-picked')?.text).toBe('Hand-picked')
    expect(normalizeSourceDetail(null)).toBeNull()
    expect(normalizeSourceDetail('   ')).toBeNull()
  })
})

describe('taxonomyExtras', () => {
  it('emits every key beyond the six the code names', () => {
    expect(taxonomyExtras({
      pillar: 'methodology', structure_used: 'TEARDOWN',
      value_tier: 'high', target_persona: 'DTC founder', experiment: { arm: 'a' },
    })).toEqual([['target_persona', 'DTC founder'], ['value_tier', 'high']])
  })
  it('leaves the two call-out keys to their own placements', () => {
    // error_message renders next to the error stage chip; structure_reason
    // renders beneath structure_used as its justification.
    expect(taxonomyExtras({ error_message: 'boom', structure_reason: 'because' })).toEqual([])
    expect(taxonomyValue({ error_message: 'boom' }, 'error_message')).toBe('boom')
  })
  it('yields nothing for a bare-string or absent taxonomy', () => {
    expect(taxonomyExtras('Teardown')).toEqual([])
    expect(taxonomyExtras(null)).toEqual([])
  })
})

describe('queueFailed', () => {
  it('is the only place a publish failure is written down', () => {
    const base = {
      id: '1', clickup_task_id: null, post_text: null, scheduled_at: null,
      posted_at: null, status: 'posted', platform: 'linkedin', is_repost: null,
      error_message: null, created_at: '2026-07-01T00:00:00Z',
      post_kind: 'reach', unipile_share_url: null,
    }
    expect(queueFailed(base)).toBe(false)
    expect(queueFailed({ ...base, error_message: '  ' })).toBe(false)
    expect(queueFailed({ ...base, status: 'failed', error_message: '429' })).toBe(true)
  })
})

describe('taxonomy stamps (edit/delete markers)', () => {
  it('merges human-edit markers into an object taxonomy without losing keys', () => {
    const out = stampHumanEdit({ pillar: 'methodology', structure_used: 'TEARDOWN' }, '2026-08-03T10:00:00Z')
    expect(out).toEqual({
      pillar: 'methodology', structure_used: 'TEARDOWN',
      human_edited: true, human_edited_at: '2026-08-03T10:00:00Z',
    })
  })
  it('preserves a bare-string taxonomy as structure_used — the shape taxonomyFields reads', () => {
    const out = stampHumanEdit('Teardown', '2026-08-03T10:00:00Z')
    expect(out.structure_used).toBe('Teardown')
    expect(out.human_edited).toBe(true)
    // and the round trip through the reader still sees the structure
    expect(taxonomyFields(out).structure_used).toBe('Teardown')
  })
  it('stamps onto a null/JSON-string taxonomy too', () => {
    expect(stampHumanEdit(null, 'T').human_edited).toBe(true)
    const fromJsonString = stampHumanEdit('{"pillar":"personal"}', 'T')
    expect(fromJsonString.pillar).toBe('personal')
    expect(fromJsonString.human_edited_at).toBe('T')
  })
  it('writes the operator-delete marker the fetch filter reads back', () => {
    const out = stampOperatorDelete({ pillar: 'personal' }, '2026-08-03T10:00:00Z')
    expect(out.deleted_by_operator).toBe(true)
    expect(out.deleted_at).toBe('2026-08-03T10:00:00Z')
    expect(operatorDeleted(out)).toBe(true)
  })
})

describe('operatorDeleted', () => {
  it('is true only on the explicit marker, across live taxonomy shapes', () => {
    expect(operatorDeleted({ deleted_by_operator: true })).toBe(true)
    expect(operatorDeleted('{"deleted_by_operator":"true"}')).toBe(true)
    expect(operatorDeleted({ deleted_by_operator: false })).toBe(false)
    expect(operatorDeleted({ pillar: 'personal' })).toBe(false)
    expect(operatorDeleted('Teardown')).toBe(false)
    expect(operatorDeleted(null)).toBe(false)
    expect(operatorDeleted(undefined)).toBe(false)
  })
  it('a disqualified row with the marker must not even reach the archived bucket', () => {
    // The fetch filter is the enforcement point; this pins the predicate the
    // filter runs on the fallback-delete write's own output.
    const t = stampOperatorDelete({ pillar: 'personal' })
    expect(operatorDeleted(t)).toBe(true)
  })
})

describe('selfContainedHtml — only a styled document earns the preview frame', () => {
  it('accepts a document that ships its own <style>', () => {
    expect(selfContainedHtml('<html><style>.a{color:red}</style><body>x</body></html>')).toBe(true)
    expect(selfContainedHtml('<STYLE media="all">.a{}</STYLE><p>x</p>')).toBe(true)
  })
  it('accepts a stylesheet <link>', () => {
    expect(selfContainedHtml('<link rel="stylesheet" href="kit.css"><section>x</section>')).toBe(true)
  })
  it('rejects the kit-CSS fragments the engines actually author', () => {
    // Real shape measured 2026-08-03: class-based fragment, no styles anywhere.
    expect(selfContainedHtml('<section class="card framework"><div class="frame">x</div></section>')).toBe(false)
    expect(selfContainedHtml('<section class="slide bb-warning"><div class="toplabel">y</div></section>')).toBe(false)
  })
  it('rejects empty and null', () => {
    expect(selfContainedHtml('')).toBe(false)
    expect(selfContainedHtml(null)).toBe(false)
    expect(selfContainedHtml(undefined)).toBe(false)
  })
  it('a non-stylesheet link is not presentation', () => {
    expect(selfContainedHtml('<link rel="preconnect" href="https://x"><p>x</p>')).toBe(false)
  })
})

// Ask 13 — the alert strip is an alarm, and only errors from the last 48h ring
// it. Older errored rows stay in the Errors section, out of the count.
describe('errorAt + isRecentError (the 48h alarm window)', () => {
  it('prefers taxonomy.error_flipped_at over updated_at', () => {
    const r = row({ status: 'error', taxonomy: { error_flipped_at: '2026-07-29T08:00:00Z' }, updated_at: '2026-07-31T10:00:00Z' })
    expect(errorAt(r)).toBe('2026-07-29T08:00:00Z')
  })
  it('falls back to updated_at when the stamp is missing (4 of 7 live rows on 2026-08-03)', () => {
    expect(errorAt(row({ status: 'error', taxonomy: null }))).toBe(base.updated_at)
  })
  it('an error inside the window is recent; one outside is not', () => {
    // now = 2026-07-31T12:00Z; 47h ago is in, 49h ago is out
    const inside = row({ status: 'error', taxonomy: { error_flipped_at: '2026-07-29T13:00:00Z' } })
    const outside = row({ status: 'error', taxonomy: { error_flipped_at: '2026-07-29T11:00:00Z' } })
    expect(isRecentError(inside, now)).toBe(true)
    expect(isRecentError(outside, now)).toBe(false)
  })
  it('the boundary is exactly ERROR_ALARM_HOURS, inclusive', () => {
    const exact = new Date(now - ERROR_ALARM_HOURS * 3600_000).toISOString()
    expect(isRecentError(row({ status: 'error', taxonomy: { error_flipped_at: exact } }), now)).toBe(true)
    const past = new Date(now - ERROR_ALARM_HOURS * 3600_000 - 1000).toISOString()
    expect(isRecentError(row({ status: 'error', taxonomy: { error_flipped_at: past } }), now)).toBe(false)
  })
  it('never claims a non-error row, whatever its timestamps', () => {
    expect(isRecentError(row({ status: 'review', updated_at: new Date(now).toISOString() }), now)).toBe(false)
  })
  it('an undatable error stays in the alarm — fail loud, never age out by accident', () => {
    const und = row({ status: 'error', taxonomy: { error_flipped_at: 'not-a-date' } })
    expect(isRecentError(und, now)).toBe(true)
  })
  it('old errors keep stageOf error, so the section still shows them', () => {
    expect(stageOf(row({ status: 'error', taxonomy: { error_flipped_at: '2026-01-01T00:00:00Z' } }))).toBe('error')
  })
})

// ---------------------------------------------------------------------------
// listStills — the picker that read "Nothing in this folder" over a full bucket
// ---------------------------------------------------------------------------
//
// 2026-08-10: the Swap-image picker showed an empty library while post-stills
// held 49 + 14 + 14 images. Cause: `supabase.storage.from(...).list()` carries
// the logged-in operator's JWT, and role=`authenticated` has no SELECT policy
// on `storage.objects` for that bucket — so it returns `[]` with NO error, and
// an empty array is indistinguishable from an empty folder. Measured the same
// second against the same prefix: anon 49, authed 0.
//
// The pin is on the DISCRIMINATOR, not on the fix's shape: this function must
// present the ANON key, because the moment it presents a session token the
// picker silently empties again and nothing throws.
describe('listStills', () => {
  const ANON = 'anon-key-under-test'
  let calls: { url: string; init: RequestInit }[] = []

  beforeEach(() => {
    calls = []
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', ANON)
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init })
      return Promise.resolve(new Response(JSON.stringify([
        { name: 'selfie-14.jpg' },
        { name: 'shot.PNG' },
        // The row Supabase materialises for an empty prefix. It has a name and
        // a size and would draw as a broken tile.
        { name: '.emptyFolderPlaceholder' },
        { name: 'notes.txt' },
      ]), { status: 200 }))
    })
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

  it('lists as ANON, never on the caller’s session', async () => {
    await listStills('library')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://project.supabase.co/storage/v1/object/list/post-stills')
    expect(calls[0].init.method).toBe('POST')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.apikey).toBe(ANON)
    // 🔴 The bug in one assertion. A bearer that is not the anon key is a
    // bearer that lists zero rows and reports success.
    expect(headers.Authorization).toBe(`Bearer ${ANON}`)
  })

  it('asks for the folder it was given, newest first', async () => {
    await listStills('selfie-pool-b')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      prefix: 'selfie-pool-b',
      limit: 200,
      sortBy: { column: 'created_at', order: 'desc' },
    })
  })

  it('keeps images of any case and drops the placeholder and the strays', async () => {
    const out = await listStills('library')
    expect(out.map(s => s.name)).toEqual(['selfie-14.jpg', 'shot.PNG'])
    expect(out.every(s => s.folder === 'library')).toBe(true)
  })

  it('gives the grid a rendered thumb and the DRAFT the full asset', async () => {
    const [first] = await listStills('library')
    // What gets pinned is the object itself — a 200px render on LinkedIn would
    // be a thumbnail on the feed.
    expect(first.url).toContain('/object/public/post-stills/library/selfie-14.jpg')
    expect(first.url).not.toContain('width=')
    // What the 84px tile loads is not the 1-2MB original.
    expect(first.thumb).toContain('/render/image/public/post-stills/library/selfie-14.jpg')
    expect(first.thumb).toContain('width=200')
    expect(first.thumb).not.toBe(first.url)
  })

  it('throws on a refusal instead of reporting an empty library', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 403 })))
    await expect(listStills('library')).rejects.toThrow(/403/)
  })
})

// ---------------------------------------------------------------------------
// WHY DID THIS FAIL: the terminal log entry wins over the stale stamp
// ---------------------------------------------------------------------------
//
// Every fixture below is a VERBATIM live body, id in the comment, captured from
// the 55 `status='error'` rows on 2026-08-22. The end-to-end run over all 55 is
// goal-runs/workbench-polish-2026-08-22-out/evidence/p4b-tools/reasons.test.ts;
// these are the shapes that decide the branches.

// The defect this whole change exists for: the stamp says the sentinel stopped
// it, and the log says the pipeline kept going and passed.
const STALE_STAMP = { error_message: 'Generation stuck — no completion within 22 minutes. Likely a silent workflow chain break.' }

describe('draftFailure', () => {
  it('prefers the terminal log entry over a stale taxonomy.error_message', () => {
    // row 2694b514: sentinel fired at 22 minutes, then lint passed three more times
    const f = draftFailure({
      taxonomy: STALE_STAMP, qa_verdict: null, qa_score: null,
      log_agent: 'Lint Gate', log_body: 'VERDICT: PASS (first draft clean)', log_ts: null,
    })
    expect(f.kind).toBe('completed')
    expect(f.reason).not.toMatch(/Generation stuck/)
    expect(f.reason).toMatch(/filed as an error anyway/)
  })

  it('keeps the stall claim when the sentinel really is the terminal event', () => {
    // row a4848868
    const f = draftFailure({
      taxonomy: STALE_STAMP, qa_verdict: null, qa_score: null,
      log_agent: 'Stuck Sentinel',
      log_body: 'Generation stuck — no completion within 141 minutes. Likely a silent workflow chain break.',
      log_ts: null,
    })
    expect(f.kind).toBe('stalled')
    expect(f.detail).toBe('141 minutes')
  })

  it('names the QA score against its own denominator, never an assumed one', () => {
    // row cd394bcc, scored out of 120, and one retry died on lint instead
    const f = draftFailure({
      taxonomy: STALE_STAMP, qa_verdict: 'rewrite_ok', qa_score: '62',
      log_agent: 'QA Give-Up', log_ts: null,
      log_body: "VERDICT: QA_BLOCKED\nFailed QA and could not be regenerated within budget (2 attempt(s)). "
        + "Final verdict REWRITE_OK (74/120). Routed to status 'error' — non-publishable.\n\nATTEMPT HISTORY:\n"
        + '[\n {\n  "attempt": 1,\n  "outcome": "lint_fail"\n },\n {\n  "attempt": 2,\n  "outcome": "generation_failed"\n }\n]',
    })
    expect(f.kind).toBe('qa')
    expect(f.detail).toBe('74/120')
    expect(f.reason).toContain('74 of 120')
    expect(f.reason).toContain('1 of the retries failed lint')
  })

  it('separates "the model never came back" from "QA did not like it"', () => {
    // row f9c6bf9f, one attempt, and it produced nothing to judge
    const f = draftFailure({
      taxonomy: STALE_STAMP, qa_verdict: null, qa_score: null,
      log_agent: 'QA Give-Up', log_ts: null,
      log_body: "VERDICT: QA_BLOCKED\nFailed QA and could not be regenerated within budget (1 attempt(s)). "
        + "Final verdict NEEDS_REGENERATE (0/?). Routed to status 'error' — non-publishable.\n\nATTEMPT HISTORY:\n"
        + '[\n {\n  "attempt": 1,\n  "outcome": "generation_failed"\n }\n]',
    })
    expect(f.kind).toBe('generation_failed')
    expect(f.reason).toMatch(/never returned/)
    // (0/?) must never render as a score: a denominator of "?" is not a floor.
    expect(f.reason).not.toContain('0 of')
  })

  it('names the lint rule that fired', () => {
    // row e7740bb1
    const f = draftFailure({
      taxonomy: null, qa_verdict: null, qa_score: null,
      log_agent: 'Lint Gate', log_ts: null,
      log_body: "VERDICT: GIVE_UP (generated post)\nFailed the deterministic lint gate after 1 regeneration "
        + "attempt(s) — routed to status 'error' (non-publishable).\n\nLINT FEEDBACK:\n"
        + 'nobody_reveal_family: MERGED v28 from part_nobody plus nobody_flags_reveal. (found: "Nobody flags")',
    })
    expect(f.kind).toBe('lint')
    expect(f.detail).toBe('nobody_reveal_family')
    expect(f.reason).toContain('nobody_reveal_family')
  })

  it('reads the rule out of an Iterations block on a PASS-after-rewrite row', () => {
    // row a1730aca, passed, and the card should say what it had to fix
    const f = draftFailure({
      taxonomy: null, qa_verdict: null, qa_score: null,
      log_agent: 'Lint Gate', log_ts: null,
      log_body: 'VERDICT: PASS after 1 regeneration attempt(s)\n\nIterations:\n'
        + '  #1: contrast_closer: post ends on a corrective-contrast reframe',
    })
    expect(f.kind).toBe('completed')
    expect(f.detail).toBe('contrast_closer')
  })

  it('will not read a saved model refusal out as if it were content', () => {
    // row 60e3c008, a 200-with-a-refusal that wrote itself into the draft
    const f = draftFailure({
      taxonomy: null, qa_verdict: 'needs_regenerate', qa_score: '0',
      log_agent: 'Hook Agent', log_ts: null,
      log_body: '{"hooks":[{"hook_text":"You\'ve hit your weekly limit · resets Aug 21, 9am (UTC)",'
        + '"_parse_failed":true}],"_parse_failed":true}',
    })
    expect(f.kind).toBe('refusal')
    expect(f.reason).not.toContain('weekly limit')
  })

  it('falls back to the old order only when there is no log at all', () => {
    expect(draftFailure({
      taxonomy: STALE_STAMP, qa_verdict: null, qa_score: null,
      log_agent: null, log_body: null, log_ts: null,
    })).toMatchObject({ kind: 'unknown', reason: STALE_STAMP.error_message })

    expect(draftFailure({
      taxonomy: null, qa_verdict: 'qa_blocked', qa_score: '62',
      log_agent: null, log_body: null, log_ts: null,
    }).reason).toBe('Blocked by QA (score 62)')

    expect(draftFailure({
      taxonomy: null, qa_verdict: null, qa_score: null,
      log_agent: null, log_body: null, log_ts: null,
    }).reason).toBe('No reason recorded')
  })

  it('draftFinished is true only for a terminal PASS', () => {
    const pass = { log_agent: 'Lint Gate', log_body: 'VERDICT: PASS (first draft clean)', log_ts: null, taxonomy: null, qa_verdict: null, qa_score: null }
    expect(draftFinished(pass)).toBe(true)
    expect(draftFinished({ ...pass, log_agent: 'Stuck Sentinel', log_body: 'Generation stuck — no completion within 21 minutes.' })).toBe(false)
    expect(draftFinished({ ...pass, log_agent: null, log_body: null })).toBe(false)
  })

  it('draftFailureReason is still the one-line form the card calls', () => {
    const d = { taxonomy: STALE_STAMP, qa_verdict: null, qa_score: null, log_agent: 'Lint Gate', log_body: 'VERDICT: PASS (first draft clean)', log_ts: null }
    expect(draftFailureReason(d)).toBe(draftFailure(d).reason)
  })
})
