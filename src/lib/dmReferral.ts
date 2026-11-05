import { supabase } from './supabase'
import { isRecoverableHold, type Thread } from './inbox'
import { parseEmailCc } from './emailCc'
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

/* ==========================================================================
   REFERRAL EMAIL (Ivan 2026-11-05, Éléa G. -> Gambit: "we should be able to send
   emails too"). The handoff gave the person's address, so the card offers the
   first email. Staging writes ONE unapproved channel='email' row on the
   referrer's thread; the normal Send owns approval, and Send Messages mails it
   from the seat's own identity (davorin@ / itsmattan@ / im@). The referred
   person's reply matches back to this thread by the address we emailed.
   ========================================================================== */
export const REFERRAL_EMAIL_MODEL = 'inbox_referral_email_v1'
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/

type EmailRow = Pick<Thread['messages'][number], 'ai_model' | 'direction' | 'sent_at' | 'created_at' | 'send_blocked_reason' | 'send_blocked_at' | 'approved_at'>
/** The referral email still live for this handoff (written after it): sent, approved, or a pending draft.
 * A discarded, expired (the ARCH drafter's 3-day expiry) or failed row no longer counts, so it can be staged again. */
export function referralEmailRow<T extends EmailRow>(rows: readonly T[], inbound: Pick<EmailRow, 'sent_at' | 'created_at'>): T | null {
  const after = inbound.sent_at || inbound.created_at
  return rows.find(m => m.ai_model === REFERRAL_EMAIL_MODEL && m.direction === 'outbound' && (m.sent_at || m.created_at) >= after
    && (m.sent_at || m.approved_at || !m.send_blocked_at || isRecoverableHold(m.send_blocked_reason ?? null))) ?? null
}

export async function stageReferralEmail(t: Thread, inbound: { id: string; sent_at: string | null; created_at: string }, email: { to: string; cc: string[]; subject: string; body: string }, referredName: string | null, referredCompany: string | null = null): Promise<void> {
  if (!['ivan', 'arch', 'risedtc'].includes(t.client_id)) throw new Error('Email is unavailable for this conversation.')
  const to = email.to.trim(), subject = email.subject.replace(/\s+/g, ' ').trim(), body = email.body.trim()
  const cc = parseEmailCc(email.cc)
  if (!EMAIL.test(to)) throw new Error('Enter a valid To address.')
  if (cc.some(a => a.toLowerCase() === to.toLowerCase())) throw new Error('The To address is also on Cc.')
  if (!subject || subject.length > 150) throw new Error('Add a subject line.')
  if (!body || body.length > 5000) throw new Error('The email is empty.')
  const { data, error } = await supabase.from('outreach_messages').select('ai_model,direction,sent_at,created_at,send_blocked_reason,send_blocked_at,approved_at').eq('prospect_id', t.prospect_id).eq('ai_model', REFERRAL_EMAIL_MODEL)
  if (error) throw error
  if (referralEmailRow((data ?? []) as EmailRow[], inbound)) throw new Error('This email is already in the draft. Refresh the conversation.')
  const { error: saveError } = await supabase.from('outreach_messages').insert({
    id: crypto.randomUUID(), prospect_id: t.prospect_id, direction: 'outbound', channel: 'email', message_type: 'email',
    message_text: `Subject: ${subject}\n\n${body}`, recipient_email: to, ai_model: REFERRAL_EMAIL_MODEL, sequence_step: null,
    // sent_at defaults to now() at the column level; null keeps it an unapproved draft.
    sent_at: null, approved_at: null,
    draft_evidence: { v: REFERRAL_EMAIL_MODEL, email_subject: subject, ...(cc.length ? { email_cc: cc } : {}), referral_input_message_id: inbound.id, referred_name: referredName, referred_company: referredCompany },
  })
  if (saveError) throw saveError
}
