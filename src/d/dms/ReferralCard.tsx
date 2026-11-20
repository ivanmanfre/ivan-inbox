import { useEffect, useState } from 'react'
import type { Thread } from '../../lib/inbox'
import { createReferredLead, dismissReferral, drafterEmailRow, readStoredReferral, REFERRAL_LEAD_MODEL, referralEmailRow, referralInbound, requestDmReferral, stageReferralEmail, type ReferredLeadResult } from '../../lib/dmReferral'
import { INVITE_NOTE_LIMIT, laterChecked, laterInbound, type ReferralDraft, type ReferralEmail } from '../../../supabase/functions/inbox-dm-draft/referral'
import { ReferredLeadCard } from './ReferredLeadCard'
import { threadEmailSender } from '../../lib/inbox'

const inboundStamp = (t: Thread) => t.messages.filter(m => m.direction === 'inbound').map(m => m.id).join(',')

export function ReferralCard({ t, onUseAcknowledgement, onStaged }: { t: Thread; onUseAcknowledgement?: (text: string) => void; onStaged?: () => void }) {
  // The stored referral decides whether a verified handoff stays open after later replies, so read it first.
  const [stored, setStored] = useState<{ key: string; value: unknown } | null>(null)
  const storedKey = `${t.prospect_id}:${inboundStamp(t)}`
  const isLead = t.messages.some(m => m.ai_model === REFERRAL_LEAD_MODEL)
  const eligible = ['ivan', 'arch', 'risedtc'].includes(t.client_id) && !t.spam && !t.blacklisted
  useEffect(() => {
    if (isLead || !eligible) return
    let current = true
    void readStoredReferral(t.prospect_id).then(value => { if (current) setStored({ key: storedKey, value }) })
      .catch(() => { if (current) setStored({ key: storedKey, value: null }) })
    return () => { current = false }
  }, [storedKey, isLead, eligible]) // eslint-disable-line react-hooks/exhaustive-deps
  const cached = stored?.key === storedKey ? stored.value : undefined
  const inbound = cached === undefined ? null : referralInbound(t, cached)
  const stamp = inbound ? `${t.prospect_id}:${inbound.id}` : ''
  const [retry, setRetry] = useState(0)
  const [state, setState] = useState<{ stamp: string; data: ReferralDraft | null; error: string | null } | null>(null)
  const [copied, setCopied] = useState<'dm' | 'ack' | null>(null)
  const [copyError, setCopyError] = useState(false)
  const [note, setNote] = useState<{ stamp: string; text: string } | null>(null)
  const [acting, setActing] = useState<{ busy: boolean; error: string | null; lead: ReferredLeadResult | null; dismissed: boolean }>({ busy: false, error: null, lead: null, dismissed: false })
  useEffect(() => {
    if (!stamp) return
    let current = true
    setState(null); setCopied(null); setCopyError(false); setNote(null); setActing({ busy: false, error: null, lead: null, dismissed: false })
    void requestDmReferral(t, retry > 0, cached).then(data => {
      if (current) setState({ stamp, data, error: null })
    }).catch(e => {
      if (current) setState({ stamp, data: null, error: e instanceof Error ? e.message : 'Research could not finish.' })
    })
    return () => { current = false }
  }, [stamp, retry]) // eslint-disable-line react-hooks/exhaustive-deps
  if (t.messages.some(m => m.ai_model === 'arch_referral_package_v1')) return <ReferredLeadCard key={t.prospect_id} t={t} />
  if (isLead) return <ReferredFrom t={t} />
  if (!stamp || acting.dismissed) return null
  const result = state?.stamp === stamp ? state : null
  const r = result?.data
  const leadId = acting.lead?.lead_prospect_id ?? r?.lead_prospect_id
  const contact = leadId ? null : r?.status === 'verified' ? r : r?.candidate
  const handoff = r ? t.messages.find(m => m.id === r.input_message_id) ?? inbound : inbound
  const answered = handoff && t.messages.some(m => m.direction === 'outbound' && m.sent_at && m.sent_at > (handoff.sent_at || handoff.created_at))
  if (r?.status === 'none') return null
  const referrer = t.prospect_name.split(' ')[0]
  const person = (r?.name ?? '').split(' ')[0] || 'them'
  // What the referrer wrote after the handoff, as read by the model: thanks or an emoji leave it open.
  const later = r?.status === 'verified' ? laterInbound(t.messages, r.input_message_id) : []
  const unchecked = r?.status === 'verified' && !laterChecked(r, later)
  const paused = r?.status === 'verified' && later.length > 0 && !unchecked && r.later?.verdict !== 'go' ? r.later : null
  const canCreate = t.client_id === 'arch' && r?.status === 'verified' && !leadId && !r.dismissed_at && !!r.draft && !paused && !unchecked
  const noteText = note?.stamp === stamp ? note.text : contact?.draft ?? ''
  const copy = async (kind: 'dm' | 'ack') => {
    try { await navigator.clipboard.writeText(kind === 'ack' ? r!.acknowledgement! : contact!.draft!); setCopied(kind); setCopyError(false) }
    catch { setCopyError(true) }
  }
  const create = async () => {
    setActing(a => ({ ...a, busy: true, error: null }))
    try { const lead = await createReferredLead(t, r!.input_message_id, noteText); setActing(a => ({ ...a, busy: false, lead })); onStaged?.() }
    catch (e) { setActing(a => ({ ...a, busy: false, error: e instanceof Error ? e.message : 'The lead could not be created. Try again.' })) }
  }
  const dismiss = async () => {
    setActing(a => ({ ...a, busy: true, error: null }))
    try { await dismissReferral(t, r!.input_message_id); setActing(a => ({ ...a, busy: false, dismissed: true })) }
    catch (e) { setActing(a => ({ ...a, busy: false, error: e instanceof Error ? e.message : 'Could not dismiss. Try again.' })) }
  }
  return <section className="dm-referral dm-src" aria-label="Referred contact">
    <h3>{r?.status === 'verified' ? `Draft for ${r.name}` : 'Referred contact'}</h3>
    {!result && <p role="status">Researching the referred person and preparing a DM for review…</p>}
    {result?.error && <p role="alert">{result.error}</p>}
    {r?.status === 'unresolved' && !r.lead_prospect_id && <p>{r.reason || 'The referred person needs clarification.'}</p>}
    {acting.lead?.status === 'created' && <p role="status">{r?.name} is now an ARCH lead. The invite note is held in their conversation until Send.</p>}
    {acting.lead?.status === 'linked_existing' && <p role="status">{r?.name} was already an ARCH lead, so nothing new was staged. Linked.</p>}
    {leadId && <a className="d-link" href={`#exp/d/dms?thread=${encodeURIComponent(leadId)}`}>Open referred lead</a>}
    {paused && <p role="status"><b>Paused.</b> {referrer} wrote later: “{paused.quote}”{paused.verdict === 'redirect' ? ' They point to someone else now.' : ''}</p>}
    {unchecked && <p role="status">{referrer} wrote again after the handoff and it has not been read yet. Retry research to read it.</p>}
    {r?.status === 'verified' && !r.draft && !leadId && r.reason && <p>{r.reason}</p>}
    {contact && contact.draft && <>
      {r?.candidate && <h4>Possible match: {contact.name}</h4>}
      <p>{contact.summary}</p>
      <p className="dm-meta">Draft from {t.client_id === 'swishdm' ? 'Jonathan' : t.client_id === 'risedtc' ? 'Mattan' : t.client_id === 'arch' ? 'Davorin' : 'Ivan'}. {canCreate ? `It goes out as a LinkedIn invite note (${noteText.length}/${INVITE_NOTE_LIMIT}). Check whether Davorin already messaged ${person} by hand first.` : 'Review it on LinkedIn. Connection status has not been checked.'}</p>
      <textarea aria-label={`DM draft for ${contact.name}`} readOnly={!canCreate} value={canCreate ? noteText : contact.draft ?? ''} onChange={e => setNote({ stamp, text: e.target.value })} rows={5} disabled={acting.busy} />
      <div className="dm-referral-actions">
        {canCreate && <button type="button" className="dm-k" disabled={acting.busy || !noteText.trim() || noteText.trim().length > INVITE_NOTE_LIMIT} onClick={() => void create()}>{acting.busy ? 'Creating…' : 'Create referred lead'}</button>}
        <button type="button" className="dm-k" onClick={() => void copy('dm')}>{copied === 'dm' ? 'Copied' : 'Copy DM'}</button>
        <a className="d-link" href={contact.linkedin_url!} target="_blank" rel="noreferrer">Open LinkedIn profile</a>
        {r?.status === 'verified' && !leadId && <button type="button" className="dm-k" disabled={acting.busy} onClick={() => void dismiss()}>Not contacting {person}</button>}
      </div>
      {canCreate && <p className="dm-meta">Creating the lead sends nothing. The note waits in {person}'s conversation for Send.</p>}
      <details><summary>Research sources</summary>{contact.sources.map(s => <a className="d-link" key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.title}</a>)}</details>
    </>}
    {acting.error && <p role="alert">{acting.error}</p>}
    {r?.email && handoff && <ReferralEmailDraft key={stamp} t={t} inbound={handoff} email={r.email} referredName={r.name} referredCompany={r.company} onStaged={onStaged} />}
    {r?.email_reason && <p>{r.email_reason}</p>}
    {r?.acknowledgement && !answered && !t.draft && <>
      <h4>Acknowledgement to {referrer}</h4>
      <textarea aria-label={`Acknowledgement draft for ${t.prospect_name}`} readOnly value={r.acknowledgement} rows={2} />
      <div className="dm-referral-actions">
        {onUseAcknowledgement && <button type="button" className="dm-k" onClick={() => onUseAcknowledgement(r.acknowledgement!)}>Use acknowledgement</button>}
        <button type="button" className="dm-k" onClick={() => void copy('ack')}>{copied === 'ack' ? 'Copied acknowledgement' : 'Copy acknowledgement'}</button>
      </div>
      <p className="dm-meta">Review before sending.</p>
    </>}
    {copyError && <p role="alert">Could not copy. Select the draft above and copy it.</p>}
    {(result?.error || unchecked || r?.email_reason || r?.status === 'unresolved' && !r.lead_prospect_id || r?.status === 'verified' && !r.draft && !leadId) && <button type="button" className="dm-k" onClick={() => setRetry(n => n + 1)}>Retry research</button>}
  </section>
}

/** The referred person's own thread: who pointed us here, and the check before the held invite goes out. */
function ReferredFrom({ t }: { t: Thread }) {
  const row = t.messages.find(m => m.ai_model === REFERRAL_LEAD_MODEL)
  const ev = (row?.draft_evidence ?? {}) as { referrer_prospect_id?: string; referrer_name?: string; review_note?: string }
  return <section className="dm-referral dm-src" aria-label="Referral">
    <h3>Referred by {ev.referrer_prospect_id ? <a className="d-link" href={`#exp/d/dms?thread=${encodeURIComponent(ev.referrer_prospect_id)}`}>{ev.referrer_name || 'a previous lead'}</a> : ev.referrer_name || 'a previous lead'}</h3>
    {row && !row.sent_at && ev.review_note && <p role="note">{ev.review_note}</p>}
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
