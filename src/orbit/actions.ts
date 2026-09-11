// src/orbit/actions.ts — the ONLY writes the /orbit surface makes.
//
// Every write below targets `outreach_prospects` (never any other table),
// rides the operator's own Supabase JWT under RLS, and ALWAYS re-selects the
// row it just touched (`.select('id')`) and THROWS if that comes back empty —
// PostgREST answers a silent 204 to an UPDATE/INSERT that RLS quietly
// filtered away, and a caller that ignored that would report "queued" for a
// write that never actually landed. Pattern lifted verbatim from
// src/lib/inbox.ts's discardDraft/restoreDraft (p0-inbox.md §7).
//
// NOTHING HERE SENDS ANYTHING. There is no DM text anywhere in this file —
// every action is a stage/flag change on a database row that an existing,
// separately-reviewed sender workflow may later pick up.

import { supabase } from '../lib/supabase'
import type { OrbitLane, OrbitPerson, OrbitPost, OrbitTenant } from './types'

// ---------------------------------------------------------------------------
// The raw prospect row pickability() and queueInvite() need. OrbitPerson (the
// graph payload) deliberately does not carry these — they are sender-gate
// fields, not graph-rendering fields — so this is a small, explicit read
// straight off outreach_prospects by id. `enrichment_data` is a jsonb blob;
// `icp_floor_waived` and ARCH's hold flags live INSIDE it, not as their own
// columns (coordinator correction, 2026-09-11).
// ---------------------------------------------------------------------------
export interface ProspectRow {
  id: string
  stage: string | null
  blacklisted: boolean | null
  country: string | null
  scorer_version: string | null
  preferred_channel: string | null
  connection_sent_at: string | null
  connected_at: string | null
  last_dm_sent_at: string | null
  skip_state: string | null
  icp_score: number | null
  trigger_type: string | null
  trigger_confidence: number | null
  campaign_id: string | null
  enrichment_data: Record<string, unknown> | null
}

const PROSPECT_ROW_COLS =
  'id,stage,blacklisted,country,scorer_version,preferred_channel,connection_sent_at,connected_at,last_dm_sent_at,' +
  'skip_state,icp_score,trigger_type,trigger_confidence,campaign_id,enrichment_data'

/** Read-only: the current sender-gate fields for one prospect. Not a write,
 *  so it carries none of the guard/throw discipline below. */
export async function fetchProspectRow(pid: string): Promise<ProspectRow | null> {
  const { data, error } = await supabase.from('outreach_prospects')
    .select(PROSPECT_ROW_COLS).eq('id', pid).maybeSingle()
  if (error) throw error
  return data as ProspectRow | null
}

/** Best-effort: whether a campaign is currently active. Never throws — a
 *  failed read here must not block or misreport a write that already
 *  succeeded; it degrades to "unknown" (null), which pickability treats as
 *  not-a-blocker rather than a false negative. */
async function fetchCampaignActive(campaignId: string | null): Promise<boolean | null> {
  if (!campaignId) return null
  const { data, error } = await supabase.from('outreach_campaigns')
    .select('is_active,archived').eq('id', campaignId).maybeSingle()
  if (error || !data) return null
  return Boolean(data.is_active) && !data.archived
}

// ---------------------------------------------------------------------------
// pickability — mirrors the REAL sender filters (verified against the live
// workflows, not just 00-scope.md's summary — see the per-tenant comments
// below). Honest by construction: a blocker string only ever names a
// condition the real sender workflow checks, never something invented for
// this UI. `campaignActive` / `campaignLane` are stamped on by the caller
// from graph.lanes, since they live on the campaign, not the prospect row.
// ---------------------------------------------------------------------------
export interface PickabilityRow extends ProspectRow {
  campaignActive: boolean | null
  campaignLane: string | null
}

export interface Pickability { ok: boolean; blockers: string[] }

