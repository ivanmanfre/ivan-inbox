/* ==========================================================================
   src/d/lanes/glance/ready.ts — "ready to invite", per seat, per lane.

   WHY A NEW READ. `inbox_pipeline_v` (Lanes' old "sendable") groups by
   campaign NAME (lane_of) and drifted from the senders: it counts campaigns
   no sender picks, misses Rise company expansion (36 ready read as 0) and
   takes icp>=7 where Ivan's engage pool takes 6. So this file mirrors each
   picker's own DATABASE filter, lane by lane (rules written down in
   O/B/build-plan.md "Ready rule", cited to the workflow lines), in ONE
   candidate select classified in code (`laneOf`, pure), so Lanes never fires a
   query per lane (the DB stalled on 27 Sep; keep this read light):
     · Ivan  — 5ZXtArhobWrDDpfJ QueryBuildNotes, pools view/signal/engage/
               hiring/cold + the warm invite retry;
     · Rise  — same node, the RISE_* campaign lanes + partner + reconnect,
               with the company stop rule and 7-day spacing replayed;
     · Arch  — ARCH Connection Sender, stage=queued split by enrichment lane.
   Checks the senders make only in code at send time (geo gate, ads gate,
   live gate, exclusion ledgers, qualification) are NOT replayed: the count
   is "passes the sender's filter", a ceiling, and the UI says so.
   Fresh stock excludes prior contact and holds. RISE warm stock comes from the
   canonical supply RPC; other RISE pools remain visible as candidates. No writes.
   ========================================================================== */
import { supabase } from '../../../lib/supabase'
import type { GovernorRow } from '../../../lib/kpis'
import type { Seat } from '../../seats'

export type ReadyLane = { seat: Seat; lane: string; label: string; n: number; capped: boolean; campaignId: string | null; off: string | null }
export type ReadyRead = { lanes: ReadyLane[]; saturdayNy: boolean }
export type ReadySeat = { total: number; lanes: ReadyLane[] }

