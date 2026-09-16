/* ==========================================================================
   LEAD MAGNETS: the lane's gated offers, and who else on the timeline runs
   the same play.

   `operator_lead_magnets` (db, live 2026-09-16) returns EVERY lead magnet in
   the lane's catalog, not just the ones with activity — most rows carry
   `posts: 0`. There is no per-post list inside a row: the row is the
   aggregate (`posts`, `comments`, `gate_dms`, `cta_clicks`, `calls`) since
   `since`. `calls` reads null on every lane today because no booking ledger
   is keyed by slug yet; the RPC ships one top-level `calls_note` explaining
   that (a null there means "not attributable", not "zero calls" — see the
   note text at read time, never hardcode it here).

   `operator_gated_posts` is a separate roster: OTHER accounts' posts that
   gate an offer behind a comment, ranked by reach efficiency (`per_1k` =
   comments per 1,000 followers). `follower_count` is only sometimes known
   (`followers_source` says how); `per_1k` is null whenever it isn't.
   ========================================================================== */
import { supabase } from './supabase'
import { CLIENT_OPS_GATE, type ContentLane } from './content'
import { sinceMonday } from './reach'
import { num } from './benchmark'

export type LmRow = {
  slug: string
  title: string
  status: 'published' | 'draft' | 'retired'
  keyword: string | null
  posts: number
  comments: number
  gate_dms: number
  cta_clicks: number
  /** Always null today: no booking ledger is keyed by slug yet (see `calls_note` on the read). */
  calls: number | null
  first_post: string | null
  last_post: string | null
  per_post_comments: number | null
}

export type GatedPost = {
  post_ref: string
  author: string
  author_url: string
  posted_at: string
  likes: number
  comments: number
  reposts: number
  follower_count: number | null
  followers_source: string | null
  per_1k: number | null
  cta_kind: string
  gate_keyword: string
  offer: string
  confidence: number
}

export type LeadMagnetsRead =
  | { kind: 'ready'; since: string; lms: LmRow[]; calls_note?: string; readAt: string }
  | { kind: 'denied' | 'failed'; message: string }

export type GatedRead =
  | { kind: 'ready'; since: string; judged: number; gated: number; posts: GatedPost[]; readAt: string }
  | { kind: 'denied' | 'failed'; message: string }

export type LmLayout = 'a' | 'b'
export type LmWindow = 4 | 12

/** An LM with fewer posts than this shows no rate line: too thin to read as a rate. */
export const LM_FLOOR_POSTS = 2
export const LM_DEFAULT_LAYOUT: LmLayout = 'a'
export const LM_WINDOWS: LmWindow[] = [4, 12]
/** Roster lines shown before a fold. */
export const LM_TOP = 8

/** Rows with any activity (a post, a CTA click, a gate DM, or a call), posts desc then comments desc then CTA clicks desc.
    Most catalog rows carry `posts: 0` and no other activity; the surfaces render only what this returns and state
    "N of M lead magnets show a post or a click" using `lms.length` for M. */
export function activeLms(lms: LmRow[]): LmRow[] {
  return lms
    .filter(r => r.posts > 0 || r.cta_clicks > 0 || r.gate_dms > 0 || (r.calls ?? 0) > 0)
    .sort((a, b) => b.posts - a.posts || b.comments - a.comments || b.cta_clicks - a.cta_clicks)
}

/** Comments per 1,000 followers, one decimal. Null when followers is null or zero (never divide by an unknown or empty audience). */
export function perThousand(comments: number, followers: number | null): number | null {
  if (followers === null || followers === 0) return null
  return Math.round((1000 * comments / followers) * 10) / 10
}

/** Reach-efficiency order: `per_1k` desc, unsized posts last, then comments desc. Stable on further ties. */
export function rankGated(posts: GatedPost[]): GatedPost[] {
  return [...posts].sort((a, b) => {
    if (a.per_1k === null && b.per_1k === null) return b.comments - a.comments
    if (a.per_1k === null) return 1
    if (b.per_1k === null) return -1
    return b.per_1k - a.per_1k || b.comments - a.comments
  })
}

