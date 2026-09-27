/* ==========================================================================
   src/d/lanes/model.ts — the Lanes read model, pure.

   Everything the Lanes place draws is shaped here from rows the libs already
   read (cc03 payload, campaign perf, governor, kpis views). Port of the D mock's
   `lanes-model.js`, typed. Two rules the code keeps:
     1. Invitations, DMs and InMail are never added together, and no seat is
        ever added to another.
     2. A reading we do not have stays null and renders as "unknown" / "?";
        it is never 0.
   ========================================================================== */
import {
  isOpenIncident, isQueueEmptyClient, rateLimitIncident, rateLimitSentence,
  type CcClient, type CcCompareRow, type CcIncident, type CcPayload, type CcRangeRow, type CcLiveness,
} from '../../lib/campaignControl'
import type { Seat } from '../seats'
import { SEAT_NAME } from '../seats'

export type Range = '7d' | '30d' | '90d'
export const RANGES: Range[] = ['7d', '30d', '90d']
const PREV: Record<Range, string | null> = { '7d': 'prev7d', '30d': 'prev30d', '90d': null }

const WARSAW = 'Europe/Warsaw'
const fmt = (t: string | number | Date, o: Intl.DateTimeFormatOptions, tz = WARSAW) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...o }).format(new Date(t)).replace('Sept', 'Sep')
export const hm = (t: string | number | Date, tz = WARSAW) => fmt(t, { hour: '2-digit', minute: '2-digit', hour12: false }, tz)
export const dm = (t: string | number | Date, tz = WARSAW) => fmt(t, { day: 'numeric', month: 'short' }, tz)
export const dayKey = (t: string | number | Date, tz = WARSAW) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(t))

export function ago(t: string | null | undefined, now: number): string {
  if (!t) return 'never'
  const m = (now - Date.parse(t)) / 6e4
  if (!Number.isFinite(m)) return 'unknown'
  return m < 1 ? 'just now' : m < 60 ? `${Math.round(m)}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`
}
export function until(t: string | null | undefined, now: number): string | null {
  if (!t) return null
  const m = (Date.parse(t) - now) / 6e4
  if (!Number.isFinite(m)) return null
  return m <= 0 ? 'now' : m < 60 ? `in ${Math.round(m)}m` : m < 2880 ? `in ${Math.round(m / 60)}h` : `in ${Math.round(m / 1440)}d`
}

export type Tone = 'warn' | 'live' | 'dim'
/** The state word on a seat plate. A stale monitor makes every seat unverified. */
export function seatWord(c: CcClient | undefined, liveness: CcLiveness): { word: string; tone: Tone } {
  if (!c) return { word: 'Unknown, unverified', tone: 'warn' }
  if (liveness === 'stale') return { word: 'Unknown, unverified', tone: 'warn' }
  if (rateLimitIncident(c)) return { word: 'Rate limited', tone: 'warn' }
  if (isQueueEmptyClient(c)) return { word: 'Queue empty', tone: 'warn' }
  const w = { healthy: 'Healthy', capacity_reached: 'Capacity reached', outside_window: 'Outside window', incident: 'Incident', unknown: 'Unknown, unverified' }[c.status]
  return { word: w, tone: c.status === 'healthy' ? 'live' : c.status === 'outside_window' ? 'dim' : 'warn' }
}

export const clientOf = (p: CcPayload | null, seat: Seat) => p?.clients.find(c => c.client_id === seat)
const allRow = (p: CcPayload, seat: Seat, ch: string, iv: string): CcRangeRow | null =>
  p.ranges.rows.find(r => r.client_id === seat && r.channel === ch && r.interval === iv && r.source_lane === '__all__') ?? null
const daySent = (p: CcPayload, seat: Seat, ch: string, day: string) =>
  p.ranges.daily.find(d => d.client_id === seat && d.channel === ch && d.day === day)

