/* ==========================================================================
   src/d/shell/glanceModel.ts — the side panel's Glance (Ivan 2026-10-09: "a widget
   ... with pending dms to reply to ... alerts like 0 warm engagers stock on any of
   the lanes ... or like low sends for the day").

   PURE. Three parts, each from a read the app already makes:
     · DMs to answer: the frame's one inbox (threadBucket 'answer' or 'approve',
       the same rule as the DMs badge), longest wait first;
     · stock: Lanes' ready read (glance/ready.ts), a seat's warm lane at 0;
     · sends: the send monitor payload (campaignControl), a seat refused / queue
       empty / silent; and the sent invites of 8 days, today under half the
       seat's usual count by the same hour.
   Nothing here writes.
   ========================================================================== */
import { isConversation, threadBucket, unansweredWaitSince, eventTime, type Thread } from '../../lib/inbox'
import { isQueueEmptyClient, monitorLiveness, rateLimitIncident, type CcPayload } from '../../lib/campaignControl'
import { clientOf, dayKey } from '../lanes/model'
import type { ReadyRead } from '../lanes/glance/ready'
import { dHash } from '../route'
import { SEATS, SEAT_NAME, seatOf, type Seat } from '../seats'

export type GlanceDm = { id: string; seat: Seat; name: string; kind: 'reply' | 'draft'; since: string; href: string }
export type GlanceAlert = { key: string; seat: Seat; tone: 'bad' | 'warn'; text: string; href: string }

/** Every thread that owes Ivan a reply or holds a draft to approve, longest wait first. */
export function dmsToAnswer(threads: readonly Thread[], now: number): GlanceDm[] {
  const out: GlanceDm[] = []
  for (const t of threads) {
    const seat = seatOf(t.client_id)
    if (!seat || t.spam || !isConversation(t)) continue
    const b = threadBucket(t, now)
    if (b === 'waiting') continue
    const since = b === 'answer' ? unansweredWaitSince(t) ?? eventTime(t.last) : eventTime(t.draft ?? t.last)
    out.push({ id: t.prospect_id, seat, name: t.prospect_name || 'Unknown', kind: b === 'answer' ? 'reply' : 'draft', since, href: dHash('dms', null, { seat, thread: t.prospect_id }) })
  }
  return out.sort((a, b) => Date.parse(a.since) - Date.parse(b.since))
}

/** The lane each seat's warm engagers sit in (glance/ready.ts lane keys). */
export const WARM_LANE: Record<Seat, string> = { ivan: 'engage', risedtc: 'engager', arch: 'engager_warm' }

/** A seat whose warm lane has nothing ready. A lane switched off for the day (Saturday, off) is not an alert. */
export function stockAlerts(ready: ReadyRead | null): GlanceAlert[] {
  if (!ready) return []
  const out: GlanceAlert[] = []
  for (const seat of SEATS) {
    const mine = ready.lanes.filter(l => l.seat === seat)
    if (!mine.length) continue
    const warm = mine.find(l => l.lane === WARM_LANE[seat])
    if (warm?.off) continue
    if (!warm || warm.n === 0) out.push({ key: `stock:${seat}`, seat, tone: 'bad', text: `${SEAT_NAME[seat]}: 0 warm engagers ready`, href: dHash('lanes', null, { seat }) })
  }
  return out
}

/** Below this share of a seat's usual count by this hour, today reads low. */
export const LOW_SHARE = 0.5
/** A usual count by this hour under this is too small to call low. */
export const MIN_USUAL = 8

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

/** One sent invite: its seat and connection_sent_at. */
export type SentAt = { seat: Seat; at: string }

/** Today's invites so far, and the median of the last 7 days' invites by the same time of day (Warsaw days). */
export function soFar(rows: readonly SentAt[], seat: Seat, now: number): { today: number; usual: number } {
  const mine = rows.filter(r => r.seat === seat).map(r => Date.parse(r.at)).filter(Number.isFinite)
  const today = dayKey(now)
  const past = [1, 2, 3, 4, 5, 6, 7].map(d => { const cut = now - d * 864e5, k = dayKey(cut); return mine.filter(t => t <= cut && dayKey(t) === k).length })
  return { today: mine.filter(t => t <= now && dayKey(t) === today).length, usual: median(past) }
}

/** Seat states that stop sends, and a day well under the seat's usual invites by this hour. */
export function sendAlerts(p: CcPayload | null, sends: readonly SentAt[] | null, now: number): GlanceAlert[] {
  const out: GlanceAlert[] = []
  const live = p ? monitorLiveness(p, now) : 'unknown'
  for (const seat of SEATS) {
    const c = p ? clientOf(p, seat) : undefined
    const href = dHash('lanes', null, { seat })
    const name = SEAT_NAME[seat]
    if (c) {
      if (live === 'stale') { out.push({ key: `monitor:${seat}`, seat, tone: 'warn', text: `${name}: send monitor not reporting`, href }); continue }
      if (rateLimitIncident(c)) { out.push({ key: `rate:${seat}`, seat, tone: 'bad', text: `${name}: LinkedIn is refusing invites`, href }); continue }
      if (isQueueEmptyClient(c)) { out.push({ key: `queue:${seat}`, seat, tone: 'bad', text: `${name}: invite queue is empty`, href }); continue }
      if (c.status === 'incident') { out.push({ key: `incident:${seat}`, seat, tone: 'bad', text: `${name}: sender has a problem`, href }); continue }
      if (c.status === 'capacity_reached') continue
    }
    if (!sends) continue
    const { today, usual } = soFar(sends, seat, now)
    if (usual >= MIN_USUAL && today < usual * LOW_SHARE) out.push({ key: `low:${seat}`, seat, tone: 'warn', text: `${name}: low sends, ${today} so far vs ${Math.round(usual)} usual by now`, href })
  }
  return out
}

/** What the bridge hands Brief's native sidebar: plain strings and hashes only. */
export type GlanceWire = { clear: boolean; dms: number; top: Array<{ name: string; seat: string; kind: string; age: string; href: string }>; alerts: Array<{ text: string; tone: string; href: string }> }