// Ivan — Connection Request Sender (5ZXtArhobWrDDpfJ). Verified against the
// LIVE query by a real replay row (goal-runs/signal-orbit-live-2026-09-11-out/
// evidence/g7-action-replay.txt), not just 00-scope.md's summary:
// stage=enriched & blacklisted=false & country not null & scorer_version set
// & preferred_channel null-or-linkedin & icp_score>=6. Two things the replay
// disproved from the first pass: `skip_state` is NOT in this sender's
// candidate query at all (it only gates the RISE branches), so it is
// deliberately NOT a blocker here; and `scorer_version` is stamped by a DB
// trigger on insert (currently 7..17, computed at runtime from
// content_prompts), so this only checks presence, never a hardcoded range.
// icp_score === 0 is reported separately from "icp too low" — it means
// Outreach - Re-score Pending (xz9YK8QVrDN5Jo7i) has not scored it yet.
function ivanPickability(row: PickabilityRow): Pickability {
  const blockers: string[] = []
  if (row.stage !== 'enriched') blockers.push(`stage is ${row.stage ?? 'unset'}, the sender needs enriched`)
  if (!row.country) blockers.push('no country on file yet')
  if (row.icp_score === 0) blockers.push('ICP score is 0 — still awaiting re-score')
  else if ((row.icp_score ?? -1) < 6) blockers.push(`ICP ${row.icp_score ?? 'unscored'} is under 6`)
  if (row.blacklisted) blockers.push('blacklisted')
  if (row.connection_sent_at) blockers.push('already invited (connection request sent)')
  if (row.preferred_channel === 'email') blockers.push('preferred channel is email, not LinkedIn')
  if (!row.scorer_version) blockers.push('scorer version unknown (not yet stamped)')
  return { ok: blockers.length === 0, blockers }
}

// RISE picker: stage in (identified,enriched) & connection_sent_at null &
// last_dm_sent_at null & country not null & skip_state null & campaign active.
function risePickability(row: PickabilityRow): Pickability {
  const blockers: string[] = []
  if (!(row.stage === 'identified' || row.stage === 'enriched')) blockers.push(`stage is ${row.stage ?? 'unset'}, the sender needs identified or enriched`)
  if (row.connection_sent_at) blockers.push('connection already sent')
  if (row.last_dm_sent_at) blockers.push('DM already sent')
  if (!row.country) blockers.push('no country')
  if (row.skip_state) blockers.push(`skipped: ${row.skip_state}`)
  if (row.campaignActive === false) blockers.push('campaign is not active')
  return { ok: blockers.length === 0, blockers }
}

// ARCH sender (9FpJ1cUqoEPTCeP2): stage='queued' & (icp>=7 OR
// enrichment_data.icp_floor_waived=true) & a lane tag on the campaign & no
// lang_hold/copy_hold. The waive flag and the holds live INSIDE
// enrichment_data, not as their own columns.
function archPickability(row: PickabilityRow): Pickability {
  const blockers: string[] = []
  if (row.stage !== 'queued') blockers.push(`stage is ${row.stage ?? 'unset'}, the sender needs queued`)
  const ed = (row.enrichment_data ?? {}) as { icp_floor_waived?: boolean; lang_hold?: boolean; copy_hold?: boolean }
  const icpOk = (row.icp_score ?? -1) >= 7
  if (!icpOk && ed.icp_floor_waived !== true) blockers.push(`ICP ${row.icp_score ?? 'unscored'} is under 7 and not floor-waived`)
  if (!row.campaignLane) blockers.push('campaign carries no lane tag')
  if (ed.lang_hold) blockers.push('on lang_hold')
  if (ed.copy_hold) blockers.push('on copy_hold')
  if (row.skip_state) blockers.push(`on hold: ${row.skip_state}`)
  return { ok: blockers.length === 0, blockers }
}

/** `{ok, blockers}` — honest, never "queued ✓" if the real sender workflow
 *  will not actually see this row. */
export function pickability(tenant: OrbitTenant, row: PickabilityRow): Pickability {
  if (tenant === 'ivan') return ivanPickability(row)
  if (tenant === 'risedtc') return risePickability(row)
  return archPickability(row)
}

// ---------------------------------------------------------------------------
// The exact-effect copy PersonPanel/PostPanel show BEFORE the tap. These are
// prose, not logic — kept beside pickability() so the two never drift.
// ---------------------------------------------------------------------------
export function queueInviteEffect(tenant: OrbitTenant): string {
  if (tenant === 'ivan') return 'Sets stage → enriched, trigger engaged_post (min. confidence 3); the Ivan sender picks it up once country, scorer_version and ICP clear its lane rule.'
  if (tenant === 'risedtc') return 'Sets stage → enriched and clears any skip; the RISE sender picks it up once country is present and no invite/DM has gone out yet.'
  return 'Sets stage → queued; the ARCH sender picks it up once ICP ≥ 7 (or floor-waived) and no hold is set.'
}