export type TodayView = {
  inv: number | null; invY: number | null; dm: number | null; inmail: number | null
  attempted: number | null; failed: number | null
  capUsed: number | null; cap: number | null; wUsed: number | null; wCap: number | null; resets: string | null
}
export function todayOf(p: CcPayload | null, seat: Seat, now: number): TodayView | null {
  const c = clientOf(p, seat)
  if (!p || !c) return null
  const tz = p.ranges.tz || WARSAW
  const t = dayKey(now, tz), y = dayKey(now - 864e5, tz)
  const inv = allRow(p, seat, 'invitation', 'today')
  const cap = c.invitation.capacity ?? {}
  return {
    inv: daySent(p, seat, 'invitation', t)?.sent ?? inv?.sent ?? null,
    invY: daySent(p, seat, 'invitation', y)?.sent ?? null,
    dm: allRow(p, seat, 'dm', 'today')?.sent ?? null,
    inmail: allRow(p, seat, 'inmail', 'today')?.sent ?? null,
    attempted: inv?.attempted ?? null, failed: inv?.failed ?? null,
    capUsed: cap.daily_used ?? null, cap: cap.daily_cap ?? null, wUsed: cap.weekly_used ?? null, wCap: cap.weekly_cap ?? null,
    resets: cap.daily_window_from ? hm(Date.parse(cap.daily_window_from) + 864e5) : null,
  }
}

export type Bar = { day: string; dow: string; v: number | null; today: boolean }
/** Fourteen local days, oldest first. A day the payload does not carry is null, never 0. */
export function seriesOf(p: CcPayload | null, seat: Seat, now: number, ch: 'invitation' | 'dm', field: 'sent' | 'replies_people' = 'sent', n = 14): Bar[] {
  const tz = p?.ranges.tz || WARSAW
  const today = dayKey(now, tz)
  return Array.from({ length: n }, (_, i) => {
    const day = dayKey(now - (n - 1 - i) * 864e5, tz)
    const r = p ? daySent(p, seat, ch, day) : undefined
    const v = r ? (field === 'sent' ? r.sent : r.replies_people ?? null) : null
    return { day, dow: fmt(`${day}T12:00:00Z`, { weekday: 'short' }, 'UTC').slice(0, 1), v, today: day === today }
  })
}

/** A compare needs two COMPLETE windows of equal length (today's Control.tsx rule); else there is none. */
export function comparable(p: CcPayload, range: Range): { rows: CcCompareRow[] } | null {
  const prev = PREV[range]
  const iv = p.ranges.intervals.find(i => i.name === range)
  const pv = prev ? p.ranges.intervals.find(i => i.name === prev) : undefined
  if (!prev || !iv || !pv || !iv.complete || !pv.complete || iv.days !== pv.days) return null
  return { rows: p.ranges.compare.filter(x => x.current === range && x.previous === prev) }
}

export type WindowView = {
  range: Range; inv: number | null; dm: number | null; inmail: number | null; repliers: number | null; invFailed: number | null
  accepted: number | null; matured: number | null; rate: number | null; prevRate: number | null; delta: number | null
  compare: CcCompareRow[]; hasInterval: boolean
}
export function windowOf(p: CcPayload | null, seat: Seat, range: Range): WindowView {
  const iv = p?.ranges.intervals.find(i => i.name === range)
  const r = (ch: string) => (p && iv ? allRow(p, seat, ch, range) : null)
  const inv = r('invitation'), dmr = r('dm'), im = r('inmail')
  const coh = inv?.acceptance_cohort
  const prev = PREV[range]
  const compare = p && prev ? (comparable(p, range)?.rows ?? []).filter(x => x.client_id === seat) : []
  const ic = compare.find(x => x.channel === 'invitation')
  return {
    range, hasInterval: Boolean(iv),
    inv: inv?.sent ?? null, dm: dmr?.sent ?? null, inmail: im?.sent ?? null, repliers: dmr?.replies_people ?? null, invFailed: inv?.failed ?? null,
    accepted: coh?.accepted_within_72h ?? null, matured: coh?.matured_denominator ?? null, rate: coh?.matured_denominator ? coh.rate_pct : null,
    prevRate: ic?.accept_rate_previous_pct ?? null, delta: ic?.delta_pp ?? null, compare,
  }
}

