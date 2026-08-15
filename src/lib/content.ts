import { supabase } from './supabase'

// Content domain: Ivan's own posts/carousels AND Mattan Danino's board, both out
// of the same carousel_drafts table. There is no per-client table fork — the
// whole tenancy split is one nullable column (phase1b §1).
//
// 'risedtc' / 'arch' are DATABASE VALUES and never labels: client lanes are
// called "Mattan Danino" / "Davorin Smit" everywhere a human reads them (IA §0).
// LANE_LABEL is the only place that mapping lives, so a rename can never
// half-land again.
export type ContentLane = 'ivan' | 'risedtc' | 'arch'

export const CONTENT_LANES = ['ivan', 'risedtc', 'arch'] as const

export const LANE_LABEL: Record<ContentLane, string> = {
  ivan: 'Ivan',
  risedtc: 'Mattan Danino',
  arch: 'Davorin Smit',
}

// Possessive form, for "on Mattan's board" / "Ivan's drafts".
export const LANE_POSSESSIVE: Record<ContentLane, string> = {
  ivan: 'Ivan’s',
  risedtc: 'Mattan’s',
  arch: 'Davorin’s',
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
  // When it ACTUALLY went out — stamped from scheduled_posts.posted_at by the
  // write-back workflow (MZzvhOvlNuvSWllo). Carried on the LIST row, not just
  // the detail, because "what time did this post" is a calendar question:
  // scheduled_at is the intent, published_at is the event, and the two are not
  // always the same minute. Optional on the TYPE so existing fixtures compile.
  published_at?: string | null
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
  // The richer, human-written source (91% of drafts carry it — Ivan's own kill
  // notes on 08-13/14's audit sample — vs. taxonomy.source's coarse slug). It
  // was selected only by fetchDraftDetail's `select('*')` and rendered only in
  // the detail pane (DraftPane.tsx:987); the list card never carried it, so
  // Mattan-lane rows had no source legibility at all below the 1300px
  // breakpoint where the ct-colv source column folds away (faithful.css "THE
  // TABLE SHEDS COLUMNS"). Optional on the TYPE so every existing fixture
  // keeps compiling — the column is selected below, so live rows carry it.
  source_label?: string | null
}

const COLS =
  'id, client_id, status, type, title, topic, post_body, scheduled_at, published_at, ' +
  'source_post_id, image_urls, taxonomy, updated_at, created_at, board_visible, ' +
  'funnel_stage, qa_verdict:qa->>verdict, qa_score:qa->>score, ' +
  'qa_regen:qa->>qa_regen_attempts, qa_backfilled:qa->>backfilled, source_label'

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
    : { column: 'client_id', op: 'eq', value: lane }
}

// NULL→'ivan' the same way every existing screen does, so a raw carousel_drafts
// row can be compared against a lane without special-casing null at each site.
export function draftLane(r: { client_id?: string | null }): string {
  return r.client_id ?? 'ivan'
}

// ---------- buckets ----------

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

// ---------- the error ALARM window (ask 13) ----------
//
// "in content the errors only show latest 48 hour errors" — the alert strip is
// an ALARM, and an alarm that still rings for a June failure teaches the eye to
// ignore it. Errors older than the window stay visible in the Errors section
// and through the Stage filter; only the strip's count is time-scoped.
//
// When did it error? taxonomy.error_flipped_at is the honest stamp (the QA
// gate writes it when it flips a row to error — TAXONOMY_CALLOUT_KEYS renders
// it beside the stage chip); updated_at is the fallback for rows that predate
// the stamp. Live probe 2026-08-03: 7 errored rows, only 3 carry
// error_flipped_at, 2 fall inside 48h. The fallback over-reports recency if
// anything else touches an errored row — the right direction for an alarm.
export const ERROR_ALARM_HOURS = 48

export function errorAt(r: ContentDraft): string | null {
  return taxonomyValue(r.taxonomy, 'error_flipped_at') ?? r.updated_at ?? null
}

// True when an ERRORED row belongs in the alarm strip. A row with no parseable
// timestamp at all stays in the alarm — an undatable error must fail loud, not
// age out by accident.
export function isRecentError(r: ContentDraft, now: number = Date.now()): boolean {
  if (r.status !== 'error') return false
  const at = errorAt(r)
  if (!at) return true
  const t = new Date(at).getTime()
  if (!Number.isFinite(t)) return true
  return now - t <= ERROR_ALARM_HOURS * 3600_000
}

// ---------- the at-a-glance excerpt (old-board parity #2) ----------
//
// Ivan, complaint #2: a review row could be read only by OPENING it. The old
// board never made him do that — StudioListView.tsx:463-503 kept a persistent
// snippet of post_body under every title, and StudioListView.tsx:8-18 names it
// as the reason the list is scannable at all ("the operator reads without
// opening").
//
// The rules here are the ones a one-line preview needs to stay honest:
//  · the HOOK is the first non-empty line, because that is the only part of a
//    LinkedIn post the feed itself shows before "…see more";
//  · line breaks collapse to " · " rather than to a space, so two separate
//    lines never read as one sentence the draft does not contain;
//  · truncation is marked with an ellipsis, never silent — a clipped claim that
//    looks complete is the one way an excerpt can lie.
// It returns null rather than '' so a caller cannot render an empty line for a
// draft whose body has not been generated yet (every `generating` row).
export const EXCERPT_CHARS = 180

export function draftExcerpt(body: string | null | undefined, max: number = EXCERPT_CHARS): string | null {
  const lines = (body ?? '').split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return null
  const s = lines.join(' · ')
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
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
  const f = laneFilter(lane)
  let q = supabase.from('carousel_drafts').select(COLS, { count: 'exact' })
  q = f.op === 'is' ? q.is(f.column, null) : q.eq(f.column, f.value)
  // THE WHOLE LANE, the same set dashboard-v2's useContentLibrary reads (Ivan,
  // 2026-08-04: "u missing stuff from dashboard-v2"). The recent-or-active
  // window (updated_at within RECENT_DAYS OR an active status) silently dropped
  // every published/disqualified row older than 60 days, so this list and the
  // dashboard disagreed about what exists. Newest-first + the 1000 cap keeps
  // the fetch bounded; `count` stays exact so a capped page is visible as
  // "1000 of N" rather than passing as complete.
  const { data, error, count } = await q
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
  // The queue's own format column ('text' / 'single_image' / …). Selected since
  // 2026-08-10 because the calendar draws queue rows now and a chip's type label
  // has to come from somewhere: these rows have no carousel_drafts twin to read
  // a `type` off. Optional on the TYPE so existing fixtures keep compiling.
  post_format?: string | null
}

// The publish queue behind BOTH lanes — its own status vocabulary, unrelated to
// carousel_drafts.status (phase1b §2).
export const QUEUE_STATUSES = ['pending', 'queued_v2', 'posting', 'posted', 'failed', 'cancelled'] as const

