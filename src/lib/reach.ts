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
export type ReachCategory = 'job_title' | 'seniority' | 'industry' | 'location'
export type ReachDemographics = Partial<Record<ReachCategory | 'company_size', ReachBucket[] | null>>

export type PostAudienceRow = {
  activity_id: string
  post_url: string | null
  published_at: string | null
  title: string | null
  impressions: number | null
  in_pct: number | null
  out_pct: number | null
  members_reached: number | null
  /** From the trackers' latest capture or the backfill; absent on rows read before 069. */
  reactions?: number | null
  comments?: number | null
  /** Tracker rows only (070): profile views from the post, the winner flag, funnel class, Ivan's hook type, a staged reuse idea. */
  profile_views?: number | null
  is_winner?: boolean | null
  winner_detected_at?: string | null
  funnel_class?: string | null
  hook_type?: string | null
  reuse?: { status: string; eligible_at: string | null; title: string | null } | null
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
        location: reachShares(recentPosts, 'location', 3),
      },
    },
    total: rows.length,
    undated,
  }
}

// ---- what the history says --------------------------------------------------

/* Four readings the backfilled history supports (checked on the real rows,
   2026-09-16), each with the smallest post count that keeps it honest. A
   reading below its floor is null and the block leaves the line out.
     · concentration: the one post behind the 4-week total, next to the median
       post (Rise 09-16: one post = 85% of the 4-week reach),
     · floor: how many people the author's own network shows a post to, so the
       rest reads as out of network (Ivan ≈ 21, Rise ≈ 80, ARCH ≈ 306),
     · outcome: out of network follows reach (under 100 people ≈ 34% out, over
       300 ≈ 82% on Ivan's lane), so it is a result, never a lever,
     · comments: what commented posts reached against uncommented ones.
   Medians are unweighted per post; p90 is nearest rank. */

export const INSIGHT_WEEKS = 12
const MIN_TOP = 3
const MIN_GROUP = 5

export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Nearest-rank percentile: the value at or below which `q` of the posts sit. */
export function percentile(xs: number[], q: number): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.max(0, Math.ceil(q * s.length) - 1)]
}

/** People the author's own network showed the post to: reached x in-network share. Null without a split or reach. */
export function inNetworkOf(p: PostAudienceRow): number | null {
  const sp = splitOf(p), r = reachedOf(p)
  return sp && r != null ? Math.round((r * sp.inPct) / 100) : null
}

/** A title short enough for one line: cut on a word boundary with an ellipsis. The trackers store an 80-character stub. */
export function shortTitle(title: string | null | undefined, max = 60): string | null {
  const t = (title ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const at = cut.lastIndexOf(' ')
  return `${(at > max / 2 ? cut.slice(0, at) : cut).replace(/[\s,.:;&-]+$/, '')}…`
}

export type ReachGroup = { label: string; n: number; reached: number; outPct: number; profileViewsPer100: number | null }
export type ReachInsights = {
  concentration: { posts: number; reached: number; top: { title: string | null; reached: number; pct: number }; median: number } | null
  /** `ofFollowers` = median in-network people as a share of the lane's followers, one decimal, when a count is known. */
  floor: { posts: number; median: number; p90: number; ofFollowers: number | null; followers: number | null } | null
  /** Rise funnel classes and Ivan hook types, each group with at least five posts, best median reach first. Null under two groups. */
  byFunnelClass: ReachGroup[] | null
  byHookType: ReachGroup[] | null
  outcome: { small: { n: number; outPct: number }; large: { n: number; outPct: number } } | null
  comments: { withComments: { n: number; median: number }; without: { n: number; median: number } } | null
}

const sinceMonday = (now: number, weeks: number) => {
  const current = weekStartOf(new Date(now).toISOString()) as string
  return new Date(new Date(`${current}T00:00:00Z`).getTime() - (weeks - 1) * 7 * DAY).toISOString().slice(0, 10)
}

const HOOK_LABEL: Record<string, string> = {
  story_opener: 'story opener', data_led: 'data-led', quote_cold_open: 'quote cold open', how_to_declarative: 'how-to',
  specific_receipt: 'specific receipt', contrarian: 'contrarian', pattern_interrupt: 'pattern interrupt',
}

/** Posts grouped by a label, groups under `MIN_GROUP` dropped, best median reach first. `other` and blanks never form a group. */
export function reachGroups(rows: PostAudienceRow[], key: (p: PostAudienceRow) => string | null | undefined, label: (k: string) => string = k => k): ReachGroup[] | null {
  const by = new Map<string, PostAudienceRow[]>()
  for (const p of rows) {
    const k = key(p)
    if (!k || k === 'other' || reachedOf(p) == null) continue
    by.set(k, [...(by.get(k) ?? []), p])
  }
  const groups: ReachGroup[] = []
  for (const [k, ps] of by) {
    if (ps.length < MIN_GROUP) continue
    const reached = ps.reduce((a, p) => a + (reachedOf(p) as number), 0)
    const pv = ps.filter(p => isNum(p.profile_views))
    groups.push({
      label: label(k), n: ps.length,
      reached: median(ps.map(p => reachedOf(p) as number)) as number,
      outPct: Math.round(median(ps.map(p => splitOf(p)?.outPct).filter((v): v is number => v != null)) ?? 0),
      profileViewsPer100: pv.length === ps.length && reached > 0 ? Math.round((100 * pv.reduce((a, p) => a + (p.profile_views as number), 0) / reached) * 10) / 10 : null,
    })
  }
  groups.sort((a, b) => b.reached - a.reached)
  return groups.length >= 2 ? groups : null
}

export type ReachWinners =
  /** The lane runs a winner rule (Rise): its flagged posts, newest first. */
  | { mode: 'flagged'; posts: PostAudienceRow[] }
  /** No rule on this lane: the most commented posts of the last 12 weeks, at least one comment, at most five. */
  | { mode: 'candidates'; posts: PostAudienceRow[]; weeks: number }

export function reachWinners(rows: PostAudienceRow[], now: number = Date.now()): ReachWinners {
  const flagged = rows.filter(p => p.is_winner === true).sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))
  if (flagged.length) return { mode: 'flagged', posts: flagged }
  const from = sinceMonday(now, INSIGHT_WEEKS)
  const posts = rows
    .filter(p => (weekStartOf(p.published_at) ?? '') >= from && isNum(p.comments) && p.comments >= 1)
    .sort((a, b) => (b.comments as number) - (a.comments as number) || (reachedOf(b) ?? 0) - (reachedOf(a) ?? 0))
    .slice(0, 5)
  return { mode: 'candidates', posts, weeks: INSIGHT_WEEKS }
}

