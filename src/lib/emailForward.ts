import { supabase } from './supabase'

export const forwardRecipient = (client: string) => client === 'arch' ? 'davorinsmit@arch.agency' : client === 'risedtc' ? 'mattan@risedtc.com' : ''
export const validForwardRecipient = (value: string) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value.trim())

export async function forwardInboxEmail(messageId: string, to: string, note: string, requestId: string): Promise<string> {
  if (!validForwardRecipient(to)) throw new Error('Enter one valid email address.')
  const { data, error } = await supabase.functions.invoke('inbox-email-forward', {
    body: { message_id: messageId, to: to.trim(), note, request_id: requestId },
  })
  if (error) {
    let detail = error.message
    if (error.context instanceof Response) {
      try { detail = (await error.context.json()).error || detail } catch { /* Keep the transport error. */ }
    }
    throw new Error(detail || 'Forwarding failed. Try again.')
  }
  if (!data?.ok || typeof data.email_id !== 'string') throw new Error(data?.error || 'The email service did not confirm the forward. Try again.')
  return data.email_id
}
