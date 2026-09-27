// DMs, the read model. Pure: every rule here is TODAY'S rule from lib/inbox.ts
// (threadBucket, isOlderOwed, isAutoReplyThread, threadOrder, isDiscarded,
// isOwedInbound, isConversation), applied per seat. Nothing is re-judged here.
import {
  channelFamilies, eventTime, isAutoReplyThread, isConversation, isDiscarded, isOlderOwed, isOwedInbound,
  isLeadMagnet, messageChannel, threadBucket, threadKind, threadOrder,
  type InboxMessage, type Thread,
} from '../../lib/inbox'
import { campaignLaneLabel, copyRouteTag, threadLaneLabel } from '../../lib/labels'
import { seatOf, type Seat } from '../seats'
import { warsawDay } from '../ui/time'
import { splitEmail } from './emailFolder'

const DAY = 86_400_000

export type SeatView = {
  seat: Seat
  owner: Thread[]      // an owner question, pinned first
  drafted: Thread[]    // Needs you, with a live draft
  nodraft: Thread[]    // Needs you, owed with no draft
  later: Thread[]      // pushed drafts, soonest return first
  older: Thread[]      // owed past the 14-day clock
  auto: Thread[]       // their robot wrote last
  rest: Thread[]       // sent, waiting on them
  thrown: Thread[]     // a draft discarded in the last 3 days, nothing sent since
  spam: Thread[]
  email: Thread[]
  /** Email-only people (no LinkedIn thread) who owe a reply: they live in the Email folder, and
   *  Needs you carries one pointer line so its count still matches the frame's. */
  emailOwed: Thread[]
  /** The Email folder: threads whose email reply (or pending email leg) waits on him, and the rest. */
  emailWaiting: Thread[]
  emailRest: Thread[]
  /** Every live conversation on the seat, newest activity first (All conversations). */
  all: Thread[]
}

/** Nobody on LinkedIn: every message rode email. Such a thread stays in the Email folder only
 *  (Ivan 09-27: the email shows on the DM "only in cases where the DM is connected to the email"). */
export function isEmailOnly(t: Thread): boolean {
  const f = channelFamilies(t.messages)
  return f.length === 1 && f[0] === 'email'
}

export function seatThreads(threads: Thread[], seat: Seat): Thread[] {
  return threads.filter(t => seatOf(t.client_id) === seat)
}

/** The newest discarded draft on a thread, or null. */
export function lastDiscard(t: Thread): InboxMessage | null {
  return t.messages.filter(isDiscarded).at(-1) ?? null
}

export function isThrownRecently(t: Thread, now: number = Date.now()): boolean {
  const d = lastDiscard(t)
  if (!d || t.draft !== null || !d.send_blocked_at) return false
  const at = Date.parse(d.send_blocked_at)
  if (now - at > 3 * DAY) return false
  return !t.messages.some(m => m.direction === 'outbound' && m.sent_at && Date.parse(m.sent_at) > at)
}

