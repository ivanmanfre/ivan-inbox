import { useEffect, useState } from 'react'
import type { Thread } from '../../lib/inbox'
import { supabase } from '../../lib/supabase'

// SwishDM named referrals (2026-10-20, Junior Scott Pence -> Nisha Shah). The detector's triage finds the person a
// reply points us to and stages them as their own lead (enrichment_data.swishdm_referral on the referrer, .referral on
// the referred person). Ivan: "on JUNIOR THREAD i dont see this... i need visibility that nisha was outreached".
// Both threads show the link and where the outreach stands, read from the referred lead's own rows.

type RefKey = { status?: string; name?: string; result?: string; person?: { name?: string; title?: string | null } | null }
type Sent = { message_type: string; sent_at: string | null; approved_at: string | null; send_blocked_reason: string | null }
export type SwishRef =
  | { kind: 'to'; name: string; title: string | null; leadId: string | null; status: string; result: string; rows: Sent[] }
  | { kind: 'from'; name: string; leadId: string }

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const LABEL: Record<string, string> = { inmail: 'InMail', connection_note: 'Invite', dm: 'DM' }

export function referralStatus(r: Extract<SwishRef, { kind: 'to' }>): string {
  if (r.status === 'not_found') return `Couldn't find ${r.name} at this brand on LinkedIn. Nobody was contacted.`
  if (r.status === 'ambiguous') return `More than one ${r.name} matched on LinkedIn. Nobody was contacted.`
  if (r.status === 'lookup_failed') return 'LinkedIn lookup failed. It retries on the next run.'
  if (r.status === 'lookup_gave_up') return 'LinkedIn lookup failed 3 times. Nobody was contacted.'
  if (!r.leadId) return /^already_in_outreach/.test(r.result) ? `${r.name} was already in outreach, so nothing new was sent.` : `Not contacted: ${r.result}.`
  const sent = r.rows.filter(m => m.sent_at).sort((a, b) => a.sent_at!.localeCompare(b.sent_at!))
  if (sent.length) return sent.map(m => `${LABEL[m.message_type] ?? m.message_type} sent ${when(m.sent_at!)}`).join(' · ')
  if (r.rows.some(m => m.approved_at && !m.send_blocked_reason)) return 'Passed the seat check. Queued to send.'
  return 'Waiting for the seat check before anything is sent.'
}

export function SwishReferral({ t }: { t: Thread }) {
  const [ref, setRef] = useState<SwishRef | null>(null)
  const stamp = `${t.prospect_id}:${t.messages.length}`
  useEffect(() => {
    let current = true
    setRef(null)
    void (async () => {
      const { data: own } = await supabase.from('outreach_prospects').select('enrichment_data').eq('id', t.prospect_id).single()
      const ed = (own?.enrichment_data ?? {}) as { swishdm_referral?: RefKey; referral?: { from_prospect_id?: string; from_name?: string } }
      if (ed.referral?.from_prospect_id) {
        if (current) setRef({ kind: 'from', name: ed.referral.from_name || 'a previous lead', leadId: ed.referral.from_prospect_id })
        return
      }
      const k = ed.swishdm_referral
      if (!k?.name) return
      const result = String(k.result ?? '')
      const leadId = /^staged [0-9a-f-]{36}$/.test(result) ? result.slice(7) : null
      let rows: Sent[] = []
      if (leadId) {
        const { data } = await supabase.from('outreach_messages').select('message_type,sent_at,approved_at,send_blocked_reason').eq('prospect_id', leadId).eq('direction', 'outbound')
        rows = (data ?? []) as Sent[]
      }
      if (current) setRef({ kind: 'to', name: k.person?.name || k.name, title: k.person?.title ?? null, leadId, status: k.status ?? '', result, rows })
    })().catch(() => { /* card stays hidden; the thread itself is unaffected */ })
    return () => { current = false }
  }, [stamp]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!ref) return null
  const link = (id: string, name: string) => <a className="d-link" href={`#exp/d/dms?thread=${encodeURIComponent(id)}`}>{name}</a>
  if (ref.kind === 'from') return <section className="dm-referral dm-src" aria-label="Referral">
    <h3>Referred by {link(ref.leadId, ref.name)}</h3>
  </section>
  return <section className="dm-referral dm-src" aria-label="Referral">
    <h3>Referred to {ref.leadId ? link(ref.leadId, ref.name) : ref.name}{ref.title ? `, ${ref.title}` : ''}</h3>
    <p role="status">{referralStatus(ref)}</p>
  </section>
}
