import { useEffect, useState } from 'react'
import type { Thread } from '../../lib/inbox'
import { referralInbound, requestDmReferral } from '../../lib/dmReferral'
import type { ReferralDraft } from '../../../supabase/functions/inbox-dm-draft/referral'

export function ReferralCard({ t }: { t: Thread }) {
  const inbound = referralInbound(t)
  const stamp = inbound ? `${t.prospect_id}:${inbound.id}` : ''
  const [retry, setRetry] = useState(0)
  const [state, setState] = useState<{ stamp: string; data: ReferralDraft | null; error: string | null } | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  useEffect(() => {
    if (!stamp) return
    let current = true
    setState(null); setCopied(false); setCopyError(false)
    void requestDmReferral(t, retry > 0).then(data => {
      if (current) setState({ stamp, data, error: null })
    }).catch(e => {
      if (current) setState({ stamp, data: null, error: e instanceof Error ? e.message : 'Research could not finish.' })
    })
    return () => { current = false }
  }, [stamp, retry]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!stamp) return null
  const result = state?.stamp === stamp ? state : null
  const r = result?.data
  if (r?.status === 'none') return null
  const copy = async () => {
    try { await navigator.clipboard.writeText(r!.draft!); setCopied(true); setCopyError(false) }
    catch { setCopyError(true) }
  }
  return <section className="dm-referral dm-src" aria-label="Referred contact">
    <h3>{r?.status === 'verified' ? `Draft for ${r.name}` : 'Referred contact'}</h3>
    {!result && <p role="status">Researching the referred person and preparing a DM for review…</p>}
    {result?.error && <p role="alert">{result.error}</p>}
    {r?.status === 'unresolved' && <p>{r.reason || 'The referred person needs clarification.'}</p>}
    {r?.status === 'verified' && <>
      <p>{r.summary}</p>
      <p className="dm-meta">Draft from {t.client_id === 'risedtc' ? 'Mattan' : t.client_id === 'arch' ? 'Davorin' : 'Ivan'}. Review it on LinkedIn. Connection status has not been checked.</p>
      <textarea aria-label={`DM draft for ${r.name}`} readOnly value={r.draft ?? ''} rows={5} />
      <div className="dm-referral-actions">
        <button type="button" className="dm-k" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy DM'}</button>
        <a className="d-link" href={r.linkedin_url!} target="_blank" rel="noreferrer">Open LinkedIn profile</a>
      </div>
      {copyError && <p role="alert">Could not copy. Select the draft above and copy it.</p>}
      <details><summary>Research sources</summary>{r.sources.map(s => <a className="d-link" key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.title}</a>)}</details>
    </>}
    {(result?.error || r?.status === 'unresolved') && <button type="button" className="dm-k" onClick={() => setRetry(n => n + 1)}>Retry research</button>}
  </section>
}
