import { supabase } from './supabase'
import { CLIENT_OPS_GATE, type ContentLane } from './content'

/* ==========================================================================
   WHO THE POSTS REACHED: the pure math behind the Strategy Results reach block.

   Source: `operator_post_audience(p_gate, p_client_id)`, one row per post,
   newest first, from the post trackers (`source: 'tracker'`) and the history
   backfill (`source: 'backfill'`). `demographics` holds LinkedIn's top buckets
   only, so a label missing from a post's list contributes nothing for that
   post: a floor, never an invented value.

   The share and split math matches personal-site `lib/postReach.ts` (the client
   boards and Ivan's dashboard) line for line, so the same post set gives the
   same numbers on every surface:
     · split drawable only when both halves are numbers, each clamped 0-100,
     · members reached only when a positive number,
     · share per label = sum(pct / 100 x members_reached) over posts that list
       the category, divided by the summed members_reached of those posts,
       rounded, labels under 1% dropped,
     · out of network weighted by members_reached, a post with no reach counts
       once.

   Weeks are ISO weeks (Monday start) in UTC, so a post lands in the same week
   on every device and in every test run.
   ========================================================================== */

export type ReachBucket = { label: string; pct: number }
export type ReachCategory = 'job_title' | 'seniority' | 'industry'
export type ReachDemographics = Partial<Record<ReachCategory | 'company_size' | 'location', ReachBucket[] | null>>

export type PostAudienceRow = {
  activity_id: string
  post_url: string | null
  published_at: string | null
  title: string | null
  impressions: number | null
  in_pct: number | null
  out_pct: number | null
  members_reached: number | null
  demographics: ReachDemographics | null
  captured_at: string | null
  source: string | null
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** The split is drawable only when both halves are real numbers. */
export function splitOf(p: PostAudienceRow): { inPct: number; outPct: number } | null {
  if (!isNum(p.in_pct) || !isNum(p.out_pct)) return null
  return { inPct: Math.max(0, Math.min(100, p.in_pct)), outPct: Math.max(0, Math.min(100, p.out_pct)) }
}

/** Members reached, only when it is a real positive number. */
export function reachedOf(p: PostAudienceRow): number | null {
  return isNum(p.members_reached) && p.members_reached > 0 ? p.members_reached : null
}

/** Top buckets of one demographic list, in the order LinkedIn ranks them. */
export function topBuckets(list: ReachBucket[] | undefined | null, n: number): ReachBucket[] {
  return (Array.isArray(list) ? list : [])
    .filter(b => b && typeof b.label === 'string' && b.label.trim() && isNum(b.pct))
    .slice(0, n)
}

export type ReachShares = { labels: ReachBucket[]; posts: number; reached: number }

/** Share of members reached per label for one category, top `n`. Null when no post qualifies. */
export function reachShares(posts: PostAudienceRow[], key: ReachCategory, n = 3): ReachShares | null {
  const members = new Map<string, number>()
  let reached = 0
  let count = 0
  for (const p of posts) {
    const r = reachedOf(p)
    const list = topBuckets(p.demographics?.[key], Infinity)
    if (r == null || !list.length) continue
    reached += r
    count += 1
    for (const b of list) members.set(b.label, (members.get(b.label) ?? 0) + (b.pct / 100) * r)
  }
  if (!count || reached <= 0) return null
  const labels = [...members.entries()]
    .map(([label, m]) => ({ label, share: (m / reached) * 100 }))
    .sort((a, b) => b.share - a.share)
    .map(x => ({ label: x.label, pct: Math.round(x.share) }))
    .filter(x => x.pct >= 1)
    .slice(0, n)
  if (!labels.length) return null
  return { labels, posts: count, reached }
}

/** Out of network weighted by members reached; a post with no reach counts once. Null when no post has a split. */
export function weightedSplit(posts: PostAudienceRow[]): { inPct: number; outPct: number; n: number } | null {
  let wIn = 0, wOut = 0, w = 0, n = 0
  for (const p of posts) {
    const sp = splitOf(p)
    if (!sp) continue
    const raw = reachedOf(p)
    const weight = raw != null && raw > 0 ? raw : 1
    wIn += sp.inPct * weight; wOut += sp.outPct * weight; w += weight; n += 1
  }
  if (!n || w <= 0) return null
  return { inPct: Math.round(wIn / w), outPct: Math.round(wOut / w), n }
}

/** "Founder 18% · Marketing Manager 7%". A middle dot, because LinkedIn labels carry commas. */
export const formatShares = (labels: ReachBucket[]): string => labels.map(l => `${l.label} ${l.pct}%`).join(' · ')

// ---- weeks ----------------------------------------------------------------

const DAY = 86_400_000

/** Monday 00:00 UTC of the ISO week holding `iso`, as YYYY-MM-DD. Null for a missing or bad date. */
export function weekStartOf(iso: string | null | undefined): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  const d = new Date(Math.floor(t / DAY) * DAY)
  const back = (d.getUTCDay() + 6) % 7 // Monday = 0, Sunday = 6
  return new Date(d.getTime() - back * DAY).toISOString().slice(0, 10)
}

