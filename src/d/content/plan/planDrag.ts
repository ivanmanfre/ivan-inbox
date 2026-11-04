import { planDay } from '../../../lib/contentPlan'
import { hmIn, notPastToday, zonedToUtc } from '../laneTime'
import type { Acct, PlanItem, Tz } from './planBrain'

// DRAG A PLAN CARD TO ANOTHER DAY (Ivan 2026-11-04: "drag content dates from here too and reschedule easily").
// The same rules as the panel's Move day, decided here so the Weeks drag and the panel never disagree:
//  · a dated post moves to the dropped day and keeps its time of day in its account's zone (a time already gone
//    by today = in an hour, as on the Calendar);
//  · a planned slot has no day of its own (it takes the first free weekday of its week on approval), so a drop
//    moves it to the dropped day's WEEK; a drop inside its own week changes nothing and says so.
// Nothing here writes: PlanWeeks does the write and the Undo.

export type DropPlan =
  | { kind: 'post'; draftId: string; prev: string; when: string }
  | { kind: 'slot'; slotId: string; from: string; week: string }
  | { kind: 'none'; why: string | null }

const addDays = (iso: string, n: number) => { const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
/** The Monday that starts the week holding `day`. */
export const weekOf = (day: string) => addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7))

/** Why this card cannot be dragged, or null when it can. Same rule as the panel's Move day key. */
export function refuseWhy(it: PlanItem, acct: Acct): string | null {
  if (it.st === 'published') return 'Already published. It stays on its day.'
  if (it.st === 'failed') return 'This slot failed. The planner is picking a new topic, so it cannot move yet.'
  if (it.kind === 'planned') return it.slotId ? null : 'This planned post cannot move.'
  if (!it.draftId || !it.at) return 'This post has no draft date to move.'
  if (acct === 'risedtc' && it.st === 'review') return 'A Rise draft waiting for OK gets its day when it is approved.'
  return null
}

/** What dropping `it` on `day` does. `now` is injectable for tests. */
export function dropPlan(it: PlanItem, acct: Acct, tz: Tz, day: string, today: string, now: number = Date.now()): DropPlan {
  const why = refuseWhy(it, acct)
  if (why) return { kind: 'none', why }
  if (day < today) return { kind: 'none', why: 'That day has passed.' }
  if (it.kind === 'planned') {
    const week = weekOf(day)
    if (week === it.week) return { kind: 'none', why: 'It is already in that week. It gets its day when you approve it.' }
    return { kind: 'slot', slotId: it.slotId!, from: it.week, week }
  }
  if (it.day === day) return { kind: 'none', why: null }
  const when = notPastToday(zonedToUtc(day, hmIn(it.at!, tz.name), tz.name), tz.name, now)
  return { kind: 'post', draftId: it.draftId!, prev: it.at!, when }
}

/** What the hot day says while a card hovers it ("Thu 12 Nov · 10:45 Warsaw" / "Week of 16 Nov"). */
export function dropLabel(it: PlanItem, acct: Acct, tz: Tz, day: string, today: string, now: number = Date.now()): string | null {
  const p = dropPlan(it, acct, tz, day, today, now)
  if (p.kind === 'post') return `${planDay(day)} · ${hmIn(p.when, tz.name)} ${tz.label}`
  if (p.kind === 'slot') return `Week of ${planDay(p.week).replace(/^\w+ /, '')}`
  return null
}

/** A refused move in plain words (the panel's Move day and the Weeks drag say the same). */
const MOVE_ERR: Record<string, string> = {
  past_date: 'That time has already passed. Nothing changed.',
  no_room: 'That week is full. Nothing changed.',
  no_free_day: 'That week has no free weekday left. Nothing changed.',
  same_week: 'It is already in that week. Nothing changed.',
  out_of_horizon: 'That week is not in the plan. Nothing changed.',
  bad_week: 'That week is not in the plan. Nothing changed.',
  bad_status: 'This post can no longer be moved. Nothing changed.',
  not_found: 'This post is no longer in the plan. Nothing changed.',
  bad_gate: 'The app could not confirm it is you. Nothing changed.',
}
export function moveError(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code
  if (typeof code === 'string' && MOVE_ERR[code]) return MOVE_ERR[code]
  const msg = e instanceof Error ? e.message : ''
  // The one refusal content.ts already says in plain words (a Rise idea flagged for Mattan).
  if (/Mattan/.test(msg) && !msg.includes('—')) return msg
  return 'Could not move it. Nothing changed.'
}
