import { useEffect, useState } from 'react'
import type { Thread } from '../../lib/inbox'
import { drafterEmailRow, referralEmailRow, referralInbound, requestDmReferral, stageReferralEmail } from '../../lib/dmReferral'
import type { ReferralDraft, ReferralEmail } from '../../../supabase/functions/inbox-dm-draft/referral'
import { ReferredLeadCard } from './ReferredLeadCard'
import { threadEmailSender } from '../../lib/inbox'

export function ReferralCard({ t, onUseAcknowledgement, onStaged }: { t: Thread; onUseAcknowledgement?: (text: string) => void; onStaged?: () => void }) {
  const inbound = referralInbound(t)
  const stamp = inbound ? `${t.prospect_id}:${inbound.id}` : ''
  const [retry, setRetry] = useState(0)
  const [state, setState] = useState<{ stamp: string; data: ReferralDraft | null; error: string | null } | null>(null)
  const [copied, setCopied] = useState<'dm' | 'ack' | null>(null)
  const [copyError, setCopyError] = useState(false)
  useEffect(() => {
    if (!stamp) return
    let current = true
    setState(null); setCopied(null); setCopyError(false)
    void requestDmReferral(t, retry > 0).then(data => {
      if (current) setState({ stamp, data, error: null })
    }).catch(e => {
      if (current) setState({ stamp, data: null, error: e instanceof Error ? e.message : 'Research could not finish.' })
    })
    return () => { current = false }
  }, [stamp, retry]) // eslint-disable-line react-hooks/exhaustive-deps
  if (t.messages.some(m => m.ai_model === 'arch_referral_package_v1')) return <ReferredLeadCard key={t.prospect_id} t={t} />
  if (!stamp) return null
  const result = state?.stamp === stamp ? state : null
  const r = result?.data
  const contact = r?.lead_prospect_id ? null : r?.status === 'verified' ? r : r?.candidate
  const answered = inbound && t.messages.some(m => m.direction === 'outbound' && m.sent_at && m.sent_at > (inbound.sent_at || inbound.created_at))
  if (r?.status === 'none') return null
  const copy = async (kind: 'dm' | 'ack') => {
    try { await navigator.clipboard.writeText(kind === 'ack' ? r!.acknowledgement! : contact!.draft!); setCopied(kind); setCopyError(false) }
    catch { setCopyError(true) }
  }
  return <section className="dm-referral dm-src" aria-label="Referred contact">
    <h3>{r?.status === 'verified' ? `Draft for ${r.name}` : 'Referred contact'}</h3>
    {!result && <p role="status">Researching the referred person and preparing a DM for review…</p>}
    {result?.error && <p role="alert">{result.error}</p>}
    {r?.acknowledgement && !answered && !t.draft && <>
      <h4>Acknowledgement to {t.prospect_name.split(' ')[0]}</h4>
      <textarea aria-label={`Acknowledgement draft for ${t.prospect_name}`} readOnly value={r.acknowledgement} rows={2} />
      <div className="dm-referral-actions">
        {onUseAcknowledgement && <button type="button" className="dm-k" onClick={() => onUseAcknowledgement(r.acknowledgement!)}>Use acknowledgement</button>}
        <button type="button" className="dm-k" onClick={() => void copy('ack')}>{copied === 'ack' ? 'Copied acknowledgement' : 'Copy acknowledgement'}</button>
      </div>
      <p className="dm-meta">Review before sending.</p>
    </>}
    {r?.status === 'unresolved' && !r.lead_prospect_id && <p>{r.reason || 'The referred person needs clarification.'}</p>}
    {r?.lead_prospect_id && <a className="d-link" href={`#exp/d/dms?thread=${encodeURIComponent(r.lead_prospect_id)}`}>Open referred lead</a>}
    {contact && <>
      {r?.candidate && <h4>Possible match: {contact.name}</h4>}
      <p>{contact.summary}</p>
      <p className="dm-meta">Draft from {t.client_id === 'swishdm' ? 'Jonathan' : t.client_id === 'risedtc' ? 'Mattan' : t.client_id === 'arch' ? 'Davorin' : 'Ivan'}. Review it on LinkedIn. Connection status has not been checked.</p>
      <textarea aria-label={`DM draft for ${contact.name}`} readOnly value={contact.draft ?? ''} rows={5} />
      <div className="dm-referral-actions">
        <button type="button" className="dm-k" onClick={() => void copy('dm')}>{copied === 'dm' ? 'Copied' : 'Copy DM'}</button>
        <a className="d-link" href={contact.linkedin_url!} target="_blank" rel="noreferrer">Open LinkedIn profile</a>
      </div>
      <details><summary>Research sources</summary>{contact.sources.map(s => <a className="d-link" key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.title}</a>)}</details>
    </>}
    {r?.email && inbound && <ReferralEmailDraft key={stamp} t={t} inbound={inbound} email={r.email} referredName={r.name} referredCompany={r.company} onStaged={onStaged} />}
    {r?.email_reason && <p>{r.email_reason}</p>}
    {copyError && <p role="alert">Could not copy. Select the draft above and copy it.</p>}
    {(result?.error || r?.email_reason || r?.status === 'unresolved' && !r.lead_prospect_id) && <button type="button" className="dm-k" onClick={() => setRetry(n => n + 1)}>Retry research</button>}
  </section>
}

