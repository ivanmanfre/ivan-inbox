import { supabase } from './supabase'

// Content domain: Ivan's own posts/carousels AND Mattan Danino's board, both out
// of the same carousel_drafts table. There is no per-client table fork — the
// whole tenancy split is one nullable column (phase1b §1).
//
// 'risedtc' is a DATABASE VALUE and never a label: lane B is called "Mattan
// Danino" everywhere a human reads it (IA §0). LANE_LABEL is the only place that
// mapping lives, so a rename can never half-land again.
export type ContentLane = 'ivan' | 'risedtc'

export const CONTENT_LANES = ['ivan', 'risedtc'] as const

export const LANE_LABEL: Record<ContentLane, string> = {
  ivan: 'Ivan',
  risedtc: 'Mattan Danino',
}

// Possessive form, for "on Mattan's board" / "Ivan's drafts".
export const LANE_POSSESSIVE: Record<ContentLane, string> = {
  ivan: 'Ivan’s',
  risedtc: 'Mattan’s',
}

// Only the fields a queue/preview surface actually renders. Column names
// verified live against PostgREST 2026-07-31 (a missing column 400s with
// 42703; every name below returned 200), and mirror the dashboard's own
// SELECT_COLS in personal-site/hooks/useContentLibrary.ts:61.
export type ContentDraft = {
  id: string
  client_id: string | null
  status: string
  type: string | null
  title: string | null
  topic: string | null
  post_body: string | null
  scheduled_at: string | null
  // urn:li:activity:... stamped by the publisher once the post is really live.
  // Its absence past scheduled_at is the ONLY signal that a schedule died
  // silently (PostWorkSurface.tsx:117 uses exactly this pair).
  source_post_id: string | null
  image_urls: string[] | null
  // Sometimes a jsonb object ({structure_used, image_style, pillar, …}),
  // sometimes a bare string. Both shapes are live today (ACCESS-MATRIX check 3).
  taxonomy: Record<string, unknown> | string | null
  updated_at: string
  created_at: string
  // TRUE = the row has been promoted onto the client's board by the
  // operator_set_board_visible flow; FALSE/NULL = it exists internally only.
  // Optional on the TYPE (not on the query) purely so every existing fixture
  // and consumer that builds a ContentDraft literal keeps compiling — the
  // column is selected below, so live rows always carry it.
  board_visible?: boolean | null
  // Carried on the LIST row because they are card tags and filter facets
  // (AFFORDANCES §2.1), not detail-only fields. funnel_stage is populated on
  // 157/198 Ivan and 80/84 Mattan rows; the four qa_* fields are PostgREST
  // jsonb projections (`qa->>verdict`), which is what keeps a 23-key qa object
  // — including a full rewrite_text on 150 rows — out of the list payload.
  // Optional on the TYPE so every existing fixture keeps compiling.
  funnel_stage?: string | null
  qa_verdict?: string | null
  qa_score?: string | null
  qa_regen?: string | null
  qa_backfilled?: string | null
}

const COLS =
  'id, client_id, status, type, title, topic, post_body, scheduled_at, ' +
  'source_post_id, image_urls, taxonomy, updated_at, created_at, board_visible, ' +
  'funnel_stage, qa_verdict:qa->>verdict, qa_score:qa->>score, ' +
  'qa_regen:qa->>qa_regen_attempts, qa_backfilled:qa->>backfilled'

// ---------- lane scoping ----------

// There is no 'ivan' literal in carousel_drafts.client_id: the live values are
// NULL ×190 (Ivan) and 'risedtc' ×84 (DB check 2026-07-31). Every other screen
// in this app coalesces NULL→'ivan' at the CONSUMPTION layer (today.ts:199
// rowClient) — doing that at the QUERY layer instead, i.e. .eq('client_id',
// 'ivan'), returns zero rows and renders a calm, wrong, empty board. This
// descriptor exists so that mistake is pinned by a unit test rather than by a
// blank screen.
export type LaneFilter =
  | { column: 'client_id'; op: 'is'; value: null }
  | { column: 'client_id'; op: 'eq'; value: string }

export function laneFilter(lane: ContentLane): LaneFilter {
  return lane === 'ivan'
    ? { column: 'client_id', op: 'is', value: null }
    : { column: 'client_id', op: 'eq', value: 'risedtc' }
}

// NULL→'ivan' the same way every existing screen does, so a raw carousel_drafts
// row can be compared against a lane without special-casing null at each site.
export function draftLane(r: { client_id?: string | null }): string {
  return r.client_id ?? 'ivan'
}

// ---------- buckets ----------

// The statuses the queue is allowed to consider "in flight" — a row in one of
// these is fetched regardless of how old it is, because an approved post from
// 90 days ago that never got a time is exactly the backlog this surface exists
// to expose.
export const ACTIVE_STATUSES = ['review', 'error', 'generating', 'approved', 'scheduled'] as const
export const RECENT_DAYS = 60

export type ContentBucketName =
  | 'review' | 'error' | 'stuckScheduled' | 'approvedUnscheduled'
  | 'generating' | 'scheduled' | 'published' | 'archived' | 'unknown'

export type ContentBuckets = Record<ContentBucketName, ContentDraft[]>

// 'draft' and 'idea' are real values the dashboard writes/projects
// (useContentLibrary.ts:69 defaults a null status to 'draft'; ideaProjection.ts
// :135 synthesises 'idea' client-side) but no queue actions them. They land in
// `unknown` on purpose: this bucket is rendered, never dropped, so nothing can
// hide from the board just because the vocabulary grew (blank-board #3).
export const ARCHIVED_STATUSES = ['disqualified', 'skipped'] as const

function emptyBuckets(): ContentBuckets {
  return {
    review: [], error: [], stuckScheduled: [], approvedUnscheduled: [],
    generating: [], scheduled: [], published: [], archived: [], unknown: [],
  }
}

// One row lands in exactly one bucket. Order of the branches IS the spec:
// stuck-scheduled must be tested before plain scheduled, and
// approved-without-a-time before anything that would swallow it.
export function bucketDrafts(rows: ContentDraft[], now: number = Date.now()): ContentBuckets {
  const out = emptyBuckets()
  for (const r of rows) {
    switch (r.status) {
      case 'review': out.review.push(r); break
      case 'error': out.error.push(r); break
      case 'generating': out.generating.push(r); break
      case 'approved':
        // The proven black hole: the dashboard's review lane only shows
        // status='review', and its calendar only shows rows that HAVE a
        // scheduled_at — so an approved post with no time is invisible on
        // every existing surface. The DB check on 2026-07-31 found 0 such rows
        // today; the trap is structural, not empirical, so the bucket ships
        // anyway and a backlog can never build up unseen.
        if (r.scheduled_at) out.scheduled.push(r)
        else out.approvedUnscheduled.push(r)
        break
      case 'scheduled':
        if (isStuckScheduled(r, now)) out.stuckScheduled.push(r)
        else out.scheduled.push(r)
        break
      case 'published': out.published.push(r); break
      case 'disqualified':
      case 'skipped': out.archived.push(r); break
      default: out.unknown.push(r)
    }
  }
  return out
}

