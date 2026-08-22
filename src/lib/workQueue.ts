import { supabase } from './supabase'
import { unansweredWaitSince, type Thread } from './inbox'
import { isCommentKind, pendingOps, type OpsDraft, type OpsKind } from './ops'
import { rowClient } from './today'

// Today, item 4 (workbench-polish-2026-08-22). 552 rows sit waiting on a human
// decision across four tables; 449 of them cannot appear on Today at all,
// because the edge function behind the rest of this screen carries no content
// drafts, no ideas and no ops rows. This file is the read-only cross-lane
// ranking that closes that gap, built from data the app already fetches
// (threads, ops drafts) plus two new minimal reads for the two piles that
// have no other fetcher (content review/error, staged client ideas), both
// well under PostgREST's 1000-row clamp (95 + 55 + 176 rows measured), so no
// paging is needed.
//
// RANKING RULE: severity tier first, oldest-first within a tier. A person
// waiting is always ranked above a draft waiting, and inside "a person is
// waiting" a reply nobody has even OPENED outranks one that has at least been
// read once. 36 of the 58 unanswered threads were never opened in this app
// at all, which is a sharper failure than an opened-but-unanswered thread: an
// opened one was at least SEEN. Full ranking, tiers 0-5:
//   0  a real reply, never opened in this app
//   1  a real reply, opened but still unanswered
//   2  a time-sensitive ops draft (escalation, newsjack), dead on arrival past
//      a few days by the nature of the thing
//   3  any other rotting ops draft (comment, weekly report, booking)
//   4  the content review/error pile, one card per lane
//   5  the staged client-idea pile, one card per lane
// Ties within a tier break oldest-first: the item that has waited longest
// inside its own severity band is the one that has waited longest, full stop.

export type QueueTier = 0 | 1 | 2 | 3 | 4 | 5
export type QueueKind = 'reply' | 'ops' | 'contentReview' | 'contentError' | 'ideas'

export type QueueItem = {
  id: string
  tier: QueueTier
  kind: QueueKind
  title: string
  sub: string | null
  lane: string // 'ivan' | 'risedtc' | 'arch'
  waitingSince: string
  ageDays: number
  n?: number // set on the aggregate pile cards (tiers 4-5): how many rows this one card stands for
  // What the row's click hands to the navigation callback: a prospect_id for a
  // reply (opens that exact thread), or null when the item opens a whole
  // surface instead (Ops, or Content pre-filtered to `lane`).
  openId: string | null
}

export function ageDaysOf(iso: string, now: number): number {
  return Math.max(0, (now - Date.parse(iso)) / 86_400_000)
}

// A thread nobody has opened in this app at all: every inbound message on it
// still carries read_at IS NULL. markThreadRead only fires on open
// (ThreadScreen.tsx:109), so this is exactly the instrument the evidence used.
export function neverOpened(t: Thread): boolean {
  const inbound = t.messages.filter(m => m.direction === 'inbound')
  return inbound.length > 0 && inbound.every(m => m.read_at === null)
}

export function buildReplyItems(threads: Thread[], now: number): QueueItem[] {
  const out: QueueItem[] = []
  for (const t of threads) {
    // unansweredWaitSince, not needsAnswer: needsAnswer cuts off at 14 days so
    // the badge does not ring forever, and the whole point of this queue is
    // the threads that cutoff hides: 27 of the 58 unanswered threads have
    // waited over 30 days.
    const since = unansweredWaitSince(t)
    if (since === null) continue
    out.push({
      id: `reply:${t.prospect_id}`,
      tier: neverOpened(t) ? 0 : 1,
      kind: 'reply',
      title: t.prospect_name,
      sub: t.last.message_text,
      lane: t.client_id,
      waitingSince: since,
      ageDays: ageDaysOf(since, now),
      openId: t.prospect_id,
    })
  }
  return out
}

const TIME_SENSITIVE_OPS = new Set<OpsKind>(['escalation', 'newsjack'])

const OPS_KIND_LABEL: Record<string, string> = {
  escalation: 'Escalation', newsjack: 'Newsjack', comment_outbound: 'Comment',
  comment_reply: 'Comment reply', weekly_report: 'Weekly report', booking: 'Booking',
  update: 'Update', precall_email: 'Pre-call email', manual_invite: 'Manual invite',
}

