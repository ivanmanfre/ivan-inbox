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
  status: 'published' | 'draft' | 'retired' | 'private'
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
  /** Null on every `link`-kind row by rubric design (db/083), not just empty: a `link` gate names
      no comment word to type. Every reader already treats it as falsy; this just says so in the type. */
  gate_keyword: string | null
  offer: string
  confidence: number
}

export type LeadMagnetsRead =
  | {
      kind: 'ready'; since: string; lms: LmRow[]; calls_note?: string; readAt: string
      /** The active row with the most CTA clicks plus gate DMs (db/083). Absent on an older RPC;
          `null` when the RPC ran and found no row. Either way, no line prints for it. */
      best_own?: LmRow | null
    }
  | { kind: 'denied' | 'failed'; message: string }

export type GatedRead =
  | {
      kind: 'ready'; since: string; judged: number; gated: number; posts: GatedPost[]; readAt: string
      /** Roster posts in the window with no judgment yet (db/083). Absent on an older RPC. */
      unjudged?: number
      /** The top row by `per_1k` with a follower count, else by comments (db/083). `null` when the roster carries none. */
      best?: GatedPost | null
    }
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

const plural = (n: number, one: string) => `${num(n)} ${n === 1 ? one : `${one}s`}`

/** A rate with its thousands separator and exactly one decimal, matching the surfaces' own `rate1`.
    `num()` would round 13.3 to 13, so a rate never goes through it. */
const rate1 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** Catalog titles and judge-written offers carry an em or en dash; the house rule is that neither
    reaches the screen. Both surfaces already state this out the same way (CHANGE ONE, CHANGE BOTH). */
const plain = (s: string) => s.replace(/\s*[—–]\s*/g, ', ')

const GATE_KIND_LABEL: Record<string, string> = { comment_gate: 'a comment gate', dm_gate: 'a DM gate', link: 'a link' }

/* ==========================================================================
   THE VERDICT STRIP. One pure builder for both surfaces, so the Results
   section and the dedicated view can never disagree on what "the answer" is.
   Each line stands alone: a row with nothing to say is left out rather than
   printed with a placeholder, so the strip can carry one, two or three lines
   depending on what the two reads actually returned (ARCH's own thin roster
   may show only one or two). Every key it reads is optional — an older RPC
   simply produces no line for the piece it does not carry, never a crash.
   ========================================================================== */

/** Line 1: the loudest gate on the roster, from the RPC's own `best` pick (top by `per_1k`,
    else by comments). `null`/absent renders no line — there is no invented "best" to report. */
export function bestGateLine(best: GatedPost | null | undefined): string | null {
  if (!best) return null
  const what = best.gate_keyword ? `comment "${plain(best.gate_keyword)}"` : (GATE_KIND_LABEL[best.cta_kind] ?? best.cta_kind.replace(/_/g, ' '))
  const rate = perThousand(best.comments, best.follower_count)
  const size = rate != null ? `${rate1(rate)} per 1k followers` : 'size unknown'
  return `Best gate on the roster: ${plain(best.author)}, ${what}, ${plural(best.comments, 'comment')}, ${size}.`
}

/** Line 2: the lane's own best performer, from the RPC's own `best_own` pick (most CTA clicks
    plus gate DMs). `null`/absent renders no line. The status travels on the line: `best_own` is
    picked by activity alone (same rule as `activeLms`), so it is routinely a `retired` or `draft`
    row, and naming the title without saying so would read as a live recommendation it is not. */
export function bestOwnLine(row: LmRow | null | undefined): string | null {
  if (!row) return null
  const name = plain(row.title || row.keyword || row.slug)
  return `Your best lead magnet: ${name}, ${row.status}, ${plural(row.cta_clicks, 'CTA click')}, ${plural(row.gate_dms, 'gate DM')}, ${plural(row.posts, 'post')}.`
}

/** Line 3: coverage. Absent when `unjudged` is missing (older RPC) or exactly 0 (every roster
    post in the window is judged, so the gate share is no longer an upper bound). */
