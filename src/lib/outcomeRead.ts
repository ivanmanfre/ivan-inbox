import { supabase } from './supabase'

// CONTENT OUTCOME READ (db/20261114g). Every 4 weeks the DB pools each account's posts from a 28-day window
// (ending 8 days before the read, so every post has its day-7 numbers) and groups them by where they came
// from. One small RPC per account: content_outcome_latest(p_client) -> the latest read and the one before it.
// Groups are only ever compared inside one account (same buyer score, same outreach filters, same weeks).

export type OutcomeRow = {
  dimension: 'lane' | 'source_kind' | 'ivan_topic'
  grp: string
  label: string
  posts: number
  imp_posts: number
  imp_median: number | null
  buyer_posts: number
  wrote_posts?: number | null
  buyer_sum: number | null
  buyer_per_post: number | null
  buyer_lo: number | null
  buyer_hi: number | null
  wrote_sum: number | null
  wrote_per_post: number | null
  bookings_linked: number | null
  fit_versions: string[] | null
  coverage: Record<string, number> | null
}
export type OutcomeReadView = { read_id: string; window_start: string; window_end: string; as_of?: string; rows: OutcomeRow[] }
export type OutcomeLatest = { read: OutcomeReadView | null; prev: OutcomeReadView | null }

export async function fetchOutcomeLatest(lane: string): Promise<OutcomeLatest> {
  const { data, error } = await supabase.rpc('content_outcome_latest', { p_client: lane })
  if (error) throw new Error(error.message || 'Could not read the results.')
  const d = (data ?? {}) as Partial<OutcomeLatest>
  return { read: d.read ?? null, prev: d.prev ?? null }
}

/** Fewer measured posts than this in a group: show the numbers, say it is too few to judge. */
export const MIN_POSTS = 4

const n1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString('en-US')

/** Pure: one plain line for a group. Buyers = buyer-fit people who engaged by day 7, per post, with the 90% range. */
export function outcomeLine(r: OutcomeRow): string {
  const parts: string[] = []
  if (r.buyer_posts > 0 && r.buyer_per_post != null) {
    const range = r.buyer_lo != null && r.buyer_hi != null ? ` (${n1(r.buyer_lo)} to ${n1(r.buyer_hi)})` : ''
    parts.push(`${n1(r.buyer_per_post)} buyer${n1(r.buyer_per_post) === '1' ? '' : 's'} a post${range}`)
    if (r.buyer_posts < r.posts) parts.push(`buyers counted on ${r.buyer_posts} of ${r.posts}`)
  } else parts.push('buyers not counted')
  if ((r.wrote_posts ?? 0) > 0) parts.push(`${r.wrote_sum ?? 0} wrote to you`)
  if (r.imp_median != null) parts.push(`${Math.round(r.imp_median).toLocaleString('en-US')} views`)
  return parts.join(' · ')
}

/** Pure: too few posts with buyers counted to read anything into this group. */
export const tooFew = (r: OutcomeRow) => r.buyer_posts > 0 && r.buyer_posts < MIN_POSTS

/** Pure: the rows in reading order. The account total first, then the groups by post count. */
export function outcomeGroups(rows: readonly OutcomeRow[]) {
  const total = rows.find(r => r.dimension === 'lane') ?? null
  const bySource = rows.filter(r => r.dimension === 'source_kind').sort((a, b) => b.posts - a.posts || a.label.localeCompare(b.label))
  const byTopic = rows.filter(r => r.dimension === 'ivan_topic').sort((a, b) => b.posts - a.posts || a.label.localeCompare(b.label))
  return { total, bySource, byTopic }
}

/** Same buyer score: both reads used exactly one and the same score version (a mix is never compared). */
const sameFit = (a: OutcomeRow | null, b: OutcomeRow | null) =>
  !!a && !!b && (a.fit_versions ?? []).length === 1 && (b.fit_versions ?? []).length === 1 && a.fit_versions![0] === b.fit_versions![0]

/** Pure: the line comparing this read with the one before, only when both used the same buyer score. */
export function previousLine(cur: OutcomeRow | null, prev: OutcomeRow | null, prevWindow: string | null): string | null {
  if (!cur || !prev || !prevWindow) return null
  if (!sameFit(cur, prev)) return `The read before (${prevWindow}) used a different or mixed buyer score, so it is not compared.`
  if (prev.buyer_per_post == null) return null
  return `The read before (${prevWindow}): ${prev.posts} posts, ${n1(prev.buyer_per_post)} buyers a post.`
}

/** Pure: what is missing, in one line, or null when nothing is. */
export function coverageLine(total: OutcomeRow | null): string | null {
  const c = total?.coverage ?? {}
  const bits: string[] = []
  const miss = (c.engagers_not_collected ?? 0) + (c.engagers_not_shown_by_day7 ?? 0)
  if (miss) bits.push(`engagers missing on ${miss} post${miss === 1 ? '' : 's'}`)
  if (c.no_day7_impressions) bits.push(`no day-7 views on ${c.no_day7_impressions}`)
  if (c.comments_only) bits.push(`only commenters are collected on ${c.comments_only === 1 ? '1 post' : `${c.comments_only} posts`}, likes are not`)
  if (c.all_engagers_unscored) bits.push(`engagers not scored yet on ${c.all_engagers_unscored}`)
  if (c.deleted_left_out) bits.push(`${c.deleted_left_out} deleted post${c.deleted_left_out === 1 ? '' : 's'} left out`)
  return bits.length ? `Gaps: ${bits.join(', ')}.` : null
}
