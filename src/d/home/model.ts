/* ==========================================================================
   src/d/home/model.ts — what each Home tile shows, pure.

   Every rule is borrowed from the Lanes glance it replaced, never re-invented:
   next week = lanes/glance/model contentWeek (the board's counting rule);
   invites = the monitor's Warsaw-day count (lanes/model todayOf); ready =
   lanes/glance/ready readyOf; rate limit = lanes/glance/model limitOf over the
   monitor incident + the sender's pause keys + its newest attempt.
   A reading we do not have is 'wait' (…) or 'fail' (?), never 0.
   ========================================================================== */
import { rateLimitIncident } from '../../lib/campaignControl'
import type { Seat } from '../seats'
import { clientOf, controlOf, dm, hm, todayOf } from '../lanes/model'
import type { LanesData } from '../lanes/useLanesData'
import { limitOf } from '../lanes/glance/model'
import { readyOf, type ReadySeat } from '../lanes/glance/ready'

export type Read<T> = { v: T } | { wait: true } | { fail: string }

export const val = <T,>(v: T): Read<T> => ({ v })
const slot = <T, U>(s: { value: T | null; failed: string | null }, f: (v: T) => U): Read<U> =>
  s.value != null ? { v: f(s.value) } : s.failed ? { fail: s.failed } : { wait: true }

export function invitesOf(d: LanesData, seat: Seat, now: number): Read<number | null> {
  return slot(d.cc, p => todayOf(p, seat, now)?.inv ?? null)
}

export function readyRead(d: LanesData, seat: Seat): Read<ReadySeat> {
  const gov = d.gov.value?.find(x => x.client_id === seat) ?? null
  return slot(d.ready, r => readyOf(r, seat, gov))
}

export type LimitTile = { limited: boolean; resumes: string | null; lastTry: string | null; refused: boolean }

/** "Clear" / "Limited · resumes 17:41" + "last try 15:41". Unread when neither the monitor nor the pause keys answered. */
export function limitRead(d: LanesData, seat: Seat, now: number): Read<LimitTile> {
  if ((!d.cc.value && !d.cc.failed) || (!d.pauses.value && !d.pauses.failed)) return { wait: true }
  if (!d.cc.value && !d.pauses.value) return { fail: d.cc.failed ?? d.pauses.failed ?? 'could not be read' }
  const c = clientOf(d.cc.value, seat)
  const inc = c ? rateLimitIncident(c) : null
  const cv = c && inc ? controlOf(c, now) : null
  const na = (inc?.next_action ?? {}) as { cooldown_until?: string | null; earliest_safe_at?: string | null }
  const att = d.attempts.value?.[seat]
  const last = att && att !== 'failed' ? att : null
  const v = limitOf({
    incident: inc ? { lead: cv?.incident?.lead ?? '', cooldown: na.cooldown_until ?? na.earliest_safe_at ?? null } : null,
    seatPause: d.pauses.value?.[seat], globalPause: d.pauses.value?.all, last, now,
  })
  return { v: { limited: v.limited, resumes: v.resumes && Date.parse(v.resumes) > now ? v.resumes : null, lastTry: last?.at ?? null, refused: Boolean(last && !last.ok) } }
}

/** 17:41 today, "28 Sep 17:41" another day (Warsaw). */
export function when(t: string, now: number): string {
  return `${dm(t) === dm(now) ? '' : dm(t) + ' '}${hm(t)}`
}