// Past its time with no published URN = it silently never went out
// (PostWorkSurface.tsx:117). A 'scheduled' row with NO scheduled_at at all is
// counted stuck too: the dashboard's filter requires a non-null scheduled_at,
// so that row is invisible there AND can never fire — the worst of both.
export function isStuckScheduled(r: ContentDraft, now: number = Date.now()): boolean {
  if (r.status !== 'scheduled') return false
  if (r.source_post_id) return false
  if (!r.scheduled_at) return true
  const t = new Date(r.scheduled_at).getTime()
  if (!Number.isFinite(t)) return false   // unparseable time is not evidence of a stall
  return t < now
}

// ---------- stuck generation (phase 6 ask 6) ----------
//
// The gap the parity scout ranked third: a generation that died mid-run (the
// n8n workflow fell over, the container 502'd) leaves the row sitting at
// `generating` forever, and NOTHING on this surface said so. isStuckScheduled
// above closes exactly this class of bug for the SCHEDULED case; the generating
// case was left open.
//
// 🔴 THE THRESHOLD IS NOT INVENTED. The old dashboard already has one and has
// had it for a while: `personal-site/components/dashboard/genAge.ts:11`,
// `export const STUCK_MINUTES = 20`, shared by the Posts board and the LM board
// and rendered as the `generating · 24m ⚠` chip. The brief allowed deriving a
// p95 from observed generation times if the old board had no threshold — it
// does, so the ported number wins over a fresh derivation, and there is nothing
// to derive from anyway: a live probe on 2026-08-02 found ZERO rows at
// `generating` in either table, so any p95 this build computed would have had
// an empty sample behind it.
export const STUCK_GENERATING_MINUTES = 20

// Minutes since `iso`, or null when there is no timestamp to measure from —
// never 0, which would be a claim that the run just started (genAge.ts:16-22).
export function elapsedMinutes(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.round((now - t) / 60_000))
}

// The most precise start the row carries. genAge.ts's own comment names the
// pair: carousel_drafts.taxonomy.generating_started_at when it is set, else
// updated_at (LM rows have no dedicated start timestamp and always pass
// updated_at). Reading updated_at as a fallback is slightly conservative — a
// re-write bumps it and restarts the clock — which is the right direction for a
// warning: it under-reports staleness rather than crying stuck on a live run.
export function generatingSince(r: ContentDraft): string | null {
  return taxonomyValue(r.taxonomy, 'generating_started_at') ?? r.updated_at ?? null
}

// True once a GENERATING row has been running past the threshold. Anything not
// at that status is false: a stalled run is a fact about an in-flight row, and
// asking it of a published row would answer a question nobody asked.
export function isStuckGenerating(r: ContentDraft, now: number = Date.now()): boolean {
  if (r.status !== 'generating') return false
  const m = elapsedMinutes(generatingSince(r), now)
  return m !== null && m >= STUCK_GENERATING_MINUTES
}

// ---------- reads ----------

export type ContentPage = {
  rows: ContentDraft[]
  // Server-side exact count of the SAME filter. rows can be capped by
  // PostgREST's 1000-row ceiling long before the caller notices, so a surface
  // that says "12 waiting" off rows.length is lying whenever count > rows.length.
  count: number | null
}

export async function fetchContentDrafts(lane: ContentLane): Promise<ContentPage> {
  const since = new Date(Date.now() - RECENT_DAYS * 86400_000).toISOString()
  const f = laneFilter(lane)
  let q = supabase.from('carousel_drafts').select(COLS, { count: 'exact' })
  q = f.op === 'is' ? q.is(f.column, null) : q.eq(f.column, f.value)
  const { data, error, count } = await q
    // Recent OR still in flight. toISOString() ends in 'Z', never the '+00:00'
    // form PostgREST needs percent-encoded inside a filter value.
    .or(`updated_at.gte.${since},status.in.(${ACTIVE_STATUSES.join(',')})`)
    .order('updated_at', { ascending: false })
    .limit(1000)
  if (error) throw error
  // Operator-deleted rows are GONE from every list, including Archived: when a
  // hard DELETE is refused by RLS, deleteDraft falls back to disqualified +
  // taxonomy.deleted_by_operator, and this filter is what makes that row leave
  // the surface anyway. Filtered here (the one choke point every lane reads
  // through) rather than per-bucket. The server-side `count` can therefore run
  // a few rows high — it is a denominator, not a list.
  const rows = ((data ?? []) as unknown as ContentDraft[])
    .filter(r => !operatorDeleted(r.taxonomy))
  return { rows, count: count ?? null }
}

export type ScheduledQueueRow = {
  id: string
  clickup_task_id: string | null
  post_text: string | null
  scheduled_at: string | null
  posted_at: string | null
  status: string
  platform: string | null
  is_repost: boolean | null
  error_message: string | null
  created_at: string
  // IA §2.3: the queue's own tags. post_kind is reach 151 / capture 1 and
  // unipile_share_url is the only proof a queued row really went out.
  // `source` is NULL on all 152 rows and is deliberately not selected.
  post_kind: string | null
  unipile_share_url: string | null
}

// The publish queue behind BOTH lanes — its own status vocabulary, unrelated to
// carousel_drafts.status (phase1b §2).
export const QUEUE_STATUSES = ['pending', 'queued_v2', 'posting', 'posted', 'failed', 'cancelled'] as const

// Takes no lane argument and needs none: scheduled_posts has no client_id column
// at all (42703), so it is Ivan's BY CONSTRUCTION, not by filter (IA §2.3 / R4).
export async function fetchScheduledQueue(): Promise<ScheduledQueueRow[]> {
  const { data, error } = await supabase.from('scheduled_posts')
    .select('id, clickup_task_id, post_text, scheduled_at, posted_at, status, platform, is_repost, error_message, created_at, post_kind, unipile_share_url')
    .in('status', QUEUE_STATUSES as unknown as string[])
    .order('scheduled_at', { ascending: false })
    .limit(500)
  if (error) throw error
  return (data ?? []) as unknown as ScheduledQueueRow[]
}

// A queue row that carries an error_message is the ONLY place a publish failure
// is written down (9 rows live). It lifts into the lane's alert strip beside the
// draft errors — a failed publish and a failed generation are the same class of
// fact to the operator even though they live in different tables (IA §2.3).
export function queueFailed(r: ScheduledQueueRow): boolean {
  return !!(r.error_message && r.error_message.trim())
}

// ---------- ideas (R7 — a NEW read, per IA §7) ----------
//
// lm_idea_candidates has NO tenancy column (client_id 42703s; workspace_type and
// campaign_id are NULL on every reviewing row), so it is Ivan's by construction —
// the same argument as scheduled_posts. Written down because "no column" is easy
// to misread as "unscoped, show everywhere" (IA §2.2).
//
// 🔴 An idea's identity derives from the LLM's own title text, so a re-worded
// re-ingest is a DIFFERENT row and nothing dedups it. Consequences carried by
// every consumer: count rows never "distinct topics", never key UI state on the
// id across refreshes, never dedup client-side by title.
export const IDEA_STATUS = 'reviewing'