/** "12,400 followers" when known, "size unknown" otherwise. */
export function sizeLabel(p: { follower_count: number | null }): string {
  return p.follower_count != null && p.follower_count > 0 ? `${num(p.follower_count)} followers` : 'size unknown'
}

/** null under `LM_FLOOR_POSTS` (too thin to read as a rate). Every number carries its denominator:
    text is "Comments per post 6.5"; note is "over 4 posts", or "14 gate DMs, 9 CTA clicks over 4 posts"
    when either count is present. */
export function lmRate(row: LmRow): { text: string; note: string } | null {
  if (row.posts < LM_FLOOR_POSTS) return null
  const rate = (row.per_post_comments ?? 0).toFixed(1)
  const extras: string[] = []
  if (row.gate_dms > 0) extras.push(`${row.gate_dms} gate DMs`)
  if (row.cta_clicks > 0) extras.push(`${row.cta_clicks} CTA clicks`)
  const note = extras.length ? `${extras.join(', ')} over ${row.posts} posts` : `over ${row.posts} posts`
  return { text: `Comments per post ${rate}`, note }
}

/** Whether `iso` falls in the last `weeks` (ISO-week aligned, same convention as reach's `sinceMonday`) up to `now`. */
export function inWindow(iso: string | null, weeks: LmWindow, now: number = Date.now()): boolean {
  if (!iso) return false
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return false
  const from = sinceMonday(now, weeks)
  return iso.slice(0, 10) >= from && t <= now
}

/** Reads `lm=a|b` off the hash's own query string first (`#/path?lm=b`), then `location.search`;
    defaults to `LM_DEFAULT_LAYOUT` when neither carries a recognised value. */
export function layoutFromLocation(loc: { hash: string; search: string }): LmLayout {
  const q = loc.hash.indexOf('?')
  const fromHash = q >= 0 ? new URLSearchParams(loc.hash.slice(q + 1)).get('lm') : null
  const fromSearch = new URLSearchParams(loc.search).get('lm')
  const v = fromHash ?? fromSearch
  return v === 'a' || v === 'b' ? v : LM_DEFAULT_LAYOUT
}

export async function fetchLeadMagnets(lane: ContentLane): Promise<LeadMagnetsRead> {
  const { data, error } = await supabase.rpc('operator_lead_magnets', { p_gate: CLIENT_OPS_GATE, p_client_id: lane })
  if (error) {
    const message = error.message || 'The lead magnets read failed.'
    return /permission|denied|not authorized|unauthorized|not_authenticated/i.test(message)
      ? { kind: 'denied', message }
      : { kind: 'failed', message }
  }
  const d = data as { since?: unknown; lms?: unknown; calls_note?: unknown } | null
  if (!d || typeof d.since !== 'string' || !Array.isArray(d.lms)) {
    return { kind: 'failed', message: 'The lead magnets read returned no usable list.' }
  }
  return {
    kind: 'ready',
    since: d.since,
    lms: d.lms as LmRow[],
    ...(typeof d.calls_note === 'string' ? { calls_note: d.calls_note } : {}),
    readAt: new Date().toISOString(),
  }
}

export async function fetchGatedPosts(lane: ContentLane): Promise<GatedRead> {
  const { data, error } = await supabase.rpc('operator_gated_posts', { p_gate: CLIENT_OPS_GATE, p_client_id: lane })
  if (error) {
    const message = error.message || 'The gated posts read failed.'
    return /permission|denied|not authorized|unauthorized|not_authenticated/i.test(message)
      ? { kind: 'denied', message }
      : { kind: 'failed', message }
  }
  const d = data as { since?: unknown; judged?: unknown; gated?: unknown; posts?: unknown } | null
  if (!d || typeof d.since !== 'string' || typeof d.judged !== 'number' || typeof d.gated !== 'number' || !Array.isArray(d.posts)) {
    return { kind: 'failed', message: 'The gated posts read returned no usable list.' }
  }
  return { kind: 'ready', since: d.since, judged: d.judged, gated: d.gated, posts: d.posts as GatedPost[], readAt: new Date().toISOString() }
}
