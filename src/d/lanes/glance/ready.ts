/* ==========================================================================
   src/d/lanes/glance/ready.ts — "ready to invite", per seat, per lane.

   WHY A NEW READ. `inbox_pipeline_v` (Lanes' old "sendable") groups by
   campaign NAME (lane_of) and drifted from the senders: it counts campaigns
   no sender picks, misses Rise company expansion (36 ready read as 0) and
   takes icp>=7 where Ivan's engage pool takes 6. So this file mirrors each
   picker's own DATABASE filter, lane by lane (rules written down in
   O/B/build-plan.md "Ready rule", cited to the workflow lines):
     · Ivan  — 5ZXtArhobWrDDpfJ QueryBuildNotes, pools view/signal/engage/
               hiring/cold + the warm invite retry;
     · Rise  — same node, the RISE_* campaign lanes + partner + reconnect,
               with the company stop rule and 7-day spacing replayed;
     · Arch  — ARCH Connection Sender, stage=queued split by enrichment lane.
   Checks the senders make only in code at send time (geo gate, ads gate,
   live gate, exclusion ledgers, qualification) are NOT replayed: the count
   is "passes the sender's filter", a ceiling, and the UI says so.
   Every read is a SELECT, scoped to one seat's campaigns. Nothing writes.
   ========================================================================== */
import { supabase } from '../../../lib/supabase'
import type { GovernorRow } from '../../../lib/kpis'
import type { Seat } from '../../seats'

export type ReadyLane = { seat: Seat; lane: string; label: string; n: number; capped: boolean; campaignId: string | null; off: string | null }
export type ReadyRead = { lanes: ReadyLane[]; saturdayNy: boolean }
export type ReadySeat = { total: number; lanes: ReadyLane[] }

const PAGE = 1000
const DAY = 864e5
type Row = { campaign_id: string; company_domain: string | null; lane: string | null }
/* A narrow view of the PostgREST builder: the full generic type of a long filter
   chain with JSON paths is too deep for tsc (TS2589), and only these verbs are used. */
interface Q {
  eq(c: string, v: unknown): Q; in(c: string, v: readonly unknown[]): Q; not(c: string, op: string, v: unknown): Q
  is(c: string, v: null | boolean): Q; gte(c: string, v: unknown): Q; lte(c: string, v: unknown): Q; or(f: string): Q
  order(c: string): Q; limit(n: number): PromiseLike<{ data: unknown; error: { message: string } | null }>
}
const base = () => supabase.from('outreach_prospects').select('campaign_id, company_domain, lane:enrichment_data->>lane') as unknown as Q
const iso = (t: number) => new Date(t).toISOString()

async function rows(build: (q: Q) => Q): Promise<{ rows: Row[]; capped: boolean }> {
  const { data, error } = await build(base()).order('id').limit(PAGE)
  if (error) throw new Error(error.message)
  const r = (data ?? []) as unknown as Row[]
  return { rows: r, capped: r.length >= PAGE }
}

const refuse = (holdH: number, now: number) =>
  `enrichment_data->invite_refused->>last_at.is.null,enrichment_data->invite_refused->>last_at.lt.${iso(now - holdH * 36e5)}`
const LINKEDIN = 'preferred_channel.is.null,preferred_channel.eq.linkedin'

/** The busiest campaign of a lane's rows (the sheet the row opens). */
function topCampaign(r: Row[]): string | null {
  const m = new Map<string, number>()
  for (const x of r) m.set(x.campaign_id, (m.get(x.campaign_id) ?? 0) + 1)
  return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}
