import { stageOf, type ContentDraft, type ContentStage, type ScheduledQueueRow } from './content'

// THE CALENDAR, derived — never a second copy of the rows.
//
// Ported in SHAPE from the old dashboard's `dashboard-v2/sections/calendarItems.ts`
// (the file the 2026-07-21 restore brought back). `reschedulable` there was a
// guess about which rows a direct UPDATE would silently no-op on; here it is a
// live function body, verbatim and with nothing added: canMoveDate is
// operator_set_schedule_date's status line.
//
// 🔴🔴 THE ONE-SOURCE RULE IS DEAD, AND IT SHIPPED AS A LIE (Ivan, 2026-08-10:
// "I just saw a LinkedIn post done in our account today that doesn't show on the
// calendar"). This file used to read `carousel_drafts` ALONE and said so proudly
// — "no dedupe rule, no clickup_task_id join, no way for a chip to point at a
// row the list does not have". What it actually bought was a calendar that could
// not see the table the PUBLISHER fires from.
//
// The measurement, live 2026-08-10 (mgmt API):
//   · the post Ivan saw = scheduled_posts bc8cf413, scheduled 2026-08-10 12:00Z,
//     posted 12:01:04Z. There is NO carousel_drafts row for it — not by body,
//     not by any join. Nothing this file could ever have drawn.
//   · 45 POSTED and 9 PENDING scheduled_posts rows have no carousel_drafts twin
//     at all. For August alone the calendar drew 8 chips against 17 real queued
//     posts: Aug 11, 12 (×2), 13, 14, 15, 17, 20 and 23 were all invisible.
// The 30-pack lanes insert straight into `scheduled_posts` and never mint a
// draft row, so "the drafts table is the schedule" was only ever true for the
// posts that happened to come through post-gen.
//
// So the queue is a SECOND SOURCE now, and the two rules that keeps honest:
//   1. DEDUPE, or the same post draws twice. 🔴 THE 08-10 VERSION OF THIS NOTE
//      SAID THERE IS NO JOIN. There is no foreign KEY — but
//      `scheduled_posts.clickup_task_id` CARRIES THE DRAFT'S OWN UUID (the
//      Bridge writes `clickup_task_id: d.id`, the publisher re-reads the draft
//      with it at send time, the write-back resolves it with it afterwards).
//      Live 2026-08-11: 8/8 pending Ivan-lane queue rows and 54 posted ones
//      resolve by that column. So the key is THE LINK first (queueDraftId), with
//      the scheduled INSTANT and an exact body match kept as the nets for rows
//      that carry a legacy ClickUp id or no link at all.
//   2. A QUEUE CHIP IS INERT. It has no draft to open and no draft id for
//      operator_set_schedule_date to take, so it is not clickable and not
//      movable, and it says which table it came from.

export type CalendarSource = 'draft' | 'queue'

export type CalendarItem = {
  id: string
  /** Which table drew it. 'queue' = scheduled_posts, with no draft behind it. */
  source: CalendarSource
  title: string
  /** Local day key, `YYYY-MM-DD`. The grid is drawn in Ivan's timezone, not UTC. */
  day: string
  /** When it fires, per the table that fires it. A move preserves its time of day. */
  at: string
  /**
   * The draft's OWN `scheduled_at`, and only when it disagrees with `at` — i.e.
   * when the publish queue holds a different time for the same post. Null on
   * every row where the two tables agree, which is every row today. See
   * queueDriftByBody.
   */
  plannedAt: string | null
  /**
   * When it ACTUALLY went out (`published_at`), or null while it is still ahead.
   * Carried separately from `at` and never folded into it: the chip shows the
   * intended time for anything pending and the real one for anything published,
   * and conflating them would hide a post that fired at a different minute than
   * the slot said — which is exactly the class of failure the 2026-08-09
   * incident was (queued 08-07, regenerated 07:56Z, published 08:00:58Z).
   */
  postedAt: string | null
  /** The list's stage vocabulary, so a chip and a row are coloured by the same fact. */
  stage: ContentStage
  type: string | null
  /** Whether this row can be re-dated from this surface. See canMoveDate. */
  movable: boolean
}

/** The `Ready, no date` rail: approved, never dated, and on no other calendar. */
export type CalendarRail = { id: string; title: string; type: string | null; movable: boolean }

export function draftTitle(d: ContentDraft): string {
  return d.title?.trim() || d.topic?.trim() || 'Untitled'
}

