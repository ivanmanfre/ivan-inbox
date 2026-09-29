// D · Content planner, the month and every-post read. Pure. Built on TODAY'S
// calendar builder (lib/calendarItems: published history with the real posted
// time, publish-queue-only posts, planned client rows, the drift between queue
// and draft, the stuck post) so the wall and the month draw every kind of post
// today's month grid draws. Days are re-keyed to Warsaw, the wall's clock.
import {
  buildCalendarItems, buildCalendarRail, itemDayISO,
  type CalendarItem, type CalendarRail,
} from '../../lib/calendarItems'
import type { ContentDraft, ScheduledQueueRow } from '../../lib/content'
import { warsawDay, warsawHm } from '../ui/time'
import { DAY_MS, type Lane } from './model'

export type PlanItem = CalendarItem & { lane: Lane }

/**
 * Every dated post of a seat (Ivan's also carries the publish queue), keyed by its Warsaw day.
 * ARCH is never movable or armable here (29 Sep): Arch's publisher posts rows at review without
 * an approval, so a date write on an Arch row is live, and Davorin reviews on Friday.
 */
export function seatItems(rows: ContentDraft[], lane: Lane, queue: ScheduledQueueRow[] | null, now: number = Date.now()): PlanItem[] {
  return buildCalendarItems(rows, lane === 'ivan' ? queue ?? [] : [], now)
    .map(it => ({ ...it, lane, day: warsawDay(itemDayISO(it.at, it.postedAt)), ...(lane === 'arch' ? { movable: false, armable: false } : {}) }))
}

export function byDay(items: PlanItem[]): Map<string, PlanItem[]> {
  const m = new Map<string, PlanItem[]>()
  for (const it of items) { const a = m.get(it.day); if (a) a.push(it); else m.set(it.day, [it]) }
  return m
}

/** The posts to draw first in a cell: the one that goes out (or went out) first. */
export function cellOrder(items: PlanItem[]): PlanItem[] {
  return [...items].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}

/** The Saturday and Sunday after a Friday key (Warsaw days), for the weekend marker on the wall. */
export function weekendAfter(fridayKey: string): [string, string] {
  const t = Date.parse(`${fridayKey}T10:00:00Z`)
  return [warsawDay(t + DAY_MS), warsawDay(t + 2 * DAY_MS)]
}

/** The badge a card carries, in today's chip words. */
export function badgeOf(it: PlanItem): { text: string; tone: 'lime' | 'warn' | 'dim' } | null {
  if (it.stage === 'published') return { text: `✓ POSTED ${it.postedAt ? warsawHm(it.postedAt) : ''}`.trim(), tone: 'dim' }
  if (it.stage === 'stuck') return { text: 'DID NOT GO OUT', tone: 'warn' }
  if (it.source === 'queue') return { text: 'QUEUE ONLY', tone: 'dim' }
  if (it.arming === 'planned') return { text: it.lane === 'ivan' ? 'NOT SCHEDULED' : 'PLANNED', tone: 'warn' }
  if (it.stage === 'review') return { text: 'IN REVIEW', tone: 'lime' }
  return null
}

/** Today's chip description (calendar.tsx chipDescription), shortened to plain words. */
export function describe(it: PlanItem): string {
  const parts: string[] = []
  if (it.stage === 'published') {
    parts.push(`Went out at ${it.postedAt ? warsawHm(it.postedAt) : 'an unknown time'} Warsaw`)
    if (it.postedAt && warsawHm(it.postedAt) !== warsawHm(it.at)) parts.push(`was set for ${warsawHm(it.at)}`)
  } else if (it.stage === 'stuck') parts.push('Did not go out at its time')
  else if (it.arming === 'planned') parts.push('Dated, but nothing is set to publish it yet')
  else if (it.arming === 'armed') parts.push(`Set to publish at ${warsawHm(it.at)} Warsaw`)
  if (it.source === 'queue') parts.push('from the publish queue with no draft behind it, so it cannot be opened or moved here')
  if (it.plannedAt) parts.push(`the publish queue fires this at ${warsawHm(it.at)}; the draft still says ${warsawHm(it.plannedAt)}`)
  return parts.join(' · ')
}

/** Month counts in today's three words: set to publish, posted, dated but not set. */
export function monthCounts(items: PlanItem[], monthKeys: Set<string>): { scheduled: number; posted: number; planned: number } {
  const inM = items.filter(i => monthKeys.has(i.day))
  return {
    scheduled: inM.filter(i => i.arming === 'armed' && i.stage !== 'stuck').length,
    posted: inM.filter(i => i.stage === 'published').length,
    planned: inM.filter(i => i.arming === 'planned').length,
  }
}

/** Undated drafts that can take a date (review / scheduled, no date), oldest first. */
export function undated(rows: ContentDraft[]): CalendarRail[] {
  return buildCalendarRail(rows)
}

/** "waited 12d" for the rail. */
export function waited(iso: string, now: number = Date.now()): string {
  const d = Math.max(0, Math.floor((now - Date.parse(iso)) / DAY_MS))
  return d < 1 ? 'today' : `${d}d`
}
