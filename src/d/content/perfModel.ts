import type { PostAudienceRow } from '../../lib/reach'

/* ==========================================================================
   POST PERFORMANCE (2026-10-31, Ivan: "on every board we have one but on the
   inbox there isn't a comparison with times"). Pure math over the same rows
   the boards read (operator_post_audience), so the numbers match.

   · A post under SETTLE_DAYS old is still collecting views: it is listed, but
     left out of every median and of the best day / best time read.
   · A post whose last capture came under SETTLE_DAYS after it went out stopped
     being tracked early (two Ivan posts read 13 and 28 forever): listed, left
     out the same way, never compared.
   · Engagement is the typical (median) post's rate, like impressions, so one
     viral post cannot swing the period on its own.
   · "Typical" is the median impressions of the settled posts in the period.
   · Days and times are read in the seat's own clock (laneTime LANE_TZ).
   · A day or time with fewer than MIN_N settled posts is shown but never
     called best.
   ========================================================================== */

export const SETTLE_DAYS = 3
export const MIN_N = 5
const DAY = 86_400_000

export type Period = 30 | 90 | 0 // 0 = all time
export type SortKey = 'impressions' | 'engagement' | 'comments' | 'newest'

export type PerfPost = {
  id: string
  url: string | null
  title: string
  at: string
  weekday: number // 0 Mon … 6 Sun, seat clock
  hour: number // 0-23, seat clock
  hm: string // HH:MM, seat clock
  impressions: number | null
  reactions: number | null
  comments: number | null
  shares: number | null
  engagement: number | null // reactions + comments + reposts
  rate: number | null // engagement / impressions
  vsTypical: number | null // impressions / typical
  settled: boolean
  stalled: boolean // tracking stopped before the post settled
}

export type Totals = { posts: number; impressions: number; settledImpressions: number; reactions: number; comments: number; median: number | null; rate: number | null }
export type Bucket = { key: string; label: string; n: number; median: number | null; best: boolean }
export type PerfRead = {
  posts: PerfPost[]
  now: Totals
  before: Totals | null
  typical: number | null
  fresh: number
  stalled: number
  days: Bucket[]
  times: Bucket[]
  /** One exact minute that holds most settled posts (a scheduled slot), so the time read also compares kinds of post. */
  slot: { hm: string; n: number; of: number } | null
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function clock(iso: string, tz: string): { weekday: number; hour: number; hm: string } {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(Date.parse(iso))
  const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.find(x => x.type === 'weekday')?.value ?? '')
  const hour = Number(p.find(x => x.type === 'hour')?.value ?? 0) % 24
  return { weekday: wd < 0 ? 0 : wd, hour, hm: `${String(hour).padStart(2, '0')}:${p.find(x => x.type === 'minute')?.value ?? '00'}` }
}

/** The tracker keeps the first 80 characters, so a title that long was cut. */
const CLIP = 80
function firstLine(t: string | null): string {
  const lines = (t ?? '').split('\n').map(s => s.trim()).filter(Boolean)
  if (!lines.length) return 'Published post'
  return lines.length === 1 && (t ?? '').length >= CLIP ? `${lines[0].replace(/[\s.,;:–-]+$/, '')}…` : lines[0]
}

function maturity(r: PostAudienceRow, now: number): { settled: boolean; stalled: boolean } {
  const at = Date.parse(r.published_at!)
  if (now - at < SETTLE_DAYS * DAY) return { settled: false, stalled: false }
  const cap = r.captured_at ? Date.parse(r.captured_at) : NaN
  const stalled = Number.isFinite(cap) && cap - at < SETTLE_DAYS * DAY
  return { settled: !stalled, stalled }
}

export function toPost(r: PostAudienceRow, tz: string, now: number): PerfPost | null {
  if (!r.published_at || !Number.isFinite(Date.parse(r.published_at))) return null
  const { weekday, hour, hm } = clock(r.published_at, tz)
  const parts = [r.reactions, r.comments, r.shares]
  const engagement = parts.some(isNum) ? parts.reduce<number>((s, v) => s + (isNum(v) ? v : 0), 0) : null
  const impressions = isNum(r.impressions) ? r.impressions : null
  return {
    id: r.activity_id, url: r.post_url, title: firstLine(r.title), at: r.published_at, weekday, hour, hm,
    impressions, reactions: isNum(r.reactions) ? r.reactions : null, comments: isNum(r.comments) ? r.comments : null, shares: isNum(r.shares) ? r.shares : null,
    engagement, rate: engagement != null && impressions ? engagement / impressions : null, vsTypical: null,
    ...maturity(r, now),
  }
}