export type IdeaCandidate = {
  id: string
  source: string | null
  raw_topic: string | null
  normalized_topic: string | null
  signal_strength: number | null
  icp_fit_score: number | null
  virality_score: number | null
  gap_score: number | null
  beat_fit_score: number | null
  composite_score: number | null
  why_score: string | null
  format_recommendation: string | null
  offer_ladder_map: string | null
  content_type: string | null
  post_angle: string | null
  ivan_engaged: boolean | null
  source_ref: string | null
  slack_permalink: string | null
  ingested_at: string | null
  scored_at: string | null
  // The join back to a promoted draft. NULL on every reviewing row, as it must
  // be — carried so a promoted idea can be recognised if the status ever widens.
  promoted_draft_id: string | null
  promoted_draft_table: string | null
  promoted_clickup_task_id: string | null
}

const IDEA_COLS =
  'id, source, raw_topic, normalized_topic, signal_strength, icp_fit_score, ' +
  'virality_score, gap_score, beat_fit_score, composite_score, why_score, ' +
  'format_recommendation, offer_ladder_map, content_type, post_angle, ' +
  'ivan_engaged, source_ref, slack_permalink, ingested_at, scored_at, ' +
  'promoted_draft_id, promoted_draft_table, promoted_clickup_task_id'

// ---------- the idea split (phase 6 ask 3) ----------
//
// The conflation: `fetchIdeaCandidates` had no content-type filter, so LM ideas
// were counted into the POSTS pipeline's "ideas" figure and rendered in the
// posts idea list. "12 post ideas" quietly included lead-magnet ideas — the old
// dashboard never did this (it runs two disjoint projections, ideaProjection.ts
// for posts and lmIdeaProjection.ts for LMs).
//
// The discriminator EXISTS and is not inferred: `lm_idea_candidates.content_type`,
// inspected on a live row and counted with count=exact head probes on
// 2026-08-02, at status='reviewing':
//
//     content_type='post'          57
//     content_type='lead_magnet'    3
//     content_type IS NULL          0
//     ------------------------------
//     total at reviewing           60
//
// (Across the whole table, unfiltered by status: post 734, lead_magnet 31,
// NULL 235 — so NULL is a real shape in the table, it just does not currently
// occur at `reviewing`.)
//
// 🔴 The filter is applied by PARTITION, not by adding `.eq('content_type', …)`
// to the query. A row whose content_type is NULL or an unrecognised value would
// vanish from BOTH lanes under an equality filter — an idea that exists in the
// database and appears on no surface, which is the exact failure mode this
// app's lane scoping is written to refuse (see the `_r1atest` note above and
// blank-board #3). Unclassified rows are rendered, labelled as unclassified, on
// the posts lane.
export type IdeaKind = 'post' | 'lead_magnet' | 'other'

export function ideaKindOf(i: Pick<IdeaCandidate, 'content_type'>): IdeaKind {
  const s = (i.content_type ?? '').trim().toLowerCase()
  if (s === 'post') return 'post'
  if (s === 'lead_magnet') return 'lead_magnet'
  return 'other'
}

export type IdeaSplit = { post: IdeaCandidate[]; lead_magnet: IdeaCandidate[]; other: IdeaCandidate[] }

export function splitIdeas(ideas: IdeaCandidate[]): IdeaSplit {
  const out: IdeaSplit = { post: [], lead_magnet: [], other: [] }
  for (const i of ideas) out[ideaKindOf(i)].push(i)
  return out
}

// Per-kind SERVER-SIDE exact counts. Deriving these from the fetched page would
// re-introduce the D2 problem one level down: the page is capped at 500 and the
// bar would draw a proportion of whatever survived the cap. `other` is the only
// figure computed rather than probed — total minus the two known kinds — because
// PostgREST has no "not in this set" head probe that stays correct when a new
// content_type value appears. Arithmetic over three exact counts is exact.
export type IdeaCounts = { total: number | null; post: number | null; lead_magnet: number | null; other: number | null }

export async function fetchIdeaCounts(): Promise<IdeaCounts> {
  const head = async (kind?: 'post' | 'lead_magnet') => {
    let q = supabase.from('lm_idea_candidates')
      .select('id', { count: 'exact', head: true })
      .eq('status', IDEA_STATUS)
    if (kind) q = q.eq('content_type', kind)
    const { count, error } = await q
    if (error) throw error
    return count ?? 0
  }
  const [total, post, lead_magnet] = await Promise.all([head(), head('post'), head('lead_magnet')])
  return { total, post, lead_magnet, other: Math.max(0, total - post - lead_magnet) }
}

export type IdeaPage = { ideas: IdeaCandidate[]; count: number | null }

export async function fetchIdeaCandidates(): Promise<IdeaPage> {
  const { data, error, count } = await supabase.from('lm_idea_candidates')
    .select(IDEA_COLS, { count: 'exact' })
    .eq('status', IDEA_STATUS)
    // Highest composite first — the scorer's own ordering. Server-side exact
    // count travels with it because PostgREST caps a SELECT long before a
    // header notices (D10).
    .order('composite_score', { ascending: false, nullsFirst: false })
    .limit(500)
  if (error) throw error
  return { ideas: (data ?? []) as unknown as IdeaCandidate[], count: count ?? null }
}

export type LaneProbe = {
  // Rows matching the queue's real filter (recent-or-active).
  scoped: number
  // Rows in this lane, full stop. total > 0 && scoped === 0 means the filter ate
  // everything — a broken query, not an empty board. Neither the dashboard nor
  // this app could tell those apart before this probe existed (blank-board #5).
  total: number
}

export async function fetchLaneProbe(lane: ContentLane): Promise<LaneProbe> {
  const since = new Date(Date.now() - RECENT_DAYS * 86400_000).toISOString()
  const f = laneFilter(lane)
  const base = () => {
    const q = supabase.from('carousel_drafts').select('id', { count: 'exact', head: true })
    return f.op === 'is' ? q.is(f.column, null) : q.eq(f.column, f.value)
  }
  const [scopedRes, totalRes] = await Promise.all([
    base().or(`updated_at.gte.${since},status.in.(${ACTIVE_STATUSES.join(',')})`),
    base(),
  ])
  if (scopedRes.error) throw scopedRes.error
  if (totalRes.error) throw totalRes.error
  return { scoped: scopedRes.count ?? 0, total: totalRes.count ?? 0 }
}

