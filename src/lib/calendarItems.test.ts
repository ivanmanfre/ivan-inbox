import { describe, it, expect } from 'vitest'
import {
  ARMING_LABEL, armingOf, buildCalendarItems, buildCalendarRail, canArm, canMoveDate,
  dayKey, dayKeyOf, groupByDay, itemDayISO, monthLabel, monthWeeks, publishAtForDay,
  queueDriftByBody, queueOnlyItems, queueStage, queueTitle, shiftMonth,
} from './calendarItems'
import type { ContentDraft, ScheduledQueueRow } from './content'

// Ported in shape from the old dashboard's calendarItems.test.ts: one test per
// derivation rule, each naming the live behaviour it protects.

const NOW = Date.parse('2026-08-07T12:00:00Z')
const d = (over: Partial<ContentDraft> = {}): ContentDraft => ({
  id: 'd1', client_id: 'risedtc', status: 'scheduled', type: 'text',
  title: 'A post', topic: null, post_body: 'body',
  scheduled_at: '2026-08-12T10:30:00Z', source_post_id: null, image_urls: null,
  taxonomy: {}, updated_at: '2026-08-01T00:00:00Z', created_at: '2026-08-01T00:00:00Z',
  ...over,
})

// The publish queue — the second source, added 2026-08-10. Fixture values are
// the LIVE shape of the row that started it: scheduled_posts bc8cf413, armed for
// 2026-08-10 12:00Z and out at 12:01:04Z, with no carousel_drafts row anywhere.
const q = (over: Partial<ScheduledQueueRow> = {}): ScheduledQueueRow => ({
  id: 'q1', clickup_task_id: '65e5d219', post_text: 'A doc with 50+ DM scripts went around.\n\nSecond line.',
  scheduled_at: '2026-08-10T12:00:00Z', posted_at: null, status: 'pending',
  platform: 'linkedin', is_repost: false, error_message: null,
  created_at: '2026-08-07T21:20:28Z', post_kind: 'reach', unipile_share_url: null,
  post_format: 'text',
  ...over,
})

describe('buildCalendarItems — which rows become chips', () => {
  it('a scheduled draft becomes one chip on its own local day', () => {
    const items = buildCalendarItems([d()], [], NOW)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'd1', stage: 'scheduled', title: 'A post' })
    expect(items[0].day).toBe(dayKeyOf('2026-08-12T10:30:00Z'))
  })

  it('published rows stay on the calendar — the month is a record, not just a plan', () => {
    const items = buildCalendarItems([d({ status: 'published', source_post_id: 'urn:li:activity:1' })], [], NOW)
    expect(items[0].stage).toBe('published')
  })

  it('a past-due schedule keeps its own stage (stuck), never drawn as a plan', () => {
    const items = buildCalendarItems([d({ scheduled_at: '2026-08-01T10:00:00Z' })], [], NOW)
    expect(items[0].stage).toBe('stuck')
  })

  it('a row with no date is NOT drawn — there is no day to draw it on', () => {
    expect(buildCalendarItems([d({ scheduled_at: null })], [], NOW)).toHaveLength(0)
  })

  it('an unparseable date is dropped rather than bucketed as today', () => {
    expect(buildCalendarItems([d({ scheduled_at: 'not-a-date' })], [], NOW)).toHaveLength(0)
  })

  it('an errored or archived row carrying an old date is NOT drawn as a future post', () => {
    const rows = [d({ status: 'error' }), d({ id: 'd2', status: 'disqualified' }), d({ id: 'd3', status: 'skipped' })]
    expect(buildCalendarItems(rows, [], NOW)).toHaveLength(0)
  })

  it('🔴 a DATED REVIEW row is drawn — that is what the client lane\'s forward schedule IS', () => {
    // Probed 2026-08-07: risedtc holds 9 dated `review` rows, 13 published and
    // ZERO at `scheduled`. Drawing `scheduled` only showed his history and
    // nothing ahead of today.
    const items = buildCalendarItems([d({ status: 'review' })], [], NOW)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ stage: 'review', movable: true })
  })

  it('a dated approved row is drawn too — but the date RPC will not take it', () => {
    const items = buildCalendarItems([d({ status: 'approved' })], [], NOW)
    expect(items[0]).toMatchObject({ stage: 'approved', movable: false })
  })

  it('titles fall back topic → Untitled, never blank', () => {
    expect(buildCalendarItems([d({ title: null, topic: 'The topic' })], [], NOW)[0].title).toBe('The topic')
    expect(buildCalendarItems([d({ title: null, topic: null })], [], NOW)[0].title).toBe('Untitled')
  })

  it('chips come back in time order, so the day cell reads top-to-bottom', () => {
    const rows = [
      d({ id: 'late', scheduled_at: '2026-08-12T18:00:00Z' }),
      d({ id: 'early', scheduled_at: '2026-08-12T08:00:00Z' }),
    ]
    expect(buildCalendarItems(rows, [], NOW).map(i => i.id)).toEqual(['early', 'late'])
  })
})

