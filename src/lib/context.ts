import { supabase } from './supabase'

// Everything the context sheet shows about a prospect, fetched on open (one
// prospect row + one scan lookup) rather than joined into the inbox view —
// the view stays lean and the sheet is an on-demand surface.
export type ProspectContext = {
  icp_score: number | null
  icp_reasoning: string | null
  title: string | null
  headline: string | null
  location: string | null
  industry: string | null
  linkedin_url: string | null
  company_domain: string | null
  connection_sent_at: string | null
  connected_at: string | null
  dm_count: number | null
  reply_count: number | null
  last_reply_at: string | null
  // System provenance (n8n lane markers like "lm-anchor:..."). Read-only here.
  notes: string | null
  // Ivan's own annotation, editable from the sheet. Separate column so it can
  // never collide with the system's notes writes.
  operator_note: string | null
  operator_note_at: string | null
}

export type ScanInfo = {
  company_slug: string
  report_url: string | null
  completed_at: string | null
  automation_grade: string | null
}

// Mirrors the drafter's _ht_slug base: slugified prospect NAME (not company),
// stored with a 2-hex suffix, so lookups prefix-match `${base}-%`.
export function nameSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

export async function fetchProspectContext(prospectId: string): Promise<ProspectContext> {
  const { data, error } = await supabase.from('outreach_prospects')
    .select('icp_score,icp_reasoning,title,headline,location,industry,linkedin_url,company_domain,connection_sent_at,connected_at,dm_count,reply_count,last_reply_at,notes,operator_note,operator_note_at')
    .eq('id', prospectId).single()
  if (error) throw error
  return data as ProspectContext
}

// Same two-step lookup the Warm Reply Drafter uses: exact domain match first,
// then person-name slug prefix. Returns null when no completed scan exists.
export async function fetchScan(name: string, companyDomain: string | null): Promise<ScanInfo | null> {
  const sel = 'company_slug,report_url,completed_at,automation_grade'
  if (companyDomain) {
    const { data } = await supabase.from('scans').select(sel)
      .eq('domain', companyDomain).eq('status', 'complete')
      .order('completed_at', { ascending: false }).limit(1)
    if (data?.length) return data[0] as ScanInfo
  }
  const base = nameSlug(name)
  if (!base) return null
  const { data } = await supabase.from('scans').select(sel)
    .like('company_slug', `${base}-%`).eq('status', 'complete')
    .order('completed_at', { ascending: false }).limit(1)
  return data?.length ? (data[0] as ScanInfo) : null
}

export async function saveOperatorNote(prospectId: string, note: string): Promise<void> {
  const trimmed = note.trim()
  const { error } = await supabase.from('outreach_prospects')
    .update({
      operator_note: trimmed || null,
      operator_note_at: trimmed ? new Date().toISOString() : null,
    })
    .eq('id', prospectId)
  if (error) throw error
}
