import { supabase } from './supabase'
import { groupThreads, isInternalConfirmation, isReplyRetryExhausted, type InboxMessage, type Thread } from './inbox'


async function readThread(id: string): Promise<InboxMessage[]> {
  const { data, error } = await supabase.from('inbox_messages_v').select('*').eq('prospect_id', id)
  if (error) throw error
  if (!data?.length) throw new Error('This conversation could not be loaded.')
  return data as InboxMessage[]
}

function stamp(rows: InboxMessage[]): string {
  return JSON.stringify(rows.map(m => [m.id, m.message_text, m.sent_at, m.approved_at, m.send_blocked_reason, m.prospect_stage, m.prospect_blacklisted, m.prospect_skip_reason]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
}

/** A click creates an unapproved draft. The normal review and send controls own approval. */
export async function requestDmDraft(t: Thread): Promise<void> {
  if (!['ivan', 'arch', 'risedtc'].includes(t.client_id) || t.spam || t.blacklisted || t.stage === 'engaged' || t.channel === 'email') throw new Error('Drafting is unavailable for this conversation.')
  if (t.ownerConfirmation && !isReplyRetryExhausted(t.ownerConfirmation)) throw new Error('Add the confirmed owner answer before drafting this reply.')
  const rows = await readThread(t.prospect_id)
  if (rows.some(m => m.client_id !== t.client_id)) throw new Error('The conversation identity changed. Refresh and try again.')
  if (rows.some(m => m.prospect_blacklisted || ['archived', 'skipped', 'disqualified', 'unsubscribed', 'blacklisted', 'engaged'].includes(m.prospect_stage) || m.prospect_skip_reason)) throw new Error('This conversation is paused or closed. Refresh before drafting.')
  const hold = groupThreads(rows)[0]?.ownerConfirmation
  if (hold && (hold.id !== t.ownerConfirmation?.id || !isReplyRetryExhausted(t.ownerConfirmation))) throw new Error('Add the confirmed owner answer before drafting this reply.')
  if (rows.some(m => m.direction === 'outbound' && !m.sent_at && !m.send_blocked_at && m.message_text.trim())) throw new Error('A reply is already waiting. Refresh the conversation.')
  const conversation = rows.filter(m => m.message_text.trim() && !isInternalConfirmation(m) && (m.direction === 'inbound' || m.sent_at))
    .sort((a, b) => (a.sent_at || a.created_at).localeCompare(b.sent_at || b.created_at))
  const { data: session } = await supabase.auth.getSession()
  if (!session.session?.access_token) throw new Error('Sign in again to draft.')
  const response = await window.fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/inbox-dm-draft`, {
    method: 'POST', headers: { Authorization: `Bearer ${session.session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prospect_id: t.prospect_id }), signal: AbortSignal.timeout(140_000),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Drafting failed. Try again.')
  if (!result || typeof result.reply !== 'string' || !result.reply.trim()) throw new Error(typeof result?.reason === 'string' ? result.reason : 'The drafter returned no reply. Try again.')
  const reply = result.reply.trim()
  if (reply.length > 8000) throw new Error('The draft was too long. Try again.')
  if (JSON.stringify([...(result.input_message_ids ?? [])].sort()) !== JSON.stringify(conversation.map(m => m.id).sort())) throw new Error('The conversation changed while drafting. Refresh and try again.')
  if (stamp(await readThread(t.prospect_id)) !== stamp(rows)) throw new Error('The conversation changed while drafting. Refresh and try again.')
  const { error: saveError } = await supabase.from('outreach_messages').insert({
    id: crypto.randomUUID(), prospect_id: t.prospect_id, direction: 'outbound', channel: 'linkedin', message_type: 'dm',
    message_text: reply, ai_model: 'inbox_on_demand_reply', sequence_step: null, sent_at: null, approved_at: null,
    draft_evidence: { v: 'inbox_on_demand_reply_v1', generated_text: reply, input_message_ids: conversation.map(m => m.id), model: result.model ?? null, facts: result.sources ?? [] },
  })
  if (saveError) throw saveError
}
