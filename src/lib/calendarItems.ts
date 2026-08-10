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
//   1. DEDUPE, or the same post draws twice. There is no foreign key between the
//      tables (scheduled_posts has clickup_task_id, carousel_drafts has no such
//      column — 42703), so the join is the SCHEDULED INSTANT, with an exact body
//      match as a second net. Verified on the live August set: every twin agrees
//      to the minute (8/8), and every un-twinned queue row lands on a minute no
//      draft holds.
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
  /** The row's own `scheduled_at`, carried so a move can preserve its time of day. */
  at: string
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
export function buildCalendarItems(
  rows: ContentDraft[],
  queue: ScheduledQueueRow[] = [],
  now: number = Date.now(),
): CalendarItem[] {
  const out: CalendarItem[] = []
  for (const d of rows) {
    if (!d.scheduled_at) continue
    const day = dayKeyOf(d.scheduled_at)
    if (!day) continue
    const stage = stageOf(d, now)
    if (!DATED_STAGES.has(stage)) continue
    out.push({
      id: d.id,
      source: 'draft',
      title: draftTitle(d),
      day,
      at: d.scheduled_at,
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
function bodyKey(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim()
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
  for (const d of rows) {
    if (!d.scheduled_at) continue
    if (!DATED_STAGES.has(stageOf(d, now))) continue
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
    if (instants.has(t)) continue
    const b = bodyKey(r.post_text)
    if (b && bodies.has(b)) continue
    const stage = queueStage(r, now)
    if (!stage) continue
    const day = dayKeyOf(r.scheduled_at)
    if (!day) continue
    out.push({
      id: r.id,
      source: 'queue',
      title: queueTitle(r.post_text),
      day,
      at: r.scheduled_at,
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