describe('canMoveDate — operator_set_schedule_date’s status line, and nothing else', () => {
  it('🔴 IVAN’S OWN DRAFTS MOVE NOW: the date RPC has no client_id branch at all', () => {
    // The refusal this used to encode (`not_a_client_draft`) belongs to the
    // ARMING rpc. db/032 tests status only, so the lane stopped mattering —
    // and the signature says so: canMoveDate cannot even SEE client_id now.
    const row = (status: string, client_id: string | null) => ({ status, client_id })
    expect(canMoveDate(row('scheduled', null))).toBe(true)
    expect(canMoveDate(row('review', null))).toBe(true)
    expect(canMoveDate(row('scheduled', 'risedtc'))).toBe(true)
  })
  it('the two statuses the SQL names, verbatim — and nothing outside them', () => {
    for (const s of ['review', 'scheduled']) {
      expect(canMoveDate({ status: s })).toBe(true)
    }
    for (const s of ['approved', 'generating', 'error', 'disqualified', 'skipped']) {
      expect(canMoveDate({ status: s })).toBe(false)
    }
  })
  it('🔴 published is refused BY THE DATABASE now, not by a promise we keep here', () => {
    expect(canMoveDate({ status: 'published' })).toBe(false)
  })
  it('the chips carry that answer, so a locked row never renders a move control', () => {
    const items = buildCalendarItems([d(), d({ id: 'p', status: 'published' })], [], NOW)
    expect(items.find(i => i.id === 'd1')?.movable).toBe(true)
    expect(items.find(i => i.id === 'p')?.movable).toBe(false)
    // the same row on Ivan's lane — dated, scheduled, no client_id — is movable
    expect(buildCalendarItems([d({ client_id: null })], [], NOW)[0].movable).toBe(true)
  })
})

