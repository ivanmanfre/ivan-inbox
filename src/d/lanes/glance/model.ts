/* ==========================================================================
   src/d/lanes/glance/model.ts — the glance's read model, pure.

   The glance is the top of Lanes: per seat, the five things Ivan must always
   know (next week's content, drafts waiting, invites today, ready leads, rate
   limit). Every rule here is borrowed, never re-invented:
     · content: `content/model.ts` isScheduled / postOn (the ratified board
       counting rule), over NEXT calendar week Mon–Fri (Warsaw days);
     · rate limit: the monitor's rate-limit incident + the sender's own pause
       keys + the sender's newest invite attempt.
   A reading we do not have stays null and renders "?", never 0.
   ========================================================================== */
import type { ContentDraft } from '../../../lib/content'
import { isPlanned, isScheduled, titleOf, wallDays, type WallDay } from '../../content/model'
import type { Seat } from '../../seats'
import { warsawDay } from '../../ui/time'

/** Below this many scheduled posts next week, the cell warns (Ivan's floor). */
export const CONTENT_FLOOR = 3

/** Mon–Fri of the NEXT calendar week, Warsaw days (on a Wednesday: the following Mon–Fri; on a Sunday: tomorrow's week). */
export function nextWeekDays(now: number = Date.now()): WallDay[] {
  const days = wallDays(now)
  const dow = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', weekday: 'short' }).format(new Date(now))
  return dow === 'Sat' || dow === 'Sun' ? days.slice(0, 5) : days.slice(5, 10)
}

export type ContentDay = WallDay & { posts: number; stub: string | null; planned: boolean }
export type ContentWeek = { n: number; days: ContentDay[]; below: boolean }

/** Next week's content for one seat. `n` = the Content place's own count (scheduled, posts not days). */
export function contentWeek(rows: ContentDraft[], lane: Seat, days: WallDay[]): ContentWeek {
  const out = days.map(d => {
    const on = rows.filter(r => r.scheduled_at && warsawDay(r.scheduled_at) === d.key)
    const sch = on.filter(r => isScheduled(r, lane))
    const plan = on.find(r => isPlanned(r, lane))
    const first = sch[0] ?? null
    return { ...d, posts: sch.length, stub: first ? titleOf(first) : plan ? titleOf(plan) : null, planned: !first && Boolean(plan) }
  })
  const n = out.reduce((a, d) => a + d.posts, 0)
  return { n, days: out, below: n < CONTENT_FLOOR }
}

export type Attempt = { at: string; ok: boolean; error: string | null }
export type LimitView = {
  limited: boolean
  /** Why it reads limited, in plain words (null when clear). */
  why: string | null
  last: Attempt | null
  /** The pause that holds the seat now or last held it, ISO. */
  resumes: string | null
  /** Where that pause comes from: the seat's own key or the global switch. */
  resumesBy: 'seat' | 'global' | null
  /** A try after the last pause ran out was refused again. */
  refusedAfterPause: boolean
}

const future = (t: string | null | undefined, now: number) => Boolean(t && Date.parse(t) > now)

/**
 * The rate-limit state of one seat.
 * limited = LinkedIn-refusal incident open on the monitor, OR a pause key still in the future,
 * OR the newest attempt after the last pause ended was refused again.
 */
export function limitOf(args: {
  incident: { lead: string; cooldown: string | null } | null
  seatPause: string | null | undefined
  globalPause: string | null | undefined
  last: Attempt | null
  now: number
}): LimitView {
  const { incident, seatPause, globalPause, last, now } = args
  const pauses = [
    seatPause ? { at: seatPause, by: 'seat' as const } : null,
    globalPause ? { at: globalPause, by: 'global' as const } : null,
    incident?.cooldown ? { at: incident.cooldown, by: 'seat' as const } : null,
  // A pause that ended more than a day ago is history, not state: it is not shown.
  ].filter((x): x is { at: string; by: 'seat' | 'global' } => Boolean(x && Number.isFinite(Date.parse(x.at)) && Date.parse(x.at) > now - 864e5))
  const latest = pauses.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null
  const paused = latest ? future(latest.at, now) : false
  const refusedAfterPause = Boolean(latest && !paused && last && !last.ok && Date.parse(last.at) > Date.parse(latest.at))
  const why = paused
    ? (latest!.by === 'global' ? 'Every seat is on the manual stop' : 'Paused after LinkedIn refused invites')
    : incident ? 'LinkedIn is refusing invites'
    : refusedAfterPause ? 'Refused again after the pause ended'
    : null
  return { limited: Boolean(why), why, last, resumes: latest?.at ?? null, resumesBy: latest?.by ?? null, refusedAfterPause }
}
