/* ==========================================================================
   src/d/lanes/reads.ts — the few reads Lanes needs that no lib had yet.
   Every one is a SELECT (or a HEAD count, or a STABLE read rpc), scoped to a
   seat or to one campaign. Nothing here writes.
   ========================================================================== */
import { supabase } from '../../lib/supabase'
import type { CameBackCard } from '../../wb/dms/cameBackData'
import type { Seat } from '../seats'

export type Counter = { seat: string; action_type: string; count: number; daily_limit: number | null }

/** The sender's own daily counters (DM cap 50 etc.), for the UTC day the sender counts in. */
export async function fetchCounters(now = Date.now()): Promise<Counter[]> {
  const day = new Date(now).toISOString().slice(0, 10)
  const { data, error } = await supabase.from('linkedin_daily_actions').select('seat, action_type, count, daily_limit').eq('date', day)
  if (error) throw error
  return (data ?? []) as Counter[]
}

export async function fetchCameBack(): Promise<CameBackCard[]> {
  const { data, error } = await supabase.rpc('came_back_cards')
  if (error) throw error
  return (data ?? []) as CameBackCard[]
}

/** Ivan's warm signals waiting for a look (the DMs lane card). */
export async function fetchWarmCount(): Promise<number> {
  const { data, error } = await supabase.rpc('warm_signal_cards')
  if (error) throw error
  return Array.isArray(data) ? data.length : 0
}

type CampaignRow = { id: string; name: string; client_id: string | null }
const since = (days: number, now = Date.now()) => new Date(now - days * 864e5).toISOString()

async function headCount(build: (q: ReturnType<typeof base>) => ReturnType<typeof base>): Promise<number> {
  const { count, error } = await build(base())
  if (error) throw error
  return count ?? 0
}
const base = () => supabase.from('outreach_prospects').select('id', { count: 'exact', head: true })

/** New people found in 7 days, by the rule the mock used: Ivan's engage campaigns,
    Rise's engager campaigns, Arch's engager lane. */
export async function fetchEngagers7d(): Promise<Record<Seat, number>> {
  const { data, error } = await supabase.from('outreach_campaigns').select('id, name, client_id')
  if (error) throw error
  const rows = (data ?? []) as CampaignRow[]
  const ids = (f: (r: CampaignRow) => boolean) => rows.filter(f).map(r => r.id)
  const ivan = ids(r => !r.client_id && /engage/i.test(r.name))
  const rise = ids(r => r.client_id === 'risedtc' && /engager/i.test(r.name))
  const arch = ids(r => r.client_id === 'arch')
  const t = since(7)
  const [a, b, c] = await Promise.all([
    ivan.length ? headCount(q => q.in('campaign_id', ivan).gt('created_at', t)) : 0,
    rise.length ? headCount(q => q.in('campaign_id', rise).gt('created_at', t)) : 0,
    arch.length ? headCount(q => q.in('campaign_id', arch).gt('created_at', t).eq('enrichment_data->>lane', 'engager_warm')) : 0,
  ])
  return { ivan: a, risedtc: b, arch: c }
}

export const STAGES = ['enriched', 'ballot_hold', 'expansion_hold', 'queued', 'connection_sent', 'connected', 'dm_sent', 'replied', 'positive_reply', 'skipped', 'archived', 'disqualified', 'inmail_failed'] as const

/** Where everyone in one campaign stands: one HEAD count per stage (no row leaves the DB). */
export async function fetchStageCounts(campaignId: string): Promise<Array<{ stage: string; n: number }>> {
  const out = await Promise.all(STAGES.map(async stage => ({ stage, n: await headCount(q => q.eq('campaign_id', campaignId).eq('stage', stage)) })))
  return out.filter(s => s.n > 0)
}

export type LaneMix = { lanes: Array<{ lane: string; n: number }>; capped: boolean }
const PAGE = 1000, MAX_PAGES = 3

/** The lanes inside one campaign, people touched in 30 days (the mock's SQL, paged). */
export async function fetchLaneMix(campaignId: string): Promise<LaneMix> {
  const counts = new Map<string, number>()
  let capped = false
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase.from('outreach_prospects').select('lane:enrichment_data->>lane')
      .eq('campaign_id', campaignId).gt('updated_at', since(30)).order('id').range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as Array<{ lane: string | null }>
    for (const r of rows) if (r.lane) counts.set(r.lane, (counts.get(r.lane) ?? 0) + 1)
    if (rows.length < PAGE) break
    if (page === MAX_PAGES - 1) capped = true
  }
  return { lanes: [...counts].map(([lane, n]) => ({ lane, n })).sort((a, b) => b.n - a.n), capped }
}

