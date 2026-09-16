/* ==========================================================================
   AGAINST THE ROSTER: the lane's posts next to the accounts on its watch roster.

   Ivan 2026-09-16, on competitors per client: comments and reposts per post
   for the lane against its direct competitors over the same weeks, and the
   analysed angles nobody has taken. What exists for a competitor is what
   LinkedIn shows the public: likes, comments, reposts, the text. Reach, the
   in/out split and demographics exist only for the author, so this file
   never claims them for anyone else.

   Own side = the same rows the reach block reads (client_post_metrics via
   operator_post_audience: comments and, since 071, shares). Roster side =
   operator_roster_posts. Both medians are unweighted, posts inside the same
   ISO-week window, and every account carries its post count. Under
   ROSTER_FLOOR posts an account is named but not measured.
   ========================================================================== */
import { supabase } from './supabase'
import { CLIENT_OPS_GATE, type ContentLane } from './content'
import { INSIGHT_WEEKS, median, sinceMonday, shortTitle, type PostAudienceRow } from './reach'

export type RosterPost = {
  who: string
  role: string
  at: string | null
  comments: number | null
  reposts: number | null
  url: string | null
  /** First 220 characters; only on each author's three most commented posts and on posts with an angle. */
  text: string | null
  angle: string | null
  topic: string | null
  actioned: boolean | null
}

export type RosterRead =
  | { kind: 'ready'; roster: Array<{ account: string; role: string }>; posts: RosterPost[]; readAt: string }
  | { kind: 'denied'; message: string }
  | { kind: 'failed'; message: string }

