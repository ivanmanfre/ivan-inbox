import { evaluate } from './followupCadence.js'
import { eventTime, sendFailed, type InboxMessage, type Thread } from '../../lib/inbox'
import { seatOf, type Seat } from '../seats'
import type { LaterItem } from './later'

export type FollowupMessage = { id: string; direction: string; message_type: string; message_text?: string; sent_at?: string; created_at?: string; channel?: string; is_reaction?: boolean; ai_model?: string; send_blocked_at?: string; send_blocked_reason?: string; snoozed_until?: string; unipile_message_id?: string }
export type FollowupSource = { seat: string; prospect: { id: string; stage: string; icp_score: number | null; enrichment_data: Record<string, unknown>; call_booked_at?: string; skip_reason?: string; next_touch_after?: string }; rows: FollowupMessage[] }
export type FollowupProjection = { prospect_id: string; seat: Seat; at: string; state: 'scheduled' | 'due'; basis: 'estimate' | 'dated'; lastTouch: string; nextStep: string }
const ts = (s: string | null | undefined) => Date.parse(s ?? '') || 0
const followupModel = /stall_bump|followup_dated|manual_followup|cameback_followup/

export function projectFollowups(sources: FollowupSource[], now = Date.now()): FollowupProjection[] {
 const projected: FollowupProjection[] = []
 for (const s of sources) {
  if (!['ivan','risedtc','arch'].includes(s.seat)) continue
  const seat = s.seat as Seat, p = s.prospect, dated = p.skip_reason === 'follow_up_dated'
  const real = s.rows.filter(r => !r.is_reaction && r.message_type !== 'connection_note' && (r.direction === 'inbound' || r.sent_at)).sort((a,b) => ts(a.sent_at ?? a.created_at) - ts(b.sent_at ?? b.created_at))
  const lastIn = real.filter(r => r.direction === 'inbound').at(-1), lastOut = real.filter(r => r.direction === 'outbound').at(-1)
  const review = p.enrichment_data?.followup_review as { latest_inbound_id?: string; latest_outbound_id?: string; verdict?: { follow_up?: boolean; angle?: string } } | undefined
  if (review?.latest_inbound_id === lastIn?.id && review?.latest_outbound_id === lastOut?.id && review?.verdict?.follow_up === false) continue
  const messages = s.rows.filter(r => r.message_type !== 'connection_note' && (r.direction === 'inbound' || r.sent_at) && (seat !== 'arch' || r.channel !== 'email')).map(r => ({ id: r.unipile_message_id || r.id, is_sender: r.direction === 'outbound', text: r.message_text, timestamp: r.sent_at ?? r.created_at, is_reaction: r.is_reaction, channel: r.channel }))
  const result = evaluate({ seat, prospect: dated ? { ...p, skip_reason: null, next_touch_after: null } : p, rows: s.rows, messages, complete: true, now, allowEmail: dated })
  if (!result.due_at) continue
  const at = dated ? p.next_touch_after : result.due_at
  if (!at || ts(at) > now + 72 * 3_600_000) continue
  projected.push({ prospect_id: p.id, seat, at, state: ts(at) <= now ? 'due' : 'scheduled', basis: dated ? 'dated' : 'estimate', lastTouch: result.last_delivered_touch_at!,
   nextStep: review && review.latest_inbound_id === lastIn?.id && review.latest_outbound_id === lastOut?.id && review.verdict?.angle ? review.verdict.angle : 'Conversation check pending' })
 }
 return projected.sort((a,b) => ts(a.at) - ts(b.at))
}

export type UpcomingItem = { t: Thread; at: string; line: string }
export function upcomingItems(projected: FollowupProjection[], later: LaterItem[], byId: ReadonlyMap<string, Thread>, seat: Seat, now = Date.now()): UpcomingItem[] {
 const out = new Map<string, UpcomingItem>()
 for (const p of projected) {
  const t = byId.get(p.prospect_id)
  if (!t || p.seat !== seat || seatOf(t.client_id) !== seat || t.spam || t.draft || t.ownerConfirmation || blockedFollowup(t)) continue
  const delivered = t.messages.filter(m => m.direction === 'outbound' && m.sent_at).sort((a,b) => ts(a.sent_at) - ts(b.sent_at)).at(-1)
  if (ts(delivered?.sent_at) !== ts(p.lastTouch) || t.messages.some(m => m.direction === 'inbound' && ts(eventTime(m)) > ts(p.lastTouch))) continue
  out.set(p.prospect_id, { t, at: p.at, line: p.state === 'due' ? `Due · ${p.nextStep}` : `${p.basis === 'dated' ? 'Scheduled return' : 'Estimated follow-up'} · ${p.nextStep}` })
 }
 for (const l of later) if (ts(l.at) <= now + 72 * 3_600_000) out.set(l.t.prospect_id, { t: l.t, at: l.at, line: l.kind === 'draft' ? 'Draft returns for review' : 'Scheduled return · draft when due' })
 return [...out.values()].sort((a,b) => ts(a.at) - ts(b.at))
}

export function blockedFollowup(t: Thread): { message: InboxMessage; reason: string } | null {
 if (t.spam || t.draft || t.ownerConfirmation) return null
 const m = t.messages.filter(m => !m.sent_at && followupModel.test(m.ai_model ?? '') && sendFailed(m)).at(-1)
 if (!m?.send_blocked_at) return null
 const at = ts(m.send_blocked_at)
 if (t.messages.some(r => r.id !== m.id && ((r.direction === 'outbound' && r.sent_at && ts(r.sent_at) > at) || (r.direction === 'inbound' && ts(eventTime(r)) > at)))) return null
 const raw = m.send_blocked_reason ?? ''
 if (/^(discarded|superseded)(?:_|$)/.test(raw)) return null
 const reason = raw === 'arch_conversation_owner_only' ? 'Conversation ownership check failed' : raw.startsWith('followup_') ? `Follow-up held: ${raw.slice(9).replaceAll('_',' ')}` : `Delivery blocked: ${raw.replaceAll('_',' ')}`
 return { message: m, reason }
}