export function coverageLine(judged: number, unjudged: number | null | undefined): string | null {
  if (unjudged == null || unjudged <= 0) return null
  return `${num(judged)} of ${num(judged + unjudged)} roster posts judged, so treat the gate share as an upper bound.`
}

/** The whole strip, at most three lines, each independent: a read that is not `ready` (loading,
    denied, failed) contributes none of its lines rather than a placeholder for the other's. */
export function verdictLines(gated: GatedRead | null, lm: LeadMagnetsRead | null): string[] {
  const g = gated?.kind === 'ready' ? gated : null
  const l = lm?.kind === 'ready' ? lm : null
  return [
    g ? bestGateLine(g.best) : null,
    l ? bestOwnLine(l.best_own) : null,
    g ? coverageLine(g.judged, g.unjudged) : null,
  ].filter((line): line is string => line !== null)
}

/** null under `LM_FLOOR_POSTS` (too thin to read as a rate). Every number carries its denominator:
    text is "Comments per post 6.5"; note is "over 4 posts", or "14 gate DMs, 9 CTA clicks over 4 posts"
    when either count is present. Counts read through `num()` and take a singular when they are one. */
export function lmRate(row: LmRow): { text: string; note: string } | null {
  if (row.posts < LM_FLOOR_POSTS) return null
  const rate = (row.per_post_comments ?? 0).toFixed(1)
  const extras: string[] = []
  if (row.gate_dms > 0) extras.push(`${num(row.gate_dms)} gate ${row.gate_dms === 1 ? 'DM' : 'DMs'}`)
  if (row.cta_clicks > 0) extras.push(`${num(row.cta_clicks)} CTA ${row.cta_clicks === 1 ? 'click' : 'clicks'}`)
  const over = `over ${plural(row.posts, 'post')}`
  const note = extras.length ? `${extras.join(', ')} ${over}` : over
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

/** `best` / `best_own` are shaped exactly like an existing row of their own RPC, or JSON null.
    A key present but shaped wrong (an array, say) reads as null rather than crashing the parse:
    the strip's own line-builder already treats a missing pick as nothing to report. */
function readRowOrNull<T>(v: unknown): T | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as T) : null
}

export async function fetchLeadMagnets(lane: ContentLane): Promise<LeadMagnetsRead> {
  const { data, error } = await supabase.rpc('operator_lead_magnets', { p_gate: CLIENT_OPS_GATE, p_client_id: lane })
  if (error) {
    const message = error.message || 'The lead magnets read failed.'
    return /permission|denied|not authorized|unauthorized|not_authenticated/i.test(message)
      ? { kind: 'denied', message }
      : { kind: 'failed', message }
  }
  const d = data as { since?: unknown; lms?: unknown; calls_note?: unknown; best_own?: unknown } | null
  if (!d || typeof d.since !== 'string' || !Array.isArray(d.lms)) {
    return { kind: 'failed', message: 'The lead magnets read returned no usable list.' }
  }
  return {
    kind: 'ready',
    since: d.since,
    lms: d.lms as LmRow[],
    ...(typeof d.calls_note === 'string' ? { calls_note: d.calls_note } : {}),
    ...('best_own' in d ? { best_own: readRowOrNull<LmRow>(d.best_own) } : {}),
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
  const d = data as { since?: unknown; judged?: unknown; gated?: unknown; posts?: unknown; unjudged?: unknown; best?: unknown } | null
  if (!d || typeof d.since !== 'string' || typeof d.judged !== 'number' || typeof d.gated !== 'number' || !Array.isArray(d.posts)) {
    return { kind: 'failed', message: 'The gated posts read returned no usable list.' }
  }
  return {
    kind: 'ready',
    since: d.since,
    judged: d.judged,
    gated: d.gated,
    posts: d.posts as GatedPost[],
    ...(typeof d.unjudged === 'number' ? { unjudged: d.unjudged } : {}),
    ...('best' in d ? { best: readRowOrNull<GatedPost>(d.best) } : {}),
    readAt: new Date().toISOString(),
  }
}
