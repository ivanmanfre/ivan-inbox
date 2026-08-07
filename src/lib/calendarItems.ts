import { stageOf, type ContentDraft, type ContentLane, type ContentStage } from './content'

// THE CALENDAR, derived — never a second copy of the rows.
//
// Ported in SHAPE from the old dashboard's `dashboard-v2/sections/calendarItems.ts`
// (the file the 2026-07-21 restore brought back), but not in substance, and the
// difference is the whole point:
//
//   · the old board merged THREE sources (carousel_drafts + scheduled_posts +
//     lm_drafts_v2) because its schedule lived in a queue table. This surface
//     reads ONE source — the lane's already-loaded carousel_drafts rows — so
//     there is no dedupe rule, no `clickup_task_id` join, and no way for a chip
//     to point at a row the list does not have;
//   · `reschedulable` there was a guess about which rows a direct UPDATE would
//     silently no-op on. Here it mirrors a live function body (canMoveDate in
//     content.ts) plus one guard of our own, stated where it is made.
//
// Everything below is pure: no fetch, no supabase, no Date.now() that isn't
// injectable. That is what makes it testable, and the derivation is where the
// old board's calendar bugs lived.

export type CalendarItem = {
  id: string
  title: string
  /** Local day key, `YYYY-MM-DD`. The grid is drawn in Ivan's timezone, not UTC. */
  day: string
  /** The row's own `scheduled_at`, carried so a move can preserve its time of day. */
  at: string
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
  lane: ContentLane,
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
      title: draftTitle(d),
      day,
      at: d.scheduled_at,
      stage,
      type: d.type,
      movable: canMoveDate(d, lane),
    })
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}

/**
 * `Ready, no date` — approved and never dated.
 *
 * Same predicate the Approved section's sub-line already counts ("N approved
 * without a date — on no other surface"), so the two can never disagree.
 */
export function buildCalendarRail(rows: ContentDraft[], lane: ContentLane): CalendarRail[] {
  return rows
    .filter(d => d.status === 'approved' && !d.scheduled_at)
    .map(d => ({ id: d.id, title: draftTitle(d), type: d.type, movable: canMoveDate(d, lane) }))
}

/**
 * WHICH ROWS THIS SURFACE MAY RE-DATE, and both halves of the rule.
 *
 * Read off the LIVE function body (pg_get_functiondef, 2026-08-07):
 *
 *   operator_schedule_draft(p_gate text, p_draft_id uuid, p_publish_at timestamptz)
 *     · gate first                                   -> 'bad_gate'
 *     · no such row                                  -> 'not_found'
 *     · 🔴 client_id IS NULL                          -> 'not_a_client_draft'
 *     · single_image/carousel with no image_urls
 *       (carousel: or no slides)                     -> 'awaiting_media'
 *     · update set status='scheduled', scheduled_at=p_publish_at,
 *                  board_visible=true
 *
 * So:
 *  1. THE IVAN LANE HAS NO PATH. The RPC refuses `client_id IS NULL` by
 *     construction, and the only other way to move a date is a direct write to
 *     `carousel_drafts.scheduled_at` — which is precisely what the publish
 *     bridge acts on, and what this app has refused to do since the parity
 *     ledger (AFFORDANCES A5). A surface with no legal write offers no button.
 *  2. PUBLISHED IS OURS, not the database's. The SQL has no status guard at
 *     all, so re-dating a published row would flip it back to 'scheduled' and
 *     hand it to the publisher a second time. The old board's calendar drew the
 *     same line ("carousel posts are reschedulable until published").
 *
 * The media guard is deliberately NOT mirrored here: `slides` is not on the
 * list row, so a client-side "this will fail" would be a guess. The refusal is
 * surfaced verbatim instead (CLIENT_RPC_MESSAGES.awaiting_media).
 */
export function canMoveDate(d: Pick<ContentDraft, 'status' | 'client_id'>, lane: ContentLane): boolean {
  if (lane !== 'risedtc') return false
  if (!d.client_id) return false
  return d.status !== 'published'
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