function totals(ps: PerfPost[]): Totals {
  const sum = (k: 'impressions' | 'reactions' | 'comments') => ps.reduce((s, p) => s + (p[k] ?? 0), 0)
  return {
    posts: ps.length, impressions: sum('impressions'), settledImpressions: ps.reduce((s, p) => s + (p.settled ? p.impressions ?? 0 : 0), 0), reactions: sum('reactions'), comments: sum('comments'),
    median: median(ps.filter(p => p.settled && p.impressions != null).map(p => p.impressions!)),
    rate: median(ps.filter(p => p.settled && p.rate != null).map(p => p.rate!)),
  }
}

const DAY_LABEL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
/** Three-hour bands in the seat's clock; the night band wraps midnight. */
export const BANDS: readonly { key: string; from: number; to: number }[] = [
  { key: '05-08', from: 5, to: 8 }, { key: '08-11', from: 8, to: 11 }, { key: '11-14', from: 11, to: 14 },
  { key: '14-17', from: 14, to: 17 }, { key: '17-20', from: 17, to: 20 }, { key: '20-05', from: 20, to: 29 },
]
const bandOf = (h: number) => BANDS.find(b => (h >= b.from && h < b.to) || (h + 24 >= b.from && h + 24 < b.to))!.key
const bandLabel = (k: string) => k.split('-').map(h => `${h}:00`).join('–')

function buckets(ps: PerfPost[], keyOf: (p: PerfPost) => string, order: string[], label: (k: string) => string, keepEmpty: boolean): Bucket[] {
  const settled = ps.filter(p => p.settled && p.impressions != null)
  const out = order.map(key => {
    const xs = settled.filter(p => keyOf(p) === key).map(p => p.impressions!)
    return { key, label: label(key), n: xs.length, median: median(xs), best: false }
  }).filter(b => keepEmpty || b.n > 0)
  const top = out.filter(b => b.n >= MIN_N && b.median != null).sort((a, b) => b.median! - a.median!)[0]
  if (top) top.best = true
  return out
}

function slotOf(ps: PerfPost[]): PerfRead['slot'] {
  const settled = ps.filter(p => p.settled && p.impressions != null)
  const n = new Map<string, number>()
  for (const p of settled) n.set(p.hm, (n.get(p.hm) ?? 0) + 1)
  const top = [...n].sort((a, b) => b[1] - a[1])[0]
  return top && settled.length >= MIN_N * 2 && top[1] * 2 > settled.length ? { hm: top[0], n: top[1], of: settled.length } : null
}

export function perfRead(rows: PostAudienceRow[], tz: string, period: Period, now: number): PerfRead {
  const all = rows.map(r => toPost(r, tz, now)).filter((p): p is PerfPost => !!p)
  const span = period * DAY
  const inNow = period ? all.filter(p => Date.parse(p.at) > now - span && Date.parse(p.at) <= now) : all
  const inBefore = period ? all.filter(p => Date.parse(p.at) > now - 2 * span && Date.parse(p.at) <= now - span) : null
  const nowT = totals(inNow)
  const typical = nowT.median
  const posts = inNow.map(p => ({ ...p, vsTypical: typical && p.impressions != null ? p.impressions / typical : null }))
  return {
    posts, now: nowT, before: inBefore && inBefore.length ? totals(inBefore) : null, typical,
    fresh: posts.filter(p => !p.settled && !p.stalled).length,
    stalled: posts.filter(p => p.stalled).length,
    days: buckets(posts, p => DAY_LABEL[p.weekday], DAY_LABEL, k => k, true),
    times: buckets(posts, p => bandOf(p.hour), BANDS.map(b => b.key), bandLabel, false),
    slot: slotOf(posts),
  }
}

export function sortPosts(ps: PerfPost[], key: SortKey): PerfPost[] {
  const v = (p: PerfPost) => key === 'impressions' ? p.impressions : key === 'engagement' ? p.rate : key === 'comments' ? p.comments : Date.parse(p.at)
  return [...ps].sort((a, b) => (v(b) ?? -1) - (v(a) ?? -1) || Date.parse(b.at) - Date.parse(a.at))
}

/** Change against the period before, as a whole percent; null when there is nothing to compare. */
export function change(now: number | null, before: number | null | undefined): number | null {
  if (now == null || before == null || before === 0) return null
  return Math.round(((now - before) / before) * 100)
}