describe('buildCalendarRail — No date yet', () => {
  // 🔴 THE DEFECT THIS BLOCK REPLACES. The rail used to filter on
  // `status === 'approved'`, a status canMoveDate refuses and the live census
  // records as ZERO rows on both lanes, so it could never hold anything — while
  // 89 undated `review` rows, which is exactly what the date RPC accepts, were
  // excluded from the only surface built to date them. Live 2026-08-22 the new
  // predicate surfaces ivan 2, risedtc 48, arch 39.
  it('🔴 is the set the date write ACCEPTS and that has no date, not a status with zero rows', () => {
    const rows = [
      d({ id: 'rev', status: 'review', scheduled_at: null }),
      d({ id: 'sch', status: 'scheduled', scheduled_at: null }),
      d({ id: 'dated', status: 'review', scheduled_at: '2026-08-12T10:00:00Z' }),
      d({ id: 'appr', status: 'approved', scheduled_at: null }),
      d({ id: 'err', status: 'error', scheduled_at: null }),
      d({ id: 'pub', status: 'published', scheduled_at: null }),
    ]
    expect(buildCalendarRail(rows).map(r => r.id).sort()).toEqual(['rev', 'sch'])
  })

  it('the predicate is canMoveDate itself, so the rail and the move control cannot drift', () => {
    for (const s of ['review', 'scheduled', 'approved', 'error', 'published', 'disqualified', 'idea']) {
      const row = d({ status: s, scheduled_at: null })
      expect(buildCalendarRail([row]).length).toBe(canMoveDate(row) ? 1 : 0)
    }
  })

  // The invariant the surface leans on: every rail row is handed a working
  // control, because one function answers both questions. Asserted over the
  // whole status vocabulary rather than over one fixture.
  it('EVERY rail row is movable, by construction — no row can appear without a control', () => {
    const rows = ['review', 'scheduled', 'approved', 'error', 'published', 'generating', 'skipped']
      .flatMap(s => [
        d({ id: `${s}-i`, status: s, scheduled_at: null, client_id: null }),
        d({ id: `${s}-c`, status: s, scheduled_at: null, client_id: 'risedtc' }),
      ])
    const rail = buildCalendarRail(rows)
    expect(rail.length).toBeGreaterThan(0)
    expect(rail.every(r => r.movable)).toBe(true)
  })

  it('🔴 BOTH LANES — the date RPC has no client_id branch, so neither does the rail', () => {
    const rows = [
      d({ id: 'ivan', client_id: null, status: 'review', scheduled_at: null }),
      d({ id: 'client', client_id: 'risedtc', status: 'review', scheduled_at: null }),
    ]
    expect(buildCalendarRail(rows).map(r => r.id).sort()).toEqual(['client', 'ivan'])
  })

  it('OLDEST FIRST — a 35-day row is never buried under this morning’s batch', () => {
    const rows = [
      d({ id: 'new', status: 'review', scheduled_at: null, created_at: '2026-08-21T09:00:00Z' }),
      d({ id: 'old', status: 'review', scheduled_at: null, created_at: '2026-07-17T09:00:00Z' }),
      d({ id: 'mid', status: 'review', scheduled_at: null, created_at: '2026-08-01T09:00:00Z' }),
    ]
    expect(buildCalendarRail(rows).map(r => r.id)).toEqual(['old', 'mid', 'new'])
  })

  it('carries created_at, because the only fact that ranks a backlog is how long it waited', () => {
    const row = d({ status: 'review', scheduled_at: null, created_at: '2026-07-17T09:00:00Z' })
    expect(buildCalendarRail([row])[0].createdAt).toBe('2026-07-17T09:00:00Z')
  })
})

// ---------------------------------------------------------------------------
// ARMED vs PLANNED (2026-08-22)
//
// A `review` row with a `scheduled_at` does not publish. Six live risedtc rows
// are in exactly that shape (Aug 24-31) against two armed ones (Sep 1, Sep 7),
// and before `arming` every one of the eight drew an identical chip.
// ---------------------------------------------------------------------------

describe('armingOf — a date is not a publisher', () => {
  it('🔴 a DATED REVIEW row is PLANNED, never armed — nothing reads status=review', () => {
    expect(armingOf('review', 'draft')).toBe('planned')
    expect(buildCalendarItems([d({ status: 'review' })], [], NOW)[0].arming).toBe('planned')
  })
  it('status=scheduled is ARMED — that is the Bridge’s own predicate', () => {
    expect(buildCalendarItems([d({ status: 'scheduled' })], [], NOW)[0].arming).toBe('armed')
  })
  it('approved-and-dated is planned too: it is not the status the publisher reads', () => {
    expect(armingOf('approved', 'draft')).toBe('planned')
  })
  it('published is neither — it has already gone', () => {
    expect(armingOf('published', 'draft')).toBe('out')
    expect(armingOf('published', 'queue')).toBe('out')
  })
  it('🔴 STUCK IS ARMED AND LATE, not planned — something WAS meant to fire it', () => {
    // isStuckScheduled is status='scheduled' past its time. Calling that
    // "planned" would say nobody was going to publish it.
    expect(buildCalendarItems([d({ scheduled_at: '2026-08-01T10:00:00Z' })], [], NOW)[0])
      .toMatchObject({ stage: 'stuck', arming: 'armed' })
    expect(armingOf('stuck', 'queue')).toBe('armed')
  })
  it('a publish-queue chip is armed by definition — it IS the publisher’s row', () => {
    expect(buildCalendarItems([], [q()], Date.parse('2026-08-09T00:00:00Z'))[0].arming).toBe('armed')
  })
  it('every state has a word, so the chip never encodes this in colour alone', () => {
    expect(ARMING_LABEL.armed).toBe('Armed')
    expect(ARMING_LABEL.planned).toBe('Planned')
    expect(ARMING_LABEL.out).toBe('Posted')
  })
})