const PAGE = 1000
const MAX_PAGES = 3
const DAY = 864e5
const iso = (t: number) => new Date(t).toISOString()
export const domainOf = (d: string | null | undefined) => (d ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')

/** One candidate row: the prospect columns and enrichment keys any picker filters on. */
export type Cand = {
  id: string; campaign_id: string; stage: string; icp_score: number | null; trigger_type: string | null; trigger_confidence: number | null
  scorer_version: string | null; country: string | null; preferred_channel: string | null; connection_sent_at: string | null; connected_at: string | null
  last_dm_sent_at: string | null; liveness_checked_at: string | null; created_at: string; skip_state: string | null; skip_reason: string | null
  reply_count: number | null; note_variant: string | null; hypertarget_reserved: boolean | null; company_domain: string | null
  ed_lane: string | null; sig_ok: string | null; sig_note: string | null; rise_note: string | null; anchor: string | null; gate: string | null
  next_touch_after?: string | null; call_booked_at?: string | null; needs_manual_reply?: boolean | null; recycled_at?: string | null; last_reply_at?: string | null; dm_count?: number | null
  partner: string | null; colleague: string | null; refused: string | null; src: string | null; waived: string | null; lang_hold: string | null; copy_hold: string | null
}
const COLS = 'id, campaign_id, stage, icp_score, trigger_type, trigger_confidence, scorer_version, country, preferred_channel, connection_sent_at, connected_at, last_dm_sent_at, liveness_checked_at, created_at, skip_state, skip_reason, reply_count, note_variant, hypertarget_reserved, company_domain, next_touch_after, call_booked_at, needs_manual_reply, recycled_at, last_reply_at, dm_count, '
  + 'ed_lane:enrichment_data->>lane, sig_ok:enrichment_data->>signal_approved_at, sig_note:enrichment_data->>signal_note_final, rise_note:enrichment_data->>rise_note_final, anchor:enrichment_data->>anchor_client, gate:enrichment_data->name_gate->>status, '
  + 'partner:enrichment_data->>partner_lane, colleague:enrichment_data->expansion->>colleague_first, refused:enrichment_data->invite_refused->>last_at, src:enrichment_data->>source_kind, waived:enrichment_data->>icp_floor_waived, lang_hold:enrichment_data->>lang_hold, copy_hold:enrichment_data->>copy_hold'

type Camp = { id: string; client_id: string | null; is_active: boolean | null; archived: boolean | null }
export type Cfg = Record<string, string>
const live = (c: Camp) => c.is_active === true && c.archived !== true
const hours = (v: string | undefined) => { const n = parseInt(v ?? '', 10); return n > 0 ? n : 20 }

const IVAN_RETRY = ['0aaf1db1-4cdc-41f6-a033-87fdde6eb78e', '7695d36d-df7e-4344-9ec5-a206b5dbfab0', '62f37ffd-7f9d-4a55-ab1e-c14f687c028f']
const RISE = {
  view: 'cdc57dc3-bcee-4d7c-8dbd-6eabceb8ab9d', orbit: 'a2194be6-6c18-429c-873e-2a120e505250', engager: '6549db14-3bdf-4462-a7ee-c97d762bb2cb',
  cold: '9a9ee3a5-c3a6-452d-8442-52285248d70c', expansion: 'b9c55e21-ed67-42e1-94ab-b9e948a4bed9', partner: '92c745f2-bd37-4887-96c3-ef930d542e24',
}
const ARCH_IDS = ['15de1a7c-86f4-40b7-bdbd-3c1fce94b6b9', '1a2701a0-931b-4949-95fb-9bbf2de16f09', '12c53034-7176-4950-be20-1c1bf5ba11a7', 'f17e4dac-d6b7-4c66-8d5c-8f1b2ace0685']
const LABEL: Record<string, string> = {
  view: 'Profile views', signal: 'Content signal', engage: 'Warm engagers', hiring: 'Hiring signal', cold: 'Cold', retry: 'Warm invite retry',
  orbit: 'Client orbit', engager: 'Competitor engagers', expansion: 'Colleagues of our leads', partner: 'CMO partners', reconnect: 'InMail reconnect',
  engager_warm: 'Warm engagers', company_expansion: 'Colleagues of our leads', hiring_signal: 'Hiring signal', funding_signal: 'Funding', new_in_role: 'New in role',
  cold_games: 'Cold (games)', cold_apps: 'Cold (apps)', profile_view: 'Profile views', sponsor_mined: 'Sponsors', sponsor_team: 'Sponsor team',
}

export type Ctx = { now: number; cfg: Cfg; scorer: number; ivanIds: Set<string>; riseLive: Set<string>; archLive: Set<string>; stop: Set<string>; touch: Set<string>; satNy: boolean; riseReadyIds?: Set<string>; riseReadyCount?: number }

/** PURE: which lane (if any) the seat's sender would pick this row from, by its own filter. */
export function laneOf(r: Cand, x: Ctx): { seat: Seat; lane: string } | null {
  if (r.skip_state || r.hypertarget_reserved || r.call_booked_at || r.needs_manual_reply || r.last_reply_at || r.reply_count || r.dm_count || r.lang_hold || r.copy_hold
    || (r.next_touch_after && Date.parse(r.next_touch_after) > x.now) || r.icp_score == null) return null
  const retry = r.skip_reason === 'invite_withdrawn_stale'
  if (!retry && (r.skip_reason || r.connection_sent_at || r.connected_at || r.last_dm_sent_at || r.recycled_at)) return null
  if (r.campaign_id === RISE.engager) return x.riseLive.has(r.campaign_id) && x.riseReadyIds?.has(r.id) ? { seat: 'risedtc', lane: 'engager' } : null
  const held = (h: number) => Boolean(r.refused && Date.parse(r.refused) >= x.now - h * 36e5)
  const li = !r.preferred_channel || r.preferred_channel === 'linkedin'
  const icp = r.icp_score ?? -1, conf = r.trigger_confidence
  if (x.ivanIds.has(r.campaign_id)) {
    if (held(hours(x.cfg.invite_refused_hold_hours)) || !r.country) return null
    if (r.skip_reason === 'invite_withdrawn_stale') {
      const ok = IVAN_RETRY.includes(r.campaign_id) && icp >= 7 && !r.reply_count && !r.hypertarget_reserved && r.ed_lane !== 'own_post_engager'
        && (!r.preferred_channel || ['linkedin', 'inmail'].includes(r.preferred_channel)) && !['ivan_invite_retry_blank_v1', 'X422'].includes(r.note_variant ?? '')
        && Boolean(r.connection_sent_at && Date.parse(r.connection_sent_at) <= x.now - 42 * DAY)
      return ok ? { seat: 'ivan', lane: 'retry' } : null
    }
    const v = Number(r.scorer_version)
    if (r.stage !== 'enriched' || !li || !(v >= 7 && v <= x.scorer)) return null
    if (r.trigger_type === 'profile_view') return conf != null && conf >= 3 && icp >= 7 && r.sig_ok && Date.parse(r.created_at) >= x.now - 7 * DAY ? { seat: 'ivan', lane: 'view' } : null
    if (r.trigger_type === 'content_signal') return icp >= 7 && r.sig_note ? { seat: 'ivan', lane: 'signal' } : null
    if (r.trigger_type === 'engaged_post' || r.trigger_type === 'content_engagement')
      return conf != null && conf >= 3 && icp >= 6 && (r.ed_lane !== 'own_post_engager' || r.sig_note) ? { seat: 'ivan', lane: 'engage' } : null
    if (r.trigger_type === 'hiring') return icp >= 7 && conf != null && conf >= 3 && Date.parse(r.created_at) >= x.now - 3 * DAY ? { seat: 'ivan', lane: 'hiring' } : null
    return conf == null && icp >= 7 && r.liveness_checked_at ? { seat: 'ivan', lane: 'cold' } : null
  }
  if (x.riseLive.has(r.campaign_id)) {
    if (held(hours(x.cfg.invite_refused_hold_hours)) || !r.country || r.connection_sent_at || r.connected_at) return null
    const d = domainOf(r.company_domain)
    const rcx = x.cfg.rise_company_expansion === 'on'
    const spaced = rcx && Boolean(d) && (x.stop.has(d) || x.touch.has(d))
    if (r.campaign_id === RISE.partner)
      return r.stage === 'enriched' && !r.skip_state && r.partner === 'true' && r.rise_note && li && !r.last_dm_sent_at ? { seat: 'risedtc', lane: 'partner' } : null
    if (r.last_dm_sent_at) {
      const ok = !r.reply_count && Date.parse(r.last_dm_sent_at) <= x.now - 3 * DAY && ['enriched', 'inmail_ready', 'dm_sent'].includes(r.stage) && !r.skip_state
        && !r.hypertarget_reserved && icp >= 6 && r.rise_note && (!r.preferred_channel || ['linkedin', 'inmail'].includes(r.preferred_channel)) && !spaced
      return ok ? { seat: 'risedtc', lane: 'reconnect' } : null
    }
    if (!['identified', 'enriched'].includes(r.stage) || !li || r.gate === 'blocked_until_mattan_ok' || spaced) return null
    if (r.campaign_id === RISE.view) return Date.parse(r.created_at) >= x.now - 7 * DAY ? { seat: 'risedtc', lane: 'view' } : null
    if (r.campaign_id === RISE.orbit) return r.rise_note || r.anchor ? { seat: 'risedtc', lane: 'orbit' } : null
    if (r.campaign_id === RISE.engager) return r.rise_note ? { seat: 'risedtc', lane: 'engager' } : null
    if (r.campaign_id === RISE.cold) return r.rise_note && r.liveness_checked_at ? { seat: 'risedtc', lane: 'cold' } : null
    if (r.campaign_id === RISE.expansion) return rcx && r.colleague ? { seat: 'risedtc', lane: 'expansion' } : null
    return null
  }
  if (x.archLive.has(r.campaign_id)) {
    const ok = r.stage === 'queued' && !r.skip_state && (icp >= 7 || r.src === 'client_sourced_sponsor' || r.waived === 'true') && r.ed_lane
      && !r.lang_hold && !r.copy_hold && !r.connection_sent_at && !r.connected_at && !r.last_dm_sent_at && !held(hours(x.cfg.arch_invite_refused_hold_hours))
    return ok ? { seat: 'arch', lane: r.ed_lane! } : null
  }
  return null
}

/** PURE: rows to lanes, with the lanes each sender reads even when empty, and the reason a lane is skipped today. */
export function buildReady(rows: Cand[], x: Ctx, capped: boolean): ReadyRead {
  const by = new Map<string, Cand[]>()
  for (const r of rows) { const l = laneOf(r, x); if (l) { const k = `${l.seat}|${l.lane}`; by.set(k, [...(by.get(k) ?? []), r]) } }
  const top = (xs: Cand[]) => { const m = new Map<string, number>(); for (const r of xs) m.set(r.campaign_id, (m.get(r.campaign_id) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null }
  const sat = (lane: string) => (x.satNy && lane !== 'view' ? 'Saturday: profile views only' : null)
  const fixed: Array<[Seat, string, string | null]> = [
    ['ivan', 'engage', sat('engage')], ['ivan', 'cold', sat('cold')], ['ivan', 'view', x.cfg.profile_view_send_enabled === 'true' ? null : 'switched off'],
    ['ivan', 'signal', sat('signal')], ['ivan', 'hiring', sat('hiring')], ['ivan', 'retry', x.cfg.ivan_invite_retry_enabled === 'true' ? sat('retry') : 'switched off'],
    ...([['partner', 'partner'], ['engager', 'engager'], ['expansion', 'expansion'], ['view', 'view'], ['orbit', 'orbit'], ['cold', 'cold']] as const)
      .filter(([k]) => x.riseLive.has(RISE[k]))
      .map(([k]): [Seat, string, string | null] => ['risedtc', k, k === 'view' ? (x.cfg.profile_view_send_enabled === 'true' ? null : 'switched off') : k === 'expansion' && x.cfg.rise_company_expansion !== 'on' ? 'switched off' : sat(k)]),
    ...(x.riseLive.size ? [['risedtc', 'reconnect', sat('reconnect')] as [Seat, string, string | null]] : []),
  ]
  const lanes: ReadyLane[] = fixed.map(([seat, lane, off]) => { const xs = by.get(`${seat}|${lane}`) ?? []; return { seat, lane, label: LABEL[lane] ?? lane, n: xs.length, capped, campaignId: top(xs) ?? (seat === 'risedtc' ? RISE[lane as keyof typeof RISE] ?? null : null), off } })
  for (const [k, xs] of by) if (k.startsWith('arch|')) { const lane = k.slice(5); lanes.push({ seat: 'arch', lane, label: LABEL[lane] ?? lane.replace(/_/g, ' '), n: xs.length, capped, campaignId: top(xs), off: null }) }
  const warm = lanes.find(l => l.seat === 'risedtc' && l.lane === 'engager')
  if (warm && x.riseReadyCount != null) { warm.n = x.riseReadyCount; warm.capped = false }
  return { lanes, saturdayNy: x.satNy }
}

async function config(): Promise<{ cfg: Cfg; camps: Camp[]; scorer: number }> {
  const [c, k, v] = await Promise.all([
    supabase.from('integration_config').select('key, value').in('key', ['invite_refused_hold_hours', 'arch_invite_refused_hold_hours', 'rise_company_expansion', 'profile_view_send_enabled', 'ivan_invite_retry_enabled']),
    supabase.from('outreach_campaigns').select('id, client_id, is_active, archived'),
    supabase.from('content_prompts').select('version').eq('slug', 'icp-outreach-scoring').limit(1),
  ])
  for (const r of [c, k, v]) if (r.error) throw new Error(r.error.message)
  const cfg: Cfg = {}
  for (const r of (c.data ?? []) as Array<{ key: string; value: string | null }>) cfg[r.key] = String(r.value ?? '').replace(/^"+|"+$/g, '').trim()
  const scorer = Number((v.data as Array<{ version: number }> | null)?.[0]?.version)
  if (!Number.isFinite(scorer)) throw new Error('the scorer version could not be read')
  return { cfg, camps: (k.data ?? []) as Camp[], scorer }
}

/** Rise company stop rule + 7-day spacing (RCX_GUARD v1.1): domains a Rise colleague replied/booked at, or was touched at in 7 days. */
async function riseDomains(riseAll: string[], now: number): Promise<{ stop: Set<string>; touch: Set<string> }> {
  const since = iso(now - 7 * DAY)
  const { data, error } = await supabase.from('outreach_prospects').select('company_domain, reply_count, last_reply_at, call_booked_at, connection_sent_at, last_dm_sent_at, connected_at')
    .in('campaign_id', riseAll).not('company_domain', 'is', null)
    .or(`reply_count.gt.0,last_reply_at.not.is.null,call_booked_at.not.is.null,connection_sent_at.gte.${since},last_dm_sent_at.gte.${since}`).limit(5000)
  if (error) throw new Error(error.message)
  const stop = new Set<string>(), touch = new Set<string>()
  for (const p of (data ?? []) as Array<{ company_domain: string; reply_count: number | null; last_reply_at: string | null; call_booked_at: string | null; connection_sent_at: string | null; last_dm_sent_at: string | null; connected_at: string | null }>) {
    const d = domainOf(p.company_domain)
    if (!d) continue
    if (p.call_booked_at || Number(p.reply_count) > 0 || p.last_reply_at) stop.add(d)
    const t = Math.max(p.connection_sent_at ? Date.parse(p.connection_sent_at) : 0, !p.connected_at && p.last_dm_sent_at ? Date.parse(p.last_dm_sent_at) : 0)
    if (t && now - t < 7 * DAY) touch.add(d)
  }
  return { stop, touch }
}

/** Saturday in New York: the shared Ivan/Rise sender invites profile viewers only (`_weekendViewOnly`). */
export function isSaturdayNy(now: number): boolean {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date(now)) === 'Sat'
}

/** THE read: config (3 small selects), ONE candidate select over the three seats' live campaigns, and the Rise domain list. */
export async function fetchReady(now = Date.now()): Promise<ReadyRead> {
  const [{ cfg, camps, scorer }, supply] = await Promise.all([config(), supabase.rpc('inbox_rise_ready')])
  if (supply.error) throw new Error(supply.error.message)
  if (!supply.data || !Number.isInteger(supply.data.ready_count) || supply.data.ready_count < 0 || !Array.isArray(supply.data.ready_ids)) throw new Error('RISE ready stock could not be verified')
  const ivanIds = new Set(camps.filter(c => live(c) && c.client_id == null).map(c => c.id))
  const riseLive = new Set(Object.values(RISE).filter(id => camps.some(c => c.id === id && live(c))))
  const archLive = new Set(ARCH_IDS.filter(id => camps.some(c => c.id === id && live(c))))
  const ids = [...ivanIds, ...riseLive, ...archLive]
  const riseAll = camps.filter(c => c.client_id === 'risedtc').map(c => c.id)
  // The retry branch is narrowed in the query to what the retry lane can take (its campaigns, 42 days since
  // the withdrawn invite), and the select pages, so a big pool never truncates into a silent undercount.
  const retry = `and(skip_reason.eq.invite_withdrawn_stale,icp_score.gte.7,reply_count.eq.0,connection_sent_at.lte.${iso(now - 42 * DAY)},campaign_id.in.(${IVAN_RETRY.join(',')}))`
  const page = (from: number) => supabase.from('outreach_prospects').select(COLS).in('campaign_id', ids).eq('blacklisted', false).is('connected_at', null)
    .or(`and(connection_sent_at.is.null,stage.in.(enriched,identified,queued,dm_sent,inmail_ready)),${retry}`)
    .order('id').range(from, from + PAGE - 1)
  const candidates = async (): Promise<{ rows: Cand[]; capped: boolean }> => {
    const rows: Cand[] = []
    for (let i = 0; i < MAX_PAGES; i++) {
      const { data, error } = await page(i * PAGE)
      if (error) throw new Error(error.message)
      const got = (data ?? []) as unknown as Cand[]
      rows.push(...got)
      if (got.length < PAGE) return { rows, capped: false }
    }
    return { rows, capped: true }
  }
  const [cand, dom] = await Promise.all([
    ids.length ? candidates() : Promise.resolve({ rows: [] as Cand[], capped: false }),
    cfg.rise_company_expansion === 'on' && riseAll.length ? riseDomains(riseAll, now) : Promise.resolve({ stop: new Set<string>(), touch: new Set<string>() }),
  ])
  const rows = cand.rows
  return buildReady(rows, { now, cfg, scorer, ivanIds, riseLive, archLive, stop: dom.stop, touch: dom.touch, satNy: isSaturdayNy(now), riseReadyIds: new Set(supply.data.ready_ids), riseReadyCount: supply.data.ready_count }, cand.capped)
}

/** One seat's lanes, busiest first; the total counts only lanes the sender would pick today. Governor warm-only drops Ivan's cold. */
export function readyOf(r: ReadyRead, seat: Seat, gov?: GovernorRow | null): ReadySeat {
  const lanes = r.lanes.filter(l => l.seat === seat).map(l =>
    ['retry', 'reconnect'].includes(l.lane) ? { ...l, off: l.off ?? 'Previously contacted; excluded from fresh stock' } :
    seat === 'risedtc' && l.lane !== 'engager' ? { ...l, label: l.label + ' candidates', off: l.off ?? 'Qualification not yet verified for this stock count' } :
    seat === 'ivan' && l.lane === 'cold' && !l.off && gov && gov.mode !== 'normal' ? { ...l, off: gov.mode === 'warm_only' ? 'warm only this week' : 'cold paused' } : l)
    .sort((a, b) => Number(Boolean(a.off)) - Number(Boolean(b.off)) || b.n - a.n)
  return { total: lanes.filter(l => !l.off).reduce((a, l) => a + l.n, 0), lanes }
}