// Ivan's Connection Request Sender does not read skip_state at all (verified
// by replay — see skip() below), so its own copy has to say what ACTUALLY
// stops the row: a stage move, not a skip flag.
export function skipEffect(tenant: OrbitTenant): string {
  if (tenant === 'ivan') return 'Removes them from the send line (stage → skipped); the Ivan sender only ever picks stage=enriched. Nothing is sent or deleted.'
  if (tenant === 'risedtc') return 'Sets skip_state → manual_skip; the RISE sender excludes any row with skip_state set. Nothing is sent or deleted.'
  return 'Moves the row off stage=queued into ballot_hold; the ARCH sender only ever picks stage=queued. Nothing is sent or deleted.'
}

export function addToLaneEffect(tenant: OrbitTenant, campaignName: string): string {
  if (tenant === 'ivan') {
    return `Inserts a new outreach_prospects row on "${campaignName}" awaiting re-score (icp_score 0, skip_reason needs_rescore) and geo resolution. It becomes sendable after scoring and geo resolution, usually within a day. Nothing is sent.`
  }
  const stageNote = tenant === 'arch' ? 'queued (ICP ≥ 7) or ballot_hold (ICP < 7)' : 'enriched/identified'
  return `Inserts a new outreach_prospects row on "${campaignName}" at stage ${stageNote}, attributed to this post/profile touch. Nothing is sent.`
}

/** The exact success copy, per tenant. Ivan's row is never immediately
 *  sendable (it awaits re-score + geo) — never say "queued ✓" here. */
export function addToLaneSuccessNote(tenant: OrbitTenant): string {
  if (tenant === 'ivan') return 'Added. It becomes sendable after scoring and geo resolution, usually within a day.'
  return 'Added.'
}

// ---------------------------------------------------------------------------
// queueInvite — flips an EXISTING prospect row into the sender's queue.
// Refuses (returns a blocker, never writes) when the row already has a live
// thread (connection_sent_at / connected_at / last_dm_sent_at) or is
// blacklisted — never rewind a live thread. After a successful write,
// re-runs pickability on the fresh row so the caller can show honestly what,
// if anything, still blocks it (never assume the write alone made it live).
// ---------------------------------------------------------------------------
export type WriteResult = { ok: true; remaining: Pickability } | { ok: false; blocker: string }

export async function queueInvite(tenant: OrbitTenant, pid: string): Promise<WriteResult> {
  const row = await fetchProspectRow(pid)
  if (!row) return { ok: false, blocker: 'prospect row not found' }
  if (row.blacklisted) return { ok: false, blocker: 'blacklisted' }
  if (row.connection_sent_at || row.connected_at || row.last_dm_sent_at) return { ok: false, blocker: 'already invited' }

  const patch = tenant === 'ivan'
    ? {
        stage: 'enriched',
        trigger_type: row.trigger_type ?? 'engaged_post',
        trigger_confidence: Math.max(row.trigger_confidence ?? 0, 3),
        skip_state: null,
        skip_state_reason: null,
      }
    : tenant === 'risedtc'
    ? { stage: 'enriched', skip_state: null }
    : { stage: 'queued' }

  const { data, error } = await supabase.from('outreach_prospects').update(patch).eq('id', pid).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('queueInvite: the write did not land (RLS filtered it away)')

  const fresh = await fetchProspectRow(pid)
  const campaignActive = await fetchCampaignActive(fresh?.campaign_id ?? row.campaign_id)
  const remaining = fresh
    ? pickability(tenant, { ...fresh, campaignActive, campaignLane: null })
    : { ok: true, blockers: [] }
  return { ok: true, remaining }
}

// ---------------------------------------------------------------------------
// skip — files the row out of the sender's pick, by hand. TENANT-AWARE:
// `skip_state='manual_skip'` alone does NOT stop an Ivan invite — replayed
// against the live DB, a row with skip_state set, icp 8, country present
// still came back sendable from the Connection Request Sender's verbatim
// query (skip_state appears only in the RISE branches + a send-time geo-gate
// write). `stage='skipped'` is what actually removes it there; skip_state is
// still stamped alongside it for the audit trail and any RISE-style reader.
// ARCH's skip_state CHECK only allows data_thin/manual_skip/vertical_gate/
// qa_halted with lane-specific meanings, so ARCH is skipped by moving it off
// stage='queued' instead — never by writing skip_state.
// ---------------------------------------------------------------------------
export async function skip(tenant: OrbitTenant, pid: string, reason = 'orbit:operator'): Promise<void> {
  const nowIso = new Date().toISOString()
  const patch = tenant === 'ivan'
    ? { stage: 'skipped', skip_reason: 'orbit:operator_skip', skip_state: 'manual_skip', skip_state_reason: reason, skip_state_at: nowIso }
    : tenant === 'risedtc'
    ? { skip_state: 'manual_skip', skip_state_reason: reason, skip_state_at: nowIso }
    : { stage: 'ballot_hold', skip_reason: 'orbit:operator_skip' }
  const { data, error } = await supabase.from('outreach_prospects').update(patch).eq('id', pid).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('skip: the write did not land (RLS filtered it away)')
}