export function buildOpsItems(drafts: OpsDraft[], now: number): QueueItem[] {
  const out: QueueItem[] = []
  for (const d of pendingOps(drafts, now)) {
    const label = OPS_KIND_LABEL[d.kind] ?? d.kind
    out.push({
      id: `ops:${d.id}`,
      tier: TIME_SENSITIVE_OPS.has(d.kind) ? 2 : 3,
      kind: 'ops',
      title: label,
      sub: isCommentKind(d.kind)
        ? (d.context?.author_name ? `${d.context.author_name}: ${d.body}` : d.body)
        : d.body,
      lane: d.client_id,
      waitingSince: d.created_at,
      ageDays: ageDaysOf(d.created_at, now),
      // Ops has no per-row focus mechanism from outside the job (OpsBoard is
      // owned by another item in this run), so the item opens the Ops job at
      // the job level rather than a specific row, still the exact surface the
      // approve/discard control lives on, just not pre-scrolled to this row.
      openId: null,
    })
  }
  return out
}

// ---------- the two piles Today has never carried: content and ideas ----------

type PileRow = { client_id: string | null; created_at: string; title: string | null }
type LanePile = { lane: string; n: number; oldestCreatedAt: string; oldestTitle: string | null }

async function pileByLane(table: string, status: string): Promise<LanePile[]> {
  // Read-only. All three call sites below (review, error, staged ideas) are
  // measured well under the 1000-row PostgREST clamp (max 176 rows), so a
  // single unpaged select is honest here, no Range headers needed.
  const { data, error } = await supabase
    .from(table)
    .select('client_id, created_at, title')
    .eq('status', status)
    .order('created_at', { ascending: true })
  if (error) throw error
  const byLane = new Map<string, LanePile>()
  for (const r of (data ?? []) as PileRow[]) {
    const lane = rowClient(r)
    const existing = byLane.get(lane)
    if (existing) existing.n += 1
    else byLane.set(lane, { lane, n: 1, oldestCreatedAt: r.created_at, oldestTitle: r.title })
  }
  return [...byLane.values()]
}

export async function fetchContentReviewPile(): Promise<LanePile[]> {
  return pileByLane('carousel_drafts', 'review')
}

export async function fetchContentErrorPile(): Promise<LanePile[]> {
  return pileByLane('carousel_drafts', 'error')
}

export async function fetchStagedIdeaPile(): Promise<LanePile[]> {
  return pileByLane('client_ideas', 'staged')
}

const LANE_NAME: Record<string, string> = { ivan: 'Your', risedtc: "Mattan's", arch: "Davorin's" }

export function pileItems(piles: LanePile[], kind: 'contentReview' | 'contentError' | 'ideas', now: number): QueueItem[] {
  const noun = kind === 'contentReview' ? 'drafts in review'
    : kind === 'contentError' ? 'errored drafts'
      : 'ideas staged'
  const tier: QueueTier = kind === 'ideas' ? 5 : 4
  return piles.map(p => ({
    id: `${kind}:${p.lane}`,
    tier,
    kind,
    title: `${LANE_NAME[p.lane] ?? p.lane} lane: ${p.n} ${noun}`,
    sub: p.oldestTitle,
    lane: p.lane,
    waitingSince: p.oldestCreatedAt,
    ageDays: ageDaysOf(p.oldestCreatedAt, now),
    n: p.n,
    // Pre-filtered to the lane, not the individual row: Content itself is
    // owned by other items in this run (the calendar rail, the error reasons,
    // the client-lane promote capability), so this hands off at the lane
    // boundary, the one filter Today can set without touching those files,
    // and Content's own tabs take it from there.
    openId: p.lane,
  }))
}

// One list, ranked. Tier first (a person always outranks a draft, and a
// silent reply always outranks one that was at least opened), oldest-first
// inside a tier.
export function rankQueue(items: QueueItem[]): QueueItem[] {
  return [...items].sort((a, b) => a.tier - b.tier || b.ageDays - a.ageDays)
}