const POOL: Record<string, string> = {
  cold: 'cold', engage: 'engagers', hiring: 'hiring', company_expansion: 'company expansion', armed_name_gate_only: 'cleared by Mattan',
  engager_warm_only: 'engagers only', engager_warm: 'engager lane', ads_gate_excluded: 'held by ads gate', name_gate_blocked: 'held for Mattan',
}
const PACE: Record<string, string> = { no_target: 'no target set', on_track: 'on track', behind: 'behind target', not_yet: 'too early to judge' }

/** The pools waiting on a seat, from the payload's own breakdown (numbers only). */
export function poolsOf(c: CcClient): Array<[string, number]> {
  const raw = (c.invitation.eligible_stock_by_pool ?? {}) as Record<string, unknown>
  const inner = (raw.by_pool && typeof raw.by_pool === 'object' ? raw.by_pool : { ...raw, ...(raw.by_lane && typeof raw.by_lane === 'object' ? raw.by_lane : {}) }) as Record<string, unknown>
  return Object.entries(inner).filter(([, v]) => typeof v === 'number').map(([k, v]) => [POOL[k] ?? k.replace(/_/g, ' '), v as number])
}

/* The contract's "sendable-open" (today's Control.tsx `sendableOpen`): the shared
   sender reports Saturday as open_now with a view_only reason, so open_now alone
   does not mean a seat can send. A seat that is not sendable-open is never paced. */
const NOT_SENDABLE = /view_only|_closed|outside_window/
export function sendableOpen(ch: { session?: { open_now: boolean } | null; executable_reasons?: string[] }): boolean {
  if (!ch.session?.open_now) return false
  return !NOT_SENDABLE.test((ch.executable_reasons ?? []).join(' '))
}
/** One executable reason (`cooldown:arch_conn_send_pause_until`) in plain words. */
export function reasonWord(r: string): string {
  const [k, v = ''] = r.split(':')
  if (k === 'cooldown') return `paused (${v.replace(/_/g, ' ')})`
  if (k === 'window_state') return `window ${v.split('=').pop()}`
  if (/view_only/.test(r)) return 'view-only day (Saturday rule)'
  if (/outside_window|_closed/.test(r)) return 'outside the sending window'
  return r.replace(/_/g, ' ')
}

/* The seat's eligible supply counted ONCE (today's Control.tsx seatEligible): the
   producer stamps the seat-wide figure on every source lane and adds the lanes
   up for the channel, so the channel figure is that number times the lane count. */
export function seatEligible(ch: { eligible_stock?: number | null; eligible_stock_by_pool?: Record<string, unknown> | null; by_lane?: Array<{ eligible_stock?: number | null }> }): number | null {
  const lv = (ch.by_lane ?? []).map(l => l.eligible_stock).filter((v): v is number => typeof v === 'number')
  if (lv.length > 0 && lv.every(v => v === lv[0])) return lv[0]
  const raw = (ch.eligible_stock_by_pool ?? {}) as Record<string, unknown>
  const inner = (raw.by_pool && typeof raw.by_pool === 'object' ? raw.by_pool : raw) as Record<string, unknown>
  const pools = Object.values(inner).filter((v): v is number => typeof v === 'number')
  if (pools.length) return pools.reduce((a, v) => a + v, 0)
  return ch.eligible_stock ?? null
}