describe('canArm — which planned rows THIS surface can hand to a publisher', () => {
  it('a planned row on Ivan’s lane: scheduleDraft is scoped .is(client_id, null)', () => {
    expect(canArm({ client_id: null }, 'planned')).toBe(true)
    expect(buildCalendarItems([d({ status: 'review', client_id: null })], [], NOW)[0].armable).toBe(true)
  })
  it('🔴 NEVER a client row — its arming RPC also sets board_visible=true', () => {
    // operator_schedule_draft publishes the post onto a paying client's live
    // board as a side effect. That decision does not belong on a hover control.
    expect(canArm({ client_id: 'risedtc' }, 'planned')).toBe(false)
    expect(buildCalendarItems([d({ status: 'review', client_id: 'risedtc' })], [], NOW)[0].armable).toBe(false)
  })
  it('never an already-armed or already-posted row', () => {
    expect(canArm({ client_id: null }, 'armed')).toBe(false)
    expect(canArm({ client_id: null }, 'out')).toBe(false)
  })
  it('a queue chip is never armable — there is no draft row for the write to take', () => {
    expect(buildCalendarItems([], [q()], NOW)[0].armable).toBe(false)
  })
})

describe('publishAtForDay — what the RPC is actually handed', () => {
  it('preserves the time of day so ONLY the day varies (the 08-04 Fri→Sun move)', () => {
    const cur = new Date(2026, 7, 7, 10, 30, 0, 0).toISOString()
    const next = publishAtForDay(cur, '2026-08-09')
    const nd = new Date(next)
    expect(nd.getFullYear()).toBe(2026)
    expect(nd.getMonth()).toBe(7)
    expect(nd.getDate()).toBe(9)
    expect(nd.getHours()).toBe(10)
    expect(nd.getMinutes()).toBe(30)
  })
  it('defaults a never-dated draft to 09:00 local, not to whatever now happens to be', () => {
    const next = new Date(publishAtForDay(null, '2026-08-19', Date.parse('2026-08-07T23:14:00Z')))
    expect(next.getDate()).toBe(19)
    expect(next.getHours()).toBe(9)
    expect(next.getMinutes()).toBe(0)
  })
  it('an unparseable stored date is treated as no date rather than throwing', () => {
    const next = new Date(publishAtForDay('garbage', '2026-08-19'))
    expect(next.getDate()).toBe(19)
    expect(next.getHours()).toBe(9)
  })
})

describe('the grid', () => {
  it('dayKey is LOCAL — the UTC slice(0,10) bug the risedtc punchlist recorded', () => {
    // 22:00 local on the 9th is the 10th in UTC for a positive offset, and the
    // 9th is what belongs on the grid either way: the key is built from the
    // local parts, never from the ISO string.
    const local = new Date(2026, 7, 9, 22, 0, 0)
    expect(dayKey(local)).toBe('2026-08-09')
    expect(dayKeyOf(local.toISOString())).toBe('2026-08-09')
  })
  it('weeks start on Sunday — the posting week is Sun-Thu', () => {
    const weeks = monthWeeks(2026, 7)
    expect(new Date(weeks[0][0] + 'T00:00:00').getDay()).toBe(0)
    expect(weeks.every(w => w.length === 7)).toBe(true)
  })
  it('covers every day of the month exactly once', () => {
    const flat = monthWeeks(2026, 7).flat()
    const inMonth = flat.filter(k => k.startsWith('2026-08'))
    expect(inMonth).toHaveLength(31)
    expect(new Set(flat).size).toBe(flat.length)
  })
  it('does not draw a sixth empty week when the month does not need one', () => {
    // February 2026 starts on a Sunday: exactly four weeks of 7 cover it.
    expect(monthWeeks(2026, 1).length).toBeLessThanOrEqual(5)
  })
  it('shiftMonth rolls the year rather than producing month 12', () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 })
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 })
  })
  it('groupByDay buckets by the same key the grid draws', () => {
    const items = buildCalendarItems([d(), d({ id: 'd2' })], [], NOW)
    const byDay = groupByDay(items)
    expect(byDay.get(items[0].day)).toHaveLength(2)
  })
  it('monthLabel names the month rather than printing a number', () => {
    expect(monthLabel(2026, 7)).toMatch(/2026/)
  })
})