/**
 * A LOCAL day key. `iso.slice(0, 10)` is the bug this function exists to avoid:
 * it is the UTC day, and a 2026-08-09 21:00 ET post would be drawn on 08-10 —
 * the exact class of mistake the risedtc board punchlist recorded on the first
 * operator_schedule_draft ("check the rendered weekday").
 */
export function dayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function dayKeyOf(iso: string): string | null {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return dayKey(new Date(t))
}

/**
 * WHICH STAGES A DATE MEANS SOMETHING ON.
 *
 * 🔴 `review` and `approved` are on this list because of what the live data
 * says, not because they sound schedule-ish. Probed 2026-08-07: the client lane
 * holds 84 `review` rows of which 9 CARRY A DATE, 13 published, and ZERO at
 * `scheduled` — his forward schedule is a set of dated review rows, exactly as
 * the 08-04 Friday→Sunday move recorded it (`status='review'` and
 * `board_visible=true` left untouched, only the day changed). A calendar that
 * drew `scheduled` only would have shown Mattan's history and NOTHING ahead of
 * today, which is the one thing this view exists to show.
 *
 * `error` and `archived` are NOT here: a disqualified or errored row can still
 * carry the date it was going to go out on, and drawing that on a future day
 * says it is going out. It is not.
 */
const DATED_STAGES = new Set<ContentStage>(['review', 'approved', 'scheduled', 'stuck', 'published'])

/**
 * The chips.
 *
 * A row with no parseable `scheduled_at` is NOT drawn: there is no day to draw
 * it on, and inventing one (today, the created date) would be a date the
 * database does not hold. Undated approved rows get the rail instead, which is
 * the honest place for "ready, nobody has said when".
 */
/**
 * WHICH DAY A CHIP LANDS ON.
 *
 * 🔴 ONCE A POST HAS GONE OUT, THE DAY IT WENT OUT IS THE DAY. `scheduled_at` is
 * intent and `published_at` is the event, and the two are not always the same —
 * the chip already read the posted TIME on its face while still sitting in the
 * planned day's cell, which is a chip that contradicts itself.
 *
 * Live census 2026-08-10 (Ivan's lane): 54 published rows carry a published_at,
 * and ONE of them lands on a different day than it was scheduled for
 * (25813de4 — set for Jun 6 12:00, out Jun 8 12:00). One row is not a reason to
 * skip a rule; it is the proof that the rule is not hypothetical, and every
 * queue row that fires late gets it right for free.
 */
export function itemDayISO(plannedISO: string, actualISO: string | null | undefined): string {
  if (!actualISO) return plannedISO
  return Number.isFinite(Date.parse(actualISO)) ? actualISO : plannedISO
}

export function buildCalendarItems(
  rows: ContentDraft[],
  queue: ScheduledQueueRow[] = [],
  now: number = Date.now(),
): CalendarItem[] {
  const out: CalendarItem[] = []
  const driftById = queueDriftByDraftId(rows, queue)
  const drift = queueDriftByBody(rows, queue)
  for (const d of rows) {
    if (!d.scheduled_at) continue
    const stage = stageOf(d, now)
    if (!DATED_STAGES.has(stage)) continue
    // A post that has not gone out fires on the QUEUE's clock, whatever the
    // draft says — see queueDriftByBody. A post that HAS gone out is placed on
    // the day it really went out. The id link is consulted first: it survives
    // the copy drifting apart, which the body key cannot.
    const at = driftById.get(d.id) ?? drift.get(bodyKey(d.post_body)) ?? d.scheduled_at
    const day = dayKeyOf(itemDayISO(at, d.published_at))
    if (!day) continue
    out.push({
      id: d.id,
      source: 'draft',
      title: draftTitle(d),
      day,
      at,
      plannedAt: at === d.scheduled_at ? null : d.scheduled_at,
      postedAt: d.published_at ?? null,
      stage,
      type: d.type,
      movable: canMoveDate(d),
    })
  }
  for (const it of queueOnlyItems(rows, queue, now)) out.push(it)
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}

// ---------------------------------------------------------------------------
// The publish queue (scheduled_posts) — the second source
// ---------------------------------------------------------------------------

/**
 * The queue's own status vocabulary, mapped onto the stage the chip is coloured
 * by. It is NOT carousel_drafts.status and never was (phase1b §2).
 *
 * `cancelled` is absent on purpose and it is the same rule the draft side keeps
 * for `archived`: a cancelled row can still carry the date it was going to go
 * out on, and drawing that says it is going out. It is not.
 */