// ---------- writes ----------
//
// The only two content writes this app is allowed to make. Both mirror the
// dashboard's existing semantics exactly (setStatus, studioActions.ts:250) and
// both are scoped .is('client_id', null): approve is an IVAN-lane action, and
// Mattan’s lane is read-only ambient visibility here — client-facing decisions
// belong on the client board, behind its own gates (D7). No schedule, no
// publish, no delete lives in this file on purpose: flipping a row to
// 'scheduled' is what the n8n Bridge (yzXqLDIpuNzuhUQq) picks up to actually
// put a post on LinkedIn, so scheduling stays on the dashboard.

// Approve is a status write and does NOT publish (phase1b §4): publishing needs
// scheduled_at + status='scheduled', or the explicit publish-now webhook.
export async function approveDraft(id: string): Promise<void> {
  const { error } = await supabase.from('carousel_drafts')
    .update({ status: 'approved' })
    .eq('id', id).is('client_id', null)
  if (error) throw error
}

// The dashboard's 's' key "skip" is session-local only — it adds the id to a
// React Set and writes nothing (PostWorkSurface.tsx:240-244), so it evaporates
// on reload. Its real persisted equivalent is the 'r' key, reject:
// setStatus(id, 'disqualified') (PostWorkSurface.tsx:236). This is that write,
// which is why skipping here is a durable decision and needs a confirm sheet.
export const SKIP_STATUS = 'disqualified'

export async function skipDraft(id: string): Promise<void> {
  const { error } = await supabase.from('carousel_drafts')
    .update({ status: SKIP_STATUS })
    .eq('id', id).is('client_id', null)
  if (error) throw error
}

// ---------- edit / delete (usability-voice ask 3) ----------
//
// Both are IVAN-LANE ONLY, mirroring approveDraft's `.is('client_id', null)`
// scope — Mattan's lane stays read-only ambient visibility by standing rule.
// Both verify their own write landed (`.select()` + a non-empty result):
// PostgREST returns a silent 204 when RLS filters the row away, and a surface
// that says "Saved" off a filtered-away write is lying.

// Merge marker keys into a taxonomy value of ANY live shape (object, bare
// string, JSON string, null). A bare-string taxonomy is a structure value
// (taxonomyFields reads it as structure_used), so it is preserved under that
// key rather than clobbered.
export function stampTaxonomy(t: unknown, marks: Record<string, unknown>): Record<string, unknown> {
  const parsed = parseMaybeJson(t)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return { ...(parsed as Record<string, unknown>), ...marks }
  }
  if (typeof parsed === 'string' && parsed.trim()) {
    return { structure_used: parsed.trim(), ...marks }
  }
  return { ...marks }
}

// The regen-clobber protection contract: a pipeline regen must be able to SEE
// that a human touched this row. Writing the marker is this app's half; the
// n8n side honors it separately.
export function stampHumanEdit(t: unknown, at: string = new Date().toISOString()): Record<string, unknown> {
  return stampTaxonomy(t, { human_edited: true, human_edited_at: at })
}

export function stampOperatorDelete(t: unknown, at: string = new Date().toISOString()): Record<string, unknown> {
  return stampTaxonomy(t, { deleted_by_operator: true, deleted_at: at })
}

// TRUE only on an explicit marker. taxonomyValue() cannot be used here — it
// stringifies via str(), which returns null for a boolean true.
export function operatorDeleted(t: unknown): boolean {
  const parsed = parseMaybeJson(t)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
  const v = (parsed as Record<string, unknown>).deleted_by_operator
  return v === true || v === 'true'
}

// The explicit-save edit. Editing NEVER touches status — approve stays the
// only status write. `taxonomy` is the value loaded with the detail
// (read-modify-write): the human-edit markers are merged into it and written
// in the same PATCH as the body.
export async function updateDraftBody(id: string, body: string, taxonomy: unknown): Promise<void> {
  const { data, error } = await supabase.from('carousel_drafts')
    .update({ post_body: body, taxonomy: stampHumanEdit(taxonomy) })
    .eq('id', id).is('client_id', null)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Save failed — the database did not accept the edit.')
  }
}

// Delete, honestly. The RLS probe (2026-08-03) proved UPDATE on real rows but
// left DELETE unproven: PostgREST answers 204 to a DELETE it silently filtered.
// So: attempt the hard DELETE with return=representation; an EMPTY result
// means it did not happen, and the row is instead flipped to 'disqualified'
// with taxonomy.deleted_by_operator so it leaves every list (fetch filter
// above) — and THAT write is verified too. Skip ≠ Delete: skip is a visible
// archive decision, delete removes the row from the surface entirely.
export async function deleteDraft(id: string, taxonomy: unknown): Promise<'deleted' | 'disqualified'> {
  const del = await supabase.from('carousel_drafts')
    .delete()
    .eq('id', id).is('client_id', null)
    .select('id')
  if (!del.error && del.data && del.data.length > 0) return 'deleted'
  const upd = await supabase.from('carousel_drafts')
    .update({ status: SKIP_STATUS, taxonomy: stampOperatorDelete(taxonomy) })
    .eq('id', id).is('client_id', null)
    .select('id')
  if (upd.error) throw upd.error
  if (!upd.data || upd.data.length === 0) {
    throw new Error('Delete failed — the row was neither removed nor archived.')
  }
  return 'disqualified'
}

// Idea delete, same honesty contract. The fallback status is 'archived' — a
// REAL value in lm_idea_candidates (1,460 rows live at it, probed 2026-08-03;
// 'dismissed'/'rejected' do not exist in the table) — which removes the row
// from the reviewing list every consumer fetches.
export async function deleteIdea(id: string): Promise<'deleted' | 'archived'> {
  const del = await supabase.from('lm_idea_candidates')
    .delete()
    .eq('id', id)
    .select('id')
  if (!del.error && del.data && del.data.length > 0) return 'deleted'
  const upd = await supabase.from('lm_idea_candidates')
    .update({ status: 'archived' })
    .eq('id', id)
    .select('id')
  if (upd.error) throw upd.error
  if (!upd.data || upd.data.length === 0) {
    throw new Error('Delete failed — the idea was neither removed nor archived.')
  }
  return 'archived'
}

// The one rule that decides whether a row shows a mutating affordance at all,
// in one place because round 2 renders those buttons from two surfaces (the
// queue card and the draft detail screen). D6: only a row waiting on review is
// actionable. D7: only in the Ivan lane — Mattan’s lane is read-only ambient
// visibility, and approveDraft/skipDraft are both scoped .is('client_id', null)
// anyway, so a button there would be a button that silently does nothing.
export function reviewActionable(status: string, lane: ContentLane): boolean {
  return status === 'review' && lane === 'ivan'
}

// ---------- pipeline stages ----------
//
// bucketDrafts (above) groups by TRIAGE — "what needs me", in urgency order.
// Ivan's round-2 read of that board: "pretty shitty the way stages are…
// separate on our end on ideas, review, approved". A post has a LIFECYCLE, and
// the queue should be that lifecycle read top to bottom, with the exceptions
// (error / silently-dead schedule) lifted OUT of the flow into one alert strip
// instead of interrupting it.
//
// This is a SECOND view of the same rows, added alongside bucketDrafts rather
// than replacing it: cand-b renders the triage buckets and the two groupings
// disagree on purpose (an approved row WITH a date is 'scheduled' to triage —
// it has a time, nothing to do — but still 'approved' to the pipeline, because
// that is the stage it is actually in).
export type ContentStage =
  | 'ideas' | 'generating' | 'review' | 'approved' | 'scheduled' | 'published'
  | 'error' | 'stuck' | 'archived' | 'other'

