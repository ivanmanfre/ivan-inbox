import { supabase } from './supabase'
import type { InboxMessage } from './inbox'

/** SwishDM short-offer leads get their ChatGPT/Gemini check only after they accept the invite
 *  (enrichment_data.swishdm_auto.check_after_accept). A written reply that lands before the first message
 *  while that check is 'pending' is not drafted yet: the reply drafter (Accept + Reply Detector, triage)
 *  waits for the check so the offer carries a fair finding, up to 24 h after the reply. Stacey Wilhelm,
 *  11-10: the pane said "no draft, write it yourself" during that wait. */
export type CheckWait = { startedAt: string | null }

/** What the pane reads: the check's state, and when their newest WRITTEN message came in. A reaction is
 *  never waited on (the drafter answers it on its own fast path), so it neither starts nor extends a wait. */
export type CheckState = { state: string | null; startedAt: string | null; replyAt: string | null }

type Msg = Pick<InboxMessage, 'direction' | 'message_type' | 'sent_at'>

const WAIT_MS = 24 * 3600e3   // triage.js CHECK_WAIT_MS

export function readCheckWait(check: CheckState | null, messages: readonly Msg[], now: number): CheckWait | null {
  if (!check || check.state !== 'pending' || !check.replyAt) return null
  if (messages.some(m => m.direction === 'outbound' && m.sent_at && (m.message_type === 'dm' || m.message_type === 'inmail'))) return null
  const at = Date.parse(check.replyAt)
  if (!Number.isFinite(at) || now - at >= WAIT_MS) return null
  return { startedAt: check.startedAt }
}

export async function fetchCheckState(prospectId: string): Promise<CheckState | null> {
  const p = await supabase.from('outreach_prospects')
    .select('cak:enrichment_data->swishdm_auto->check_after_accept').eq('id', prospectId).single()
  if (p.error) throw p.error
  const cak = (p.data as { cak: { state?: string; started_at?: string | null } | null }).cak
  if (!cak || cak.state !== 'pending') return cak ? { state: cak.state ?? null, startedAt: null, replyAt: null } : null
  const m = await supabase.from('outreach_messages').select('sent_at,created_at')
    .eq('prospect_id', prospectId).eq('direction', 'inbound').not('is_reaction', 'is', true)
    .order('sent_at', { ascending: false, nullsFirst: false })   // triage's own order (sent_at.desc.nullslast)
    .order('created_at', { ascending: false }).limit(1)
  if (m.error) throw m.error
  const r = (m.data as { sent_at: string | null; created_at: string }[])[0]
  return { state: 'pending', startedAt: cak.started_at ?? null, replyAt: r ? (r.sent_at ?? r.created_at) : null }
}