// ---------------------------------------------------------------------------
// addToLane — inserts a brand-new outreach_prospects row for a person who has
// none yet (a pure content touch: an engager or a profile viewer never
// campaigned). Never targets a cold campaign — the caller must only offer
// campaigns from filters.pickableLanes(graph.lanes).
//
// Ivan's shape mirrors the canonical harvester intake (Outreach - Engagement
// Harvest → Prospects) rather than a hand-made "enriched + our own score"
// row: icp_score 0 + skip_reason='needs_rescore' hands scoring to Outreach -
// Re-score Pending (xz9YK8QVrDN5Jo7i, ACTIVE), which writes the real ICP and
// clears skip_reason once it clears >=7. Writing a score ourselves here would
// forge a judgement that workflow owns — a real incident cost 91 invites in
// August. country is left null; a seatless enrichment branch fills it for
// any row carrying enrichment_data.lane === 'orbit_add' (that exact marker
// is load-bearing — do not rename it).
// ---------------------------------------------------------------------------
export type AddToLaneResult =
  | { ok: true; already: false; prospectId: string }
  | { ok: true; already: true; prospectId: string }

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  const msg = (error as { message?: string } | null)?.message ?? ''
  return code === '23505' || /linkedin_url/i.test(msg)
}

export async function addToLane(args: {
  tenant: OrbitTenant
  person: OrbitPerson
  campaignId: string
  post?: OrbitPost | null
}): Promise<AddToLaneResult> {
  const { tenant, person, campaignId, post } = args
  const nowIso = new Date().toISOString()

  const identity = {
    campaign_id: campaignId,
    linkedin_url: person.url,
    linkedin_profile_id: person.mid,
    name: person.n,
    headline: person.ti,
  }
  const attribution = {
    trigger_type: post ? 'engaged_post' : 'profile_view',
    trigger_confidence: 3,
    trigger_source_url: post?.url ?? null,
    attribution: post ? 'post_touch' : 'no_post_touch',
    attributed_post_id: post?.row ?? null,
    attribution_meta: { source: 'orbit', post: post?.id ?? null, kind: post ? 'post_touch' : 'no_post_touch', at: nowIso },
  }
  // Load-bearing marker: a separate orbit-harvest enrichment branch fills
  // `country` for rows carrying this exact `lane` value.
  const enrichment_data = { lane: 'orbit_add', orbit_added_at: nowIso }

  const insertRow = tenant === 'ivan'
    ? {
        ...identity, ...attribution,
        stage: 'enriched',
        icp_score: 0,
        skip_reason: 'needs_rescore',
        rescore_attempts: 0,
        send_priority: 2,
        blacklisted: false,
        preferred_channel: null,
        enrichment_data,
      }
    : {
        ...identity, ...attribution,
        icp_score: person.i,
        stage: tenant === 'arch'
          ? ((person.i ?? 0) >= 7 ? 'queued' : 'ballot_hold')
          : (person.i != null ? 'enriched' : 'identified'),
        enrichment_data,
      }

  const { data, error } = await supabase.from('outreach_prospects').insert(insertRow).select('id')
  if (error) {
    if (!isUniqueViolation(error)) throw error
    // linkedin_url is UNIQUE: this person already has a prospect row somewhere.
    // Surface it as "already", pointing the caller at Open thread instead of
    // silently failing or duplicating.
    const existing = await supabase.from('outreach_prospects').select('id').eq('linkedin_url', person.url).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) throw error
    return { ok: true, already: true, prospectId: existing.data.id }
  }
  if (!data || data.length === 0) throw new Error('addToLane: the write did not land (RLS filtered it away)')
  return { ok: true, already: false, prospectId: data[0].id }
}

// Re-exported so panels never have to import OrbitLane just to type a picker prop.
export type { OrbitLane }
