import { emailRowSender, type InboxMessage, type Thread } from './inbox'
import { splitEmailDraft } from './emailSubject'

export type EmailDetails = {
  subject: string | null; body: string; from: string | null; fromName: string | null
  to: string[]; cc: string[]; date: string | null; messageId: string | null
  replyToMessageId: string | null; references: string | null
  html?: string | null
}

export type EmailMetadata = {
  generated_text?: string | null; subject?: string | null; from?: string | null; from_name?: string | null
  to?: string | string[] | null; cc?: string | string[] | null; message_id?: string | null
  references?: string | null; in_reply_to?: string | null; resend_id?: string | null
  our_mailbox?: string | null
}

export type EmailDetailRow = {
  id: string; prospect_id: string; recipient_email?: string | null; email_mirror_text?: string | null
  email_metadata?: EmailMetadata | null; email_subject?: string | null; email_cc?: string[] | null
  email_headers?: Record<string, string> | null
}

const nonempty = (s?: string | null) => typeof s === 'string' && s.trim() ? s.trim() : null
const address = (s?: string | null) => nonempty(s?.match(/<([^<>]+)>/)?.[1] ?? s)
const addresses = (v?: string | string[] | null) => [...new Set((Array.isArray(v) ? v : v ? [v] : []).flatMap(s => s.split(/[,;]+/)).map(address).filter((s): s is string => !!s))]
const senderName = (s?: string | null) => nonempty(s?.match(/^\s*"?([^"<]+?)"?\s*</)?.[1])

/** Mirrors the existing clientEmailPayload send boundary; only escaped text enters this HTML. */
function clientEmailPayload(input: string, from: string | null): { body: string; html?: string } {
  const cfg = from === 'davorin@madebyarch.com' ? { name: 'Davorin Šmit', first: 'Davorin', company: 'ARCH', url: 'https://arch.agency' }
    : from === 'itsmattan@risedtc.com' ? { name: 'Mattan Danino', first: 'Mattan', company: 'RISE', url: 'https://risedtc.com' } : null
  if (!cfg) return { body: input }
  const oldSignature = new RegExp('\\n\\s*(?:(?:Cheers|Best|Regards|Thanks)[,!]?\\s*\\n)?' + cfg.first + '(?: ' + (cfg.first === 'Davorin' ? '(?:Smit|Šmit)' : 'Danino') + ')?\\s*(?:\\n(?:RISE(?: DTC)?|Arch))?\\s*(?:\\n(?:https?:\\/\\/)?(?:www\\.)?(?:risedtc\\.com|arch\\.agency)\\/?)?\\s*$', 'i')
  const body = input.trim().replace(oldSignature, '').trimEnd()
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  const htmlText = body.split(/(https?:\/\/[^\s<>]+)/g).map((s, i) => i % 2 ? '<a href="' + escape(s) + '" style="color:#222;text-decoration:underline">' + escape(s) + '</a>' : escape(s)).join('').replace(/\n/g, '<br>')
  const domain = cfg.url.replace('https://', '')
  return { body: body + '\n\nCheers,\n' + cfg.name + '\n' + cfg.company + '\n' + domain,
    html: '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#222">' + htmlText + '<div style="margin-top:24px">Cheers,</div><table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:12px;border-collapse:collapse"><tr><td style="border-left:2px solid #222;padding-left:14px;font-family:Arial,Helvetica,sans-serif"><div style="font-size:16px;line-height:1.4;font-weight:700;color:#161616">' + cfg.name + '</div><div style="font-size:11px;line-height:1.8;letter-spacing:1px;color:#666">' + cfg.company + '</div><a href="' + cfg.url + '" style="font-size:12px;line-height:1.8;color:#222;text-decoration:none">' + domain + '</a></td></tr></table></div>' }
}

/** Keep draft fields aligned with each dispatcher's actual Subject-line parser. */
export function splitEmailForSend(text: string, options: { subject?: string | null; transport?: 'native' | 'mirror' } = {}): { subject: string; body: string } {
  if (options.transport === 'mirror') {
    const header = text.match(/^[ \t]*Subject:[ \t]*(.+?)[ \t]*\r?\n/i)
    return header ? { subject: header[1].trim(), body: text.slice(header[0].length).replace(/^\s+/, '') }
      : { subject: options.subject ?? '', body: text }
  }
  const lines = text.split('\n')
  for (let i = 0; i < Math.min(lines.length, 3); i++) {
    const line = lines[i].trim().replace(/\*\*/g, '').trim()
    if (!line.toLowerCase().startsWith('subject:')) continue
    let start = i + 1
    if (start < lines.length && !lines[start].trim()) start++
    return { subject: line.replace(/^subject:?\s*/i, '').trim(), body: lines.slice(start).join('\n') }
  }
  return { subject: options.subject ?? '', body: text }
}