export function reachInsights(rows: PostAudienceRow[], now: number = Date.now(), followers: number | null = null): ReachInsights {
  const dated = rows.filter(p => weekStartOf(p.published_at))
  const inWindow = (weeks: number) => { const from = sinceMonday(now, weeks); return dated.filter(p => (weekStartOf(p.published_at) as string) >= from) }

  const recent = inWindow(RECENT_WEEKS).filter(p => reachedOf(p) != null)
  let concentration: ReachInsights['concentration'] = null
  if (recent.length >= MIN_TOP) {
    const reached = recent.reduce((a, p) => a + (reachedOf(p) as number), 0)
    const top = recent.reduce((a, p) => ((reachedOf(p) as number) > (reachedOf(a) as number) ? p : a), recent[0])
    const title = shortTitle(top.title)
    concentration = { posts: recent.length, reached, top: { title, reached: reachedOf(top) as number, pct: Math.round(((reachedOf(top) as number) / reached) * 100) }, median: median(recent.map(p => reachedOf(p) as number)) as number }
  }

  const inNet = inWindow(INSIGHT_WEEKS).map(inNetworkOf).filter((v): v is number => v != null)
  const floorMedian = median(inNet)
  const floor = inNet.length >= MIN_GROUP && floorMedian != null
    ? {
      posts: inNet.length, median: floorMedian, p90: percentile(inNet, 0.9) as number,
      followers: isNum(followers) && followers > 0 ? followers : null,
      ofFollowers: isNum(followers) && followers > 0 ? Math.round((floorMedian / followers) * 1000) / 10 : null,
    }
    : null

  const withSplit = dated.filter(p => splitOf(p) && reachedOf(p) != null)
  const small = withSplit.filter(p => (reachedOf(p) as number) < 100).map(p => (splitOf(p) as { outPct: number }).outPct)
  const large = withSplit.filter(p => (reachedOf(p) as number) >= 300).map(p => (splitOf(p) as { outPct: number }).outPct)
  const outcome = small.length >= MIN_GROUP && large.length >= MIN_GROUP
    ? { small: { n: small.length, outPct: Math.round(median(small) as number) }, large: { n: large.length, outPct: Math.round(median(large) as number) } }
    : null

  const known = dated.filter(p => isNum(p.comments) && reachedOf(p) != null)
  const c1 = known.filter(p => (p.comments as number) >= 1).map(p => reachedOf(p) as number)
  const c0 = known.filter(p => p.comments === 0).map(p => reachedOf(p) as number)
  const comments = c1.length >= MIN_GROUP && c0.length >= MIN_GROUP
    ? { withComments: { n: c1.length, median: median(c1) as number }, without: { n: c0.length, median: median(c0) as number } }
    : null

  return {
    concentration, floor, outcome, comments,
    byFunnelClass: reachGroups(dated, p => p.funnel_class),
    byHookType: reachGroups(dated, p => p.hook_type, k => HOOK_LABEL[k] ?? k.replace(/_/g, ' ')),
  }
}

// ---- read -----------------------------------------------------------------

export type ReachFollowers = { count: number; date: string } | null
export type ReachRead =
  | { kind: 'ready'; rows: PostAudienceRow[]; followers: ReachFollowers; readAt: string }
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
  // 070 returns { posts, followers }; an older reply was the bare list.
  const posts = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { posts?: unknown }).posts) ? (data as { posts: unknown[] }).posts : null
  if (!posts) return { kind: 'failed', message: 'Post reach returned no usable list.' }
  if (!posts.length) return { kind: 'failed', message: 'The read returned no posts, but this lane has tracked posts on record.' }
  const f = !Array.isArray(data) ? (data as { followers?: { count?: unknown; date?: unknown } | null }).followers : null
  const followers: ReachFollowers = f && isNum(f.count) && f.count > 0 && typeof f.date === 'string' ? { count: f.count, date: f.date } : null
  return { kind: 'ready', rows: posts as PostAudienceRow[], followers, readAt: new Date().toISOString() }
}