// ---------------------------------------------------------------------------
// THE PUBLISH QUEUE AS A SECOND SOURCE (2026-08-10)
//
// Ivan: "I just saw a LinkedIn post done in our account today that doesn't show
// on the calendar." It did not, and could not: the post lived only in
// scheduled_posts and this file read carousel_drafts alone. Every case below is
// a live row from the 2026-08-10 probe, not an invented one.
// ---------------------------------------------------------------------------

describe('queueStage — the queue vocabulary, mapped', () => {
  it('posted is published', () => {
    expect(queueStage(q({ status: 'posted', posted_at: '2026-08-10T12:01:04Z' }), NOW)).toBe('published')
  })
  it('a future pending row is scheduled', () => {
    const later = Date.parse('2026-08-09T00:00:00Z')
    expect(queueStage(q({ status: 'pending' }), later)).toBe('scheduled')
  })
  it('a pending row PAST its time with nothing posted is stuck, never quietly scheduled', () => {
    const after = Date.parse('2026-08-11T00:00:00Z')
    expect(queueStage(q({ status: 'pending' }), after)).toBe('stuck')
  })
  it('a failed publish is stuck — a dated stage, so it draws instead of vanishing', () => {
    expect(queueStage(q({ status: 'failed' }), NOW)).toBe('stuck')
  })
  it('cancelled draws nothing, the same rule archived drafts get', () => {
    expect(queueStage(q({ status: 'cancelled' }), NOW)).toBeNull()
  })
})

describe('queueTitle — scheduled_posts has no title column', () => {
  it('takes the first non-empty line, the only part LinkedIn shows unexpanded', () => {
    expect(queueTitle('\n\nFirst line.\nSecond line.')).toBe('First line.')
  })
  it('marks truncation rather than clipping silently', () => {
    const t = queueTitle('x'.repeat(200))
    expect(t.endsWith('…')).toBe(true)
    expect(t.length).toBe(70)
  })
  it('an empty body is Untitled, never an empty chip', () => {
    expect(queueTitle(null)).toBe('Untitled')
  })
})

describe('queueOnlyItems — dedupe against the drafts already drawn', () => {
  it('THE BUG: a queued post with no draft anywhere becomes a chip', () => {
    const items = queueOnlyItems([], [q({ status: 'posted', posted_at: '2026-08-10T12:01:04Z' })], NOW)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ source: 'queue', stage: 'published', movable: false })
    expect(items[0].postedAt).toBe('2026-08-10T12:01:04Z')
  })

  it('a queue row whose INSTANT a drawn draft already holds is dropped, not drawn twice', () => {
    const draft = d({ scheduled_at: '2026-08-10T12:00:00Z', post_body: 'a different body' })
    expect(queueOnlyItems([draft], [q()], NOW)).toHaveLength(0)
  })

  it('+00:00 and Z are the same instant — the key is the parse, not the string', () => {
    const draft = d({ scheduled_at: '2026-08-10 12:00:00+00:00', post_body: 'a different body' })
    expect(queueOnlyItems([draft], [q()], NOW)).toHaveLength(0)
  })

  it('a body match dedupes even when the two sides disagree about the minute', () => {
    const draft = d({ scheduled_at: '2026-08-10T16:45:00Z', post_body: q().post_text })
    expect(queueOnlyItems([draft], [q()], NOW)).toHaveLength(0)
  })

  it('a draft the calendar does NOT draw cannot suppress a live queue row', () => {
    // Disqualified rows keep their old date and are excluded from the grid; if
    // they still deduped, an archived draft would silently hide a real post.
    const dead = d({ status: 'disqualified', scheduled_at: '2026-08-10T12:00:00Z', post_body: 'other' })
    expect(queueOnlyItems([dead], [q()], NOW)).toHaveLength(1)
  })

  it('cancelled queue rows never reach the grid', () => {
    expect(queueOnlyItems([], [q({ status: 'cancelled' })], NOW)).toHaveLength(0)
  })

  it('an undated queue row is skipped — there is no day to draw it on', () => {
    expect(queueOnlyItems([], [q({ scheduled_at: null })], NOW)).toHaveLength(0)
  })
})