export const domainOf = (d: string | null | undefined) => (d ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')

type Camp = { id: string; client_id: string | null; is_active: boolean | null; archived: boolean | null }
type Cfg = Record<string, string>

async function config(): Promise<{ cfg: Cfg; camps: Camp[]; scorer: number }> {
  const [c, k, v] = await Promise.all([
    supabase.from('integration_config').select('key, value').in('key', ['invite_refused_hold_hours', 'arch_invite_refused_hold_hours', 'rise_company_expansion', 'profile_view_send_enabled', 'ivan_invite_retry_enabled']),
    supabase.from('outreach_campaigns').select('id, client_id, is_active, archived'),
    supabase.from('content_prompts').select('version').eq('slug', 'icp-outreach-scoring').limit(1),
  ])
  if (c.error) throw c.error
  if (k.error) throw k.error
  if (v.error) throw v.error
  const cfg: Cfg = {}
  for (const r of (c.data ?? []) as Array<{ key: string; value: string | null }>) cfg[r.key] = String(r.value ?? '').replace(/^"+|"+$/g, '').trim()
  const scorer = Number((v.data as Array<{ version: number }> | null)?.[0]?.version)
  if (!Number.isFinite(scorer)) throw new Error('the scorer version could not be read')
  return { cfg, camps: (k.data ?? []) as Camp[], scorer }
}
const hours = (v: string | undefined) => { const n = parseInt(v ?? '', 10); return n > 0 ? n : 20 }
const live = (c: Camp) => c.is_active === true && c.archived !== true

// ---- Ivan -----------------------------------------------------------------
const IVAN_RETRY = ['0aaf1db1-4cdc-41f6-a033-87fdde6eb78e', '7695d36d-df7e-4344-9ec5-a206b5dbfab0', '62f37ffd-7f9d-4a55-ab1e-c14f687c028f']

async function ivanLanes(camps: Camp[], cfg: Cfg, scorer: number, now: number, satNy: boolean): Promise<ReadyLane[]> {
  const ids = camps.filter(c => live(c) && c.client_id == null).map(c => c.id)
  if (!ids.length) return []
  const versions = Array.from({ length: Math.max(1, scorer - 6) }, (_, i) => String(7 + i))
  const rf = refuse(hours(cfg.invite_refused_hold_hours), now)
  const baseF = (q: Q) => q.in('campaign_id', ids).eq('stage', 'enriched').eq('blacklisted', false).not('country', 'is', null)
    .in('scorer_version', versions).or(LINKEDIN).or(rf)
  const pools: Array<[string, string, (q: Q) => Q, string | null]> = [
    ['view', 'Profile views', q => baseF(q).eq('trigger_type', 'profile_view').gte('trigger_confidence', 3).gte('icp_score', 7)
      .not('enrichment_data->>signal_approved_at', 'is', null).gte('created_at', iso(now - 7 * DAY)), cfg.profile_view_send_enabled === 'true' ? null : 'switched off'],
    ['signal', 'Content signal', q => baseF(q).eq('trigger_type', 'content_signal').gte('icp_score', 7).not('enrichment_data->>signal_note_final', 'is', null), null],
    ['engage', 'Warm engagers', q => baseF(q).in('trigger_type', ['engaged_post', 'content_engagement']).gte('trigger_confidence', 3).gte('icp_score', 6)
      .or('enrichment_data->>lane.is.null,enrichment_data->>lane.neq.own_post_engager,enrichment_data->>signal_note_final.not.is.null'), null],
    ['hiring', 'Hiring signal', q => baseF(q).eq('trigger_type', 'hiring').gte('trigger_confidence', 3).gte('created_at', iso(now - 3 * DAY)), null],
    ['cold', 'Cold', q => baseF(q).is('trigger_confidence', null).gte('icp_score', 7).not('liveness_checked_at', 'is', null), null],
  ]
  const retry = cfg.ivan_invite_retry_enabled === 'true'
  const [res, rt] = await Promise.all([
    Promise.all(pools.map(([, , f]) => rows(f))),
    rows(q => q.in('campaign_id', IVAN_RETRY.filter(id => ids.includes(id))).eq('skip_reason', 'invite_withdrawn_stale').gte('icp_score', 7).eq('reply_count', 0)
      .eq('blacklisted', false).not('country', 'is', null).not('hypertarget_reserved', 'is', true)
      .or('enrichment_data->>lane.is.null,enrichment_data->>lane.neq.own_post_engager')
      .or('preferred_channel.is.null,preferred_channel.eq.linkedin,preferred_channel.eq.inmail')
      .or('note_variant.is.null,note_variant.not.in.(ivan_invite_retry_blank_v1,X422)')
      .or(rf).lte('connection_sent_at', iso(now - 42 * DAY))),
  ])
  const out: ReadyLane[] = pools.map(([lane, label], i) => ({
    seat: 'ivan', lane, label, n: res[i].rows.length, capped: res[i].capped, campaignId: topCampaign(res[i].rows),
    off: pools[i][3] ?? (satNy && lane !== 'view' ? 'Saturday: profile views only' : null),
  }))
  out.push({ seat: 'ivan', lane: 'retry', label: 'Warm invite retry', n: rt.rows.length, capped: rt.capped, campaignId: topCampaign(rt.rows),
    off: !retry ? 'switched off' : satNy ? 'Saturday: profile views only' : null })
  return out
}

// ---- Rise -----------------------------------------------------------------
const RISE = {
  view: 'cdc57dc3-bcee-4d7c-8dbd-6eabceb8ab9d', orbit: 'a2194be6-6c18-429c-873e-2a120e505250', engager: '6549db14-3bdf-4462-a7ee-c97d762bb2cb',
  cold: '9a9ee3a5-c3a6-452d-8442-52285248d70c', expansion: 'b9c55e21-ed67-42e1-94ab-b9e948a4bed9', partner: '92c745f2-bd37-4887-96c3-ef930d542e24',
}
const RISE_LABEL: Record<keyof typeof RISE | 'reconnect', string> = {
  view: 'Profile views', orbit: 'Client orbit', engager: 'Competitor engagers', cold: 'Cold', expansion: 'Company expansion', partner: 'CMO partners', reconnect: 'InMail reconnect',
}

/** The Rise company stop rule (a colleague replied or booked) and 7-day spacing, as the sender loads it (RCX_GUARD v1.1). */
async function riseStops(now: number): Promise<{ stop: Set<string>; touch: Set<string> }> {
  const since = iso(now - 7 * DAY)
  const [a, b] = await Promise.all([
    supabase.from('outreach_campaigns').select('id, p:outreach_prospects(company_domain, reply_count, last_reply_at, call_booked_at, connection_sent_at, last_dm_sent_at, connected_at)')
      .eq('client_id', 'risedtc').not('p.company_domain', 'is', null)
      .or(`reply_count.gt.0,last_reply_at.not.is.null,call_booked_at.not.is.null,connection_sent_at.gte.${since},last_dm_sent_at.gte.${since}`, { referencedTable: 'p' }),
    supabase.from('outreach_campaigns').select('id, p:outreach_prospects!inner(company_domain, m:outreach_messages!inner(id))')
      .eq('client_id', 'risedtc').not('p.company_domain', 'is', null).eq('p.m.direction', 'inbound').limit(1, { referencedTable: 'p.m' }),
  ])
  if (a.error) throw a.error
  if (b.error) throw b.error
  type P = { company_domain: string | null; reply_count?: number | null; last_reply_at?: string | null; call_booked_at?: string | null; connection_sent_at?: string | null; last_dm_sent_at?: string | null; connected_at?: string | null }
  const stop = new Set<string>(), touch = new Set<string>()
  for (const c of (a.data ?? []) as unknown as Array<{ p: P[] }>) for (const p of c.p ?? []) {
    const d = domainOf(p.company_domain)
    if (!d) continue
    if (p.call_booked_at || Number(p.reply_count) > 0 || p.last_reply_at) stop.add(d)
    const t = Math.max(p.connection_sent_at ? Date.parse(p.connection_sent_at) : 0, !p.connected_at && p.last_dm_sent_at ? Date.parse(p.last_dm_sent_at) : 0)
    if (t && now - t < 7 * DAY) touch.add(d)
  }
  for (const c of (b.data ?? []) as unknown as Array<{ p: P[] }>) for (const p of c.p ?? []) { const d = domainOf(p.company_domain); if (d) stop.add(d) }
  return { stop, touch }
}

async function riseLanes(camps: Camp[], cfg: Cfg, now: number, satNy: boolean): Promise<ReadyLane[]> {
  const on = (id: string) => camps.some(c => c.id === id && live(c))
  const rcx = cfg.rise_company_expansion === 'on'
  const rf = refuse(hours(cfg.invite_refused_hold_hours), now)
  const nameGate = 'enrichment_data->name_gate->>status.is.null,enrichment_data->name_gate->>status.neq.blocked_until_mattan_ok'
  const lane = (id: string) => (q: Q) => q.eq('campaign_id', id).eq('blacklisted', false).not('country', 'is', null).is('connection_sent_at', null)
    .is('last_dm_sent_at', null).in('stage', ['identified', 'enriched']).or(LINKEDIN).or(rf).or(nameGate)
  const note = (q: Q) => q.not('enrichment_data->>rise_note_final', 'is', null)
  const defs: Array<[keyof typeof RISE, (q: Q) => Q, boolean]> = [
    ['view', q => lane(RISE.view)(q).gte('created_at', iso(now - 7 * DAY)), cfg.profile_view_send_enabled === 'true'],
    ['orbit', q => lane(RISE.orbit)(q).or('enrichment_data->>rise_note_final.not.is.null,enrichment_data->>anchor_client.not.is.null'), true],
    ['engager', q => note(lane(RISE.engager)(q)), true],
    ['cold', q => note(lane(RISE.cold)(q)).not('liveness_checked_at', 'is', null), true],
    ['expansion', q => lane(RISE.expansion)(q).not('enrichment_data->expansion->>colleague_first', 'is', null), rcx],
    ['partner', q => q.eq('campaign_id', RISE.partner).eq('blacklisted', false).not('country', 'is', null).is('connection_sent_at', null).is('last_dm_sent_at', null)
      .eq('stage', 'enriched').is('skip_state', null).eq('enrichment_data->>partner_lane', 'true').not('enrichment_data->>rise_note_final', 'is', null).or(LINKEDIN).or(rf), true],
  ]
  const live_ = defs.filter(([k]) => on(RISE[k]))
  const activeIds = Object.values(RISE).filter(on)
  const [stops, res, rc] = await Promise.all([
    rcx ? riseStops(now) : Promise.resolve({ stop: new Set<string>(), touch: new Set<string>() }),
    Promise.all(live_.map(([, f]) => rows(f))),
    activeIds.length ? rows(q => q.in('campaign_id', activeIds).eq('blacklisted', false).not('country', 'is', null).is('connection_sent_at', null).is('connected_at', null)
      .eq('reply_count', 0).not('last_dm_sent_at', 'is', null).lte('last_dm_sent_at', iso(now - 3 * DAY)).in('stage', ['enriched', 'inmail_ready', 'dm_sent'])
      .is('skip_state', null).not('hypertarget_reserved', 'is', true).gte('icp_score', 6).not('enrichment_data->>rise_note_final', 'is', null)
      .or('preferred_channel.is.null,preferred_channel.eq.linkedin,preferred_channel.eq.inmail').or(rf)) : Promise.resolve({ rows: [] as Row[], capped: false }),
  ])
  // Company stop rule + spacing: every brand lane and the reconnect, never the partner lane (L977 has no RCX).
  const keep = (r: Row[], k: string) => (k === 'partner' || !rcx) ? r : r.filter(x => { const d = domainOf(x.company_domain); return !d || (!stops.stop.has(d) && !stops.touch.has(d)) })
  const out: ReadyLane[] = live_.map(([k, , enabled], i) => {
    const kept = keep(res[i].rows, k)
    return { seat: 'risedtc', lane: k, label: RISE_LABEL[k], n: kept.length, capped: res[i].capped, campaignId: RISE[k],
      off: !enabled ? 'switched off' : satNy && k !== 'view' ? 'Saturday: profile views only' : null }
  })
  const rk = keep(rc.rows, 'reconnect')
  if (activeIds.length) out.push({ seat: 'risedtc', lane: 'reconnect', label: RISE_LABEL.reconnect, n: rk.length, capped: rc.capped, campaignId: topCampaign(rk), off: satNy ? 'Saturday: profile views only' : null })
  return out
}

// ---- Arch -----------------------------------------------------------------
const ARCH_IDS = ['15de1a7c-86f4-40b7-bdbd-3c1fce94b6b9', '1a2701a0-931b-4949-95fb-9bbf2de16f09', '12c53034-7176-4950-be20-1c1bf5ba11a7', 'f17e4dac-d6b7-4c66-8d5c-8f1b2ace0685']
const ARCH_LABEL: Record<string, string> = {
  engager_warm: 'Warm engagers', company_expansion: 'Company expansion', hiring_signal: 'Hiring signal', funding_signal: 'Funding', new_in_role: 'New in role',
  cold_games: 'Cold (games)', cold_apps: 'Cold (apps)', profile_view: 'Profile views', sponsor_mined: 'Sponsors', sponsor_team: 'Sponsor team',
}

async function archLanes(camps: Camp[], cfg: Cfg, now: number): Promise<ReadyLane[]> {
  const active = ARCH_IDS.filter(id => camps.some(c => c.id === id && live(c)))
  if (!active.length) return []
  const r = await rows(q => q.in('campaign_id', active).eq('blacklisted', false).is('skip_state', null).eq('stage', 'queued')
    .or('icp_score.gte.7,enrichment_data->>source_kind.eq.client_sourced_sponsor,enrichment_data->>icp_floor_waived.eq.true')
    .not('enrichment_data->>lane', 'is', null).is('enrichment_data->>lang_hold', null).is('enrichment_data->>copy_hold', null)
    .is('connection_sent_at', null).is('connected_at', null).is('last_dm_sent_at', null).or(refuse(hours(cfg.arch_invite_refused_hold_hours), now)))
  const by = new Map<string, Row[]>()
  for (const x of r.rows) { const k = x.lane ?? 'unknown'; by.set(k, [...(by.get(k) ?? []), x]) }
  return [...by].sort((a, b) => b[1].length - a[1].length).map(([lane, xs]) => ({
    seat: 'arch' as const, lane, label: ARCH_LABEL[lane] ?? lane.replace(/_/g, ' '), n: xs.length, capped: r.capped, campaignId: topCampaign(xs), off: null,
  }))
}

/** Saturday in New York: the shared Ivan/Rise sender invites profile viewers only (`_weekendViewOnly`). */
export function isSaturdayNy(now: number): boolean {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date(now)) === 'Sat'
}

export async function fetchReady(now = Date.now()): Promise<ReadyRead> {
  const { cfg, camps, scorer } = await config()
  const sat = isSaturdayNy(now)
  const [a, b, c] = await Promise.all([ivanLanes(camps, cfg, scorer, now, sat), riseLanes(camps, cfg, now, sat), archLanes(camps, cfg, now)])
  return { lanes: [...a, ...b, ...c], saturdayNy: sat }
}

/** One seat's lanes, busiest first; the total counts only lanes the sender would pick today. Governor warm-only drops Ivan's cold. */
export function readyOf(r: ReadyRead, seat: Seat, gov?: GovernorRow | null): ReadySeat {
  const lanes = r.lanes.filter(l => l.seat === seat).map(l =>
    seat === 'ivan' && l.lane === 'cold' && !l.off && gov && gov.mode !== 'normal' ? { ...l, off: gov.mode === 'warm_only' ? 'warm only this week' : 'cold paused' } : l)
    .sort((a, b) => Number(Boolean(a.off)) - Number(Boolean(b.off)) || b.n - a.n)
  return { total: lanes.filter(l => !l.off).reduce((a, l) => a + l.n, 0), lanes }
}
