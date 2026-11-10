import { supabase } from './supabase'
import type { InboxMessage } from './inbox'

/** SwishDM short-offer leads get their ChatGPT/Gemini check only after they accept the invite
 *  (enrichment_data.swishdm_auto.check_after_accept). A reply that lands before the first message while
 *  that check is 'pending' is not drafted yet: the reply drafter (Accept + Reply Detector, triage) waits
 *  for the check so the offer carries a fair finding, up to 24 h after the reply. Stacey Wilhelm, 11-10:
 *  the pane said "no draft, write it yourself" during that wait. */
export type CheckWait = { startedAt: string | null }

type Raw = { state?: string; started_at?: string | null; reason?: string }
type Msg = Pick<InboxMessage, 'direction' | 'message_type' | 'sent_at' | 'created_at'>

const WAIT_MS = 24 * 3600e3   // triage.js CHECK_WAIT_MS

export function readCheckWait(cak: Raw | null, messages: readonly Msg[], now: number): CheckWait | null {
  if (!cak || cak.state !== 'pending') return null
  if (messages.some(m => m.direction === 'outbound' && m.sent_at && (m.message_type === 'dm' || m.message_type === 'inmail'))) return null
  const lastIn = messages.filter(m => m.direction === 'inbound').at(-1)
  const at = lastIn ? Date.parse(lastIn.sent_at ?? lastIn.created_at) : NaN
  if (!Number.isFinite(at) || now - at >= WAIT_MS) return null
  return { startedAt: cak.started_at ?? null }
}

export type CheckState = Raw

export async function fetchCheckState(prospectId: string): Promise<CheckState | null> {
  const { data, error } = await supabase.from('outreach_prospects')
    .select('cak:enrichment_data->swishdm_auto->check_after_accept').eq('id', prospectId).single()
  if (error) throw error
  return (data as { cak: Raw | null }).cak
}