/** scanDays: prospect_id -> distinct days the scan was opened (came_back_cards). */
export function seatView(threads: Thread[], seat: Seat, now: number = Date.now(), scanDays: ReadonlyMap<string, number> = new Map()): SeatView {
  const mine = seatThreads(threads, seat).filter(isConversation)
  const live = mine.filter(t => !t.spam)
  const v: SeatView = { seat, owner: [], drafted: [], nodraft: [], later: [], older: [], auto: [], rest: [], thrown: [], spam: [], email: [], emailOwed: [], emailWaiting: [], emailRest: [], all: [] }
  for (const t of live) {
    const bucket = threadBucket(t, now)
    if (isEmailOnly(t)) {
      v.email.push(t)
      if (bucket !== 'waiting') v.emailOwed.push(t)
      continue
    }
    if (bucket !== 'waiting') {
      if (t.ownerConfirmation) v.owner.push(t)
      else if (t.draft !== null && t.draftSnoozedUntil === null) v.drafted.push(t)
      else v.nodraft.push(t)
    } else if (t.draftSnoozedUntil !== null) { /* parked: listed under Later only */ }
    else if (isOlderOwed(t, now)) v.older.push(t)
    else if (isAutoReplyThread(t)) v.auto.push(t)
    else v.rest.push(t)
    if (t.draftSnoozedUntil !== null) v.later.push(t)
    if (isThrownRecently(t, now)) v.thrown.push(t)
    if (threadKind(t) === 'email') v.email.push(t)
  }
  v.spam = mine.filter(t => t.spam).sort(threadOrder)
  for (const k of ['owner', 'drafted', 'nodraft', 'older', 'auto'] as const) v[k].sort(threadOrder)
  v.later.sort((a, b) => (a.draftSnoozedUntil ?? '').localeCompare(b.draftSnoozedUntil ?? ''))
  v.thrown.sort((a, b) => (lastDiscard(b)?.send_blocked_at ?? '').localeCompare(lastDiscard(a)?.send_blocked_at ?? ''))
  // Coordinator row (LANES #14): on Ivan's seat, people who opened their scan on 2+ days lead
  // "Sent, waiting on them"; everyone else keeps newest first.
  const lift = (t: Thread) => (seat === 'ivan' && (scanDays.get(t.prospect_id) ?? 0) >= 2 ? 1 : 0)
  v.rest.sort((a, b) => lift(b) - lift(a) || eventTime(b.last).localeCompare(eventTime(a.last)))
  v.email.sort(threadOrder)
  const em = splitEmail(v.email, now)
  v.emailWaiting = em.waiting
  v.emailRest = em.rest
  v.all = [...live].sort((a, b) => Date.parse(eventTime(b.last)) - Date.parse(eventTime(a.last)))
  return v
}

export function needsCount(v: SeatView): number {
  return v.owner.length + v.drafted.length + v.nodraft.length + v.emailOwed.length
}

/** When the wait began on an owed thread (the newest owed inbound), for the lime age. */
export function owedSince(t: Thread): string | null {
  const m = t.messages.filter(x => x.direction === 'inbound' && isOwedInbound(x)).at(-1)
  return m ? eventTime(m) : null
}

// ---- out per day (invites kept apart) and replied, 7 days ----------------------------------

export type DayOut = { day: string; msg: number; inv: number }

/** Seven Warsaw days ending today, oldest first. */
export function outByDay(threads: Thread[], seat: Seat, now: number = Date.now()): DayOut[] {
  const days = Array.from({ length: 7 }, (_, i) => warsawDay(now - (6 - i) * DAY))
  const out = new Map(days.map(d => [d, { day: d, msg: 0, inv: 0 }]))
  for (const t of seatThreads(threads, seat)) {
    for (const m of t.messages) {
      if (m.direction !== 'outbound' || !m.sent_at) continue
      const row = out.get(warsawDay(m.sent_at))
      if (!row) continue
      if (m.message_type === 'connection_note') row.inv += 1
      else row.msg += 1
    }
  }
  return days.map(d => out.get(d)!)
}

/** Distinct people who wrote in 7 days: not Likely spam, not an Inbound Request stranger. */
export function replied7d(threads: Thread[], seat: Seat, now: number = Date.now()): number {
  let n = 0
  for (const t of seatThreads(threads, seat)) {
    if (t.spam) continue
    if (/inbound/i.test(t.last.campaign_name ?? '')) continue
    if (t.messages.some(m => m.direction === 'inbound' && now - Date.parse(eventTime(m)) <= 7 * DAY)) n += 1
  }
  return n
}

export const SCHEDULE: Record<Seat, string> = { ivan: 'sends any hour', risedtc: 'sends 05-18 PT', arch: 'sends Sun-Fri 08-21 CET' }

// ---- the lane chip (LANES §8): lane KEY first, else a campaign word, never Arch's campaign name --