export function queueStage(r: ScheduledQueueRow, now: number = Date.now()): ContentStage | null {
  switch (r.status) {
    case 'posted': return 'published'
    // A publish that FAILED is the queue's version of isStuckScheduled — the
    // post did not go out and nobody was told. `stuck` is a dated stage, so it
    // draws; `error` is not, and this row must never be silent.
    case 'failed': return 'stuck'
    case 'pending':
    case 'queued_v2':
    case 'posting': {
      if (r.posted_at) return 'published'
      const t = r.scheduled_at ? Date.parse(r.scheduled_at) : NaN
      // Past its time, still not posted: the exact pair isStuckScheduled reads.
      if (Number.isFinite(t) && t < now) return 'stuck'
      return 'scheduled'
    }
    default: return null   // cancelled, and anything the vocabulary grows later
  }
}

/**
 * A queue row's headline. `scheduled_posts` has no title column at all, so the
 * first non-empty line of the post is the only honest one — the same line
 * LinkedIn itself shows before "…see more". Truncation is marked, never silent.
 */
export const QUEUE_TITLE_CHARS = 70

export function queueTitle(text: string | null | undefined): string {
  const first = (text ?? '').split('\n').map(l => l.trim()).find(Boolean)
  if (!first) return 'Untitled'
  return first.length > QUEUE_TITLE_CHARS
    ? `${first.slice(0, QUEUE_TITLE_CHARS - 1).trimEnd()}…`
    : first
}

