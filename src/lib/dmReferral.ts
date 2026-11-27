import { supabase } from './supabase'
import { isRecoverableHold, type Thread } from './inbox'
import { parseEmailCc } from './emailCc'
import { referralTarget, type ReferralDraft } from '../../supabase/functions/inbox-dm-draft/referral'

const REFERRAL_CLIENTS = ['ivan', 'arch', 'risedtc']
/** The inbound the referral card is about: a fresh handoff, or an open verified referral that later replies
 * ("You too!", an emoji) must not hide. `cached` is the referrer's stored inbox_referral. */
export function referralInbound(t: Thread, cached?: unknown, dismissed: readonly string[] = []) {
  if (t.spam || t.blacklisted || t.channel === 'email' || !REFERRAL_CLIENTS.includes(t.client_id)
    || ['archived', 'skipped', 'disqualified', 'unsubscribed', 'blacklisted'].includes(t.stage)) return null
  return referralTarget(t.messages, cached, dismissed)?.inbound ?? null
}

/** The referrer's stored referral and every handoff the operator dismissed, read before deciding whether the card shows. */
export async function readStoredReferral(prospectId: string): Promise<{ referral: unknown; dismissed: string[] }> {
  const { data, error } = await supabase.from('outreach_prospects').select('referral:enrichment_data->inbox_referral,dismissed:enrichment_data->inbox_referral_dismissed').eq('id', prospectId).single()
  if (error) throw error
  const row = data as { referral?: unknown; dismissed?: unknown } | null
  return { referral: row?.referral ?? null, dismissed: Array.isArray(row?.dismissed) ? row!.dismissed.filter((x): x is string => typeof x === 'string') : [] }
}

async function callDraft(body: Record<string, unknown>, timeout: number): Promise<Record<string, unknown>> {
  const { data } = await supabase.auth.getSession()
  if (!data.session?.access_token) throw new Error('Sign in again to research this referral.')
  const response = await window.fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/inbox-dm-draft`, {
    method: 'POST', headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
  })
  const result = await response.json()
  if (!response.ok) throw Object.assign(new Error(result.error || 'Referral research failed. Try again.'), { body: result })
  return result
}

const pending = new Map<string, Promise<ReferralDraft | null>>()
export async function requestDmReferral(t: Thread, retry = false, cached?: unknown, dismissed: readonly string[] = []): Promise<ReferralDraft | null> {
  const inbound = referralInbound(t, cached, dismissed)
  if (!inbound) return null
  // The seat is part of the key (Sol r4): a request started for another seat never answers this card.
  const stamp = `${t.client_id}:${t.prospect_id}:${inbound.id}:${retry}`
  const running = pending.get(stamp)
  if (running) return running
  const job = (async () => {
    const result = await callDraft({ prospect_id: t.prospect_id, mode: 'referral', retry }, 140_000)
    const referral = result.referral as ReferralDraft | null
    // The server may answer for the open referral when a newer reply only looked like a handoff.
    if (referral && !t.messages.some(m => m.direction === 'inbound' && m.id === referral.input_message_id)) throw new Error('The conversation changed. Refresh before researching the referral.')
    return referral
  })()
  pending.set(stamp, job)
  try { return await job } finally { pending.delete(stamp) }
}

/* REFERRED LEAD (Ivan 2026-11-20): the verified person becomes an ARCH lead with ONE held invite note on their own
   thread (approved_at and sent_at null). Davorin approves it through the normal Send; this never approves or sends. */
export const REFERRAL_LEAD_MODEL = 'inbox_referral_lead_v1'
export type ReferredLeadResult = { status: 'created' | 'linked_existing' | 'exists'; lead_prospect_id: string; stage?: string; sent?: number; drafts?: number
  /** What was staged: the InMail or the invite note. */
  channel?: 'inmail' | 'connection_note' }
/** Create asked for the InMail and none can go now: the reason, so the card shows the invite note for review. */
/** A note Create found an InMail can go now: the reason, so the card brings the InMail back for review. */
export const inmailAvailable = (e: unknown): string | null => {
  const why = (e as { body?: { inmail_available?: unknown } } | null)?.body?.inmail_available
  return typeof why === 'string' ? why : null
}
export const inmailUnavailable = (e: unknown): string | null => {
  const why = (e as { body?: { inmail_unavailable?: unknown } } | null)?.body?.inmail_unavailable
  return typeof why === 'string' ? why : null
}
/** `draft` is the invite note, or with `inmail` the InMail body (the note then rides along as the fallback). */
/** `seat` is the seat the shown draft was written for (Sol r3); Create refuses it unless the conversation is still on that seat. */
export async function createReferredLead(t: Thread, inputMessageId: string, draft: string, linkedinUrl: string, storyKey: string, seat: string, inmail?: { subject: string; note: string }): Promise<ReferredLeadResult> {
  const result = await callDraft({ prospect_id: t.prospect_id, mode: 'referral_lead', input_message_id: inputMessageId, draft, linkedin_url: linkedinUrl, story_key: storyKey, seat,
    ...(inmail ? { channel: 'inmail', subject: inmail.subject, note: inmail.note } : {}) }, 140_000)
  return result.lead as ReferredLeadResult
}
export async function dismissReferral(t: Thread, inputMessageId: string): Promise<void> {
  await callDraft({ prospect_id: t.prospect_id, mode: 'referral_dismiss', input_message_id: inputMessageId }, 30_000)
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

type ReplyRow = EmailRow & { recipient_email?: string | null }
/** A lane reply draft (or sent reply) after this handoff that already emails the same address: the ARCH and RISE
 * drafters email the person the prospect pointed us to (Yossi -> miad@, 2026-11-08), so the card must not
 * stage a second email to them. Discarded, expired and failed rows no longer count. */
export function drafterEmailRow<T extends ReplyRow>(rows: readonly T[], inbound: Pick<EmailRow, 'sent_at' | 'created_at'>, to: string): T | null {
  const after = inbound.sent_at || inbound.created_at, want = to.trim().toLowerCase()
  return rows.find(m => m.ai_model !== REFERRAL_EMAIL_MODEL && m.direction === 'outbound' && (m.sent_at || m.created_at) >= after
    && (m.recipient_email ?? '').trim().toLowerCase() === want
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
