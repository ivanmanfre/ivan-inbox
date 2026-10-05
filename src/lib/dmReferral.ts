import { supabase } from './supabase'
import type { Thread } from './inbox'
import { referralCandidate, type ReferralDraft } from '../../supabase/functions/inbox-dm-draft/referral'

export function referralInbound(t: Thread) {
  if (t.spam || t.blacklisted || t.channel === 'email' || !['ivan', 'arch', 'risedtc'].includes(t.client_id)
    || ['archived', 'skipped', 'disqualified', 'unsubscribed', 'blacklisted'].includes(t.stage)) return null
  const last = t.messages.filter(m => m.direction === 'inbound').sort((a, b) => (a.sent_at || a.created_at).localeCompare(b.sent_at || b.created_at)).at(-1)
  return last && referralCandidate(last.message_text) ? last : null
}

const pending = new Map<string, Promise<ReferralDraft | null>>()
export async function requestDmReferral(t: Thread, retry = false): Promise<ReferralDraft | null> {
  const inbound = referralInbound(t)
  if (!inbound) return null
  const stamp = `${t.prospect_id}:${inbound.id}:${retry}`
  const running = pending.get(stamp)
  if (running) return running
  const job = (async () => {
    const { data } = await supabase.auth.getSession()
    if (!data.session?.access_token) throw new Error('Sign in again to research this referral.')
    const response = await window.fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/inbox-dm-draft`, {
      method: 'POST', headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prospect_id: t.prospect_id, mode: 'referral', retry }), signal: AbortSignal.timeout(140_000),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Referral research failed. Try again.')
    if (result.referral && result.referral.input_message_id !== inbound.id) throw new Error('The conversation changed. Refresh before researching the referral.')
    return result.referral as ReferralDraft | null
  })()
  pending.set(stamp, job)
  try { return await job } finally { pending.delete(stamp) }
}
