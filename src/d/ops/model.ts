// D Ops: the pure reading of the ops_drafts rows. Lanes are the three seats
// (seatOf: '' / 'ivan' = Ivan, 'risedtc' / legacy 'rise' = Rise, 'arch' = Arch),
// never summed. Order inside a lane is today's (wb/ops/lanes orderLane), the
// kinds line is today's (kindsLine), the Ops number is today's (pendingOps
// minus the comment ideas past what the poster can still post today).
import { isBatchable, isStillPending } from '../../lib/focus'
import { ideaSeatKey, isTaskKind, pendingOps, pendingTasks, splitCommentIdeas, type OpsDraft, type OpsKind } from '../../lib/ops'
import { orderLane } from '../../wb/ops/lanes'
import { SEATS, SEAT_NAME, seatOf, type Seat } from '../seats'

/** The card's eyebrow, in plain words. */
export const KIND_TITLE: Record<OpsKind, string> = {
  comment_outbound: 'Comment on their post', comment_reply: 'Reply under your post', escalation: 'Escalation',
  update: 'Update for the client', newsjack: 'Newsjack', weekly_report: 'Weekly report', booking: 'Call booked',
  precall_email: 'Pre-call email', manual_invite: 'Hand-sent invite', leads_ballot: 'Leads ballot',
  conversation_takeover: 'Conversation takeover', task: 'Task', audn_recommendation: 'Audience proposal',
}

/** The eyebrow for this card: a reply sits under the SEAT's post, so only Ivan's reads "your post". */
export function kindTitle(d: OpsDraft): string {
  if (d.kind !== 'comment_reply') return KIND_TITLE[d.kind]
  const seat = seatOf(d.client_id)
  return seat === 'ivan' ? KIND_TITLE.comment_reply : `Reply under ${seat ? SEAT_PERSON[seat] : d.client_id}’s post`
}

/** Whose lane, as the plate prints it. */
export const LANE_OWNER: Record<Seat, string> = { ivan: 'your lane', risedtc: "Mattan's lane", arch: "Davorin's lane" }
export const SEAT_PERSON: Record<Seat, string> = { ivan: 'you', risedtc: 'Mattan', arch: 'Davorin' }

/** A client this app has no seat for: drawn as its own lane, never dropped (today's lanes.ts). */
export type OtherLane = { key: string; name: string; cards: OpsDraft[]; later: OpsDraft[]; waiting: number }

export type OpsBoard = {
  /** Cards (not tasks) per seat, in lane order. Comment ideas for later are not here. */
  lanes: Record<Seat, OpsDraft[]>
  /** Comment ideas past each seat's own 3 a day, per seat (board order). */
  laterBy: Record<Seat, OpsDraft[]>
  /** Every seat's ideas for later, one list (Ivan's, Rise's, Arch's, then other lanes'). */
  later: OpsDraft[]
  /** Pending cards + tasks per seat, minus later: THE Ops number, per seat. */
  waiting: Record<Seat, number>
  /** Pending tasks per seat (the part of `waiting` that sits on the list). */
  tasks: Record<Seat, number>
  /** Lanes for client ids that are not one of the three seats. */
  other: OtherLane[]
  /** Every card in the order j / k walks: Ivan's lane, Rise's, Arch's, then other lanes. */
  flat: OpsDraft[]
}

const bySeat = <T,>(f: () => T): Record<Seat, T> => ({ ivan: f(), risedtc: f(), arch: f() })

/** The lane a row sits in: one of the three seats, else its own client id. */
export function laneOf(clientId: string | null | undefined): string {
  return seatOf(clientId) ?? ideaSeatKey(clientId)
}

/**
 * `held` = cards the comment gate accepted but parked (lane switched off): the
 * accept stamps the row, so it leaves `pending`, but it stays on the board.
 */