describe('buildCalendarItems — the merged grid', () => {
  it('draws both sources, in time order, each labelled with where it came from', () => {
    const draft = d({ id: 'dr', scheduled_at: '2026-08-12T10:30:00Z' })
    const items = buildCalendarItems([draft], [q()], NOW)
    expect(items.map(i => [i.id, i.source])).toEqual([['q1', 'queue'], ['dr', 'draft']])
  })

  it('a queue chip is never movable — the date RPC only takes a carousel_drafts id', () => {
    const items = buildCalendarItems([], [q()], NOW)
    expect(items[0].movable).toBe(false)
  })

  it('passing no queue is the old behaviour exactly', () => {
    expect(buildCalendarItems([d()], [], NOW)).toEqual(buildCalendarItems([d()]))
  })
})

// ---------------------------------------------------------------------------
// STAYING IN SYNC (2026-08-10, Ivan: "just make sure it's on sync")
//
// Two ways the grid can be out of step with reality even once it can SEE both
// tables: a chip drawn on the day a post was planned rather than the day it
// went out, and a chip drawn on the draft's time when the publisher holds a
// different one.
// ---------------------------------------------------------------------------

describe('itemDayISO — the day it happened beats the day it was planned', () => {
  it('falls back to the plan while nothing has happened yet', () => {
    expect(itemDayISO('2026-08-12T10:00:00Z', null)).toBe('2026-08-12T10:00:00Z')
  })
  it('the real publish time wins once there is one', () => {
    expect(itemDayISO('2026-06-06T12:00:00Z', '2026-06-08T12:00:56Z')).toBe('2026-06-08T12:00:56Z')
  })
  it('an unparseable stamp never displaces a good plan', () => {
    expect(itemDayISO('2026-08-12T10:00:00Z', 'nonsense')).toBe('2026-08-12T10:00:00Z')
  })
})

describe('a published chip sits in the cell it actually went out in', () => {
  it('🔴 live row 25813de4: set for Jun 6, out Jun 8 — it is drawn on Jun 8', () => {
    const items = buildCalendarItems([d({
      status: 'published', source_post_id: 'urn:li:activity:1',
      scheduled_at: '2026-06-06T12:00:00Z', published_at: '2026-06-08T12:00:56Z',
    })], [], NOW)
    expect(items[0].day).toBe(dayKeyOf('2026-06-08T12:00:56Z'))
    expect(items[0].day).not.toBe(dayKeyOf('2026-06-06T12:00:00Z'))
  })
  it('the same rule on the queue side — a late fire lands where it fired', () => {
    const items = queueOnlyItems([], [q({
      status: 'posted', scheduled_at: '2026-06-06T12:00:00Z', posted_at: '2026-06-08T12:00:56Z',
    })], NOW)
    expect(items[0].day).toBe(dayKeyOf('2026-06-08T12:00:56Z'))
  })
})