// The pipeline, in order. This array IS the render order of the queue and of
// the stage rail — there is no second ordering constant to keep in sync.
export const PIPELINE_STAGES = [
  'ideas', 'generating', 'review', 'approved', 'scheduled', 'published',
] as const

// Lifted above the pipeline as an alert strip, never rendered as sections
// mid-flow: an error is not a step on the way to publishing.
export const ALERT_STAGES = ['error', 'stuck'] as const

// Chart-axis codes: the capsule chart's slots are ~40-57px wide, and full stage
// names clipped to "PUBLIS" on every state (phase0-readability #1). Full names
// stay on the section headers and the title tooltip; the axis wears the code.
export const STAGE_SHORT: Record<ContentStage, string> = {
  ideas: 'Ideas',
  generating: 'Gen',
  review: 'Review',
  approved: 'Appr',
  scheduled: 'Sched',
  published: 'Pub',
  error: 'Err',
  stuck: 'Stuck',
  archived: 'Arch',
  other: 'Other',
}

export const STAGE_LABEL: Record<ContentStage, string> = {
  ideas: 'Ideas',
  generating: 'Generating',
  review: 'Needs review',
  approved: 'Approved',
  scheduled: 'Scheduled',
  published: 'Published',
  error: 'Errors',
  stuck: 'Stuck',
  archived: 'Archived',
  other: 'Other',
}

// One row, one stage. Branch order is load-bearing in exactly one place:
// 'scheduled' is tested for stuck-ness BEFORE it counts as scheduled, so a
// past-due unpublished row can never sit quietly in the pipeline looking done.
//
// 'approved' does NOT fork on scheduled_at here (bucketDrafts does): an
// approved post is at the approved STAGE whether or not it has a date. The
// black hole that fork existed to expose is preserved as a count —
// countUndated() below — rendered as a sub-line inside the Approved section.
export function stageOf(r: ContentDraft, now: number = Date.now()): ContentStage {
  switch (r.status) {
    case 'idea': return 'ideas'
    case 'generating': return 'generating'
    case 'review': return 'review'
    case 'approved': return 'approved'
    case 'scheduled': return isStuckScheduled(r, now) ? 'stuck' : 'scheduled'
    case 'published': return 'published'
    case 'error': return 'error'
    case 'disqualified':
    case 'skipped': return 'archived'
    // 'draft' and anything the n8n vocabulary grows after this file was
    // written. Rendered at the bottom, never dropped (blank-board #3).
    default: return 'other'
  }
}

export type ContentStages = Record<ContentStage, ContentDraft[]>

function emptyStages(): ContentStages {
  return {
    ideas: [], generating: [], review: [], approved: [], scheduled: [],
    published: [], error: [], stuck: [], archived: [], other: [],
  }
}

export function groupByStage(rows: ContentDraft[], now: number = Date.now()): ContentStages {
  const out = emptyStages()
  for (const r of rows) out[stageOf(r, now)].push(r)
  return out
}

// "N approved without a date" — the approved-unscheduled black hole, kept
// visible as a sub-line now that approved rows are no longer split into their
// own section. Deleting this re-opens the hole (see bucketDrafts' comment).
export function countUndated(rows: ContentDraft[]): number {
  return rows.filter(r => !r.scheduled_at).length
}

// How many of a lane's rows are promoted onto the client's board. Rows with a
// NULL board_visible are counted as NOT visible: absence of the promotion flag
// is not evidence of promotion.
export function countBoardVisible(rows: ContentDraft[]): number {
  return rows.filter(r => r.board_visible === true).length
}

// ---------- draft detail ----------
//
// The list fetch stays slim (COLS) — post_body, agent_log and qa on 274 rows is
// payload nobody reads. The detail screen is the only thing that pulls a whole
// row, one id at a time.
export type ContentDraftDetail = ContentDraft & {
  // Every field below is nullable/loosely typed on purpose: these columns are
  // written by n8n agents, not by this app, and three of them (agent_log, qa,
  // taxonomy) are known to carry more than one shape in live data. They are
  // typed `unknown` so no call site can read them without going through the
  // normalizers below.
  agent_log: unknown
  qa: unknown
  source_label: string | null
  // 🔴 Typed `unknown`, NOT `string | null`. It is a jsonb OBJECT on 71 of 282
  // rows (63 of them Mattan's) — {kind,label,metric,slug,source_url},
  // {call_title,kind,label,quote}, {carousel_of,format,generator,kind,slug} and
  // six more shapes — and only 3 rows hold a bare string. The old `string|null`
  // was a lie TypeScript could not check, and it let the raw object reach a JSX
  // child, which throws "Objects are not valid as a React child" and takes the
  // pane to a blank on most Mattan drafts. Read it through
  // normalizeSourceDetail() and nothing else.
  source_detail: unknown
  source_ref: string | null
  client_idea_id: string | null
  funnel_stage: string | null
  published_at: string | null
  description: string | null
  // The rendered post/carousel HTML artifact the pipeline authored — what the
  // post will actually look like. Selected by `select('*')` below; rendered in
  // the detail window inside a script-less sandboxed iframe, never as raw JSX.
  authored_html: string | null
  key_points: unknown
  ig_caption: string | null
  pdf_url: string | null
  topic_strength: unknown
  // Carousel rows only (17 live). Agent-written and shaped freely, so it is
  // rendered through <Val> like every other unknown, never as a JSX child.
  slide_metadata?: unknown
  // Named here so nobody re-adds them as empty rows: style_id is NULL on all
  // 282 rows (a draft's style lives in taxonomy), regen_slides on all 282
  // (regeneration lives in agent_log and qa.qa_regen_*), video_status on all
  // 282. They are selected by `select('*')` and deliberately not rendered.
}

// select=* rather than a column list: this row is fetched one at a time, and a
// hand-maintained 26-column list would silently start hiding fields the day an
// agent starts writing a new one. Returns null (not an error) when the id is
// gone — a deleted draft and an unreadable one must not render the same (D10).
export async function fetchDraftDetail(id: string): Promise<ContentDraftDetail | null> {
  const { data, error } = await supabase.from('carousel_drafts')
    .select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return (data ?? null) as ContentDraftDetail | null
}

// ---------- shape guards for agent-written columns ----------

// A jsonb column can arrive as the parsed value OR as a JSON string (PostgREST
// hands back text for a `text` column that happens to hold JSON — carousel_drafts
// has both conventions in flight). One unwrap, used by every normalizer below.
function parseMaybeJson(v: unknown): unknown {
  if (typeof v !== 'string') return v
  const s = v.trim()
  if (!s.startsWith('{') && !s.startsWith('[')) return v
  try { return JSON.parse(s) } catch { return v }
}