/** Accounts with fewer posts than this in the window are listed, not measured. */
export const ROSTER_FLOOR = 5
export const ROSTER_ROLE_LABEL: Record<string, string> = {
  direct_competitor: 'competitor', buyer_voice: 'buyer voice', format_reference: 'format reference', warm_anchor: 'warm anchor',
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const round1 = (v: number) => Math.round(v * 10) / 10

export type RosterAccount = {
  who: string
  role: string
  posts: number
  perWeek: number
  /** Medians over the window; null under the floor. */
  comments: number | null
  reposts: number | null
}

export type RosterCompare = {
  weeks: number
  from: string
  you: RosterAccount
  /** Direct competitors at or above the floor, most commented first. */
  competitors: RosterAccount[]
  /** Direct competitors seen in the window but under the floor. */
  underFloor: Array<{ who: string; posts: number }>
  /** Direct competitors on the roster with no post in the window at all. */
  silent: string[]
  /** How many roster posts of the other roles fell in the window, per role. */
  otherRoles: Record<string, number>
}

function inWindow(at: string | null | undefined, from: string, now: number): boolean {
  if (!at) return false
  const t = Date.parse(at)
  return Number.isFinite(t) && at.slice(0, 10) >= from && t <= now
}

export function rosterCompare(
  own: PostAudienceRow[], posts: RosterPost[], roster: Array<{ account: string; role: string }>,
  youLabel: string, now: number = Date.now(), weeks: number = INSIGHT_WEEKS,
): RosterCompare {
  const from = sinceMonday(now, weeks)
  const mine = own.filter(p => inWindow(p.published_at, from, now))
  const myComments = mine.map(p => p.comments).filter(isNum)
  const myShares = mine.map(p => p.shares).filter(isNum)
  const you: RosterAccount = {
    who: youLabel, role: 'you', posts: mine.length, perWeek: round1(mine.length / weeks),
    comments: myComments.length >= ROSTER_FLOOR ? median(myComments) : null,
    reposts: myShares.length >= ROSTER_FLOOR ? median(myShares) : null,
  }
  const theirs = posts.filter(p => inWindow(p.at, from, now))
  const byWho = new Map<string, RosterPost[]>()
  const otherRoles: Record<string, number> = {}
  for (const p of theirs) {
    if (p.role !== 'direct_competitor') { otherRoles[p.role] = (otherRoles[p.role] ?? 0) + 1; continue }
    const list = byWho.get(p.who) ?? []
    list.push(p)
    byWho.set(p.who, list)
  }
  const competitors: RosterAccount[] = []
  const underFloor: Array<{ who: string; posts: number }> = []
  for (const [who, list] of byWho) {
    if (list.length < ROSTER_FLOOR) { underFloor.push({ who, posts: list.length }); continue }
    const c = list.map(p => p.comments).filter(isNum)
    const r = list.map(p => p.reposts).filter(isNum)
    competitors.push({
      who, role: 'direct_competitor', posts: list.length, perWeek: round1(list.length / weeks),
      comments: c.length >= ROSTER_FLOOR ? median(c) : null,
      reposts: r.length >= ROSTER_FLOOR ? median(r) : null,
    })
  }
  competitors.sort((a, b) => (b.comments ?? -1) - (a.comments ?? -1) || b.posts - a.posts || a.who.localeCompare(b.who))
  underFloor.sort((a, b) => b.posts - a.posts || a.who.localeCompare(b.who))
  const seen = new Set(byWho.keys())
  const silent = roster
    .filter(r => r.role === 'direct_competitor' && !seen.has(r.account.split(' (')[0].trim()))
    .map(r => r.account.split(' (')[0].trim())
  return { weeks, from, you, competitors, underFloor, silent, otherRoles }
}

export type RosterTopPost = RosterPost & {
  /** The author's median comments in the window and this post against it; null under the floor. */
  authorMedian: number | null
  lift: number | null
}

/** The roster's most commented posts in the window (competitors and buyer voices), most commented first. */
export function rosterTop(posts: RosterPost[], now: number = Date.now(), weeks: number = INSIGHT_WEEKS, max = 6): RosterTopPost[] {
  const from = sinceMonday(now, weeks)
  const pool = posts.filter(p => inWindow(p.at, from, now) && isNum(p.comments) && p.comments > 0 && (p.role === 'direct_competitor' || p.role === 'buyer_voice'))
  const byWho = new Map<string, number[]>()
  for (const p of pool) byWho.set(p.who, [...(byWho.get(p.who) ?? []), p.comments as number])
  return [...pool]
    .sort((a, b) => (b.comments as number) - (a.comments as number) || (b.at ?? '').localeCompare(a.at ?? ''))
    .slice(0, max)
    .map(p => {
      const cs = byWho.get(p.who) ?? []
      const authorMedian = cs.length >= ROSTER_FLOOR ? median(cs) : null
      const lift = authorMedian && authorMedian > 0 ? round1((p.comments as number) / authorMedian) : null
      return { ...p, authorMedian, lift }
    })
}

export type RosterAngle = { who: string; at: string | null; comments: number; url: string | null; topic: string | null; angle: string }

/** Analysed angles on roster posts in the window that nobody has marked as taken, most commented first.
    Only Ivan's competitor table carries angles today; other lanes get an empty list, and the block says so. */
export function rosterAngles(posts: RosterPost[], now: number = Date.now(), weeks: number = INSIGHT_WEEKS, max = 6): RosterAngle[] {
  const from = sinceMonday(now, weeks)
  return posts
    .filter(p => inWindow(p.at, from, now) && p.angle && p.angle.trim() && p.actioned !== true && isNum(p.comments))
    .sort((a, b) => (b.comments as number) - (a.comments as number) || (b.at ?? '').localeCompare(a.at ?? ''))
    .slice(0, max)
    .map(p => ({ who: p.who, at: p.at, comments: p.comments as number, url: p.url, topic: shortTitle(p.topic, 60), angle: shortTitle(p.angle, 180) as string }))
}

/** "3.2× their median" / "their normal post" / null under the floor. */
export function liftLine(p: { lift: number | null; authorMedian: number | null }): string | null {
  if (p.lift === null || p.authorMedian === null) return null
  if (p.lift >= 1.15) return `${p.lift.toFixed(1)}× their median of ${p.authorMedian}`
  if (p.lift <= 0.85) return `under their median of ${p.authorMedian}`
  return `their normal post (median ${p.authorMedian})`
}

export async function fetchRosterPosts(lane: ContentLane): Promise<RosterRead> {
  const { data, error } = await supabase.rpc('operator_roster_posts', { p_gate: CLIENT_OPS_GATE, p_client_id: lane })
  if (error) {
    const message = error.message || 'The roster could not be read.'
    return /permission|denied|not authorized|unauthorized|not_authenticated/i.test(message)
      ? { kind: 'denied', message }
      : { kind: 'failed', message }
  }
  const d = data as { roster?: unknown; posts?: unknown } | null
  if (!d || !Array.isArray(d.posts) || !Array.isArray(d.roster)) return { kind: 'failed', message: 'The roster read returned no usable lists.' }
  return { kind: 'ready', roster: d.roster as Array<{ account: string; role: string }>, posts: d.posts as RosterPost[], readAt: new Date().toISOString() }
}