describe('queueDriftByBody — when the two tables disagree about when it fires', () => {
  const body = 'The same post, in both tables.'

  it('the QUEUE wins for a post that has not gone out — it is what fires', () => {
    const draft = d({ post_body: body, scheduled_at: '2026-08-20T09:00:00Z' })
    const items = buildCalendarItems([draft], [q({ post_text: body, scheduled_at: '2026-08-22T16:00:00Z' })], NOW)
    expect(items).toHaveLength(1)                       // still deduped to one chip
    expect(items[0].day).toBe(dayKeyOf('2026-08-22T16:00:00Z'))
    expect(items[0].at).toBe('2026-08-22T16:00:00Z')
    // and the draft's own time is kept so the chip can say they disagree
    expect(items[0].plannedAt).toBe('2026-08-20T09:00:00Z')
  })

  it('agreement leaves plannedAt null — no warning on a row that is fine', () => {
    const at = '2026-08-20T09:00:00Z'
    const items = buildCalendarItems([d({ post_body: body, scheduled_at: at })], [q({ post_text: body, scheduled_at: at })], NOW)
    expect(items[0].plannedAt).toBeNull()
  })

  it('⛔ a CANCELLED queue row never moves a live draft', () => {
    const draft = d({ post_body: body, scheduled_at: '2026-08-20T09:00:00Z' })
    const items = buildCalendarItems([draft], [q({ post_text: body, status: 'cancelled', scheduled_at: '2026-08-22T16:00:00Z' })], NOW)
    expect(items[0].at).toBe('2026-08-20T09:00:00Z')
    expect(items[0].plannedAt).toBeNull()
  })

  it('⛔ a published pair is left alone — published_at is a better answer than either plan', () => {
    const draft = d({
      post_body: body, status: 'published', source_post_id: 'urn:li:activity:1',
      scheduled_at: '2026-06-06T12:00:00Z', published_at: '2026-06-08T12:00:56Z',
    })
    const items = buildCalendarItems([draft], [q({ post_text: body, status: 'posted', scheduled_at: '2026-06-07T12:00:00Z', posted_at: '2026-06-08T12:00:56Z' })], NOW)
    expect(items[0].plannedAt).toBeNull()
    expect(items[0].day).toBe(dayKeyOf('2026-06-08T12:00:56Z'))
  })

  it('an empty queue is a no-op, never a map of nulls', () => {
    expect(queueDriftByBody([d()], []).size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// The link that was there all along (2026-08-11)
// ---------------------------------------------------------------------------
//
// This file used to say, in its header, that there is NO join between the two
// tables. That is wrong, and the wrongness is why a chip and the post that fires
// could disagree: `scheduled_posts.clickup_task_id` CARRIES THE DRAFT'S OWN
// UUID. Measured live 2026-08-11: 8 of 8 pending Ivan-lane queue rows resolve to
// a carousel_drafts row by that column, and so do 54 posted ones. The instant
// and the body were stand-ins for a key that exists.

describe('the draft link — dedupe and drift key on the id, not on a guess', () => {
  // A REAL uuid, because the link only counts as a link when it is one: the
  // column also holds legacy ClickUp task ids, and those name nothing here.
  const ID = 'c838e37e-3a33-4058-a8d6-3f00b0c00fc6'
  const linked = (over: Partial<ScheduledQueueRow> = {}) =>
    q({ clickup_task_id: ID, ...over })

  it('a queue row linked to a DRAWN draft is one post, however far the copy drifted', () => {
    // The live 2026-08-18 pair: same slot, same draft id, different opener,
    // because the draft was rewritten after it was bridged.
    const draft = d({ id: ID, scheduled_at: '2026-08-18T16:00:00Z', post_body: 'Niching down dropped my pipeline' })
    const queue = linked({ scheduled_at: '2026-08-19T09:00:00Z', post_text: 'A few months back I cut what I do' })
    expect(queueOnlyItems([draft], [queue], NOW)).toHaveLength(0)
  })

  it('the QUEUE time still wins on a linked pair whose bodies no longer match', () => {
    const draft = d({ id: ID, scheduled_at: '2026-08-20T09:00:00Z', post_body: 'the edited copy' })
    const items = buildCalendarItems([draft], [linked({ scheduled_at: '2026-08-22T16:00:00Z', post_text: 'the queued copy' })], NOW)
    expect(items).toHaveLength(1)
    expect(items[0].at).toBe('2026-08-22T16:00:00Z')
    expect(items[0].plannedAt).toBe('2026-08-20T09:00:00Z')
  })

  it('a link to a draft the calendar does NOT draw still draws the queue row', () => {
    const dead = d({ id: ID, status: 'disqualified', scheduled_at: '2026-08-18T16:00:00Z' })
    expect(queueOnlyItems([dead], [linked({ scheduled_at: '2026-08-18T16:00:00Z' })], NOW)).toHaveLength(1)
  })

  it('a legacy ClickUp id is not a draft id and never dedupes by it', () => {
    const draft = d({ id: '86abc123', scheduled_at: '2026-08-30T09:00:00Z', post_body: 'unrelated' })
    const queue = q({ clickup_task_id: '86abc123', scheduled_at: '2026-08-31T09:00:00Z' })
    expect(queueOnlyItems([draft], [queue], NOW)).toHaveLength(1)
  })

  it('⛔ a cancelled or posted queue row never re-times its draft', () => {
    const draft = d({ id: ID, scheduled_at: '2026-08-20T09:00:00Z' })
    for (const over of [{ status: 'cancelled' }, { status: 'posted', posted_at: '2026-08-22T16:01:00Z' }]) {
      const items = buildCalendarItems([draft], [linked({ scheduled_at: '2026-08-22T16:00:00Z', ...over })], NOW)
      expect(items[0].at).toBe('2026-08-20T09:00:00Z')
      expect(items[0].plannedAt).toBeNull()
    }
  })
})
