import { useEffect, useState } from 'react'
import type { Thread } from '../../lib/inbox'
import { referralInbound, requestDmReferral } from '../../lib/dmReferral'
import type { ReferralDraft } from '../../../supabase/functions/inbox-dm-draft/referral'
import { ReferredLeadCard } from './ReferredLeadCard'

export function ReferralCard({ t, onUseAcknowledgement }: { t: Thread; onUseAcknowledgement?: (text: string) => void }) {
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
      <p className="dm-meta">Draft from {t.client_id === 'risedtc' ? 'Mattan' : t.client_id === 'arch' ? 'Davorin' : 'Ivan'}. Review it on LinkedIn. Connection status has not been checked.</p>
      <textarea aria-label={`DM draft for ${contact.name}`} readOnly value={contact.draft ?? ''} rows={5} />
      <div className="dm-referral-actions">
        <button type="button" className="dm-k" onClick={() => void copy('dm')}>{copied === 'dm' ? 'Copied' : 'Copy DM'}</button>
        <a className="d-link" href={contact.linkedin_url!} target="_blank" rel="noreferrer">Open LinkedIn profile</a>
      </div>
      <details><summary>Research sources</summary>{contact.sources.map(s => <a className="d-link" key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.title}</a>)}</details>
    </>}
    {copyError && <p role="alert">Could not copy. Select the draft above and copy it.</p>}
    {(result?.error || r?.status === 'unresolved' && !r.lead_prospect_id) && <button type="button" className="dm-k" onClick={() => setRetry(n => n + 1)}>Retry research</button>}
  </section>
}