/** ISO week number and ISO year for a Monday (YYYY-MM-DD). */
export function isoWeek(monday: string): { year: number; week: number } {
  const t = new Date(`${monday}T00:00:00Z`).getTime()
  const thursday = new Date(t + 3 * DAY)
  const year = thursday.getUTCFullYear()
  const jan1 = Date.UTC(year, 0, 1)
  return { year, week: Math.floor((thursday.getTime() - jan1) / DAY / 7) + 1 }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "14 Sep", or "29 Dec 2025" when the year differs from `thisYear`. */
export function dayLabel(ymd: string, thisYear?: number): string {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return ymd
  return `${d} ${MONTHS[m - 1]}${thisYear != null && y !== thisYear ? ` ${y}` : ''}`
}

export type ReachWeek = {
  start: string
  week: number
  year: number
  posts: PostAudienceRow[]
  withSplit: number
  split: { inPct: number; outPct: number; n: number } | null
  reached: number
  /** Posts that report a positive members reached: the denominator of `reached`. */
  withReach: number
  topIndustry: ReachBucket | null
}

export function summarizeWeek(start: string, posts: PostAudienceRow[]): ReachWeek {
  const { year, week } = isoWeek(start)
  return {
    start, year, week, posts,
    withSplit: posts.filter(p => splitOf(p)).length,
    split: weightedSplit(posts),
    reached: posts.reduce((a, p) => a + (reachedOf(p) ?? 0), 0),
    withReach: posts.filter(p => reachedOf(p) != null).length,
    topIndustry: reachShares(posts, 'industry', 1)?.labels[0] ?? null,
  }
}

export type ReachSummary = {
  /** Every ISO week from the current one back to the oldest dated post, newest first. Empty weeks included. */
  weeks: ReachWeek[]
  /** The current ISO week and the three before it. */
  recent: {
    from: string
    posts: number
    withSplit: number
    split: { inPct: number; outPct: number; n: number } | null
    reached: number
    withReach: number
    shares: Record<ReachCategory, ReachShares | null>
  }
  total: number
  undated: number
}

export const RECENT_WEEKS = 4

export function summarizeReach(rows: PostAudienceRow[], now: number = Date.now()): ReachSummary {
  const byWeek = new Map<string, PostAudienceRow[]>()
  let undated = 0
  for (const r of rows) {
    const w = weekStartOf(r.published_at)
    if (!w) { undated += 1; continue }
    const list = byWeek.get(w) ?? []
    list.push(r)
    byWeek.set(w, list)
  }
  const current = weekStartOf(new Date(now).toISOString()) as string
  const starts = [...byWeek.keys()].sort()
  // A post dated in a future week (a scheduled time) still gets its week.
  const newest = starts.length && starts[starts.length - 1] > current ? starts[starts.length - 1] : current
  const oldest = starts.length && starts[0] < newest ? starts[0] : newest
  const weeks: ReachWeek[] = []
  for (let t = new Date(`${newest}T00:00:00Z`).getTime(); t >= new Date(`${oldest}T00:00:00Z`).getTime(); t -= 7 * DAY) {
    const start = new Date(t).toISOString().slice(0, 10)
    const posts = (byWeek.get(start) ?? []).slice().sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))
    weeks.push(summarizeWeek(start, posts))
  }
  const from = new Date(new Date(`${current}T00:00:00Z`).getTime() - (RECENT_WEEKS - 1) * 7 * DAY).toISOString().slice(0, 10)
  const recentPosts = weeks.filter(w => w.start >= from).flatMap(w => w.posts)
  return {
    weeks,
    recent: {
      from,
      posts: recentPosts.length,
      withSplit: recentPosts.filter(p => splitOf(p)).length,
      split: weightedSplit(recentPosts),
      reached: recentPosts.reduce((a, p) => a + (reachedOf(p) ?? 0), 0),
      withReach: recentPosts.filter(p => reachedOf(p) != null).length,
      shares: {
        job_title: reachShares(recentPosts, 'job_title', 3),
        seniority: reachShares(recentPosts, 'seniority', 3),
        industry: reachShares(recentPosts, 'industry', 3),
      },
    },
    total: rows.length,
    undated,
  }
}

// ---- read -----------------------------------------------------------------

export type ReachRead =
  | { kind: 'ready'; rows: PostAudienceRow[]; readAt: string }
  | { kind: 'denied'; message: string }
  | { kind: 'failed'; message: string }

/* Every lane has tracked posts on record (09-15: ivan 19, risedtc 52, arch 10),
   so an empty array is a read that silently returned nothing, never a lane
   with no posts. Same rule as the audience block. */
export async function fetchPostAudience(lane: ContentLane): Promise<ReachRead> {
  const { data, error } = await supabase.rpc('operator_post_audience', { p_gate: CLIENT_OPS_GATE, p_client_id: lane })
  if (error) {
    const message = error.message || 'Post reach could not be read.'
    return /permission|denied|not authorized|unauthorized|not_authenticated/i.test(message)
      ? { kind: 'denied', message }
      : { kind: 'failed', message }
  }
  if (!Array.isArray(data)) return { kind: 'failed', message: 'Post reach returned no usable list.' }
  if (!data.length) return { kind: 'failed', message: 'The read returned no posts, but this lane has tracked posts on record.' }
  return { kind: 'ready', rows: data as PostAudienceRow[], readAt: new Date().toISOString() }
}
