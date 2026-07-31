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
}

const COLS =
  'id, client_id, status, type, title, topic, post_body, scheduled_at, ' +
  'source_post_id, image_urls, taxonomy, updated_at, created_at'

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