function str(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

// Agent-written numbers arrive as numbers AND as strings ("82"), so both are
// read; anything else is absent rather than 0 — a fabricated zero would score a
// row the machine never scored.
function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.trim()) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

// Same posture for booleans: 'true'/'false' strings are live in this data, and
// an unreadable value is null (unknown), never false (a claim).
function bool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === 'true') return true
    if (s === 'false') return false
  }
  return null
}

// 🔴 `agent` is present on 2 999 of 2 999 live entries and `source` on 2 996;
// the shipped shape returned only {ts, body}, so the proof row's 37 entries
// rendered as 37 anonymous paragraphs — the single largest field gap in the
// content surface (AMENDMENTS §A4.1). The register cannot say WHO wrote a step
// without this, so attribution is carried through here, at the normalizer,
// rather than being re-derived by each caller.
export type AgentLogEntry = {
  ts: string | null
  agent: string | null
  body: string
  source: string | null
  comment_id: string | null
}

// A clickup_backfill entry is a historical reconstruction, not a live agent
// step, and 598 of 2 999 entries are exactly that. The register marks them so a
// reader never mistakes a backfill for evidence of what the machine did.
export function isBackfillEntry(e: AgentLogEntry): boolean {
  return e.source === 'clickup_backfill'
}

// agent_log is an array of {ts, body} on a live review row, e.g.
// {"ts":"2026-07-31T12:00:08Z","body":"[Auto-promoted by LM Curator …]"}.
// It is also, on other rows, null / an empty array / a bare string / a JSON
// string / entries with a different body key. Every one of those must render as
// "nothing" instead of throwing inside a render pass and taking the screen to
// black — so this returns [] for anything it can't read, and never throws.
export function normalizeAgentLog(v: unknown): AgentLogEntry[] {
  const parsed = parseMaybeJson(v)
  const raw = Array.isArray(parsed) ? parsed : parsed == null ? [] : [parsed]
  const out: AgentLogEntry[] = []
  for (const e of raw) {
    if (typeof e === 'string') {
      const body = e.trim()
      if (body) out.push({ ts: null, agent: null, body, source: null, comment_id: null })
      continue
    }
    if (!e || typeof e !== 'object') continue
    const o = e as Record<string, unknown>
    const body = str(o.body) ?? str(o.message) ?? str(o.text) ?? str(o.note)
    if (!body) continue
    out.push({
      ts: str(o.ts) ?? str(o.at) ?? str(o.created_at),
      // The roster is enumerated from data, never hardcoded: 36 distinct agent
      // names are live today and an unknown one renders as itself.
      agent: str(o.agent) ?? str(o.action),
      body,
      source: str(o.source),
      comment_id: str(o.comment_id),
    })
  }
  // Newest last (the register is a timeline you read downwards). Only sorted
  // when EVERY entry carries a parseable timestamp — a partial sort would
  // interleave undated entries at arbitrary points and invent a history that
  // isn't in the data.
  const stamps = out.map(e => (e.ts ? Date.parse(e.ts) : NaN))
  if (out.length > 1 && stamps.every(Number.isFinite)) {
    return out
      .map((e, i) => ({ e, t: stamps[i], i }))
      .sort((a, b) => a.t - b.t || a.i - b.i)
      .map(x => x.e)
  }
  return out
}

// ---------- reading a single log entry (presentation, never a stored field) ----------
//
// The dashboard's AgentLogFeed layers two parses on top of an entry: detectStatus()
// classifies the body into a chip, parseIteration() pulls the numbers that make a
// score progression legible. Both are adopted here (IA §5.4 items 3-4) with one
// rule: the parse is layered ON TOP of the entry — when a body matches nothing,
// the entry still renders whole. Nothing here is ever written back.

export const LOG_STATUSES = ['PASS', 'FAIL', 'REWRITE_OK', 'NEEDS_REGENERATE', 'APPROVED', 'HALT'] as const
export type LogStatus = (typeof LOG_STATUSES)[number]

export type LogParse = {
  status: LogStatus | null
  // Live bodies carry both `82` and `74/90` forms, so the denominator is kept
  // rather than assumed to be 100 — a hardcoded scale is what turns 74/90 into
  // a 74% bar.
  score: number | null
  scoreMax: number | null
  issues: number | null
  iteration: number | null
  // A REWRITE: block is only worth surfacing when it is substantial; the
  // dashboard's threshold is 30 characters.
  rewrite: string | null
  // The humanised body. Where a body is JSON, the known prose keys are pulled
  // out — but `json` keeps the whole payload REACHABLE in place rather than
  // dropping it, because unlike the dashboard this register does not truncate.
  text: string
  json: Record<string, unknown> | null
}

// The keys humanizeBody() pulls, in the dashboard's own order.
const LOG_BODY_KEYS = [
  'qa_feedback', 'feedback', 'overall_feedback', 'generated_post', 'final_post',
  'hooks_text', 'revised_caption', 'summary', 'verdict_summary', 'note', 'text',
  'body', 'message',
] as const

export function parseLogEntry(e: AgentLogEntry): LogParse {
  const parsed = parseMaybeJson(e.body)
  let text = e.body
  let json: Record<string, unknown> | null = null
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    json = parsed as Record<string, unknown>
    for (const k of LOG_BODY_KEYS) {
      const v = str(json[k])
      if (v) { text = v; break }
    }
  }
  // The humanised prose first, the raw payload second — and never the two
  // concatenated: a body that appears twice makes a REWRITE: block match across
  // its own copy and doubles in length.
  const hays = json ? [text, e.body] : [e.body]
  const first = (re: RegExp): RegExpMatchArray | null => {
    for (const h of hays) { const m = h.match(re); if (m) return m }
    return null
  }
  const any = (re: RegExp): boolean => hays.some(h => re.test(h))
  const verdict = first(/\b(?:VERDICT|Status)\s*:\s*(PASS|FAIL|REWRITE_OK|NEEDS_REGENERATE|APPROVED)\b/i)
  const halt = /HALT/i.test(e.agent ?? '') || any(/\bHALT(?:ED)?\b/)
  const approved = any(/\bAPPROVED\b/)
  const status: LogStatus | null = halt
    ? 'HALT'
    : verdict
      ? (verdict[1].toUpperCase() as LogStatus)
      : approved ? 'APPROVED' : null
  const score = first(/\bSCORE\s*:?\s*(\d{1,3})(?:\s*\/\s*(\d{1,3}))?/i)
    ?? first(/\b(\d{1,3})\s*\/\s*(90|100|10)\b/)
  const issues = first(/\bISSUES?\s*:\s*(\d+)/i)
  const iter = first(/\b(?:iteration|attempt|regeneration attempt)\D{0,12}?(\d+)/i)
  const rw = first(/\bREWRITE\s*:\s*([\s\S]+)/i)
  const rewrite = rw && rw[1].trim().length > 30 ? rw[1].trim() : null
  const num = (m: RegExpMatchArray | null, i: number) => {
    const n = m?.[i] === undefined ? NaN : Number(m[i])
    return Number.isFinite(n) ? n : null
  }
  return {
    status,
    score: num(score, 1),
    scoreMax: num(score, 2),
    issues: num(issues, 1),
    iteration: num(iter, 1),
    rewrite,
    text,
    json,
  }
}

