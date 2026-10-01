import { supabase } from './supabase'
import { threadChatId, type Thread } from './inbox'
export const SCHEDULE_HOLD = 'scheduled_in_inbox'
export const SCHEDULE_REVIEW = 'post_approval_race:scheduled_thread_changed'
export const scheduleHeld = (reason: string | null) => reason === SCHEDULE_HOLD || reason === SCHEDULE_REVIEW
export type ScheduledDm = { id: string; message_text: string; channel: string; at: string; timezone: string; ids: string[]; state?: string }
export async function fetchScheduledDms(prospectId: string): Promise<ScheduledDm[]> {
  const { data, error } = await supabase.from('outreach_messages').select('id,message_text,channel,draft_evidence')
    .eq('prospect_id', prospectId).in('send_blocked_reason', [SCHEDULE_HOLD, SCHEDULE_REVIEW]).is('sent_at', null).is('approved_at', null)
  if (error) throw error
  return (data ?? []).map(m => ({ id: m.id, message_text: m.message_text, channel: m.channel, ...m.draft_evidence.scheduled_send }))
}
export async function scheduleDm(t: Thread, ids: string[], texts: string[], at: string, timezone: string): Promise<void> {
  const { error } = await supabase.rpc('schedule_inbox_dm', {
    p_prospect_id: t.prospect_id, p_message_ids: ids, p_texts: texts, p_at: at, p_timezone: timezone, p_chat_id: threadChatId(t),
  })
  if (error) throw error
}
export async function cancelScheduledDm(id: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_scheduled_inbox_dm', { p_message_id: id })
  if (error) throw error
}
export function scheduleError(e: unknown): string {
  return e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Could not save the scheduled send. Try again.'
}