export function readBoard(rows: OpsDraft[], held: ReadonlySet<string> = new Set(), now = Date.now()): OpsBoard {
  const pending = pendingOps(rows, now)
  const laterIds = new Set(splitCommentIdeas(rows, now).later.map(d => d.id))
  const pendIds = new Set(pending.map(d => d.id))
  const cards = rows.filter(d => !isTaskKind(d.kind) && (pendIds.has(d.id) || held.has(d.id)))
  const lanes = bySeat<OpsDraft[]>(() => [])
  const laterBy = bySeat<OpsDraft[]>(() => [])
  const waiting = bySeat(() => 0)
  const tasks = bySeat(() => 0)
  const others = new Map<string, OtherLane>()
  const otherOf = (k: string) => {
    let o = others.get(k)
    if (!o) { o = { key: k, name: k, cards: [], later: [], waiting: 0 }; others.set(k, o) }
    return o
  }
  for (const d of cards) {
    const s = seatOf(d.client_id)
    const later = laterIds.has(d.id)
    if (s) (later ? laterBy : lanes)[s].push(d)
    else { const o = otherOf(laneOf(d.client_id)); (later ? o.later : o.cards).push(d) }
  }
  for (const d of pending) {
    if (laterIds.has(d.id)) continue
    const s = seatOf(d.client_id)
    if (s) waiting[s] += 1
    else otherOf(laneOf(d.client_id)).waiting += 1
  }
  for (const d of pendingTasks(rows, now)) {
    const s = seatOf(d.client_id)
    if (s) tasks[s] += 1
  }
  for (const s of SEATS) lanes[s] = orderLane(lanes[s])
  const other = [...others.values()].sort((a, b) => a.key.localeCompare(b.key))
  for (const o of other) o.cards = orderLane(o.cards)
  const later = [...SEATS.flatMap(s => laterBy[s]), ...other.flatMap(o => o.later)]
  return { lanes, laterBy, later, waiting, tasks, other, flat: [...SEATS.flatMap(s => lanes[s]), ...other.flatMap(o => o.cards)] }
}

/** "13h left" / "45m left" / "expired", or '' with no expiry. */
export function timeLeft(iso: string | undefined | null, now = Date.now()): string {
  if (!iso) return ''
  const ms = new Date(iso).getTime() - now
  if (!Number.isFinite(ms)) return ''
  if (ms <= 0) return 'expired'
  return ms >= 3_600_000 ? `${Math.floor(ms / 3_600_000)}h left` : `${Math.max(1, Math.floor(ms / 60_000))}m left`
}

/** "just now" / "12m ago" / "5h ago" / "3d ago". */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  const t = new Date(iso ?? '').getTime()
  if (!Number.isFinite(t)) return ''
  const m = (now - t) / 60_000
  if (m < 1) return 'just now'
  if (m < 60) return `${Math.round(m)}m ago`
  if (m < 1440) return `${Math.round(m / 60)}h ago`
  return `${Math.round(m / 1440)}d ago`
}

const firstLine = (s: string) => s.split('\n').map(x => x.trim()).find(Boolean) ?? ''
const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** One row in a lane column: who, what it says, and the time that matters. */
export function rowLine(d: OpsDraft, now = Date.now()): { who: string; text: string; time: string; hot: boolean } {
  const c = d.context ?? {}
  const seat = seatOf(d.client_id) ?? 'ivan'
  const who = str(c.target_name) || str(c.author_name) || str(c.prospect_name) || str(c.invitee_name) || str(c.headline)
    || (d.kind === 'weekly_report' ? `Week of ${str(c.week)}` : d.kind === 'update' ? `For ${SEAT_PERSON[seat]}` : '')
  const text = d.kind === 'comment_reply' ? str(c.comment_text)
    : d.kind === 'escalation' ? (str(c.inbound) || firstLine(d.body))
      : firstLine(d.body)
  const time = d.kind === 'newsjack' ? timeLeft(str(c.expires_at), now) : ago(str(c.posted_at) || d.created_at, now)
  return { who: who || kindTitle(d), text, time, hot: d.kind === 'newsjack' || d.kind === 'escalation' }
}

export type SeatBatch = { key: string; kind: 'comment_outbound' | 'manual_invite'; lane: string; cards: OpsDraft[]; label: string }

/** Today's quick batch, per lane: two or more batchable, still-pending cards of one kind. */
export function seatBatches(lane: string, cards: OpsDraft[]): SeatBatch[] {
  const out: SeatBatch[] = []
  for (const kind of ['comment_outbound', 'manual_invite'] as const) {
    // Still pending only (today's pendingIdsOf): a gate-held comment is already
    // approved and parked; a batch discard would cancel it at the poster.
    const list = cards.filter(d => d.kind === kind && isBatchable(d) && isStillPending(d))
    if (list.length < 2) continue
    out.push({ key: `${kind}:${lane}`, kind, lane, cards: list, label: `${list.length} ${kind === 'manual_invite' ? 'invites' : 'comments'}` })
  }
  return out
}

/** Where the card sits: "card 2 of 5" inside its lane (or its lane's ideas for later). */
export function positionOf(board: OpsBoard, d: OpsDraft): { seat: Seat | null; lane: string; at: number; of: number } {
  const seat = seatOf(d.client_id)
  const o = seat ? null : board.other.find(x => x.key === laneOf(d.client_id)) ?? null
  const later = seat ? board.laterBy[seat] : o?.later ?? []
  const main = seat ? board.lanes[seat] : o?.cards ?? []
  const list = later.some(x => x.id === d.id) ? later : main
  return { seat, lane: seat ? SEAT_NAME[seat] : laneOf(d.client_id), at: list.findIndex(x => x.id === d.id) + 1, of: list.length }
}