export type Reply = { id: string; prospect_name: string; message_text: string; sent_at: string; reply_intent: string | null }
export async function fetchCampaignReplies(campaignName: string, limit = 4): Promise<Reply[]> {
  const { data, error } = await supabase.from('inbox_messages_v').select('id, prospect_name, message_text, sent_at, reply_intent')
    .eq('campaign_name', campaignName).eq('direction', 'inbound').not('sent_at', 'is', null).gt('sent_at', since(14))
    .order('sent_at', { ascending: false }).limit(limit)
  if (error) throw error
  return (data ?? []) as Reply[]
}

/** LANES #3: which arm each Arch company-expansion invite went out on, 30 days. */
export function armOf(m: { ai_model: string | null; message_text: string | null }): string {
  const k = m.ai_model ?? ''
  if (/blank/i.test(k) || /^\(blank invite/i.test(m.message_text ?? '')) return 'blank'
  const note = k.match(/^arch_(\w+?)_note/)
  return note ? `${note[1]} note` : k ? k.replace(/_v\d+$/, '').replace(/_/g, ' ') : 'no arm recorded'
}
export async function fetchInviteArms(campaignName: string, lane = 'company_expansion'): Promise<Array<{ arm: string; n: number }>> {
  const { data, error } = await supabase.from('inbox_messages_v').select('ai_model, message_text')
    .eq('campaign_name', campaignName).eq('lane', lane).eq('message_type', 'connection_note').eq('direction', 'outbound')
    .gt('sent_at', since(30)).limit(1000)
  if (error) throw error
  const c = new Map<string, number>()
  for (const m of (data ?? []) as Array<{ ai_model: string | null; message_text: string | null }>) c.set(armOf(m), (c.get(armOf(m)) ?? 0) + 1)
  return [...c].map(([arm, n]) => ({ arm, n })).sort((a, b) => b.n - a.n)
}

/** LANES #10: brands the Rise company-expansion lane stopped at, because a colleague replied. */
export async function fetchStoppedBrands(campaignId: string): Promise<number> {
  const { data, error } = await supabase.from('outreach_prospects').select('x:enrichment_data->expansion').eq('campaign_id', campaignId).limit(1000)
  if (error) throw error
  const byColleague = new Map<string, string>()
  for (const r of (data ?? []) as Array<{ x: { sibling_domain?: string; colleague_prospect_id?: string; sibling_prospect_ids?: string[] } | null }>) {
    const dom = r.x?.sibling_domain
    if (!dom) continue
    for (const id of [r.x?.colleague_prospect_id, ...(r.x?.sibling_prospect_ids ?? [])]) if (id) byColleague.set(id, dom)
  }
  const ids = [...byColleague.keys()].slice(0, 300)
  if (!ids.length) return 0
  const s = await supabase.from('outreach_prospects').select('id, stage').in('id', ids).in('stage', ['replied', 'positive_reply'])
  if (s.error) throw s.error
  return new Set(((s.data ?? []) as Array<{ id: string }>).map(r => byColleague.get(r.id))).size
}

// One lane-mix read per campaign per session (the board line and the sheet share it).
const mixCache = new Map<string, Promise<LaneMix>>()
export function laneMixOnce(campaignId: string): Promise<LaneMix> {
  let p = mixCache.get(campaignId)
  if (!p) {
    p = fetchLaneMix(campaignId)
    p.catch(() => mixCache.delete(campaignId))
    mixCache.set(campaignId, p)
  }
  return p
}

/** The sender's own pause keys per seat (Ivan's 422 pause, Arch's invite pause). */
export const PAUSE_KEY: Partial<Record<Seat, string>> = { ivan: 'ivan_conn_422_pause_until', arch: 'arch_conn_send_pause_until' }
export async function fetchPauses(): Promise<Partial<Record<Seat, string>>> {
  const { data, error } = await supabase.from('integration_config').select('key, value').in('key', Object.values(PAUSE_KEY))
  if (error) throw error
  const out: Partial<Record<Seat, string>> = {}
  for (const [seat, key] of Object.entries(PAUSE_KEY)) {
    const v = ((data ?? []) as Array<{ key: string; value: string | null }>).find(r => r.key === key)?.value
    if (v && Number.isFinite(Date.parse(v))) out[seat as Seat] = v
  }
  return out
}

export type Blocked = { id: string; prospect_name: string; client_id: string; send_blocked_at: string; send_blocked_reason: string | null }
/** Newest blocked sends across seats, same exclusions as the send log (discards and owner holds are not failures). */
export async function fetchBlocked(limit = 8): Promise<Blocked[]> {
  const { data, error } = await supabase.from('inbox_messages_v').select('id, prospect_name, client_id, send_blocked_at, send_blocked_reason')
    .eq('direction', 'outbound').not('send_blocked_at', 'is', null)
    .or('send_blocked_reason.is.null,send_blocked_reason.not.in.(discarded_in_inbox,owner_confirmation,owner_confirmation_superseded,reply_retry_pending)')
    .order('send_blocked_at', { ascending: false }).limit(limit)
  if (error) throw error
  return (data ?? []) as Blocked[]
}