export type ControlView = {
  incident: (CcIncident & { lead: string; pausedUntil: string | null; check: string | null }) | null
  lead: string; window: string; closed: boolean; opens: string | null; pct: number | null; pace: string
  sent: number; planned: number | null; pools: Array<[string, number]>; next: string | null
  /** "Cannot send right now": the channel's executable_reasons, in words (empty when it can send). */
  blockers: string[]
}
export function controlOf(c: CcClient, now: number): ControlView {
  const inv = c.invitation, s = inv.session
  const tz = s?.tz ?? WARSAW
  const tzName = tz.split('/').pop()!.replace('_', ' ')
  const from = s?.opens_at ? hm(s.opens_at, tz) : null, to = s?.closes_at ? hm(s.closes_at, tz) : null
  const window = from && to ? (from === to ? `all day (${tzName})` : `${from}–${to} ${tzName}`) : `hours not recorded (${tzName})`
  const next = s?.next_opening_at ?? null
  const opens = next ? `${dayKey(next) === dayKey(now) ? 'today' : fmt(next, { weekday: 'short', day: 'numeric', month: 'short' })} ${hm(next)}` : null
  const open = (c.incidents ?? []).filter(isOpenIncident)
  const rl = rateLimitIncident(c)
  const inc = rl ?? open[0] ?? null
  const na = (inc?.next_action ?? {}) as { cooldown_until?: string | null; earliest_safe_at?: string | null }
  const pausedAt = na.cooldown_until ?? na.earliest_safe_at ?? null
  return {
    incident: inc ? {
      ...inc,
      lead: rl ? rateLimitSentence(rl).replace(/ [\d,]+ refusals (since [^.]+|so far)\./, '') : (inc.plain_cause ?? inc.cause?.explanation ?? 'No plain cause recorded.'),
      pausedUntil: pausedAt ? hm(pausedAt) : null,
      check: inc.next_check_at ? `${hm(inc.next_check_at)}${until(inc.next_check_at, now) ? ', ' + until(inc.next_check_at, now) : ''}` : null,
    } : null,
    lead: c.status_reason,
    window, closed: !sendableOpen(inv) || c.status === 'outside_window', opens,
    blockers: inv.executable_now === false ? (inv.executable_reasons ?? []).map(reasonWord) : [],
    pct: s?.progress_pct ?? null, pace: PACE[inv.pace] ?? inv.pace, sent: inv.confirmed_sent, planned: inv.planned_by_now,
    pools: poolsOf(c), next: c.next_action?.action ?? null,
  }
}

/** One sentence per seat, today. Never a total across seats. */
export function answerOf(p: CcPayload | null, seats: Seat[], now: number, replies?: Partial<Record<Seat, { replied: number; calls: number }>> | null): { inv: Array<{ seat: Seat; v: number | null }>; sub: string } {
  const inv = seats.map(seat => ({ seat, v: todayOf(p, seat, now)?.inv ?? null }))
  if (!p) return { inv, sub: 'Reading the send monitor…' }
  const lim = seats.filter(s => { const c = clientOf(p, s); return c && rateLimitIncident(c) }).map(s => SEAT_NAME[s])
  const shut = seats.filter(s => { const c = clientOf(p, s); return c && !rateLimitIncident(c) && (c.status === 'outside_window' || !c.invitation.session?.open_now) && c.invitation.session?.next_opening_at })
    .map(s => `${SEAT_NAME[s]} opens ${hm(clientOf(p, s)!.invitation.session!.next_opening_at!)}`)
  const parts = [lim.length ? `LinkedIn is refusing ${lim.join(' and ')}` : '', ...shut].filter(Boolean)
  const rep = replies ? ` Replied this week: ${seats.map(s => `${SEAT_NAME[s]} ${replies[s]?.replied ?? 0}`).join(', ')}; calls booked this week: ${seats.map(s => `${SEAT_NAME[s]} ${replies[s]?.calls ?? 0}`).join(', ')}.` : ''
  return { inv, sub: (parts.length ? parts.join('; ') + '.' : 'Every seat is sending inside its window.') + rep }
}