// The score progression across a whole log, in log order. This is what makes a
// REWRITE_OK 68 → 69 → 74 climb legible as a climb rather than as three
// unrelated paragraphs (IA §5.4 item 4).
export type ScoreStep = { i: number; score: number; max: number | null; agent: string | null }

export function scoreProgression(log: AgentLogEntry[]): ScoreStep[] {
  const out: ScoreStep[] = []
  log.forEach((e, i) => {
    const p = parseLogEntry(e)
    if (p.score !== null) out.push({ i, score: p.score, max: p.scoreMax, agent: e.agent })
  })
  return out
}

export type QaRegenAttempt = {
  iteration: number | null
  score: number | null
  issues: number | null
  rewriteApplied: boolean | null
  verdict: string | null
  rest: [string, unknown][]
}

export type QaSummary = {
  score: number | null
  verdict: string | null
  feedback: string | null
  // Only a literal PASS verdict is a pass. Everything else (REWRITE_OK, FAIL,
  // a missing verdict) reads amber — this is the flag the UI colours on, so it
  // must never be "not obviously bad".
  pass: boolean
  // 🔴 What actually SHIPPED when a gate rewrote the post. Present on 150 of 282
  // rows and dropped by the shipped normalizer — the voice-drift blind spot the
  // dashboard's QAVerdictPanel exists to close, and the single highest-value
  // field in the 1B spec (IA §5.2).
  rewriteText: string | null
  rewriteTotal: number | null
  rewriteApplied: boolean | null
  originalVerdict: string | null
  // Regeneration history: per-attempt score + issue count + whether a rewrite
  // was applied.
  regenHistory: QaRegenAttempt[]
  regenAttempts: number | null
  regenerateInstruction: string | null
  iteration: number | null
  // Gate detail, rendered when present. Left `unknown` on purpose — these carry
  // arrays and nested objects and are rendered structurally, never as a JSX
  // child (the source_detail crash class).
  gates: [string, unknown][]
  // Provenance of the QA row ITSELF. A backfilled verdict is not the same
  // evidence as a live one and has to say so.
  parseSuccess: boolean | null
  autoPromoted: boolean | null
  publishedVersion: unknown
  backfilled: boolean | null
  backfillV: unknown
  // Every key the register does not name above, so a key an agent starts
  // writing next month appears the day it appears.
  rest: [string, unknown][]
}

// The gate-detail keys, in render order. Enumerated (not inferred) because these
// are the ones whose shape the register knows how to draw.
const QA_GATE_KEYS = [
  'failing_slides', 'claim_check', 'lint_violations', 'lint_quota_violations',
  'lint_attempts', 'perSlide', 'per_slide',
] as const

const QA_NAMED_KEYS = new Set<string>([
  'score', 'verdict', 'feedback', 'rewrite_text', 'rewrite_total', 'rewrite_applied',
  'original_verdict', 'qa_regen_history', 'qa_regen_attempts', 'regenerate_instruction',
  'iteration', 'parse_success', 'auto_promoted', 'published_version', 'backfilled',
  'backfill_v', ...QA_GATE_KEYS,
])

// qa looks like {"score":82,"verdict":"PASS","feedback":"VERDICT: REWRITE_OK…"}
// on a live row — note the feedback text contradicting the verdict field, which
// is why the chip reads `verdict` and the prose is shown verbatim underneath
// rather than being re-derived from it. Returns null when there is nothing to
// show, so the caller renders no card at all instead of an empty one.
export function normalizeQa(v: unknown): QaSummary | null {
  const parsed = parseMaybeJson(v)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const o = parsed as Record<string, unknown>
  const score = num(o.score)
  const verdict = str(o.verdict)
  const feedback = str(o.feedback)
  const rewriteText = str(o.rewrite_text)
  const rest: [string, unknown][] = []
  for (const k of Object.keys(o).sort()) {
    if (QA_NAMED_KEYS.has(k)) continue
    if (o[k] === null || o[k] === undefined || o[k] === '') continue
    rest.push([k, o[k]])
  }
  const gates: [string, unknown][] = []
  for (const k of QA_GATE_KEYS) {
    const val = o[k]
    if (val === null || val === undefined || val === '') continue
    if (Array.isArray(val) && val.length === 0) continue
    gates.push([k, val])
  }
  // Nothing to show at all → no card, rather than an empty one. The register
  // counts the extended fields too: a row whose only QA content is a rewrite is
  // exactly the row this spec exists to surface.
  if (score === null && !verdict && !feedback && !rewriteText
    && gates.length === 0 && rest.length === 0) return null
  const history = parseMaybeJson(o.qa_regen_history)
  const regenHistory: QaRegenAttempt[] = Array.isArray(history)
    ? history.map(h => {
      if (!h || typeof h !== 'object' || Array.isArray(h)) {
        return { iteration: null, score: null, issues: null, rewriteApplied: null, verdict: str(h), rest: [] }
      }
      const e = h as Record<string, unknown>
      const named = new Set(['iteration', 'attempt', 'score', 'issues', 'issue_count', 'rewrite_applied', 'verdict'])
      return {
        iteration: num(e.iteration) ?? num(e.attempt),
        score: num(e.score),
        issues: num(e.issues) ?? num(e.issue_count),
        rewriteApplied: bool(e.rewrite_applied),
        verdict: str(e.verdict),
        rest: Object.keys(e).sort()
          .filter(k => !named.has(k) && e[k] !== null && e[k] !== undefined && e[k] !== '')
          .map(k => [k, e[k]] as [string, unknown]),
      }
    })
    : []
  return {
    score,
    verdict,
    feedback,
    pass: (verdict ?? '').trim().toUpperCase() === 'PASS',
    rewriteText,
    rewriteTotal: num(o.rewrite_total),
    rewriteApplied: bool(o.rewrite_applied),
    originalVerdict: str(o.original_verdict),
    regenHistory,
    regenAttempts: num(o.qa_regen_attempts),
    regenerateInstruction: str(o.regenerate_instruction),
    iteration: num(o.iteration),
    gates,
    parseSuccess: bool(o.parse_success),
    autoPromoted: bool(o.auto_promoted),
    publishedVersion: o.published_version ?? null,
    backfilled: bool(o.backfilled),
    backfillV: o.backfill_v ?? null,
    rest,
  }
}

