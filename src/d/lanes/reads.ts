/* ==========================================================================
   src/d/lanes/reads.ts — the few reads Lanes needs that no lib had yet.
   Every one is a SELECT (or a HEAD count, or a STABLE read rpc), scoped to a
   seat or to one campaign. Nothing here writes.
   ========================================================================== */
import { supabase } from '../../lib/supabase'
import { FAILED_SEND_FILTER } from '../../lib/sends'
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
  const { data, error } = await supabase.rpc('inbox_interest_cards')
  if (error) throw error
  return (data ?? []) as CameBackCard[]
}

/** Ivan's warm signals waiting for a look (the DMs lane card). */
export async function fetchWarmCount(): Promise<number> {
  const { data, error } = await supabase.rpc('warm_signal_cards')
  if (error) throw error
  return Array.isArray(data) ? data.length : 0
}

const since = (days: number, now = Date.now()) => new Date(now - days * 864e5).toISOString()

async function headCount(build: (q: ReturnType<typeof base>) => ReturnType<typeof base>): Promise<number> {
  const { count, error } = await build(base())
  if (error) throw error
  return count ?? 0
}
const base = () => supabase.from('outreach_prospects').select('id', { count: 'exact', head: true })

/** New people with classified person-level interest, by seat and source provenance. */
export async function fetchEngagers7d(): Promise<Record<Seat, number>> {
  const seats: Seat[] = ['ivan', 'risedtc', 'arch', 'swishdm']
  const counts = await Promise.all(seats.map(async seat => {
    const { count, error } = await supabase.from('inbox_interest_prospects_v')
      .select('id', { count: 'exact', head: true }).eq('client_id', seat).gte('created_at', since(7))
    if (error) throw error
    return count ?? 0
  }))
  return Object.fromEntries(seats.map((seat, i) => [seat, counts[i]])) as Record<Seat, number>
}

export const STAGES = ['enriched', 'ballot_hold', 'expansion_hold', 'queued', 'connection_sent', 'connected', 'dm_sent', 'replied', 'positive_reply', 'skipped', 'archived', 'disqualified', 'inmail_failed'] as const

/** SwishDM's senders write their own stage names; each is counted in the shared bucket it means.
    A withdrawn invite is out of the live ladder, so it lands in Archived. */
export const SWISHDM_STAGE_BUCKET: Record<string, (typeof STAGES)[number]> = {
  swishdm_staged_hold: 'queued', swishdm_connected: 'connected', swishdm_dm_sent: 'dm_sent', swishdm_replied: 'replied',
  swishdm_inmail_sent: 'dm_sent', swishdm_invite_withdrawn: 'archived',
}

/** Fold raw per-stage counts into the shared buckets, in STAGES order (SwishDM stages mapped). */
export function foldStageCounts(raw: ReadonlyArray<{ stage: string; n: number }>): Array<{ stage: string; n: number }> {
  const by = new Map<string, number>()
  for (const r of raw) { const b = SWISHDM_STAGE_BUCKET[r.stage] ?? r.stage; by.set(b, (by.get(b) ?? 0) + r.n) }
  return STAGES.map(stage => ({ stage: stage as string, n: by.get(stage) ?? 0 })).filter(s => s.n > 0)
}

/** Where everyone in one campaign stands: one HEAD count per stage (no row leaves the DB). */
export async function fetchStageCounts(campaignId: string, clientId?: string | null): Promise<Array<{ stage: string; n: number }>> {
  const stages: string[] = [...STAGES, ...(clientId === 'swishdm' ? Object.keys(SWISHDM_STAGE_BUCKET) : [])]
  const out = await Promise.all(stages.map(async stage => ({ stage, n: await headCount(q => q.eq('campaign_id', campaignId).eq('stage', stage)) })))
  return foldStageCounts(out)
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

/** The senders' own pause keys: one per seat (a 422 streak arms it for 2h) and the
    global manual kill switch `conn_send_pause_until` (stops every seat's invites). */
export const PAUSE_KEY: Record<Seat, string> = { ivan: 'ivan_conn_422_pause_until', risedtc: 'risedtc_conn_422_pause_until', arch: 'arch_conn_send_pause_until' , swishdm: 'swishdm_invite_pause_until' }
export const KILL_SWITCH_KEY = 'conn_send_pause_until'
/** A seat's other senders' own pause keys (SwishDM's DM and InMail senders each read one). */
export const CHANNEL_PAUSE_KEYS: Partial<Record<Seat, ReadonlyArray<{ key: string; label: string }>>> = {
  swishdm: [{ key: 'swishdm_dm_pause_until', label: 'DM pause' }, { key: 'swishdm_inmail_pause_until', label: 'InMail pause' }],
}
export type Pauses = Partial<Record<Seat | 'all', string>> & { byKey?: Record<string, string> }
export async function fetchPauses(): Promise<Pauses> {
  const channelKeys = Object.values(CHANNEL_PAUSE_KEYS).flatMap(l => (l ?? []).map(k => k.key))
  const { data, error } = await supabase.from('integration_config').select('key, value').in('key', [...Object.values(PAUSE_KEY), KILL_SWITCH_KEY, ...channelKeys])
  if (error) throw error
  const rows = (data ?? []) as Array<{ key: string; value: string | null }>
  const out: Pauses = {}
  for (const [seat, key] of [...Object.entries(PAUSE_KEY), ['all', KILL_SWITCH_KEY]] as Array<[Seat | 'all', string]>) {
    const v = rows.find(r => r.key === key)?.value
    if (v && Number.isFinite(Date.parse(v))) out[seat] = v
  }
  for (const key of channelKeys) {
    const v = rows.find(r => r.key === key)?.value
    if (v && Number.isFinite(Date.parse(v))) (out.byKey ??= {})[key] = v
  }
  return out
}

export type Blocked = { id: string; prospect_name: string; client_id: string; send_blocked_at: string; send_blocked_reason: string | null }
/** Newest blocked sends across seats, same exclusions as the send log totals (discards, owner holds and unreachable recipients are not failures). */
export async function fetchBlocked(limit = 8): Promise<Blocked[]> {
  const { data, error } = await supabase.from('inbox_messages_v').select('id, prospect_name, client_id, send_blocked_at, send_blocked_reason')
    .eq('direction', 'outbound').not('send_blocked_at', 'is', null)
    .or(FAILED_SEND_FILTER)
    .order('send_blocked_at', { ascending: false }).limit(limit)
  if (error) throw error
  return (data ?? []) as Blocked[]
}