// Takes no lane argument and needs none: scheduled_posts has no client_id column
// at all (42703), so it is Ivan's BY CONSTRUCTION, not by filter (IA §2.3 / R4).
export async function fetchScheduledQueue(): Promise<ScheduledQueueRow[]> {
  const { data, error } = await supabase.from('scheduled_posts')
    .select('id, clickup_task_id, post_text, scheduled_at, posted_at, status, platform, is_repost, error_message, created_at, post_kind, unipile_share_url, post_format')
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

// ---------- the pipeline's quiet vital signs (2026-08-07) ----------
//
// Ivan retired the Content strip's alarm band ("all not needed"). Three of the
// things it counted had no other home, so they moved to Ops — the surface for
// "something needs a person" — and this is what feeds them.
//
// 🔴 COUNTS, NEVER ROWS. The band was fed by the lane's own 1,000-row page. Ops
// must not pull that page a second time just to print four numbers, so every
// figure here is a `head: true` count query (the same argument useContentBadge
// makes). The rows themselves stay one click away, in the Content sections that
// render them.
//
// Ivan's rows carry client_id NULL, never 'ivan'.
export type PipelineHealth = {
  errored: number
  pastDue: number
  stalledGenerating: number
  failedPublish: number
}

export async function fetchPipelineHealth(now: number = Date.now()): Promise<PipelineHealth> {
  const nowISO = new Date(now).toISOString()
  const genCutoff = new Date(now - STUCK_GENERATING_MINUTES * 60_000).toISOString()
  const head = { count: 'exact' as const, head: true }
  const [err, due, gen, pub] = await Promise.all([
    supabase.from('carousel_drafts').select('id', head)
      .is('client_id', null).eq('status', 'error'),
    // isStuckScheduled, expressed in PostgREST: scheduled, nothing published
    // back, and either past its time or carrying no time at all.
    supabase.from('carousel_drafts').select('id', head)
      .is('client_id', null).eq('status', 'scheduled').is('source_post_id', null)
      .or(`scheduled_at.is.null,scheduled_at.lt.${nowISO}`),
    // isStuckGenerating's UPDATED_AT half only: taxonomy.generating_started_at
    // is the more precise stamp the row-level check prefers, and it is not
    // cheaply filterable here. The count can therefore lag the row by minutes —
    // it can never claim a stall the rows do not have.
    supabase.from('carousel_drafts').select('id', head)
      .is('client_id', null).eq('status', 'generating').lt('updated_at', genCutoff),
    supabase.from('scheduled_posts').select('id', head)
      .in('status', QUEUE_STATUSES as unknown as string[])
      .not('error_message', 'is', null).neq('error_message', ''),
  ])
  const first = [err, due, gen, pub].find(r => r.error)
  if (first?.error) throw first.error
  return {
    errored: err.count ?? 0,
    pastDue: due.count ?? 0,
    stalledGenerating: gen.count ?? 0,
    failedPublish: pub.count ?? 0,
  }
}

export function pipelineHealthTotal(h: PipelineHealth): number {
  return h.errored + h.pastDue + h.stalledGenerating + h.failedPublish
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
  // The two tenancy columns this table DOES have (the header above says
  // client_id 42703s, and that stays true). Both are NULL on every reviewing
  // row today — which is a fact about the DATA, not about the schema, so they
  // are SELECTED rather than assumed, and `ideaDecidable` reads them before any
  // decision leaves this app. Optional on the type so existing fixtures compile.
  workspace_type?: string | null
  campaign_id?: string | null
}

const IDEA_COLS =
  'id, source, raw_topic, normalized_topic, signal_strength, icp_fit_score, ' +
  'virality_score, gap_score, beat_fit_score, composite_score, why_score, ' +
  'format_recommendation, offer_ladder_map, content_type, post_angle, ' +
  'ivan_engaged, source_ref, slack_permalink, ingested_at, scored_at, ' +
  'promoted_draft_id, promoted_draft_table, promoted_clickup_task_id, ' +
  // 🔴 Read, never filtered on. A `.is('workspace_type', null)` here would make
  // a client-scoped idea VANISH from every surface this app has, which is the
  // failure mode the partition note above refuses for content_type. The row is
  // shown; the decision is what gets withheld (ideaDecidable).
  'workspace_type, campaign_id'

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
  // Rows matching the queue's real filter (the whole lane, since 2026-08-04).
  scoped: number
  // Rows in this lane, full stop. total > 0 && scoped === 0 means the filter ate
  // everything — a broken query, not an empty board. Neither the dashboard nor
  // this app could tell those apart before this probe existed (blank-board #5).
  total: number
}