// ---------- source_detail (AMENDMENTS §A4.2 — a live crash class) ----------
//
// 🔴 source_detail is a jsonb OBJECT on 71 of 282 rows — 63 of them in Mattan's
// lane — and the shipped pane pushed it straight into a JSX child, which throws
// "Objects are not valid as a React child" and blanks the pane. Ten distinct
// shapes are live; the register renders kind/label as the chip, quote +
// call_title as the blockquote (this is the real call quote the client board
// shows as its honest source chip), urls as links, and EVERY remaining key as a
// label/value row so no shape can be silently dropped.
export type SourceDetail = {
  kind: string | null
  label: string | null
  quote: string | null
  callTitle: string | null
  links: [string, string][]
  rows: [string, unknown][]
  // Set only for the 3 rows that hold a bare string.
  text: string | null
}

const SOURCE_NAMED = new Set(['kind', 'label', 'quote', 'call_title'])

export function normalizeSourceDetail(v: unknown): SourceDetail | null {
  const parsed = parseMaybeJson(v)
  if (parsed === null || parsed === undefined) return null
  const empty: SourceDetail = { kind: null, label: null, quote: null, callTitle: null, links: [], rows: [], text: null }
  if (typeof parsed === 'string') {
    const s = parsed.trim()
    return s ? { ...empty, text: s } : null
  }
  if (typeof parsed !== 'object') {
    const s = str(parsed)
    return s ? { ...empty, text: s } : null
  }
  if (Array.isArray(parsed)) {
    return { ...empty, rows: parsed.map((x, i) => [String(i + 1), x] as [string, unknown]) }
  }
  const o = parsed as Record<string, unknown>
  const links: [string, string][] = []
  const rows: [string, unknown][] = []
  for (const k of Object.keys(o).sort()) {
    if (SOURCE_NAMED.has(k)) continue
    const val = o[k]
    if (val === null || val === undefined || val === '') continue
    const s = str(val)
    // Only an http(s) value is rendered as a link. A slug or an lm_ref is a
    // reference, not a resolvable URL, and linking one would produce a dead
    // anchor that looks like a working one.
    if (s && /^https?:\/\//i.test(s)) links.push([k, s])
    else rows.push([k, val])
  }
  return {
    kind: str(o.kind),
    label: str(o.label),
    quote: str(o.quote),
    callTitle: str(o.call_title),
    links,
    rows,
    text: null,
  }
}

// The taxonomy keys worth showing, in render order. `source` is read by the
// detail screen's Source block; the rest form the taxonomy grid.
export const TAXONOMY_KEYS = [
  'source', 'pillar', 'hook_type', 'structure_used', 'image_style', 'arm',
] as const
export type TaxonomyKey = (typeof TAXONOMY_KEYS)[number]

// taxonomy is a jsonb object on most rows and a BARE STRING on some (the same
// live split styleKeysOf() handles, ACCESS-MATRIX check 3). A bare string is a
// structure value — that column predates image_style and every observed bare
// string is a structure name like "Teardown" — so it is read as
// structure_used, exactly as styleKeysOf reads it. The experiment arm is one
// level down (taxonomy.experiment.arm) and is flattened to 'arm' here so the
// grid stays a flat label/value list.
export function taxonomyFields(t: unknown): Partial<Record<TaxonomyKey, string>> {
  const parsed = parseMaybeJson(t)
  const out: Partial<Record<TaxonomyKey, string>> = {}
  if (typeof parsed === 'string') {
    const s = parsed.trim()
    if (s) out.structure_used = s
    return out
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out
  const o = parsed as Record<string, unknown>
  for (const k of TAXONOMY_KEYS) {
    if (k === 'arm') continue
    const v = str(o[k])
    if (v) out[k] = v
  }
  const exp = parseMaybeJson(o.experiment)
  if (exp && typeof exp === 'object' && !Array.isArray(exp)) {
    const arm = str((exp as Record<string, unknown>).arm)
    if (arm) out.arm = arm
  }
  return out
}

// ~25 further keys are live in taxonomy beyond the six above — value_tier 179,
// target_persona 160, precondition_target 159, image_description 158,
// structure_reason 110, error_message 63, source_candidate_id 42, … — and the
// shipped grid dropped every one of them. This emits the REMAINDER, sorted, so a
// key the generator adds next month appears the day it appears instead of the
// day someone edits TAXONOMY_KEYS (IA §5.6).
//
// Two keys are pulled out by the caller rather than listed here:
// error_message/error_flipped_at render next to the error stage chip (that is
// where an errored row's reason actually lives), and structure_reason renders
// directly beneath structure_used as its justification.
export const TAXONOMY_CALLOUT_KEYS = ['error_message', 'error_flipped_at', 'structure_reason'] as const

export function taxonomyExtras(t: unknown): [string, unknown][] {
  const parsed = parseMaybeJson(t)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  const o = parsed as Record<string, unknown>
  const known = new Set<string>([...TAXONOMY_KEYS, 'experiment', ...TAXONOMY_CALLOUT_KEYS])
  const out: [string, unknown][] = []
  for (const k of Object.keys(o).sort()) {
    if (known.has(k)) continue
    const v = o[k]
    if (v === null || v === undefined || v === '') continue
    out.push([k, v])
  }
  return out
}

// The two keys that are lifted OUT of the grid: the error reason, and the
// structure justification. Returned raw so the caller can place each one where
// it belongs.
export function taxonomyValue(t: unknown, key: string): string | null {
  const parsed = parseMaybeJson(t)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return str((parsed as Record<string, unknown>)[key])
}

// key_points is an array of strings on the rows that have it, and (like every
// other agent-written column here) occasionally a newline-joined string or a
// JSON string. Anything unreadable yields [] and renders nothing.
export function normalizeKeyPoints(v: unknown): string[] {
  const parsed = parseMaybeJson(v)
  if (typeof parsed === 'string') {
    return parsed.split('\n').map(s => s.trim()).filter(Boolean)
  }
  if (!Array.isArray(parsed)) return []
  return parsed.map(x => str(x)).filter((s): s is string => !!s)
}

// image_urls is typed string[] but is agent-written like everything else here;
// a single URL string is the shape that would otherwise render as a row of
// one-character images.
export function normalizeImageUrls(v: unknown): string[] {
  const parsed = parseMaybeJson(v)
  if (typeof parsed === 'string') return parsed.trim() ? [parsed.trim()] : []
  if (!Array.isArray(parsed)) return []
  return parsed.map(x => str(x)).filter((s): s is string => !!s)
}

// Whether an HTML artifact carries its own presentation. The engines author
// carousel_drafts.authored_html as a CLASS-BASED FRAGMENT (`<section
// class="card …">`) whose styles live in the render service's kit CSS — an
// iframe would show it as raw serif text, which is the opposite of "the post
// as it will appear" (the honest render of those rows is image_urls, the
// service's own screenshots). Only a document that ships a <style> or a
// stylesheet <link> earns the preview frame.
export function selfContainedHtml(v: string | null | undefined): boolean {
  const s = (v ?? '').trim()
  if (!s) return false
  return /<style[\s>]|<link[^>]*rel=["']?stylesheet/i.test(s)
}
