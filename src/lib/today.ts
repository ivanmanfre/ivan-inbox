import { supabase } from './supabase'

// Today tab data layer: the get-morning-brief edge function + a small
// localStorage projection so the tab paints instantly on open.
//
// TRANSPORT RULE — always a bare fetch(), NEVER supabase.functions.invoke().
// invoke() attaches an X-Client-Info header that this function's CORS policy
// rejects, so every invoke() call dies in preflight (browser-proven, 2026-07).

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-morning-brief`
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

// ---------- payload types ----------
// Deliberately tolerant: the edge fn keeps growing sections, and anything the
// renderer can live without is optional so a shape change degrades instead of
// throwing. Sections Today never renders (workflow_errors, client_errors,
// urgent_tasks, content_performance, pipeline) are intentionally NOT typed —
// Ivan cut the system zone from this surface.

export type Urgency = {
  id: string
  kind: string // 'reply' | 'approve' | 'handraiser' | …
  name: string
  company?: string | null
  title?: string | null
  snippet?: string | null
  waiting_since: string
  // Set by the edge fn's urgency builder — out-of-office autoreplies stay in
  // the array but are demoted out of the visible list (one definition feeds
  // badge, hero and push body).
  is_autoreply?: boolean | null
  prospect_id?: string | null
  client_id?: string | null
}
// The fn also returns action_url / linkedin_url on urgencies and
// approve_url / skip_url on feed drafts. Those are capability-bearing (…?k=…)
// or PII links: not typed here, never rendered, never cached.

export type DmDraft = {
  id: string
  prospect_name: string
  message_text: string
  channel?: string | null
  matched_offer?: string | null
  created_at: string
  prospect_id?: string | null
  client_id?: string | null
  // Stamped by get-morning-brief once a draft is >7d old; absent on older payloads.
  is_aging?: boolean | null
}

export type CommentDraft = {
  id: string
  post_author_name?: string | null
  comment_text?: string | null
  post_excerpt?: string | null
  drafted_at?: string | null
  client_id?: string | null
  is_aging?: boolean | null
  // Live-only (the LinkedIn post these drafts hang off). Never cached — a
  // link-through is worthless offline and the cache stays minimal.
  post_url?: string | null
}

export type FeedDraft = {
  id: string
  target_name?: string | null
  target_class?: string | null
  hook?: string | null
  draft?: string | null
  status?: string | null
  created_at?: string | null
  client_id?: string | null
  post_url?: string | null // live-only, never cached (see CommentDraft)
}

export type ScheduledPost = {
  id: string
  post_text?: string | null
  post_format?: string | null
  platform?: string | null
  scheduled_at?: string | null
  status?: string | null
  kind?: string | null
  client_id?: string | null
}

export type LinkedInHealth = {
  fresh_supply?: number | null
  sends_today?: number | null
  accepts_today?: number | null
  replies_today?: number | null
  needs_reply?: number | null
  stuck?: number | null
}

export type Brief = {
  generated_at: string
  urgencies: Urgency[]
  // Present once the edge fn's demotion/cutoff lands; absent on older payloads,
  // in which case the renderer derives what it can from the rows themselves.
  autoreplies_count?: number | null
  aging_count?: number | null
  needs_you: {
    comment_drafts: CommentDraft[]
    dm_drafts: DmDraft[]
    feed_drafts: FeedDraft[]
  }
  today_content: { scheduled_posts: ScheduledPost[] }
  content_calendar?: { entries?: ScheduledPost[] | null } | null
  outreach_queue?: { total?: number | null } | null
  outreach_health?: {
    linkedin?: LinkedInHealth | null
    cold_email?: { connected?: boolean | null; note?: string | null } | null
  } | null
}

export type BriefCounts = {
  generated_at?: string | null
  urgencies_count: number
  autoreplies_count?: number | null
  aging_count?: number | null
  needs_reply?: number | null
  posts_today?: number | null
  queue_total?: number | null
  approvals: { comments: number; dms: number; feed: number }
}

// ---------- shape branching ----------
// After the full-mode auth gating lands, a degraded-to-anon call gets the
// counts shape back instead of the full payload. Branch on shape rather than
// status so that never renders as a crash.

function obj(x: unknown): Record<string, unknown> | null {
  return x && typeof x === 'object' ? (x as Record<string, unknown>) : null
}

export function isCountsShape(x: unknown): boolean {
  const o = obj(x)
  if (!o) return false
  return o.mode === 'counts' || !Array.isArray(o.urgencies)
}

function num(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : 0
}

function optNum(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null
}

function arr<T>(x: unknown): T[] {
  return Array.isArray(x) ? (x as T[]) : []
}

export function asCounts(x: unknown): BriefCounts | null {
  const o = obj(x)
  if (!o) return null
  const a = obj(o.approvals)
  return {
    generated_at: typeof o.generated_at === 'string' ? o.generated_at : null,
    urgencies_count: num(o.urgencies_count),
    autoreplies_count: optNum(o.autoreplies_count),
    aging_count: optNum(o.aging_count),
    needs_reply: optNum(o.needs_reply),
    posts_today: optNum(o.posts_today),
    queue_total: optNum(o.queue_total),
    approvals: {
      comments: num(a?.comments), dms: num(a?.dms), feed: num(a?.feed),
    },
  }
}

export function asBrief(x: unknown): Brief | null {
  const o = obj(x)
  if (!o || !Array.isArray(o.urgencies)) return null
  const needs = obj(o.needs_you)
  const content = obj(o.today_content)
  return {
    generated_at: typeof o.generated_at === 'string' ? o.generated_at : new Date().toISOString(),
    urgencies: arr<Urgency>(o.urgencies),
    autoreplies_count: optNum(o.autoreplies_count),
    aging_count: optNum(o.aging_count),
    needs_you: {
      comment_drafts: arr<CommentDraft>(needs?.comment_drafts),
      dm_drafts: arr<DmDraft>(needs?.dm_drafts),
      feed_drafts: arr<FeedDraft>(needs?.feed_drafts),
    },
    today_content: { scheduled_posts: arr<ScheduledPost>(content?.scheduled_posts) },
    content_calendar: { entries: arr<ScheduledPost>(obj(o.content_calendar)?.entries) },
    outreach_queue: { total: optNum(obj(o.outreach_queue)?.total) },
    outreach_health: (obj(o.outreach_health) ?? null) as Brief['outreach_health'],
  }
}

// ---------- scope ----------
// client_id NULL (or absent) means Ivan — the coalescing every view in this app
// already uses. NEVER backfilled or rewritten anywhere.

export type Scope = 'all' | 'ivan' | 'risedtc'

export function rowClient(r: { client_id?: string | null }): string {
  return r.client_id ?? 'ivan'
}

export function inScope(r: { client_id?: string | null }, scope: Scope): boolean {
  return scope === 'all' || rowClient(r) === scope
}

// ---------- derived counts ----------

export function isAutoreply(u: Urgency): boolean {
  return u.is_autoreply === true
}

export function partitionUrgencies(list: Urgency[]): { visible: Urgency[]; autoreplies: Urgency[] } {
  const visible: Urgency[] = []
  const autoreplies: Urgency[] = []
  for (const u of list) (isAutoreply(u) ? autoreplies : visible).push(u)
  return { visible, autoreplies }
}

export function isToday(iso: string | null | undefined, now = new Date()): boolean {
  if (!iso) return false
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate()
}

// Posts that go out (or already went out) today. scheduled_posts is the fn's
// own answer; the calendar is the fallback for payloads where that section is
// empty but the calendar still carries today's slots.
export function postsToday(b: Brief, scope: Scope, now = new Date()): ScheduledPost[] {
  const direct = b.today_content.scheduled_posts.filter(p => inScope(p, scope))
  if (direct.length > 0) return direct
  return (b.content_calendar?.entries ?? [])
    .filter(p => inScope(p, scope) && isToday(p.scheduled_at, now) && p.status !== 'cancelled')
}

export function nextUp(b: Brief, scope: Scope, now = new Date()): ScheduledPost | null {
  const future = (b.content_calendar?.entries ?? [])
    .filter(p => inScope(p, scope) && p.scheduled_at && p.status !== 'cancelled'
      && new Date(p.scheduled_at).getTime() > now.getTime())
    .sort((a, b2) => (a.scheduled_at ?? '').localeCompare(b2.scheduled_at ?? ''))
  return future[0] ?? null
}

// Counts recomputed from the full payload, scoped by the client chip. The
// screen prefers these over the server scalars once the payload has landed,
// so the strip and the zones can never disagree.
export function countsFromBrief(b: Brief, scope: Scope, now = new Date()): BriefCounts {
  const scoped = b.urgencies.filter(u => inScope(u, scope))
  const { visible, autoreplies } = partitionUrgencies(scoped)
  return {
    generated_at: b.generated_at,
    urgencies_count: visible.length,
    autoreplies_count: b.autoreplies_count ?? autoreplies.length,
    aging_count: b.aging_count ?? null,
    needs_reply: b.outreach_health?.linkedin?.needs_reply ?? null,
    posts_today: postsToday(b, scope, now).length,
    queue_total: b.outreach_queue?.total ?? null,
    approvals: {
      comments: b.needs_you.comment_drafts.filter(d => inScope(d, scope)).length,
      dms: b.needs_you.dm_drafts.filter(d => inScope(d, scope)).length,
      feed: b.needs_you.feed_drafts.filter(d => inScope(d, scope)).length,
    },
  }
}

export function approvalsTotal(c: BriefCounts): number {
  return c.approvals.comments + c.approvals.dms + c.approvals.feed
}

// ---------- the masthead number ----------
//
// An aggregating home's characteristic failure is a headline that drifts from its
// parts: a big number sourced from one place, zones sourced from another, and the
// operator learns to distrust both. So the headline is DEFINED as the sum of the
// zone loads and nothing else, and the stacked bar renders those same three
// numbers — drift is arithmetically impossible rather than merely unlikely.
//
// It takes BriefCounts because countsFromBrief() already derives every one of
// these from the same arrays the zones render, so there is one derivation, not a
// parallel one that has to be kept in step by hand.
export type TodayLoad = {
  urgent: number
  approvals: number
  going: number
  total: number
}

export function todayLoad(c: BriefCounts | null): TodayLoad {
  if (!c) return { urgent: 0, approvals: 0, going: 0, total: 0 }
  const urgent = c.urgencies_count
  const approvals = approvalsTotal(c)
  const going = c.posts_today ?? 0
  return { urgent, approvals, going, total: urgent + approvals + going }
}

// ---------- transport ----------

export class BriefAuthError extends Error {}

async function callBrief(mode: 'counts' | 'full', token: string): Promise<unknown> {
  const res = await fetch(mode === 'counts' ? `${FN_URL}?mode=counts` : FN_URL, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  })
  if (res.status === 401 || res.status === 403) throw new BriefAuthError(`brief ${res.status}`)
  if (!res.ok) throw new Error(`brief ${res.status}`)
  return res.json()
}

// One refreshSession() retry on 401 — an expired token after the PWA has been
// backgrounded is the common case. A second failure is a real auth failure and
// the caller falls back to cached data with a visible stale marker rather than
// blanking the screen.
export async function fetchBrief(mode: 'counts' | 'full'): Promise<unknown> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new BriefAuthError('no session')
  try {
    return await callBrief(mode, token)
  } catch (e) {
    if (!(e instanceof BriefAuthError)) throw e
    const { data: refreshed, error } = await supabase.auth.refreshSession()
    const fresh = refreshed.session?.access_token
    if (error || !fresh) throw e
    return callBrief(mode, fresh)
  }
}

// ---------- cache ----------

export const CACHE_KEY = 'today-cache'

export type TodayCache = { fetched_at: string; brief: Brief }

const MAX_ROWS = 30

// SECURITY — WHITELIST PROJECTION, NOT A COPY.
// Everything written to localStorage is enumerated field by field below.
// approve_url, skip_url, action_url, linkedin_url and any other capability
// link (…?k=…) are dropped here and MUST NEVER be added: localStorage on this
// origin is readable by any script that ends up running here, and those URLs
// are bearer tokens that send/skip real messages. Never replace the explicit
// fields with a spread. cacheSafe() below is the second lock.
export function projectBrief(b: Brief): Brief {
  return {
    generated_at: b.generated_at,
    autoreplies_count: b.autoreplies_count ?? null,
    aging_count: b.aging_count ?? null,
    urgencies: b.urgencies.slice(0, MAX_ROWS).map(u => ({
      id: u.id, kind: u.kind, name: u.name, company: u.company ?? null,
      title: u.title ?? null, snippet: u.snippet ?? null,
      waiting_since: u.waiting_since, is_autoreply: u.is_autoreply ?? null,
      prospect_id: u.prospect_id ?? null, client_id: u.client_id ?? null,
    })),
    needs_you: {
      comment_drafts: b.needs_you.comment_drafts.slice(0, MAX_ROWS).map(d => ({
        id: d.id, post_author_name: d.post_author_name ?? null,
        comment_text: d.comment_text ?? null, post_excerpt: d.post_excerpt ?? null,
        drafted_at: d.drafted_at ?? null, client_id: d.client_id ?? null,
        is_aging: d.is_aging ?? null,
      })),
      dm_drafts: b.needs_you.dm_drafts.slice(0, MAX_ROWS).map(d => ({
        id: d.id, prospect_name: d.prospect_name, message_text: d.message_text,
        channel: d.channel ?? null, matched_offer: d.matched_offer ?? null,
        created_at: d.created_at, prospect_id: d.prospect_id ?? null,
        client_id: d.client_id ?? null, is_aging: d.is_aging ?? null,
      })),
      feed_drafts: b.needs_you.feed_drafts.slice(0, MAX_ROWS).map(d => ({
        id: d.id, target_name: d.target_name ?? null, target_class: d.target_class ?? null,
        hook: d.hook ?? null, draft: d.draft ?? null, status: d.status ?? null,
        created_at: d.created_at ?? null, client_id: d.client_id ?? null,
      })),
    },
    today_content: {
      scheduled_posts: b.today_content.scheduled_posts.slice(0, MAX_ROWS).map(projectPost),
    },
    content_calendar: {
      entries: (b.content_calendar?.entries ?? []).slice(0, MAX_ROWS).map(projectPost),
    },
    outreach_queue: { total: b.outreach_queue?.total ?? null },
    outreach_health: b.outreach_health
      ? {
        linkedin: b.outreach_health.linkedin
          ? {
            fresh_supply: b.outreach_health.linkedin.fresh_supply ?? null,
            sends_today: b.outreach_health.linkedin.sends_today ?? null,
            accepts_today: b.outreach_health.linkedin.accepts_today ?? null,
            replies_today: b.outreach_health.linkedin.replies_today ?? null,
            needs_reply: b.outreach_health.linkedin.needs_reply ?? null,
            stuck: b.outreach_health.linkedin.stuck ?? null,
          }
          : null,
        cold_email: b.outreach_health.cold_email
          ? {
            connected: b.outreach_health.cold_email.connected ?? null,
            note: b.outreach_health.cold_email.note ?? null,
          }
          : null,
      }
      : null,
  }
}

function projectPost(p: ScheduledPost): ScheduledPost {
  return {
    id: p.id, post_text: p.post_text ?? null, post_format: p.post_format ?? null,
    platform: p.platform ?? null, scheduled_at: p.scheduled_at ?? null,
    status: p.status ?? null, kind: p.kind ?? null, client_id: p.client_id ?? null,
  }
}

// Second lock on the whitelist: if a projection ever stringifies with a
// capability-token pattern in it, the write is refused outright (fail closed)
// rather than trusting that projectBrief() was kept correct.
export function cacheSafe(json: string): boolean {
  return !/approve_url|skip_url|action_url|[?&]k=/.test(json)
}

export function writeCache(b: Brief): void {
  let json: string
  try {
    json = JSON.stringify({ fetched_at: new Date().toISOString(), brief: projectBrief(b) })
  } catch {
    return
  }
  if (!cacheSafe(json)) return
  try { localStorage.setItem(CACHE_KEY, json) } catch { /* quota / private mode */ }
}

export function readCache(): TodayCache | null {
  let raw: string | null
  try { raw = localStorage.getItem(CACHE_KEY) } catch { return null }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { fetched_at?: unknown; brief?: unknown }
    const brief = asBrief(parsed.brief)
    if (!brief) return null
    return {
      fetched_at: typeof parsed.fetched_at === 'string' ? parsed.fetched_at : brief.generated_at,
      brief,
    }
  } catch {
    return null
  }
}

// ---------- inline approve support ----------
// The Drafts screen stamps the thread's existing unipile_chat_id on the row it
// approves (threadChatId, lib/inbox.ts) so the sender appends to the existing
// chat instead of creating one — creating fails with 422 for non-connections.
// Today's inline Approve has no loaded thread, so it looks the id up first and
// hands it to the SAME approveDraft write path. Null is fine: that's exactly
// what a thread with no chat id passes.
export async function fetchThreadChatId(prospect_id: string): Promise<string | null> {
  const { data, error } = await supabase.from('inbox_messages_v')
    .select('unipile_chat_id,created_at')
    .eq('prospect_id', prospect_id)
    .not('unipile_chat_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) return null
  const row = (data ?? [])[0] as { unipile_chat_id?: string | null } | undefined
  return row?.unipile_chat_id ?? null
}

// ---------- replies (campaign / inbound health) ----------
// Client-side only: the same inbox view the rest of the app reads, narrowed to
// inbound rows in the last 7 days. No edge-fn change, no new write path.

export type ReplyCount = { client_id: string; today: number; week: number }

type InboundRow = { prospect_id: string; client_id: string | null; created_at: string; sent_at?: string | null }

export function rollupReplies(rows: InboundRow[], now = new Date()): ReplyCount[] {
  // Same phantom-duplicate defence as the inbox: one prospect can't have two
  // genuinely distinct inbound rows at the same millisecond.
  const seen = new Set<string>()
  const map = new Map<string, ReplyCount>()
  // When they actually replied. created_at is when our detector stored the row, which can
  // be a day or more later for a backfilled reply -- counting on that credited every
  // late-captured reply to "today" and left the real day showing zero.
  const weekAgo = now.getTime() - 7 * 86_400_000
  for (const r of rows) {
    const at = r.sent_at ?? r.created_at
    const key = `${r.prospect_id}|${at}`
    if (seen.has(key)) continue
    seen.add(key)
    const id = r.client_id ?? 'ivan'
    const e = map.get(id) ?? { client_id: id, today: 0, week: 0 }
    // a backfill can surface a reply older than the window we fetched on created_at
    // compare as instants: Postgres returns '+00:00' while toISOString gives 'Z', and a
    // lexical compare of two different formats is only accidentally right.
    const ts = new Date(at).getTime()
    if (!Number.isNaN(ts) && ts >= weekAgo) e.week += 1
    if (isToday(at, now)) e.today += 1
    map.set(id, e)
  }
  return [...map.values()]
}

export async function fetchReplyCounts(): Promise<ReplyCount[]> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const { data, error } = await supabase.from('inbox_messages_v')
    .select('prospect_id,client_id,created_at,sent_at')
    .eq('direction', 'inbound')
    .gte('created_at', since)
  if (error) throw error
  return rollupReplies((data ?? []) as InboundRow[])
}

// ---------- formatting ----------

export function ago(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  const m = Math.floor(s / 60)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

// ago() returns a bare "now" under a minute, so callers that append " ago"
// render "Checked now ago" on the freshest and most common read. Freshness copy
// asks for a whole phrase, not a duration, so build it here once.
export function checkedPhrase(iso: string | null | undefined): string {
  if (!iso) return 'Never checked'
  const a = ago(iso)
  if (!a) return 'Never checked'
  return a === 'now' ? 'Checked just now' : `Checked ${a} ago`
}

// Local time, always — a brief generated at 00:36Z is "21:36" in Buenos Aires
// and that is the number Ivan reads against his own clock. 24h because the
// count strip is one line at 390px and "11:01 PM" is three characters too many.
export function clockTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function dayTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function longDate(d = new Date()): string {
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
}