export async function fetchLaneProbe(lane: ContentLane): Promise<LaneProbe> {
  // The queue reads the whole lane now (see fetchContentDrafts), so scoped and
  // total are the same probe — the shape survives because useContent and the
  // blank-board diagnosis read both names.
  const f = laneFilter(lane)
  const q = supabase.from('carousel_drafts').select('id', { count: 'exact', head: true })
  const totalRes = await (f.op === 'is' ? q.is(f.column, null) : q.eq(f.column, f.value))
  if (totalRes.error) throw totalRes.error
  const total = totalRes.count ?? 0
  return { scoped: total, total }
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

// ---------- restart-to-idea (old-board parity 3b) ----------
//
// The old board could send a later-stage row back to the START of the pipeline
// from its inline status control (PostStudioPanel.tsx:610-614, 715-725). v2 had
// no equivalent: a draft the pipeline had already ruined could only be
// regenerated in place (same row, same stage) or deleted.
//
// Two things here differ from the reference, both deliberate:
//  1. THE OLD CONFIRM DESCRIBED A WRITE IT DID NOT MAKE. Its body says "flipping
//     to 'idea'", and then `regenerateFromIdea` calls `regenerateDraft()` —
//     status='generating' plus the webhook, never 'idea'. The warning was true
//     about the consequence and false about the mechanism. The write below IS
//     status='idea', so the same sentence is now literally true.
//  2. THE CONFIRM IS IN THE SIGNATURE. approveDraft/skipDraft trust their caller
//     to ask first; this one overwrites the copy AND the image, so it takes the
//     answer as an argument and a caller that forgets the sheet does not
//     compile. The prompt is built here too, so the wording cannot drift away
//     from the board Ivan already knows.
//
// Ivan lane only, `.is('client_id', null)`, exactly like approve/skip — this
// throws a draft back to the pipeline and Mattan's lane is read-only here.
export const RESTART_STATUS = 'idea'

export type RestartPrompt = { title: string; message: string; confirmText: string }

// SCHEDULED and PUBLISHED are excluded, which the old board did NOT do. A
// scheduled row is armed at the n8n Bridge and a published one is already on
// LinkedIn; sending either back to 'idea' from this window would be a schedule/
// publish-path decision wearing a content-editing button, and this app does not
// make those (see the writes header above).
export const RESTART_BLOCKED_STATUS = ['scheduled', 'published', 'idea', 'suggestion']

export function canRestartToIdea(status: string, lane: ContentLane): boolean {
  return lane === 'ivan' && !RESTART_BLOCKED_STATUS.includes(status)
}

// The same list as a PostgREST `not.in` value, so the exclusion is enforced by
// the WRITE and not only by the button. `canRestartToIdea` is a UI predicate,
// and a guard that lives only in the UI is not a guard — the same argument
// deleteClientDraft makes for its board check (see its header below).
//
// It rides IN the UPDATE rather than in a read before it because the danger
// here is a RACE: the n8n Bridge can arm a row, or the publisher ship it,
// between the render that drew the button and the click that fires this. A
// re-read cannot close that window; one statement can — a row that turned
// 'scheduled' matches no filter, no write happens, and the zero-row result
// falls into the landed-write check this function already has.
export const RESTART_BLOCKED_FILTER = `(${RESTART_BLOCKED_STATUS.join(',')})`

// Verbatim from PostStudioPanel.tsx:717-719, including the conditional " and
// image" — the one adaptation is the noun: the reference interpolates the raw
// `type` column, so its own dialog reads "Regenerate this single_image?".
export function restartToIdeaPrompt(d: Pick<ContentDraft, 'type' | 'image_urls'>): RestartPrompt {
  const kind = d.type === 'carousel' ? 'carousel' : 'post'
  const hasImage = normalizeImageUrls(d.image_urls).length > 0
  return {
    title: `Regenerate this ${kind}?`,
    message: `Flipping to 'idea' will refire the pipeline and overwrite the current copy${hasImage ? ' and image' : ''}.`,
    confirmText: 'Regenerate',
  }
}

export async function restartDraftToIdea(
  d: Pick<ContentDraft, 'id' | 'type' | 'image_urls'>,
  ask: (p: RestartPrompt) => Promise<boolean>,
): Promise<boolean> {
  const ok = await ask(restartToIdeaPrompt(d))
  if (!ok) return false
  // `.select()` for the same reason the edit/delete writes carry one: PostgREST
  // answers a silent 204 when RLS filters the row away, and a window that says
  // "sent back to idea" off a filtered-away write is lying.
  const { data, error } = await supabase.from('carousel_drafts')
    .update({ status: RESTART_STATUS })
    .eq('id', d.id).is('client_id', null)
    .not('status', 'in', RESTART_BLOCKED_FILTER)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error(
      'Restart failed — the database did not accept the status change. A post that was '
      + 'scheduled or published since this window loaded cannot be sent back to idea.',
    )
  }
  return true
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

// ---------- the save CONFLICT contract (draft-window-v2) ----------
//
// The window is now an editor you can sit inside for minutes while four live
// engines (phase1 sweep, db/025's header) rewrite post_body on a schedule, and
// Proxy Health Recovery re-generates status='error' rows every ten minutes with
// no human in the loop. The old save was a blind PATCH: last writer won, and
// the loser was never told.
//
// db/025 protects an ALREADY-marked row from service_role. It does NOT protect
// the FIRST edit — the flag only exists once a save has landed — and it does
// not protect against the operator overwriting an engine's newer body without
// being told there was one. So this path never picks a winner: if the stored
// body has moved away from what the editor was opened on, the save STOPS and
// hands both texts back.
//
// Two independent detectors, because we cannot see the table's triggers from an
// anon key and must not depend on `updated_at` being maintained by one:
//   1. a PRE-FLIGHT read of post_body — definitive, does not care about
//      triggers, and catches the real case (an engine landing mid-edit);
//   2. a compare-and-swap on `updated_at` in the UPDATE predicate — closes the
//      read/write window IF the column is maintained, and is inert (never a
//      false conflict) if it is not, because the value came from the same read.
export type SaveConflict = {
  kind: 'conflict' | 'gone'
  /** What the database holds now. Null when the row is gone. */
  theirs: string | null
  theirUpdatedAt: string | null
}

export class DraftSaveConflict extends Error {
  readonly detail: SaveConflict
  constructor(detail: SaveConflict) {
    super(detail.kind === 'gone'
      ? 'This draft was deleted while you were editing it.'
      : 'This draft changed in the database while you were editing it.')
    this.name = 'DraftSaveConflict'
    this.detail = detail
  }
}

/**
 * Save an edited body, refusing to clobber a body that moved underneath it.
 *
 * @param base  the post_body the editor was opened on — the compare half of the
 *              compare-and-swap. Pass what was LOADED, never what is displayed.
 * @param baseUpdatedAt the row's updated_at at load, or null to skip the CAS.
 * @throws DraftSaveConflict when the stored body has moved, or the row is gone.
 */
export async function saveDraftBody(
  id: string,
  body: string,
  taxonomy: unknown,
  base: string | null,
  baseUpdatedAt: string | null,
): Promise<void> {
  // 1 — pre-flight. A `maybeSingle` so a deleted row is a fact, not an error.
  const pre = await supabase.from('carousel_drafts')
    .select('post_body, updated_at')
    .eq('id', id).is('client_id', null)
    .maybeSingle()
  if (pre.error) throw pre.error
  if (!pre.data) throw new DraftSaveConflict({ kind: 'gone', theirs: null, theirUpdatedAt: null })
  const stored = (pre.data.post_body ?? null) as string | null
  if ((stored ?? '') !== (base ?? '')) {
    throw new DraftSaveConflict({
      kind: 'conflict',
      theirs: stored,
      theirUpdatedAt: (pre.data.updated_at ?? null) as string | null,
    })
  }

  // 2 — the write, gated on updated_at not having moved since the pre-flight
  // read. Using the PRE-FLIGHT value (not the load-time one) keeps the CAS about
  // the window this function owns; a bookkeeping write between load and now has
  // already been forgiven by step 1, which compared the thing that matters.
  const freshUpdatedAt = (pre.data.updated_at ?? baseUpdatedAt) as string | null
  let q = supabase.from('carousel_drafts')
    .update({ post_body: body, taxonomy: stampHumanEdit(taxonomy) })
    .eq('id', id).is('client_id', null)
  if (freshUpdatedAt) q = q.eq('updated_at', freshUpdatedAt)
  const { data, error } = await q.select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    // Zero rows means the predicate stopped matching. Re-read to say WHICH of
    // the two reasons it was, rather than blaming the operator's session for a
    // race or a race for an RLS refusal.
    const post = await supabase.from('carousel_drafts')
      .select('post_body, updated_at')
      .eq('id', id).is('client_id', null)
      .maybeSingle()
    if (!post.error && !post.data) {
      throw new DraftSaveConflict({ kind: 'gone', theirs: null, theirUpdatedAt: null })
    }
    if (!post.error && post.data && ((post.data.post_body ?? '') !== (base ?? ''))) {
      throw new DraftSaveConflict({
        kind: 'conflict',
        theirs: (post.data.post_body ?? null) as string | null,
        theirUpdatedAt: (post.data.updated_at ?? null) as string | null,
      })
    }
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
  if (!del.error && del.data && del.data.length > 0) {
    await cancelQueueRowsFor(id)
    return 'deleted'
  }
  const upd = await supabase.from('carousel_drafts')
    .update({ status: SKIP_STATUS, taxonomy: stampOperatorDelete(taxonomy) })
    .eq('id', id).is('client_id', null)
    .select('id')
  if (upd.error) throw upd.error
  if (!upd.data || upd.data.length === 0) {
    throw new Error('Delete failed — the row was neither removed nor archived.')
  }
  await cancelQueueRowsFor(id)
  return 'disqualified'
}

/**
 * A DELETE THAT ONLY REACHES ONE TABLE IS NOT A DELETE.
 *
 * `scheduled_posts` is the table the publisher fires from, and nothing links it
 * back to the draft except `clickup_task_id` carrying the draft's own uuid —
 * no foreign key, no cascade. So a deleted draft used to leave a live queue row
 * holding the copy it was bridged with, which then published on schedule from a
 * row that has no draft to open, edit or move.
 *
 * Measured 2026-08-11: 8 of 16 pending queue rows pointed at draft ids that
 * exist in NO table in the database, and the publisher's send-time refresh
 * fail-softs on a missing draft, so each one was primed to publish its snapshot.
 *
 * `cancelled`, not deleted: it is the one queue status the calendar already
 * refuses to draw (queueStage), and it leaves the record of the slot intact.
 * Posted and failed rows are history and are never touched. Fail-soft on error —
 * the draft is already gone from the board, and throwing here would report a
 * delete that visibly happened as a failure.
 */
async function cancelQueueRowsFor(draftId: string): Promise<void> {
  try {
    await supabase.from('scheduled_posts')
      .update({ status: 'cancelled', error_message: 'draft_deleted_by_operator' })
      .eq('clickup_task_id', draftId)
      .in('status', ['pending', 'queued_v2', 'posting'])
  } catch {
    // see above: never fail a completed delete on the second write
  }
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

// ---------- idea decisions (old-board parity #1: "i cant even approve the ideas") ----------
//
// The one act this band was missing. An idea left this app only by being
// DELETED, which is the one decision the pipeline cannot act on: the curator's
// promote run is what turns a scored candidate into a generating draft, and
// nothing in v2 could ask for it.
//
// 🔴 THE WRITE IS NOT OURS AND MUST NOT BECOME OURS. `approve` cascades — the
// edge function fires n8n `lm-curator-promote` FIRST, throws if that fails, and
// only then stamps the candidate — so a client-side `UPDATE status='promoted'`
// would mark an idea promoted that no run ever picked up. This calls the SAME
// deployed function the old board calls, unchanged:
//
//   personal-site/lib/ideaProjection.ts:216-229 (`decideIdea`)
//     POST ${VITE_SUPABASE_URL}/functions/v1/lm-curator-decide
//     headers  Content-Type: application/json
//              Authorization: Bearer <VITE_SUPABASE_ANON_KEY>
//     body     { candidate_id, decision }   // `reason` added ONLY when non-empty
//
// Bare fetch(), never supabase.functions.invoke() — the same rule claude.ts:6-10
// and today.ts:6-8 record: invoke() adds an X-Client-Info header that dies in
// this project's CORS preflight.
//
// Statuses the function writes (read off the deployed body,
// resources/supabase/functions/lm-curator-decide/index.ts:63-101), not inferred:
//   approve → status='promoted'  + promoted_clickup_task_id, after the n8n run
//   reject  → status='archived'  + archived_reason='ivan_rejected[:reason]'
// Either way the row leaves `reviewing`, which is why it leaves this band.
//
// ⛔ DEFER IS DELIBERATELY NOT SHIPPED. The endpoint accepts it, and it writes
// status='reviewing' — the value every row in this band already holds. On the
// old board's projection that was still a log entry; here it would be a button
// that changes nothing and reads as a state change. Log-only acts do not get
// buttons in this app.
const IDEA_DECIDE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/lm-curator-decide`

export type IdeaDecision = 'approve' | 'reject'

// What the endpoint writes for each decision we ship. Exported so a test can
// pin the strings against the deployed function rather than against this file.
export const IDEA_DECISION_STATUS: Record<IdeaDecision, string> = {
  approve: 'promoted',
  reject: 'archived',
}

// The whole set this app is willing to send, and the runtime half of the type.
// ⛔ `defer`, `revert` and `rescue` are all VALID at the endpoint (index.ts:5)
// and none of them is here: defer is the no-op named above, and the other two
// are un-decisions of rows this band cannot see (they have left `reviewing`).
export const IDEA_DECISIONS: readonly IdeaDecision[] = Object.freeze(['approve', 'reject'])

// 🔴 THE LANE GUARD, and it is OURS BECAUSE THE SERVER HAS NONE.
// `lm-curator-decide` runs under SERVICE_ROLE, accepts any candidate_id from a
// bare anon bearer, and fetches + PATCHes by id with ZERO client check
// (index.ts:2, 17-26, 47, 106). So every scoping rule this app obeys has to be
// enforced on this side of the call.
//
// The columns are real: `client_id` 42703s on this table, but `workspace_type`
// and `campaign_id` BOTH EXIST (live census 2026-08-07) — they are merely NULL
// on all 77 reviewing rows today. "Nobody has populated the column yet" is the
// icp-scorer shape of safety and it is not one; this converts it into a code
// guarantee that survives the day someone does populate it.
//
// Two more things make the scope structural rather than hopeful:
//   · the argument is the ROW, not a bare id, so the only candidate ids that
//     can reach the endpoint are ones this app's own ideas read returned;
//   · the same predicate gates the buttons, so a guarded row is never offered.
export function ideaDecidable(i: Pick<IdeaCandidate, 'workspace_type' | 'campaign_id'>): boolean {
  const w = (i.workspace_type ?? '').trim().toLowerCase()
  return (w === '' || w === 'own') && (i.campaign_id ?? null) === null
}

export const IDEA_NOT_OURS =
  'This idea is scoped to another workspace — decide it where that workspace lives.'

export async function decideIdea(
  i: Pick<IdeaCandidate, 'id' | 'workspace_type' | 'campaign_id'>,
  decision: IdeaDecision,
  reason?: string,
): Promise<Record<string, unknown>> {
  if (!ideaDecidable(i)) throw new Error(IDEA_NOT_OURS)
  // 🔴 EXPLICIT OR NOTHING. `JSON.stringify` DROPS an undefined value, so a
  // missing decision does not fail loudly here — it ships `{candidate_id}`
  // alone and lets the edge function answer `invalid_decision` (index.ts:41-44),
  // i.e. a real POST at a live endpoint for a call this app never meant to
  // make. The types stop it at compile time; this stops it at the seam, which
  // is where the two callers that are NOT typed (a test, a future one) live.
  if (!IDEA_DECISIONS.includes(decision)) throw new Error(`decide: no decision (${String(decision)})`)
  const body: Record<string, string> = { candidate_id: i.id, decision }
  const note = reason?.trim()
  if (note) body.reason = note
  const res = await fetch(IDEA_DECIDE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error || `decide ${res.status}`)
  }
  return (await res.json().catch(() => ({}))) as Record<string, unknown>
}

// ---------- THE CLIENT LANE (inbox-mattan-lane-actions) ----------
//
// Ivan, 2026-08-03: "there is no delete or approve option… also i dont see edit
// option… in mattan's case, after i approve needs review it goes to the board".
//
// The whole Mattan lane was read-only, and the stated reason was sound but
// incomplete: approveDraft/skipDraft ARE scoped `.is('client_id', null)`, so
// wiring them to a client row would have been a button that silently does
// nothing. What was missing is that the client lane has its OWN write path, and
// it is not those functions.
//
// 🔴 EVERY RULE BELOW IS COPIED OFF THE LIVE FUNCTION BODY, not inferred.
// pg_get_functiondef, 2026-08-03, saved in the run's rpc-defs.json:
//
//   operator_set_board_visible(p_gate text, p_draft_id uuid, p_visible boolean)
//     · gate first                                           -> 'bad_gate'
//     · client_id IS NULL                                    -> 'draft_not_found'
//       (so it REFUSES an Ivan row by construction — this is a client-only RPC)
//     · p_visible AND status <> 'review'                     -> 'not_in_review'
//     · update carousel_drafts set board_visible, updated_at
//     · net.http_post → n8n /webhook/client-board-queue-sync
//     · returns {ok, id, board_visible, client_id, sync_request_id}
//   It writes board_visible and NOTHING ELSE. It never touches status, never
//   sets scheduled_at, and cannot publish.
//
//   operator_edit_draft_body(p_gate text, p_draft_id uuid, p_body text)
//     · gate first                                           -> 'bad_gate'
//     · empty/blank body                                     -> 'empty_body'
//     · where client_id IS NOT NULL and status in ('review','scheduled')
//       — zero rows                                          -> 'not_editable'
//     · appends an {agent:'Operator'} agent_log entry
//     · 🔴 does NOT stamp taxonomy.human_edited — see saveClientDraftBody.
//
// The gate string is NOT a secret: it ships in the dashboard's public JS
// (clientops2/shared.tsx:21). operator_gate_ok compares its sha256 against
// integration_config.operator_panel_gate_hash; the real authorization is the
// authenticated-only EXECUTE grant.
export const CLIENT_OPS_GATE = 'clientops'

// A refusal from a gated RPC, carrying the server's own code so the surface can
// say WHICH rule refused instead of "something went wrong".
export class ClientRpcError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ClientRpcError'
    this.code = code
  }
}

// The server's codes, in Ivan's words. Anything unmapped keeps the raw code
// rather than being smoothed into a generic sentence — an unknown refusal is
// still a fact and hiding its name makes it unsearchable.
export const CLIENT_RPC_MESSAGES: Record<string, string> = {
  bad_gate: 'The operator gate refused this. Nothing changed — the draft is exactly as it was.',
  draft_not_found:
    'The database has no client draft with this id. Nothing changed.',
  not_in_review:
    'Only a draft still at Needs review can go on the client’s board — that rule lives in the database, not here.',
  not_editable:
    'The client’s copy can only be edited while the draft is at Needs review or Scheduled.',
  empty_body: 'An empty post cannot be saved.',
  awaiting_media: 'That draft carries no image, and the scheduler refuses a client post without one.',
  // The Ivan lane's refusal, verbatim from the function body. It is not an
  // error state to route around: this RPC is the client lane's write path and
  // has no Ivan-lane equivalent, which is why the calendar offers no move
  // control on that lane at all (calendarItems.ts, canMoveDate).
  not_found: 'The database has no draft with this id. Nothing changed.',
  not_a_client_draft:
    'That is one of your own drafts, and the scheduler RPC only accepts a client’s. '
    + 'Nothing changed — its date is exactly as it was.',
  // operator_set_schedule_date's only rule beyond the gate: `status in
  // ('review','scheduled')`. A published post is the case this refuses in
  // practice, and the refusal is the database's, not ours.
  bad_status:
    'Only a draft at Needs review or Scheduled can be re-dated. '
    + 'Nothing changed — its date is exactly as it was.',
}

export function clientRpcMessage(code: string): string {
  return CLIENT_RPC_MESSAGES[code] ?? `The database refused this: ${code}.`
}

function rpcOk(data: unknown, error: { message: string } | null): Record<string, unknown> {
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as Record<string, unknown>
  if (r.ok !== true) {
    const code = typeof r.error === 'string' ? r.error : 'unknown'
    throw new ClientRpcError(code, clientRpcMessage(code))
  }
  return r
}

// ---- the four policy rules, mirrored from the SQL above --------------------
//
// These exist as functions, tested against the predicates they mirror, because
// the alternative is an inline `lane === 'risedtc' && status === 'review'` at
// each of the three surfaces that renders these buttons — and the day the SQL
// changes, three places have to be found.

// PROMOTE. `status === 'review'` is the RPC's own predicate: it answers
// 'not_in_review' for anything else. This is also why approveDraft must NEVER be
// pointed at a client row — flipping one to 'approved' would make it
// PERMANENTLY unpromotable.
export function canPromote(status: string, lane: ContentLane): boolean {
  return lane !== 'ivan' && status === 'review'
}

// UN-PROMOTE has no status rule in the SQL (the `not_in_review` branch is
// guarded by `p_visible`), so taking a post back off the board works at any
// stage — which is what makes it a real undo.
export function canUnpromote(lane: ContentLane, boardVisible: boolean | null | undefined): boolean {
  return lane !== 'ivan' && boardVisible === true
}

// EDIT. The RPC's `status in ('review','scheduled')` verbatim.
export function clientEditable(status: string, lane: ContentLane): boolean {
  return lane !== 'ivan' && (status === 'review' || status === 'scheduled')
}

// DELETE, and the one rule here that is OURS rather than the database's.
//
// 🔴 The client board's `queue` is a DENORMALISED COPY of the promoted drafts —
// each entry carries the draft's id, title, post_body and images inline
// (get_client_board, probed 2026-08-03: queue length 23, and its id set is
// EXACTLY the board_visible=true set, 23/23, zero either way). Only
// operator_set_board_visible fires the sync that rebuilds it. So deleting a
// PROMOTED row removes it from our side while leaving a full copy of it sitting
// on a paying client's live board, with nothing scheduled to ever clean it up.
//
// A never-promoted row cannot be in that queue (the set equality above is the
// proof), so deleting one is exactly as safe as deleting an Ivan row.
//
// The order that IS safe is un-promote → delete: un-promoting fires the sync,
// which rebuilds the queue without the row, and the delete cannot lose that race
// because a sync that runs afterwards would not find the row either.
export function clientDeletable(lane: ContentLane, boardVisible: boolean | null | undefined): boolean {
  return lane !== 'ivan' && boardVisible !== true
}

// ---- the writes ------------------------------------------------------------

/**
 * Put a client draft on the client's board, or take it back off.
 *
 * 🔴 CLIENT-FACING. `true` is the moment a paying client can see this post: the
 * RPC fires the queue-sync webhook inline, so the board's own copy is rebuilt
 * without anyone pressing anything else. It does NOT publish — board_visible is
 * the only column it writes.
 */
/**
 * Move a CLIENT draft to a day the operator picked.
 *
 * 🔴 THIS IS THE ONLY DATE WRITE IN THE APP, and it is a gated RPC on purpose.
 * A direct `carousel_drafts.update({ scheduled_at })` is what the publish
 * bridge acts on, and the client board renders a denormalised snapshot that
 * only the RPC's own flow rebuilds — so a direct write moves the date on our
 * side and nowhere else. Same path the dashboard's drag-to-reschedule uses
 * (clientops2/shared.tsx `onReschedule`); only the picked day differs.
 *
 * 🔴 IT IS NOT A DATE-ONLY WRITE. The function body also sets
 * `status='scheduled'` and `board_visible=true`, so moving a draft PROMOTES it
 * onto the client's live board. Every caller has to say so before it fires.
 *
 * @returns the `scheduled_at` the database ended up holding.
 * @throws ClientRpcError carrying the server's own refusal code.
 */
export async function scheduleDraftAt(id: string, publishAt: string): Promise<string> {
  const { data, error } = await supabase.rpc('operator_schedule_draft', {
    p_gate: CLIENT_OPS_GATE, p_draft_id: id, p_publish_at: publishAt,
  })
  const r = rpcOk(data, error)
  return typeof r.scheduled_at === 'string' ? r.scheduled_at : publishAt
}

/**
 * Move a draft's DATE, and nothing else. Either lane.
 *
 * The calendar's write path (db/032, live 2026-08-07). It is the same gate and
 * the same shape as scheduleDraftAt above, and the whole difference is what it
 * leaves alone:
 *
 *   operator_set_schedule_date(p_gate text, p_draft_id uuid, p_scheduled_at timestamptz)
 *     · gate first                                  -> 'bad_gate'
 *     · no such row                                 -> 'not_found'
 *     · status not in ('review','scheduled')        -> 'bad_status'
 *     · update set scheduled_at = p_scheduled_at
 *
 * So: no `status='scheduled'`, no `board_visible=true`, and NO client_id test —
 * a row that was not armed stays unarmed, a post that is not on the client's
 * board does not appear on it, and Ivan's own lane is accepted. That is why the
 * calendar can offer a move on both lanes without it being an arming action.
 *
 * scheduleDraftAt stays the ARMING call and keeps its own callers (the draft
 * pane's Schedule button): promoting a client post to the board is a real
 * decision, and this function deliberately cannot make it.
 *
 * @returns the `scheduled_at` the database ended up holding.
 * @throws ClientRpcError carrying the server's own refusal code.
 */
export async function setScheduleDateAt(id: string, scheduledAt: string): Promise<string> {
  const { data, error } = await supabase.rpc('operator_set_schedule_date', {
    p_gate: CLIENT_OPS_GATE, p_draft_id: id, p_scheduled_at: scheduledAt,
  })
  const r = rpcOk(data, error)
  return typeof r.scheduled_at === 'string' ? r.scheduled_at : scheduledAt
}

export async function setBoardVisible(id: string, visible: boolean): Promise<void> {
  const { data, error } = await supabase.rpc('operator_set_board_visible', {
    p_gate: CLIENT_OPS_GATE, p_draft_id: id, p_visible: visible,
  })
  rpcOk(data, error)
}

/**
 * Save an edited body on a CLIENT row, refusing to clobber a body that moved.
 *
 * Three steps, in this order for a reason:
 *
 *  1. PRE-FLIGHT read of post_body — the same definitive detector the Ivan
 *     lane's saveDraftBody uses, and the one that catches the real case (an
 *     engine landing a rewrite mid-edit).
 *
 *  2. STAMP taxonomy.human_edited FIRST, with a compare-and-swap on updated_at.
 *     Two things ride on the order:
 *       · the CAS closes the read/write window the gated RPC cannot close
 *         itself — it exposes no compare-and-swap of its own. updated_at is
 *         VERIFIED maintained on this table (a no-op PATCH on a client row
 *         moved it from 2026-07-27 to now, probe 2026-08-03), so this is a live
 *         detector here, not the inert fallback the Ivan-lane comment allows for;
 *       · once the flag is set, db/025's trigger refuses every service_role
 *         post_body write on this row — so the window between step 2 and step 3
 *         is protected rather than merely narrow.
 *     operator_edit_draft_body does not stamp this itself, so without step 2 a
 *     client-lane edit would be the ONLY edit in the app the regen guard does
 *     not cover.
 *
 *  3. The BODY write goes through the gated RPC, never a direct PATCH. RLS would
 *     allow the direct write (authenticated is FOR ALL using(true) on this
 *     table, verified live) — but the RPC carries two things a direct write
 *     throws away: the status guard that refuses an edit to an already-published
 *     client post, and the Operator entry it appends to agent_log.
 *
 * @param base the post_body the editor was opened on. Pass what was LOADED.
 * @throws DraftSaveConflict when the stored body moved, or the row is gone.
 * @throws ClientRpcError when the database refuses the edit.
 */
export async function saveClientDraftBody(
  id: string,
  body: string,
  taxonomy: unknown,
  base: string | null,
  baseUpdatedAt: string | null,
): Promise<void> {
  const pre = await supabase.from('carousel_drafts')
    .select('post_body, updated_at')
    .eq('id', id).not('client_id', 'is', null)
    .maybeSingle()
  if (pre.error) throw pre.error
  if (!pre.data) throw new DraftSaveConflict({ kind: 'gone', theirs: null, theirUpdatedAt: null })
  const stored = (pre.data.post_body ?? null) as string | null
  if ((stored ?? '') !== (base ?? '')) {
    throw new DraftSaveConflict({
      kind: 'conflict',
      theirs: stored,
      theirUpdatedAt: (pre.data.updated_at ?? null) as string | null,
    })
  }

  const freshUpdatedAt = (pre.data.updated_at ?? baseUpdatedAt) as string | null
  let stamp = supabase.from('carousel_drafts')
    .update({ taxonomy: stampHumanEdit(taxonomy) })
    .eq('id', id).not('client_id', 'is', null)
  if (freshUpdatedAt) stamp = stamp.eq('updated_at', freshUpdatedAt)
  const stamped = await stamp.select('id')
  if (stamped.error) throw stamped.error
  if (!stamped.data || stamped.data.length === 0) {
    // The predicate stopped matching between the read and the write. Say WHICH
    // of the two reasons it was rather than blaming a race for an RLS refusal.
    const post = await supabase.from('carousel_drafts')
      .select('post_body, updated_at')
      .eq('id', id).not('client_id', 'is', null)
      .maybeSingle()
    if (!post.error && !post.data) {
      throw new DraftSaveConflict({ kind: 'gone', theirs: null, theirUpdatedAt: null })
    }
    throw new DraftSaveConflict({
      kind: 'conflict',
      theirs: (post.data?.post_body ?? null) as string | null,
      theirUpdatedAt: (post.data?.updated_at ?? null) as string | null,
    })
  }

  const { data, error } = await supabase.rpc('operator_edit_draft_body', {
    p_gate: CLIENT_OPS_GATE, p_draft_id: id, p_body: body,
  })
  rpcOk(data, error)
}

/**
 * Delete a client draft that is NOT on the board.
 *
 * The board check is re-read from the database rather than trusted from the
 * row the surface is holding: a guard that lives only in the UI is not a guard,
 * and this one is the difference between a tidy queue and a ghost post on a
 * paying client's board (see clientDeletable).
 *
 * Same hard-delete-then-archive contract as the Ivan lane's deleteDraft, and
 * the same honesty: an unverified write is a failure, never a "Deleted".
 */
export async function deleteClientDraft(id: string, taxonomy: unknown): Promise<'deleted' | 'disqualified'> {
  const cur = await supabase.from('carousel_drafts')
    .select('board_visible').eq('id', id).not('client_id', 'is', null)
    .maybeSingle()
  if (cur.error) throw cur.error
  if (!cur.data) throw new Error('This draft is no longer in the database.')
  if (cur.data.board_visible === true) {
    throw new Error(
      'This draft is on the client’s board. Take it off the board first — deleting it here '
      + 'would leave a copy of it on his board with nothing to clean it up.',
    )
  }
  const del = await supabase.from('carousel_drafts')
    .delete()
    .eq('id', id).not('client_id', 'is', null)
    .select('id')
  if (!del.error && del.data && del.data.length > 0) return 'deleted'
  const upd = await supabase.from('carousel_drafts')
    .update({ status: SKIP_STATUS, taxonomy: stampOperatorDelete(taxonomy) })
    .eq('id', id).not('client_id', 'is', null)
    .select('id')
  if (upd.error) throw upd.error
  if (!upd.data || upd.data.length === 0) {
    throw new Error('Delete failed — the row was neither removed nor archived.')
  }
  return 'disqualified'
}

// The one rule that decides whether a row shows a mutating affordance at all,
// in one place because round 2 renders those buttons from two surfaces (the
// queue card and the draft detail screen). D7: only in the Ivan lane — Mattan’s
// lane has its own decision (promote, above), and approveDraft/skipDraft are
// both scoped .is('client_id', null) anyway, so a button there would be a button
// that silently does nothing.
//
// 🔴 And worse than nothing, if the scope were ever relaxed: approve writes
// status='approved', and operator_set_board_visible refuses to promote anything
// that is not at 'review'. An "approve" on a client row would therefore lock it
// off Mattan's board for good.
//
// 'error' joins 'review' (2026-08-03, Ivan: "there is no delete or approve
// option"). The live lane is 3 review rows against 13 errored ones — the
// QA_BLOCKED drafts at the top of his queue — and those had NO approve and NO
// skip, so the only backlog he actually has to clear was the one the app
// refused to act on. A failed QA verdict is an opinion about a draft, not a
// lock on it: Ivan is the override, and skip is how an errored row leaves the
// queue for good. The confirm names the state so an override is a decision, not
// an accident.
export function reviewActionable(status: string, lane: ContentLane): boolean {
  return (status === 'review' || status === 'error') && lane === 'ivan'
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

// ---------- the client lane's two categories (Ivan's item 3) ----------
//
// Ivan, 2026-08-03: "i see the needs review and on mattan's board are different
// but they are on the same category… in mattan's case, after i approve needs
// review it goes to the board… and on mattan's board category leaving needs
// review category".
//
// He is reading a real defect. The Mattan lane groups by promotion state and
// then renders the stage sections INSIDE each group — so the word "Needs
// review" appeared under "On Mattan's board" as well as under "Internal", 13
// rows and 59 rows respectively on the live lane (probe 2026-08-03). Same
// database status, two completely different meanings, one label.
//
// `review` on an INTERNAL row means Ivan has not decided whether Mattan should
// see it. `review` on a PROMOTED row means Mattan has it and has not answered.
// Neither of those is "needs review" without saying whose review, so neither
// says it.
export type BoardGroup = 'board' | 'internal'

const CLIENT_STAGE_LABEL: Record<BoardGroup, Partial<Record<ContentStage, string>>> = {
  // On his board: every stage here is a fact about HIM. "Buffer" is Ivan's own
  // word for it (2026-08-04): these rows sit on the RISE DTC board waiting on
  // Mattan's decision.
  board: {
    review: 'On buffer · client board',
    approved: 'Client approved',
    scheduled: 'Scheduled on his board',
  },
  // Our side: `review` is the decision Ivan is actually being asked for, and it
  // is named as that decision rather than as a status.
  //
  // Short on purpose. The GROUP header above it already says where the row is
  // ("Not on his board"), so a stage label that repeated that would spend a
  // header on a fact the reader just read — measured on the first live pass,
  // which stacked "WAITING ON YOU" directly above "WAITING ON YOU — NOT ON HIS
  // BOARD YET". Each header does one job: the group says where, the stage says
  // whose turn.
  internal: {
    review: 'Waiting on you',
    approved: 'Approved, still ours',
    scheduled: 'Scheduled, still ours',
  },
}

export function clientStageLabel(s: ContentStage, group: BoardGroup): string {
  return CLIENT_STAGE_LABEL[group][s] ?? STAGE_LABEL[s]
}

// A row is in the board group iff board_visible is literally true. NULL is not
// evidence of promotion — the same rule countBoardVisible uses, kept as one
// function so the grouping and the count can never disagree.
export function boardGroupOf(r: Pick<ContentDraft, 'board_visible'>): BoardGroup {
  return r.board_visible === true ? 'board' : 'internal'
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
  // SCORE, in the four shapes the engines actually emit. Order is by how
  // specific the anchor is, and the two anchored forms come FIRST for a
  // measured reason: the QA gate's own summary is "(total 93/120)" followed by
  // a "Scores:" block of "VOICE: 7/10" subscores, and the bare fallback below
  // only knows the /90 and /100 scales — so on a /120 row it skipped the total
  // and reported 7/10, the VOICE subscore, as the post's score. Live denominators
  // measured 2026-08-05 across every Ivan-lane log: 90 (101), 120 (59), 80 (30),
  // 70 (5). The anchored forms take any denominator and cannot drift onto a
  // subscore; the bare form stays scale-limited because it has no anchor.
  const score = first(/\btotal\s+(\d{1,3})\s*\/\s*(\d{1,3})\b/i)
    ?? first(/\((\d{1,3})\s*\/\s*(\d{1,3})\s*[,)]/)
    ?? first(/\bSCORE\s*:?\s*(\d{1,3})(?:\s*\/\s*(\d{1,3}))?/i)
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

// ---------- the register, compressed BY AGENT ----------
//
// Ivan, 2026-08-04: "make agent log nicer to read... with the dif agents
// compressed". Measured on the live lane: the richest draft carries 43 entries
// from 14 distinct agents across four generation passes, and QA Agent bodies
// average 7,206 characters. Forty-three peer rows is not a register anyone
// reads; fourteen agent rows that each open to their own passes is.
//
// The grouping key is the agent NAME and nothing else, so an agent that ran in
// four separate passes is ONE row carrying four entries — which is exactly the
// question the log gets asked ("what did QA say, across the attempts").
// Unattributed entries group together under a null agent rather than being
// dropped or scattered.
//
// Order is FIRST APPEARANCE, so the groups still read as the pipeline ran:
// Promoter first, QA Give-Up last. Sorting by count or by score would put the
// story out of order to save a row.
export type AgentGroup = {
  agent: string | null
  // Original log indices, preserved: the entry rows still need their position
  // for the elapsed-time gap and for a stable key.
  entries: { entry: AgentLogEntry; i: number }[]
  firstTs: string | null
  lastTs: string | null
  // The LAST status the agent reached — a gate that failed twice and then
  // passed is a pass, and the group header should say so.
  status: LogStatus | null
  scores: number[]
  scoreMax: number | null
}

export function groupLogByAgent(log: AgentLogEntry[]): AgentGroup[] {
  const order: (string | null)[] = []
  const byAgent = new Map<string | null, AgentGroup>()
  log.forEach((entry, i) => {
    const key = entry.agent ?? null
    let g = byAgent.get(key)
    if (!g) {
      g = { agent: key, entries: [], firstTs: null, lastTs: null, status: null, scores: [], scoreMax: null }
      byAgent.set(key, g)
      order.push(key)
    }
    g.entries.push({ entry, i })
    const p = parseLogEntry(entry)
    if (p.status) g.status = p.status
    if (p.score !== null) {
      g.scores.push(p.score)
      if (p.scoreMax !== null) g.scoreMax = p.scoreMax
    }
    if (entry.ts) {
      if (!g.firstTs) g.firstTs = entry.ts
      g.lastTs = entry.ts
    }
  })
  return order.map(k => byAgent.get(k)!)
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

// ---------------------------------------------------------------------------
// The still library — swapping the photo on a post
// ---------------------------------------------------------------------------
//
// 2026-08-09, Ivan: "we do need regen copy - swap image so we can add other
// library image". Until now the ONLY way to change a post's photo was to let
// `Text Post Photo Assigner` pick one, and a regeneration wipes `image_urls`
// outright — so a post whose photo was wrong had no operator-side fix.
//
// The source is the PUBLIC `post-stills` bucket, which the anon key can list
// (verified 2026-08-09: library 49, selfie-pool-a 14, selfie-pool-b 14). Three
// folders, in the order an operator wants them: the general library first, then
// the two selfie pools the assigner draws from.

export const STILL_FOLDERS = ['library', 'selfie-pool-a', 'selfie-pool-b'] as const
export type StillFolder = (typeof STILL_FOLDERS)[number]
export type Still = {
  name: string
  /** The full asset — what gets pinned to the draft. */
  url: string
  /**
   * A ~200px render of the same object, for the picker grid ONLY.
   *
   * The grid draws 48 tiles at 84px and was pointing every one of them at the
   * full-size original: measured 2.09MB for one PNG and 1.06MB for one JPG, so
   * one open of the library pulled tens of megabytes to fill 84px squares. The
   * same object through storage's render endpoint is 39.9KB at width=200 —
   * measured, same file, 26x lighter.
   *
   * NEVER pinned to a draft: `pick()` sends `url`. A 200px render is a preview,
   * and publishing one would put a thumbnail on LinkedIn.
   */
  thumb: string
  folder: StillFolder
}

const STILL_BUCKET = 'post-stills'
const IMAGE_RE = /\.(jpe?g|png|webp|gif|avif)$/i

/**
 * Every still in one folder, newest first.
 *
 * Non-images are dropped (the bucket also holds `_edit_preview` PNG scratch and
 * the odd stray), and so is the `.emptyFolderPlaceholder` row Supabase creates
 * for an empty prefix — it has a name and a size and would render as a broken
 * tile.
 *
 * 🔴 LISTED AS ANON, DELIBERATELY, and not through the SDK client.
 * `supabase.storage.from(...).list()` carries the logged-in operator's JWT
 * (role=`authenticated`), and that role has no SELECT policy on
 * `storage.objects` for this bucket after the 2026-07-19 RLS closure. The list
 * comes back `[]` with NO error — which is why the picker read "Nothing in this
 * folder" while the bucket held 49 + 14 + 14 images (measured 2026-08-10: anon
 * 49, authed 0, same prefix, same second). personal-site hit this first and
 * fixed it the same way (`listPostStills`, @7af2fef).
 *
 * post-stills is a PUBLIC bucket, so listing it as anon is what the bucket
 * already says it allows. The proper fix is a `storage.objects` SELECT policy
 * for `authenticated`, which is DDL and not ours to run from here.
 */
export async function listStills(folder: StillFolder): Promise<Still[]> {
  const base = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  const res = await fetch(`${base}/storage/v1/object/list/${STILL_BUCKET}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prefix: folder,
      limit: 200,
      sortBy: { column: 'created_at', order: 'desc' },
    }),
  })
  if (!res.ok) throw new Error(`The library would not list (${res.status}).`)
  const data: unknown = await res.json()
  if (!Array.isArray(data)) throw new Error('The library returned a shape this app cannot read.')
  return (data as { name?: string }[])
    .filter(o => typeof o.name === 'string' && IMAGE_RE.test(o.name))
    .map(o => ({
      name: o.name as string,
      folder,
      // getPublicUrl is pure string building — no auth, no request — so the URL
      // still comes from the SDK and stays encoded the way it encodes it.
      url: supabase.storage.from(STILL_BUCKET).getPublicUrl(`${folder}/${o.name}`).data.publicUrl,
      // Same path, the render endpoint instead of the object endpoint. If image
      // transformation is ever off on this project the render URL 4xxs and the
      // tile falls back to `url` in the picker's onError — a heavy grid is a
      // worse outcome than a slow one, and a blank grid is worse than both.
      thumb: supabase.storage.from(STILL_BUCKET)
        .getPublicUrl(`${folder}/${o.name}`, { transform: { width: 200, quality: 70 } })
        .data.publicUrl,
    }))
}

/**
 * Pin a photo onto one of IVAN'S drafts.
 *
 * `.is('client_id', null)` is the same lane guard every other write in this
 * file carries: a client row's media is the client board's business and is
 * never editable from here.
 *
 * 🔴 This does NOT stamp `human_edited`. That flag exists to stop the ENGINES
 * from overwriting words Ivan wrote (protect_human_edited_draft, which also
 * preserves image_urls when the old row had any). Setting it from a photo swap
 * would freeze the COPY too, and the operator only said which picture to use.
 */
export async function setDraftImage(id: string, url: string | null): Promise<void> {
  const { error } = await supabase.from('carousel_drafts')
    .update({ image_urls: url ? [url] : [] })
    .eq('id', id).is('client_id', null)
  if (error) throw error
}