const CAMP: [RegExp, string, boolean?][] = [
  [/Engagement Harvest/i, 'Harvested'], [/Kyle/, 'Kyle'], [/Lead-Magnet Commenters/i, 'LM commenters'],
  [/Cold v2b/i, 'Cold v2b'], [/Cold v2/i, 'Cold v2'], [/^Poland/i, 'Poland'], [/^Quiet on LinkedIn/i, 'Quiet on LinkedIn'],
  [/Profile View/i, 'Profile view'], [/Inbound/i, 'Inbound'], [/Competitor Engagers/i, 'Competitor engager'],
  [/Fractional CMO Partners/i, 'CMO partner'], [/Client Orbit/i, 'Client orbit'], [/RiseDTC . Cold/i, 'Cold', true],
  [/Influencer agenc/i, 'Influencer agencies'], [/^(Accounting|Agency Owners|Agency-Focused|Consultancies|Research Firms)/, 'Agency cold', true],
]
const CLOSED_LANE = new Set(['orbit_pilot_fintech', 'orbit_pilot_csaas', 'funding_signal', 'hand_raise', 'warm_games', 'warm_apps'])

export type LaneChip = { label: string; closed: boolean }

export function laneChip(t: Pick<Thread, 'lane' | 'client_id' | 'campaignLane' | 'last'>): LaneChip | null {
  if (t.lane) return { label: campaignLaneLabel(t.lane), closed: CLOSED_LANE.has(t.lane) }
  const camp = t.last.campaign_name ?? ''
  if (seatOf(t.client_id) === 'arch') return /Inbound Request/i.test(camp) ? { label: 'Inbound', closed: false } : null
  for (const [re, label, closed] of CAMP) if (re.test(camp)) return { label, closed: Boolean(closed) }
  const fallback = threadLaneLabel(null, t.campaignLane)
  return fallback ? { label: fallback, closed: false } : null
}

export type RowTag = { text: string; kind: 'lane' | 'off' | 'route' | 'ch' | 're' | 'nd' }

/** The mono tags on a list row, in the mock's order. */
export function rowTags(t: Thread, opts: { nodraft?: boolean } = {}): RowTag[] {
  const out: RowTag[] = []
  if (opts.nodraft) out.push({ text: 'No draft', kind: 'nd' })
  const lane = laneChip(t)
  if (lane?.label) out.push({ text: lane.closed ? `${lane.label} · closed` : lane.label, kind: lane.closed ? 'off' : 'lane' })
  const route = copyRouteTag(t.copyRoute)
  if (route) out.push({ text: route.label, kind: 'route' })
  const kind = threadKind(t)
  if (kind === 'email') out.push({ text: 'Email', kind: 'ch' })
  else if (kind === 'inmail') out.push({ text: 'InMail', kind: 'ch' })
  if (isLeadMagnet(t)) out.push({ text: 'Lead magnet', kind: 'ch' })
  const lastIn = t.messages.filter(m => m.direction === 'inbound').at(-1)
  if (lastIn && isReaction(lastIn)) out.push({ text: `reacted ${reactionGlyph(lastIn.message_text)}`.trim(), kind: 're' })
  return out
}

const REACTION = /^\s*\S+\s+reacted\b|^[\s\p{Extended_Pictographic}\p{Emoji_Presentation}]+$/u

export function isReaction(m: InboxMessage): boolean {
  return m.direction === 'inbound' && m.reply_intent !== 'negative' && REACTION.test((m.message_text ?? '').trim())
}

function reactionGlyph(text: string | null): string {
  return (text ?? '').replace(/^.*reacted\s*/i, '').trim().slice(0, 4)
}

/** The first paragraph of a message, flattened, for a row's one line. */
export function firstLine(text: string | null | undefined): string {
  const parts = String(text ?? '').split(/^[ \t]*-{3,}[ \t\r]*$|\n\n+/m).map(s => s.trim()).filter(Boolean)
  return (parts[0] ?? '').replace(/\s+/g, ' ')
}

export function flat(text: string | null | undefined): string {
  return String(text ?? '').replace(/^[ \t]*-{3,}[ \t\r]*$/gm, ' ').replace(/\s+/g, ' ').trim()
}

/** Short age, the mock's "17h" / "2d" / "5m". */
export function ago(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return ''
  const m = (now - Date.parse(iso)) / 60_000
  if (Number.isNaN(m)) return ''
  if (m < 60) return `${Math.max(1, Math.round(m))}m`
  if (m < 1440) return `${Math.round(m / 60)}h`
  return `${Math.round(m / 1440)}d`
}

export { messageChannel }