/** The first email to the referred person. Adding it writes an unapproved draft; Send approves it. */
function ReferralEmailDraft({ t, inbound, email, referredName, referredCompany, onStaged }: { t: Thread; inbound: Thread['messages'][number]; email: ReferralEmail; referredName: string | null; referredCompany: string | null; onStaged?: () => void }) {
  const [to, setTo] = useState(email.to)
  const [cc, setCc] = useState(email.cc.join(', '))
  const [subject, setSubject] = useState(email.subject)
  const [body, setBody] = useState(email.body)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState(false)
  const first = (referredName ?? '').split(' ')[0] || 'them'
  const from = threadEmailSender(t)
  const row = referralEmailRow(t.messages, inbound)
  // The optimistic "added" holds only until the refreshed thread shows the row; a later discard brings the form back.
  useEffect(() => { if (row) setAdded(false) }, [row])
  const drafted = row ? null : drafterEmailRow(t.messages, inbound, email.to)
  if (drafted) return <p className="dm-meta">{drafted.sent_at ? `Email sent to ${email.to}.` : `The reply draft below already emails ${email.to}.`}</p>
  if (row?.sent_at) return <p className="dm-meta">Email sent to {row.recipient_email ?? to}.</p>
  if (row || added) return <p className="dm-meta">The email to {first} is in the draft below. Send approves it (from {from}).</p>
  const add = async () => {
    setBusy(true); setError(null)
    try { await stageReferralEmail(t, inbound, { to, cc: cc.split(/[,;\s]+/).filter(Boolean), subject, body }, referredName, referredCompany); setAdded(true); onStaged?.() }
    catch (e) { setError(e instanceof Error ? e.message : 'The email could not be added. Try again.') }
    finally { setBusy(false) }
  }
  return <>
    <h4>Email to {first}</h4>
    <p className="dm-meta">From {from}. Their reply comes back to this conversation.</p>
    <label className="dm-email-field"><span className="dm-email-field-name">To</span><input aria-label="Referral email To" value={to} onChange={e => setTo(e.target.value)} disabled={busy} /></label>
    <label className="dm-email-field"><span className="dm-email-field-name">Cc</span><input aria-label="Referral email Cc" value={cc} onChange={e => setCc(e.target.value)} disabled={busy} /></label>
    <label className="dm-email-field"><span className="dm-email-field-name">Subject</span><input aria-label="Referral email subject" value={subject} onChange={e => setSubject(e.target.value)} disabled={busy} /></label>
    <textarea aria-label={`Email draft for ${first}`} value={body} onChange={e => setBody(e.target.value)} rows={7} disabled={busy} />
    <div className="dm-referral-actions">
      <button type="button" className="dm-k" disabled={busy || !to.trim() || !subject.trim() || !body.trim()} onClick={() => void add()}>{busy ? 'Adding…' : 'Add email to draft'}</button>
    </div>
    {error && <p role="alert">{error}</p>}
    <p className="dm-meta">Nothing is sent until you press Send on the draft.</p>
  </>
}
