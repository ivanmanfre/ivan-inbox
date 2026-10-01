import { supabase } from './supabase'
import { CLIENT_OPS_GATE } from './content'
import type { Lane } from '../d/content/model'

// View contracts remain explicit: a missing metric never becomes zero.
export type BrainMetrics = {
  published_n: number; engagement_n: number; engagement_median: number | null
  impressions_n: number; impressions_median: number | null
  above_floor_p75_n: number | null; above_floor_p75_eligible_n: number; above_floor_p75_share: number | null
  relevant_scored_engager_posts_n: number; scored_engagers_total: number | null; relevant_engagers_total: number | null
  relevant_engagers_per_post: number | null
}
export type BrainFloor = {
  client_id: Lane; frozen_at: string; observed_through: string
  window_start: string; window_end_exclusive: string; window_complete: boolean
  metric_basis: string; published_n: number; engagement_n: number
  engagement_median: number | null; engagement_p75: number | null
  impressions_n: number; impressions_median: number | null; impressions_p75: number | null
  first_published_at: string | null; last_published_at: string | null
  source_rows_sha256: string; limitation: string
}
export type BrainScoreboardData = {
  client: Lane; refresh_status: 'ready' | 'not_refreshed'; as_of: string | null; refreshed_at: string | null; stale: boolean
  source_posts_sha256: string | null; metric_basis: string | null
  floor: BrainFloor | null
  cohort: { status: 'no_cohort' | 'early' | 'inconclusive' | 'measured'; brain_published_n: number
    unlinked_brain_n: number; weeks_utc: string[]; comparison_status: 'no_cohort' | 'identity_unresolved' | 'no_other_posts' | 'missing_metrics' | 'available'; comparison_available: boolean; brain: BrainMetrics; other: BrainMetrics } | null
  rolling_4w: { start_at: string; end_exclusive: string; account: BrainMetrics
    engagement_vs_floor_ratio: number | null; impressions_vs_floor_ratio: number | null
    engagement_vs_floor_delta: number | null; impressions_vs_floor_delta: number | null
    engagement_ratio_reason: string | null; impressions_ratio_reason: string | null } | null
  limitations: string[]
}

export type RepeatEngager = {
  personKey: string; name: string | null; profileUrl: string | null
  engagedPosts: number; totalEvents: number; firstSeen: string; lastSeen: string
  confirmedReturn: boolean; postsComplete: boolean; returnTiming: string; relationshipState: string; relationshipBasis: string
  posts: { postId: string; platform: 'linkedin'; url: string | null; publishedAt: string | null }[]
}
export type RepeatEngagersData = {
  client: Lane; state: 'ready' | 'source_unavailable'; reason: string | null
  rows: RepeatEngager[]; returned: number; nextAfterPerson: string | null; limitation: string; sendCapable: false
}
export type OutlierRef = { platform: 'linkedin' | 'x'; post_ref: string }
export type HumanOutlierLabel = OutlierRef & {
  client: Lane; verdict: 'keep' | 'drop'; reason: string | null; actorUid: string
  createdAt: string; updatedAt: string; version: string; canEdit: boolean; undoInvocationId: string | null
}
export type CalibrationState = { state: 'waiting_for_labels' | 'queued' | 'running' | 'review_required'; labelN: number; requiredN: 30; reason: string; runnerReady: boolean }
export type OutlierLabelsData = { client: Lane; rows: HumanOutlierLabel[]; calibration: CalibrationState }
export type LabelMutation = { client: Lane; label: HumanOutlierLabel | null; calibration: CalibrationState; invocationId: string; auditId: string; mutationAt: string }
export type AccountRead<T> = { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'ready'; data: T }
export const brainNumber = (n: number | null): string => n == null ? 'Not recorded' : n.toLocaleString('en-US', { maximumFractionDigits: 1 })
export const brainDate = (value: string | null): string => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'Date not recorded'
export const safeBrainUrl = (value: string | null): string | null => value && /^https:\/\//i.test(value) ? value : null

