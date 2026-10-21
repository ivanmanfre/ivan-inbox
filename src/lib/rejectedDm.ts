import { draftSendVia, isEngineRetired, isHeldSend, isIntentionalStop, isInternalConfirmation, isUnreachableRecipient, isSwishdmRow, SWISHDM_REPLY_HOLD, type InboxMessage } from './inbox'
import { supabase } from './supabase'

export function canSendRejectedDm(m: InboxMessage & { unipile_message_id?: string | null }): boolean {
  return !(draftSendVia(m) === 'email' && m.channel !== 'email') && m.direction === 'outbound' && !m.sent_at && !m.unipile_message_id && !!m.message_text?.trim()
    && !!m.send_blocked_at && !!m.send_blocked_reason && !isEngineRetired(m) && !isInternalConfirmation(m)
    && m.send_blocked_reason !== SWISHDM_REPLY_HOLD   // a SwishDM review hold is released only by approve_swishdm_reply_draft, never by an override
    && !isSwishdmRow(m)        // SwishDM rows are sent only by the SwishDM senders (send_rejected_inbox_draft refuses them too, db/294)
    && !isIntentionalStop(m)   // an invite-instead / replied / excluded stop is not a rejection to override
    && !/^(discarded|superseded|scheduled)(?:_|$)/.test(m.send_blocked_reason)
    && !/^native_email_send_failed:/.test(m.send_blocked_reason)
    && !isUnreachableRecipient(m.send_blocked_reason)   // LinkedIn will not deliver to this person: Send anyway only burns a slot (send audit 10-21)
    && !m.send_blocked_reason.includes('no_connection_with_recipient')   // not connected: the same 422 comes back until an invite is accepted
}

/** Requeue the original row. The database compares the visible rejection before recording the override. */
export async function sendRejectedDm(m: InboxMessage, chatId?: string | null): Promise<void> {
  if (isSwishdmRow(m)) throw new Error('SwishDM messages are sent only by the SwishDM senders. Nothing was sent.')
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

/** A held message can be edited where it can be sent anyway, except a DM + email pair: the box edits
 *  one text, and the email leg would still go out with the old words. */
export function canEditHeldDm(m: InboxMessage & { unipile_message_id?: string | null }): boolean {
  return isHeldSend(m) && canSendRejectedDm(m) && draftSendVia(m) !== 'both'
}

/** Ivan 10-21 (Leighton Penrose): edit a held message and keep it held. The database compares the text,
 *  hold, approval and evidence on screen, records the edit in draft_evidence.operator_edits and clears the
 *  approval (the new words were never approved). Sending stays on sendRejectedDm. */
export async function editHeldDm(m: InboxMessage, text: string): Promise<void> {
  if (isSwishdmRow(m)) throw new Error('SwishDM messages are sent only by the SwishDM senders. Nothing was sent.')
  if (!canEditHeldDm(m)) throw new Error('This message is no longer held. Refresh before editing.')
  if (!text.trim()) throw new Error('The message is empty.')
  const { data, error: readError } = await supabase.from('outreach_messages').select('draft_evidence').eq('id', m.id).single()
  if (readError) throw readError
  const { error } = await supabase.rpc('edit_held_inbox_draft', {
    p_message_id: m.id, p_text: text, p_expected_text: m.message_text, p_expected_reason: m.send_blocked_reason,
    p_expected_blocked_at: m.send_blocked_at, p_expected_approved_at: m.approved_at, p_expected_evidence: data?.draft_evidence ?? null,
  })
  if (error) throw error
}