/** Whitespace-insensitive body compare — the second dedupe net. */
export function bodyKey(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * THE JOIN THIS FILE SPENT A DAY INSISTING DID NOT EXIST.
 *
 * The header above says there is no foreign key between the tables, and reads it
 * as "there is no join". Only the first half is true. `scheduled_posts` has no
 * FK, but `clickup_task_id` CARRIES THE DRAFT'S OWN UUID — the Bridge writes
 * `clickup_task_id: d.id` on every insert, the publisher re-reads the draft with
 * it at send time, and the write-back resolves the draft with it afterwards.
 * Measured live 2026-08-11: 8 of 8 pending Ivan-lane queue rows and 54 posted
 * ones resolve to a carousel_drafts row by that column.
 *
 * It matters because the instant and the body are both stand-ins that FAIL in
 * the case that hurts: the same post held twice with different copy (the Bridge
 * snapshots post_body once and only ever re-syncs the DATE), where the body key
 * cannot see the pair and the instant key stops seeing it the moment either side
 * is re-dated.
 *
 * The column is legacy-shaped: it held real ClickUp task ids before the Supabase
 * lane existed, and those are NOT draft ids. Only a uuid is treated as a link,
 * exactly as the publisher's own guard does (`draftUuidRE`).
 */
const DRAFT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function queueDraftId(r: ScheduledQueueRow): string | null {
  const t = (r.clickup_task_id ?? '').trim()
  return DRAFT_UUID_RE.test(t) ? t : null
}

/**
 * The same rule as queueDriftByBody — for an unpublished post the QUEUE's time
 * wins, because scheduled_posts is what the publisher reads — keyed on the link
 * instead of on the copy, so a pair whose bodies have drifted apart is still
 * recognised as one post. Returns draft id → the time it really fires at.
 */
export function queueDriftByDraftId(
  rows: ContentDraft[],
  queue: ScheduledQueueRow[],
): Map<string, string> {
  const out = new Map<string, string>()
  if (queue.length === 0) return out
  const planned = new Map<string, string>()
  for (const d of rows) {
    if (!d.scheduled_at || d.published_at) continue
    planned.set(d.id, d.scheduled_at)
  }
  for (const r of queue) {
    if (r.status === 'cancelled' || r.posted_at || !r.scheduled_at) continue
    const id = queueDraftId(r)
    if (!id) continue
    const mine = planned.get(id)
    if (!mine) continue
    if (Date.parse(mine) === Date.parse(r.scheduled_at)) continue
    out.set(id, r.scheduled_at)
  }
  return out
}

/**
 * WHEN THE TWO TABLES DISAGREE ABOUT WHEN A POST GOES OUT.
 *
 * 🔴🔴 THE TWO DATES DRIFT, AND IT IS NOT RARE. Live 2026-08-10: matched on body,
 * the draft and its queue row disagree on 20+ historical pairs, some by DAYS —
 * `1a8d5277` says May 24 02:00, its queue row fired May 31 13:00; `25813de4`
 * says Jun 6, its queue row fired Jun 8. Nothing re-syncs a draft's
 * `scheduled_at` from the queue.
 *
 * That matters now for one reason: the body net dedupes the queue row away, so
 * before this function the surviving chip carried the DRAFT's date. On a post
 * that has not gone out yet, that is a calendar drawing a day the publisher has
 * no intention of using — the same class of wrong as not drawing it at all.
 *
 * So: for a body-matched pair that has NOT been published, the QUEUE's time
 * wins, because `scheduled_posts` is the table the publisher reads. The draft's
 * own time is kept on the item as `plannedAt` so the chip can say the two
 * disagree rather than quietly picking a winner.
 *
 * ⛔ Published pairs are left alone — they already have a `published_at`, which
 * is a better answer than either plan (itemDayISO).
 * ⛔ Cancelled queue rows never win: a cancelled row is not going out at all,
 * and letting it move a live draft's chip would be the tail wagging the dog.
 *
 * Zero rows are affected today (all 8 August twins agree to the minute). It
 * ships anyway: the drift is a property of the pipeline, not of this month.
 */
export function queueDriftByBody(
  rows: ContentDraft[],
  queue: ScheduledQueueRow[],
): Map<string, string> {
  const out = new Map<string, string>()
  if (queue.length === 0) return out
  const planned = new Map<string, string>()
  for (const d of rows) {
    if (!d.scheduled_at || d.published_at) continue
    const b = bodyKey(d.post_body)
    if (b) planned.set(b, d.scheduled_at)
  }
  if (planned.size === 0) return out
  for (const r of queue) {
    if (r.status === 'cancelled' || r.posted_at || !r.scheduled_at) continue
    const b = bodyKey(r.post_text)
    if (!b) continue
    const mine = planned.get(b)
    if (!mine) continue
    if (Date.parse(mine) === Date.parse(r.scheduled_at)) continue
    out.set(b, r.scheduled_at)
  }
  return out
}

/**
 * Queue rows that NO draft already accounts for.
 *
 * Two keys, both cheap and both needed:
 *  · the scheduled INSTANT (`Date.parse`, not the ISO string — `+00:00` and `Z`
 *    are the same moment and PostgREST has shipped both);
 *  · the post body, whitespace-normalised, for the day an arming flow moves one
 *    side's date and not the other's.
 * Either one matching means the draft side is already drawing this post, and a
 * second chip would read as two posts in one slot.
 *
 * The draft side of the keys is built from the rows that were actually DRAWN
 * (dated + a dated stage), not from every loaded draft: a disqualified row that
 * still carries a date is not on the calendar, so it must not suppress a live
 * queue row that is.
 */
export function queueOnlyItems(
  rows: ContentDraft[],
  queue: ScheduledQueueRow[],
  now: number = Date.now(),
): CalendarItem[] {
  const instants = new Set<number>()
  const bodies = new Set<string>()
  // The link, checked before either stand-in: a queue row that names a drawn
  // draft IS that draft's post, whatever the copy or the minute now says.
  const drawnIds = new Set<string>()
  for (const d of rows) {
    if (!d.scheduled_at) continue
    if (!DATED_STAGES.has(stageOf(d, now))) continue
    drawnIds.add(d.id)
    const t = Date.parse(d.scheduled_at)
    if (Number.isFinite(t)) instants.add(t)
    const b = bodyKey(d.post_body)
    if (b) bodies.add(b)
  }
  const out: CalendarItem[] = []
  for (const r of queue) {
    if (!r.scheduled_at) continue
    const t = Date.parse(r.scheduled_at)
    if (!Number.isFinite(t)) continue
    const linked = queueDraftId(r)
    if (linked && drawnIds.has(linked)) continue
    if (instants.has(t)) continue
    const b = bodyKey(r.post_text)
    if (b && bodies.has(b)) continue
    const stage = queueStage(r, now)
    if (!stage) continue
    // Same rule the draft side keeps: once it is out, the day it went out IS
    // the day. A queue row that fired late belongs in the cell it fired in.
    const day = dayKeyOf(itemDayISO(r.scheduled_at, r.posted_at))
    if (!day) continue
    out.push({
      id: r.id,
      source: 'queue',
      title: queueTitle(r.post_text),
      day,
      at: r.scheduled_at,
      plannedAt: null,
      postedAt: r.posted_at ?? null,
      stage,
      type: r.post_format ?? null,
      // 🔴 NEVER movable. operator_set_schedule_date takes a carousel_drafts
      // uuid; handing it a scheduled_posts id answers `not_found` — a button
      // that always fails is worse than no button.
      movable: false,
    })
  }
  return out
}

/**
 * `Ready, no date` — approved and never dated.
 *
 * Same predicate the Approved section's sub-line already counts ("N approved
 * without a date — on no other surface"), so the two can never disagree.
 */
export function buildCalendarRail(rows: ContentDraft[]): CalendarRail[] {
  return rows
    .filter(d => d.status === 'approved' && !d.scheduled_at)
    .map(d => ({ id: d.id, title: draftTitle(d), type: d.type, movable: canMoveDate(d) }))
}

/**
 * WHICH ROWS THIS SURFACE MAY RE-DATE — now one rule, and it is the database's.
 *
 * The calendar's write path is operator_set_schedule_date (db/032), NOT the
 * arming RPC. Read off the LIVE function body (pg_get_functiondef, 2026-08-07):
 *
 *   operator_set_schedule_date(p_gate text, p_draft_id uuid, p_scheduled_at timestamptz)
 *     · gate first                                  -> 'bad_gate'
 *     · no such row                                 -> 'not_found'
 *     · status not in ('review','scheduled')        -> 'bad_status'
 *     · update set scheduled_at = p_scheduled_at        (and NOTHING else)
 *
 * What changed, and why the predicate got shorter:
 *  1. NO LANE TEST. There is no `client_id` branch in the new body, so Ivan's
 *     own drafts are accepted — the `not_a_client_draft` refusal belonged to
 *     the arming RPC alone. This surface no longer has a lane it cannot serve.
 *  2. PUBLISHED IS THE DATABASE'S RULE NOW, not ours. `status not in
 *     ('review','scheduled')` refuses a published row outright, so the guard
 *     that used to be a promise we kept in TypeScript is enforced in SQL.
 *  3. THAT SAME LINE ALSO REFUSES `approved`. Nothing on either lane sits at
 *     that status today (live census 2026-08-07: 0 rows, both lanes), but an
 *     approved row would be shown WITHOUT a move control rather than handed a
 *     button that answers `bad_status`.
 *
 * The media guard is gone with the arming RPC: a date-only write has no
 * `awaiting_media` branch, so there is nothing left to mirror or to guess at.
 */
export function canMoveDate(d: Pick<ContentDraft, 'status'>): boolean {
  return d.status === 'review' || d.status === 'scheduled'
}

/**
 * The ISO the RPC is handed for a day the operator picked.
 *
 * Verbatim semantics from the dashboard's own reschedule (clientops2/shared.tsx
 * `onReschedule`): keep the row's existing time of day so only the DAY varies —
 * the property the 08-04 Friday→Sunday move was verified against — and default
 * a never-dated row to 09:00 local.
 */
export function publishAtForDay(currentISO: string | null, day: string, now: number = Date.now()): string {
  const [y, m, d] = day.split('-').map(Number)
  const t = currentISO ? Date.parse(currentISO) : NaN
  const base = Number.isFinite(t) ? new Date(t) : new Date(now)
  if (!Number.isFinite(t)) base.setHours(9, 0, 0, 0)
  base.setFullYear(y, m - 1, d)
  return base.toISOString()
}

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------

/** Weeks start SUNDAY: Ivan's posting week is Sun-Thu (posting-days, 2026-08-04),
 *  so a Monday-start grid would push the first slot of the week to the far right. */
export function monthWeeks(year: number, month: number): string[][] {
  const first = new Date(year, month, 1)
  const start = new Date(year, month, 1 - first.getDay())
  const weeks: string[][] = []
  const cur = new Date(start)
  // Six rows only when the month needs them: a fixed 6x7 grid draws an entire
  // empty week on a short month, and empty days are supposed to stay quiet.
  for (let w = 0; w < 6; w++) {
    const row: string[] = []
    for (let i = 0; i < 7; i++) {
      row.push(dayKey(cur))
      cur.setDate(cur.getDate() + 1)
    }
    weeks.push(row)
    if (cur.getMonth() !== month && cur.getFullYear() >= year) break
  }
  return weeks
}

export function groupByDay(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const out = new Map<string, CalendarItem[]>()
  for (const it of items) {
    const cur = out.get(it.day)
    if (cur) cur.push(it)
    else out.set(it.day, [it])
  }
  return out
}

/** `2026-08-09` → the month it belongs to, as the grid's own anchor. */
export function shiftMonth(year: number, month: number, by: number): { year: number; month: number } {
  const d = new Date(year, month + by, 1)
  return { year: d.getFullYear(), month: d.getMonth() }
}

export function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}
