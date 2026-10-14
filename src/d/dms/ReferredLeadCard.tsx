import { useEffect, useState } from 'react'
import type { Thread } from '../../lib/inbox'
import { supabase } from '../../lib/supabase'

type Package = {
  identity_status?: string
  referral?: { referrer_name?: string; referrer_prospect_id?: string; requested_name?: string; identity_warning?: string; sources?: { title: string; url: string }[] }
  channel_drafts?: { connection_request?: { note?: string }; inmail?: { subject?: string; body?: string }; email?: { subject?: string; body?: string } }
  referral_followup?: { status?: string; due_at?: string; delay_days?: number }
}

export function ReferredLeadCard({ t }: { t: Thread }) {
  const [data, setData] = useState<{ email: string | null; enrichment_data: Package } | null>(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [copied, setCopied] = useState<string | null>(null)
  const [copyError, setCopyError] = useState(false)
  const stamp = `${t.prospect_id}:${t.messages.map(m => `${m.id}:${m.sent_at}:${m.send_blocked_reason}`).join('|')}`
  useEffect(() => {
    let current = true
    setData(null); setError(false); setCopied(null); setCopyError(false)
    void Promise.resolve(supabase.from('outreach_prospects').select('email,enrichment_data').eq('id', t.prospect_id).single()).then(({ data: row, error: failure }) => {
      if (!current) return
      if (failure || !row?.enrichment_data?.channel_drafts) setError(true)
      else setData(row as { email: string | null; enrichment_data: Package })
    }).catch(() => { if (current) setError(true) })
    return () => { current = false }
  }, [stamp, retry]) // eslint-disable-line react-hooks/exhaustive-deps
  const p = data?.enrichment_data, r = p?.referral, s = p?.referral_followup
  const mail = (d?: { subject?: string; body?: string }) => d?.body ? `${d.subject ? `Subject: ${d.subject}\n\n` : ''}${d.body}` : ''
  const drafts = [['Connection request', p?.channel_drafts?.connection_request?.note ?? ''], ['InMail', mail(p?.channel_drafts?.inmail)], ['Email', mail(p?.channel_drafts?.email)]]
  const sentLabels = drafts.filter(([label]) => t.messages.some(m => m.ai_model === 'arch_referral_package_v1' && m.message_type === (label === 'Connection request' ? 'connection_note' : label.toLowerCase()) && m.sent_at)).map(([label]) => label)
  const copy = async (label: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(label); setCopyError(false) }
    catch { setCopyError(true) }
  }
  return <section className="dm-referral dm-src" aria-label="Referral outreach package">
    <h3>{r?.referrer_name ? <>Referred by {r.referrer_prospect_id ? <a className="d-link" href={`#exp/d/dms?thread=${encodeURIComponent(r.referrer_prospect_id)}`}>{r.referrer_name}</a> : r.referrer_name}</> : 'Referral'}</h3>
    {!data && !error && <p role="status">Loading the referral drafts…</p>}
    {error && <><p role="alert">Referral details could not be loaded.</p><button className="dm-k" onClick={() => setRetry(n => n + 1)}>Retry referral details</button></>}
    {data && <>
      {r?.identity_warning && p?.identity_status !== 'operator_selected_profile' && <p>{r.identity_warning}</p>}
      <p className="dm-meta">{t.messages.some(m => m.direction === 'inbound') ? 'Their reply is in the conversation below.' : 'No reply recorded yet.'}</p>
      {sentLabels.length > 0 && <p className="dm-meta"><b>Sent:</b> {sentLabels.join(' · ')}</p>}
      {drafts.filter(([, text]) => text).map(([label, text]) => {
        const kind = label === 'Connection request' ? 'connection_note' : label.toLowerCase()
        const sent = t.messages.find(m => m.ai_model === 'arch_referral_package_v1' && m.message_type === kind && m.sent_at)
        const held = t.messages.some(m => m.ai_model === 'arch_referral_package_v1' && m.message_type === kind && !m.sent_at && m.send_blocked_reason === 'arch_qualification_review')
        if (sent) return null
        return <div key={label}>
          <h4>{label}</h4>
          <textarea aria-label={`${label} draft`} readOnly value={text} rows={label === 'Connection request' ? 2 : 6} />
          {held && <p className="dm-meta">Sending is on hold for lead review.</p>}
          {!sent && <div className="dm-referral-actions"><button type="button" className="dm-k" onClick={() => void copy(label, text)}>{copied === label ? `Copied ${label}` : `Copy ${label}`}</button></div>}
        </div>
      })}
      <p>{s?.status === 'cancelled' ? 'Follow-up cancelled after a reply or closed lead.' : s?.status === 'awaiting_followup_review' ? 'Follow-up ready for review below.' : s?.due_at ? `Follow-up due ${new Date(s.due_at).toLocaleString('en-GB', { timeZone: 'Europe/Warsaw' })} (Warsaw).` : `${s?.delay_days ?? 3} days after the first sent touch. Waiting for the first send.`}</p>
      <details><summary>Contact details and sources</summary>
        <p className="dm-meta">{data.email ? `Email: ${data.email}` : 'Email address pending verification.'}</p>
        {r?.identity_warning && p?.identity_status === 'operator_selected_profile' && <p>The profile selected for your InMail is {t.prospect_name}. The referral named {r.requested_name || t.prospect_name}.</p>}
        {r?.sources?.filter(source => /^https:\/\//.test(source.url)).map(source => <a className="d-link" key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}
      </details>
    </>}
    {copyError && <p role="alert">Could not copy. Select the draft above and copy it.</p>}
  </section>
}