export function emailPreview(text: string, options: { subject?: string | null; from?: string | null; to?: string[]; cc?: string[]; replyToMessageId?: string | null; formatForSend?: boolean; transport?: 'native' | 'mirror' } = {}): EmailDetails {
  const { subject, body } = options.formatForSend === false ? splitEmailDraft(text) : splitEmailForSend(text, options)
  const from = address(options.from)
  const rendered = options.formatForSend === false ? { body } : clientEmailPayload(options.transport === 'mirror' ? body : body.trim().replace(/\*\*/g, '').split(/^[ \t]*-{3,}[ \t\r]*$/m).map(s => s.trim()).filter(Boolean).join('\n\n'), from)
  return { subject: nonempty(subject) ?? (options.formatForSend === false ? nonempty(options.subject) : null), ...rendered, from, fromName: senderName(options.from),
    to: addresses(options.to), cc: addresses(options.cc), date: null, messageId: null,
    replyToMessageId: options.replyToMessageId ?? null, references: null }
}

/** Sent mirror rows omit Subject: from the body. Recover only an exact, unambiguous sent pair. */
function mirrorSubject(m: InboxMessage, t?: Thread): string | null {
  if (!t || m.direction !== 'outbound' || !m.sent_at) return null
  const matches = t.messages.filter(row => row.id !== m.id && row.sent_at && row.prospect_id === m.prospect_id && row.client_id === m.client_id
    && row.recipient_email === m.recipient_email && row.email_mirror_text
    && splitEmailDraft(row.email_mirror_text).body.trim() === m.message_text.trim())
  const subjects = [...new Set(matches.map(row => splitEmailDraft(row.email_mirror_text!).subject).filter(Boolean))]
  return subjects.length === 1 ? subjects[0] : null
}

export function emailDetails(m: InboxMessage, t?: Thread): EmailDetails {
  const em = m.draft_evidence?.email
  const headers = m.draft_evidence?.email_headers
  const saved = m.email_details
  const incoming = m.direction === 'inbound'
  const own = ['ivan', 'arch', 'risedtc', 'swishdm'].includes(m.client_id) ? emailRowSender(m.client_id) : null
  const preview = emailPreview(m.message_text ?? '', {
    subject: saved?.subject ?? em?.subject ?? m.draft_evidence?.email_subject ?? mirrorSubject(m, t),
    from: saved?.from ?? em?.from ?? (incoming ? m.recipient_email || m.prospect_email : own),
    to: saved?.to ?? (incoming ? addresses(em?.to).length ? addresses(em?.to) : addresses(em?.our_mailbox ?? own) : addresses(m.recipient_email || m.prospect_email)),
    cc: saved?.cc ?? (incoming && em?.cc != null ? addresses(em.cc) : m.email_cc ?? m.draft_evidence?.email_cc ?? addresses(em?.cc)),
    replyToMessageId: saved?.replyToMessageId ?? headers?.['In-Reply-To'] ?? em?.in_reply_to,
    formatForSend: false,
  })
  return { ...preview, fromName: saved?.fromName ?? nonempty(em?.from_name) ?? senderName(em?.from)
    ?? (incoming ? nonempty(m.prospect_name) : ({ arch: 'Davorin', risedtc: 'Mattan', swishdm: 'Jonathan', ivan: 'You' }[m.client_id] ?? null)),
    date: m.sent_at ?? m.created_at, messageId: saved?.messageId ?? nonempty(em?.message_id),
    references: saved?.references ?? nonempty(headers?.References ?? em?.references) }
}

/** Apply the open thread's small envelope read to copies, preserving the caller's message text. */
export function hydrateEmailDetails(t: Thread, rows: readonly EmailDetailRow[]): Thread {
  const byId = new Map(rows.filter(r => r.prospect_id === t.prospect_id).map(r => [r.id, r]))
  const messages = t.messages.map(m => {
    const r = byId.get(m.id)
    if (!r) return { ...m }
    return { ...m, email_details: undefined,
      recipient_email: r.recipient_email ?? m.recipient_email,
      email_mirror_text: m.email_mirror_text ?? r.email_mirror_text,
      draft_evidence: { ...m.draft_evidence, email: { ...m.draft_evidence?.email, ...r.email_metadata },
        email_subject: r.email_subject ?? m.draft_evidence?.email_subject,
        email_cc: r.email_cc ?? m.draft_evidence?.email_cc, email_headers: r.email_headers ?? m.draft_evidence?.email_headers } }
  })
  const next = { ...t, messages }
  for (const m of messages) if (m.channel === 'email') m.email_details = emailDetails(m, next)
  return { ...next, last: messages.find(m => m.id === t.last.id) ?? t.last,
    draft: messages.find(m => m.id === t.draft?.id) ?? t.draft,
    companionDraft: messages.find(m => m.id === t.companionDraft?.id) ?? t.companionDraft }
}
