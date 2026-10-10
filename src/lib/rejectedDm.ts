import { isEngineRetired, isInternalConfirmation, type InboxMessage } from './inbox'
import { supabase } from './supabase'

export function canSendRejectedDm(m: InboxMessage & { unipile_message_id?: string | null }): boolean {
  return m.direction === 'outbound' && !m.sent_at && !m.unipile_message_id && !!m.message_text?.trim()
    && !!m.send_blocked_at && !!m.send_blocked_reason && !isEngineRetired(m) && !isInternalConfirmation(m)
    && !/^(discarded|superseded|scheduled)(?:_|$)/.test(m.send_blocked_reason)
    && !/^native_email_send_failed:/.test(m.send_blocked_reason)
}

/** Requeue the original row. The database compares the visible rejection before recording the override. */
export async function sendRejectedDm(m: InboxMessage, chatId?: string | null): Promise<void> {
  if (!canSendRejectedDm(m)) throw new Error('This draft is no longer rejected. Refresh before sending.')
  const { data, error: readError } = await supabase.from('outreach_messages').select('draft_evidence').eq('id', m.id).single()
  if (readError) throw readError
  const { error } = await supabase.rpc('send_rejected_inbox_draft', {
    p_message_id: m.id, p_text: m.message_text, p_expected_reason: m.send_blocked_reason,
    p_expected_blocked_at: m.send_blocked_at, p_expected_approved_at: m.approved_at,
    p_expected_evidence: data?.draft_evidence ?? null, p_chat_id: chatId ?? null,
  })
  if (error) throw error
}