const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const str = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v : null
const numeric = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null
const numberOrNull = (v: unknown, field: string): number | null => { if (v === null) return null; const n = numeric(v); if (n == null) throw new Error(`Brain data is missing ${field}.`); return n }
const count = (v: unknown, field: string): number => { const n = numeric(v); if (n == null || !Number.isInteger(n) || n < 0) throw new Error(`Brain data has an invalid ${field}.`); return n }
const countOrNull = (v: unknown, field: string): number | null => v === null ? null : count(v, field)
const string = (v: unknown, field: string): string => { const s = str(v); if (!s) throw new Error(`Brain data is missing ${field}.`); return s }
const nullableString = (v: unknown, field: string): string | null => v === null ? null : string(v, field)
function scoped(raw: unknown, lane: Lane): Record<string, unknown> { const d = obj(raw); if (d.ok !== true || d.client !== lane) throw new Error('Brain data returned no usable data for this client.'); return d }
function metric(raw: unknown): BrainMetrics {
  const r = obj(raw)
  const m: BrainMetrics = { published_n: count(r.published_n, 'published count'), engagement_n: count(r.engagement_n, 'engagement count'), engagement_median: numberOrNull(r.engagement_median, 'engagement median'), impressions_n: count(r.impressions_n, 'impressions count'), impressions_median: numberOrNull(r.impressions_median, 'impressions median'), above_floor_p75_n: countOrNull(r.above_floor_p75_n, 'above-floor count'), above_floor_p75_eligible_n: count(r.above_floor_p75_eligible_n, 'above-floor coverage'), above_floor_p75_share: numberOrNull(r.above_floor_p75_share, 'above-floor share'), relevant_scored_engager_posts_n: count(r.relevant_scored_engager_posts_n, 'scored-engager posts'), scored_engagers_total: numberOrNull(r.scored_engagers_total, 'scored-engager total'), relevant_engagers_total: numberOrNull(r.relevant_engagers_total, 'relevant-engager total'), relevant_engagers_per_post: numberOrNull(r.relevant_engagers_per_post, 'relevant engagers per post') }
  if (m.engagement_n > m.published_n || m.impressions_n > m.published_n || (m.above_floor_p75_n != null && m.above_floor_p75_n > m.above_floor_p75_eligible_n) || m.above_floor_p75_eligible_n > m.engagement_n || m.relevant_scored_engager_posts_n > m.published_n || Object.entries(m).some(([k, v]) => k !== 'published_n' && v != null && v < 0) || (m.above_floor_p75_share != null && m.above_floor_p75_share > 1)) throw new Error('Brain metric coverage is inconsistent.')
  return m
}
function parseFloor(raw: unknown, lane: Lane): BrainFloor | null {
  if (raw === null) return null
  const f = obj(raw)
  if (f.client_id !== lane || typeof f.window_complete !== 'boolean') throw new Error('The frozen floor returned a different client or incomplete metadata.')
  return { client_id: lane, frozen_at: string(f.frozen_at, 'floor frozen date'), observed_through: string(f.observed_through, 'floor observation date'), window_start: string(f.window_start, 'floor start'), window_end_exclusive: string(f.window_end_exclusive, 'floor end'), window_complete: f.window_complete, metric_basis: string(f.metric_basis, 'floor metric basis'), published_n: count(f.published_n, 'floor published count'), engagement_n: count(f.engagement_n, 'floor engagement count'), engagement_median: numberOrNull(f.engagement_median, 'floor engagement median'), engagement_p75: numberOrNull(f.engagement_p75, 'floor engagement p75'), impressions_n: count(f.impressions_n, 'floor impressions count'), impressions_median: numberOrNull(f.impressions_median, 'floor impressions median'), impressions_p75: numberOrNull(f.impressions_p75, 'floor impressions p75'), first_published_at: nullableString(f.first_published_at, 'first publication'), last_published_at: nullableString(f.last_published_at, 'last publication'), source_rows_sha256: string(f.source_rows_sha256, 'floor source hash'), limitation: string(f.limitation, 'floor limitation') }
}
export function parseBrainScoreboard(raw: unknown, lane: Lane): BrainScoreboardData {
  const d = scoped(raw, lane)
  if (d.refresh_status !== 'ready' && d.refresh_status !== 'not_refreshed') throw new Error('The scoreboard refresh status is missing.')
  if (typeof d.stale !== 'boolean' || !Array.isArray(d.limitations)) throw new Error('The scoreboard metadata is incomplete.')
  const base = { client: lane, refresh_status: d.refresh_status, as_of: nullableString(d.as_of, 'as-of date'), refreshed_at: nullableString(d.refreshed_at, 'refresh date'), stale: d.stale, floor: parseFloor(d.floor, lane), source_posts_sha256: str(d.source_posts_sha256), metric_basis: str(d.metric_basis), limitations: d.limitations.filter((x): x is string => typeof x === 'string' && !!x.trim()) }
  if (d.refresh_status === 'not_refreshed') {
    if (d.cohort !== null || d.rolling_4w !== null) throw new Error('An unrefreshed scoreboard contains unsupported results.')
    return { ...base, refresh_status: 'not_refreshed', cohort: null, rolling_4w: null }
  }
  const c = obj(d.cohort), r = obj(d.rolling_4w)
  if (!['no_cohort', 'early', 'measured', 'inconclusive'].includes(String(c.status)) || !['no_cohort', 'identity_unresolved', 'no_other_posts', 'missing_metrics', 'available'].includes(String(c.comparison_status)) || typeof c.comparison_available !== 'boolean' || !Array.isArray(c.weeks_utc) || c.weeks_utc.some(w => typeof w !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(w))) throw new Error('The scoreboard comparison is incomplete.')
  if (c.status === 'no_cohort' && (c.brain_published_n !== 0 || c.unlinked_brain_n !== 0 || c.weeks_utc.length !== 0 || c.comparison_available || c.comparison_status !== 'no_cohort' || obj(c.brain).published_n !== 0 || obj(c.other).published_n !== 0)) throw new Error('The no-cohort scoreboard contradicts its publication counts.')
  const ratioReason = (v: unknown) => v === null ? null : ['no_metrics', 'no_floor', 'zero_floor'].includes(String(v)) ? String(v) : (() => { throw new Error('The scoreboard ratio reason is invalid.') })()
  return { ...base, refresh_status: 'ready', cohort: { status: c.status as NonNullable<BrainScoreboardData['cohort']>['status'], brain_published_n: count(c.brain_published_n, 'brain publication count'), unlinked_brain_n: count(c.unlinked_brain_n, 'unlinked brain count'), weeks_utc: c.weeks_utc as string[], comparison_status: c.comparison_status as NonNullable<BrainScoreboardData['cohort']>['comparison_status'], comparison_available: c.comparison_available, brain: metric(c.brain), other: metric(c.other) }, rolling_4w: { start_at: string(r.start_at, 'rolling start'), end_exclusive: string(r.end_exclusive, 'rolling end'), account: metric(r.account), engagement_vs_floor_ratio: numberOrNull(r.engagement_vs_floor_ratio, 'engagement ratio'), impressions_vs_floor_ratio: numberOrNull(r.impressions_vs_floor_ratio, 'impressions ratio'), engagement_vs_floor_delta: numberOrNull(r.engagement_vs_floor_delta, 'engagement delta'), impressions_vs_floor_delta: numberOrNull(r.impressions_vs_floor_delta, 'impressions delta'), engagement_ratio_reason: ratioReason(r.engagement_ratio_reason), impressions_ratio_reason: ratioReason(r.impressions_ratio_reason) } }
}
export function parseRepeatEngagers(raw: unknown, lane: Lane): RepeatEngagersData {
  const d = scoped(raw, lane)
  if (!['ready', 'source_unavailable'].includes(String(d.state)) || d.send_capable !== false || !Array.isArray(d.rows)) throw new Error('The repeat-engager reader returned an unsupported state.')
  const seen = new Set<string>()
  const rows = d.rows.map(x => {
    const r = obj(x), key = string(r.person_key, 'person identity')
    if (r.client_id !== lane || seen.has(key) || typeof r.confirmed_return !== 'boolean' || typeof r.posts_complete !== 'boolean' || !Array.isArray(r.posts)) throw new Error('The repeat-engager identity or source is invalid.')
    seen.add(key)
    const posts = r.posts.map(x => { const p = obj(x); if (p.platform !== 'linkedin') throw new Error('The engaged post platform is invalid.'); return { postId: string(p.post_ref, 'engaged post identity'), platform: 'linkedin' as const, publishedAt: nullableString(p.published_at, 'post publication date'), url: safeBrainUrl(str(p.url)) } })
    return { personKey: key, name: str(r.name), profileUrl: safeBrainUrl(str(r.linkedin_url)), engagedPosts: count(r.distinct_posts, 'distinct engaged posts'), totalEvents: count(r.total_events, 'engagement events'), firstSeen: string(r.first_observed_at, 'first observation'), lastSeen: string(r.last_observed_at, 'last observation'), confirmedReturn: r.confirmed_return, postsComplete: r.posts_complete, returnTiming: string(r.return_timing, 'return timing'), relationshipState: string(r.relationship_state, 'relationship state'), relationshipBasis: string(r.relationship_basis, 'relationship basis'), posts }
  })
  if (d.state === 'source_unavailable' && rows.length) throw new Error('Unavailable engager evidence contains unsupported people.')
  if (rows.some(r => r.engagedPosts < 2 || r.totalEvents < r.engagedPosts)) throw new Error('A repeat-engager row lacks two distinct posts.')
  const returned = count(d.returned, 'returned people')
  if (returned !== rows.length) throw new Error('The repeat-engager count does not match its rows.')
  return { client: lane, state: d.state as RepeatEngagersData['state'], reason: nullableString(d.reason, 'engager reason'), rows, returned, nextAfterPerson: nullableString(d.next_after_person, 'engager cursor'), limitation: string(d.limitation, 'engager limitation'), sendCapable: false }
}
function calibration(raw: unknown): CalibrationState {
  const c = obj(raw)
  if (!['waiting_for_labels', 'queued', 'running', 'review_required'].includes(String(c.state)) || c.required_n !== 30) throw new Error('The human-label calibration status is invalid.')
  if ((c.state === 'queued' || c.state === 'running') && c.runner_ready !== true) throw new Error('The calibration worker has not been confirmed available.')
  return { state: c.state as CalibrationState['state'], labelN: count(c.label_n, 'human labels'), requiredN: 30, reason: string(c.reason, 'calibration reason'), runnerReady: c.runner_ready === true }
}
function humanLabel(raw: unknown, lane: Lane): HumanOutlierLabel {
  const r = obj(raw)
  if (r.client_id !== lane || (r.platform !== 'linkedin' && r.platform !== 'x') || (r.label !== 'keep' && r.label !== 'drop') || typeof r.can_edit !== 'boolean') throw new Error('A human label returned a different source or client.')
  return { client: lane, platform: r.platform, post_ref: string(r.post_ref, 'label source'), verdict: r.label, reason: nullableString(r.reason, 'label reason'), actorUid: string(r.actor_uid, 'label actor'), createdAt: string(r.created_at, 'label creation'), updatedAt: string(r.updated_at, 'label update'), version: string(r.revision, 'label revision'), canEdit: r.can_edit, undoInvocationId: null }
}
export function parseOutlierLabels(raw: unknown, lane: Lane, refs: OutlierRef[]): OutlierLabelsData {
  const d = scoped(raw, lane)
  if (!Array.isArray(d.rows)) throw new Error('The human-label read is incomplete.')
  const wanted = new Set(refs.map(r => `${r.platform}:${r.post_ref}`)), seen = new Set<string>()
  const rows = d.rows.map(x => { const r = humanLabel(x, lane), key = `${r.platform}:${r.post_ref}`; if (!wanted.has(key) || seen.has(key)) throw new Error('A human label returned an unexpected source.'); seen.add(key); return r })
  return { client: lane, rows, calibration: calibration(d.calibration) }
}
function parseLabelMutation(raw: unknown, lane: Lane, ref: OutlierRef, invocationId: string, undo: boolean): LabelMutation {
  const d = scoped(raw, lane), label = d.label === null ? null : humanLabel(d.label, lane)
  if ((!undo && !label) || (label && (label.platform !== ref.platform || label.post_ref !== ref.post_ref)) || d.invocation_id !== invocationId || !(typeof d.audit_id === 'number' && Number.isSafeInteger(d.audit_id) && d.audit_id > 0 || typeof d.audit_id === 'string' && /^[1-9][0-9]*$/.test(d.audit_id))) throw new Error('The label mutation has no matching durable receipt. Refresh before trying again.')
  if (!undo && label) { const u = obj(d.undo); if (u.invocation_id !== invocationId || u.revision !== label.version) throw new Error('The label receipt is missing its guarded Undo identity.'); label.undoInvocationId = invocationId }
  return { client: lane, label, calibration: calibration(d.calibration), invocationId, auditId: String(d.audit_id), mutationAt: string(d.mutation_at, 'mutation time') }
}
async function rpc(name: string, args: Record<string, unknown>, signal?: AbortSignal) {
  const q = supabase.rpc(name, args)
  const { data, error } = await (signal ? q.abortSignal(signal) : q)
  if (error) throw new Error(error.code === 'PGRST202' || error.code === '42883' ? 'This Brain service is not available yet.' : error.message || 'The brain read could not be completed.')
  return data
}
export async function fetchBrainScoreboard(lane: Lane, signal?: AbortSignal) { return parseBrainScoreboard(await rpc('cb34_scoreboard', { p_gate: CLIENT_OPS_GATE, p_client: lane }, signal), lane) }
export async function fetchRepeatEngagers(lane: Lane, after: string | null = null, signal?: AbortSignal) { return parseRepeatEngagers(await rpc('cb34_repeat_engagers', { p_gate: CLIENT_OPS_GATE, p_client: lane, p_limit: 100, p_after_person: after }, signal), lane) }
export async function fetchOutlierLabels(lane: Lane, refs: OutlierRef[], signal?: AbortSignal): Promise<OutlierLabelsData> {
  // Catalogue pages can grow. Keep every request within the 250-ref read cap, serially.
  let result: OutlierLabelsData | null = null
  for (let i = 0; i < Math.max(1, refs.length); i += 250) {
    const batch = refs.slice(i, i + 250)
    const page = parseOutlierLabels(await rpc('cb34_outlier_labels', { p_gate: CLIENT_OPS_GATE, p_client: lane, p_refs: batch }, signal), lane, batch)
    result = result ? { ...page, rows: [...result.rows, ...page.rows] } : page
  }
  return result!
}
export async function setOutlierLabel(lane: Lane, ref: OutlierRef, verdict: 'keep' | 'drop', reason: string | null): Promise<LabelMutation> {
  if (reason && (reason.length > 40 || /\s/.test(reason))) throw new Error('Use one word of up to 40 characters for the optional reason.')
  const invocationId = crypto.randomUUID()
  return parseLabelMutation(await rpc('cb34_outlier_label_set', { p_gate: CLIENT_OPS_GATE, p_client: lane, p_platform: ref.platform, p_post_ref: ref.post_ref, p_label: verdict, p_reason: reason, p_invocation_id: invocationId, p_parent_execution: `cb34-ui:${invocationId}` }), lane, ref, invocationId, false)
}
export async function undoOutlierLabel(lane: Lane, label: HumanOutlierLabel): Promise<LabelMutation> {
  if (label.client !== lane || !label.canEdit || !label.undoInvocationId) throw new Error('No guarded Undo receipt is available for this label.')
  const invocationId = crypto.randomUUID()
  return parseLabelMutation(await rpc('cb34_outlier_label_undo', { p_gate: CLIENT_OPS_GATE, p_client: lane, p_platform: label.platform, p_post_ref: label.post_ref, p_undo_invocation_id: label.undoInvocationId, p_expected_revision: label.version, p_invocation_id: invocationId, p_parent_execution: `cb34-ui:${invocationId}` }), lane, label, invocationId, true)
}
