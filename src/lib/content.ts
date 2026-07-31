import { supabase } from './supabase'

// Content domain: Ivan's own posts/carousels AND the Rise board's, both out of
// the same carousel_drafts table. There is no per-client table fork — the whole
// tenancy split is one nullable column (phase1b §1).
export type ContentLane = 'ivan' | 'risedtc'

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
}

const COLS =
  'id, client_id, status, type, title, topic, post_body, scheduled_at, ' +
  'source_post_id, image_urls, taxonomy, updated_at, created_at, board_visible'

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
  return { rows: (data ?? []) as unknown as ContentDraft[], count: count ?? null }
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
}

// The publish queue behind BOTH lanes — its own status vocabulary, unrelated to
// carousel_drafts.status (phase1b §2).
export const QUEUE_STATUSES = ['pending', 'queued_v2', 'posting', 'posted', 'failed', 'cancelled'] as const

export async function fetchScheduledQueue(): Promise<ScheduledQueueRow[]> {
  const { data, error } = await supabase.from('scheduled_posts')
    .select('id, clickup_task_id, post_text, scheduled_at, posted_at, status, platform, is_repost, error_message, created_at')
    .in('status', QUEUE_STATUSES as unknown as string[])
    .order('scheduled_at', { ascending: false })
    .limit(500)
  if (error) throw error
  return (data ?? []) as unknown as ScheduledQueueRow[]
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
// the Rise lane is read-only ambient visibility here — client-facing decisions
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

// The one rule that decides whether a row shows a mutating affordance at all,
// in one place because round 2 renders those buttons from two surfaces (the
// queue card and the draft detail screen). D6: only a row waiting on review is
// actionable. D7: only in the Ivan lane — the Rise lane is read-only ambient
// visibility, and approveDraft/skipDraft are both scoped .is('client_id', null)
// anyway, so a Rise button would be a button that silently does nothing.
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
  source_detail: string | null
  source_ref: string | null
  client_idea_id: string | null
  funnel_stage: string | null
  published_at: string | null
  description: string | null
  key_points: unknown
  ig_caption: string | null
  pdf_url: string | null
  topic_strength: unknown
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

export type AgentLogEntry = { ts: string | null; body: string }

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
      if (body) out.push({ ts: null, body })
      continue
    }
    if (!e || typeof e !== 'object') continue
    const o = e as Record<string, unknown>
    const body = str(o.body) ?? str(o.message) ?? str(o.text) ?? str(o.note)
    if (!body) continue
    out.push({ ts: str(o.ts) ?? str(o.at) ?? str(o.created_at), body })
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

export type QaSummary = {
  score: number | null
  verdict: string | null
  feedback: string | null
  // Only a literal PASS verdict is a pass. Everything else (REWRITE_OK, FAIL,
  // a missing verdict) reads amber — this is the flag the UI colours on, so it
  // must never be "not obviously bad".
  pass: boolean
}

// qa looks like {"score":82,"verdict":"PASS","feedback":"VERDICT: REWRITE_OK…"}
// on a live row — note the feedback text contradicting the verdict field, which
// is why the chip reads `verdict` and the prose is shown verbatim underneath
// rather than being re-derived from it. Returns null when there is nothing to
// show, so the caller renders no card at all instead of an empty one.
export function normalizeQa(v: unknown): QaSummary | null {
  const parsed = parseMaybeJson(v)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const o = parsed as Record<string, unknown>
  const rawScore = typeof o.score === 'string' ? Number(o.score) : o.score
  const score = typeof rawScore === 'number' && Number.isFinite(rawScore) ? rawScore : null
  const verdict = str(o.verdict)
  const feedback = str(o.feedback)
  if (score === null && !verdict && !feedback) return null
  return { score, verdict, feedback, pass: (verdict ?? '').trim().toUpperCase() === 'PASS' }
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
