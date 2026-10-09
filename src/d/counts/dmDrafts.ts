import { supabase } from '../../lib/supabase'
import {
  dedupeMessages, fetchManualReplyIds, groupThreads, isConversation, threadBucket,
  type InboxMessage, type Thread,
} from '../../lib/inbox'
import { seatFilter, seatOf, type Seat } from '../seats'
import { currentUserId } from '../../lib/swr'
import { fetchSolvedAt, owedIds, withSolved } from './solved'

// ---------------------------------------------------------------------------
// DMs, per seat: "Drafts for you" and "Needs you".
//
// WHY A NEW READ. Today's DMs list builds its answer from the WHOLE message
// view (up to 20k rows, `fetchMessages`), groups it into threads and buckets
// each thread (`groupThreads` + `threadBucket`, lib/inbox.ts). The frame shows
// this number on every place, so it cannot pay for that read, and the first
// shortcut tried (every unsent outbound row) said 226 for Ivan, because it
// counted discarded drafts, drafts on threads he already answered, and every
// draft older than the 14-day clock.
//
// WHAT THIS DOES. The live path reads the parity-proven first-rows RPC, which
// contains complete histories for every candidate across all seats. If that
// additive RPC is absent, the original path finds prospects that COULD be
// owed today and reads their complete threads. Both run TODAY'S rule, so the
// rule itself is not re-written here and cannot drift from the list:
//   1. candidates, per seat (client_id scoped), three small reads:
//      · an unsent, unapproved outbound row created in the last 15 days
//        (the 'approve' bucket only counts drafts inside 14 days),
//      · an inbound row in the last 15 days (needsAnswer only counts an owed
//        reply inside 14 days, whatever the draft's age),
//      · an owner question or automatic-retry hold of any age (an owner
//        question keeps the thread under Needs you until it is answered);
//   2. every message of those prospects (all rows, not a window), deduped the
//      way the list dedupes them;
//   3. `groupThreads` -> the list's own filters: a conversation, not filed as
//      spam, the thread's seat is this seat, bucket is not 'waiting'.
// "Needs you" = those threads (the DMs list's "Needs your reply" block).
// "Drafts for you" = the ones that also carry a live, unsnoozed draft.
// A day of slack on the 15-day windows keeps a thread that crosses the 14-day
// line between two reads from being missed; the rule itself decides.
// ---------------------------------------------------------------------------

export type DmSeatCount = { drafts: number; needs: number }

const DAY = 86_400_000
const WINDOW_DAYS = 15
const PAGE = 1000
const ID_CHUNK = 60

// The parity-proven first-rows RPC contains complete histories for every
// Needs-you candidate across seats. Share only concurrent reads; each later
// refresh asks again, and a different signed-in user never joins this flight.
const firstRowsInFlight = new Map<string, Promise<InboxMessage[] | null>>()

async function firstRows(): Promise<InboxMessage[] | null> {
  const user = currentUserId()
  if (user) {
    const running = firstRowsInFlight.get(user)
    if (running) return running
  }
  const read = Promise.resolve(supabase.rpc('inbox_phone_first_rows_r2', {}, { get: true })).then(({ data, error }) => {
    if (error?.code === 'PGRST202') return null
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('Could not read DM count threads')
    return data as InboxMessage[]
  })
  if (user) {
    firstRowsInFlight.set(user, read)
    void read.then(
      () => { if (firstRowsInFlight.get(user) === read) firstRowsInFlight.delete(user) },
      () => { if (firstRowsInFlight.get(user) === read) firstRowsInFlight.delete(user) },
    )
  }
  return read
}

/** Pure: the per-seat numbers from a set of complete threads. */
export function countDmSeat(threads: Thread[], seat: Seat, now: number = Date.now()): DmSeatCount {
  let drafts = 0
  let needs = 0
  for (const t of threads) {
    if (seatOf(t.client_id) !== seat) continue
    if (!isConversation(t) || t.spam) continue
    if (threadBucket(t, now) === 'waiting') continue
    needs += 1
    if (t.draft !== null && t.draftSnoozedUntil === null) drafts += 1
  }
  return { drafts, needs }
}

/** Pure: the whole path after the reads, so a test can feed rows straight in. */
export function countDmSeatFromRows(rows: InboxMessage[], seat: Seat, now: number = Date.now(), manualReplyIds: Set<string> = new Set()): DmSeatCount {
  return countDmSeat(groupThreads(dedupeMessages(rows), manualReplyIds, now), seat, now)
}

// A read the database clamps at 1000 rows is paged until a short page, never
// trusted as complete.
async function paged<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < 50_000; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

type Pid = { prospect_id: string }

async function candidateIds(seat: Seat, now: number): Promise<string[]> {
  const since = new Date(now - WINDOW_DAYS * DAY).toISOString()
  const view = () => supabase.from('inbox_messages_v')
  const [drafts, inbound, holds] = await Promise.all([
    paged<Pid>((a, b) => view().select('prospect_id').or(seatFilter(seat))
      .eq('direction', 'outbound').is('sent_at', null).is('approved_at', null)
      .gte('created_at', since)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(a, b)),
    // created_at is when the row was captured, never before the message was
    // sent, so created_at >= since also catches every sent_at >= since.
    paged<Pid>((a, b) => view().select('prospect_id').or(seatFilter(seat))
      .eq('direction', 'inbound')
      .gte('created_at', since)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(a, b)),
    paged<Pid>((a, b) => view().select('prospect_id').or(seatFilter(seat))
      .eq('direction', 'outbound').is('sent_at', null).is('approved_at', null)
      .in('send_blocked_reason', ['owner_confirmation', 'reply_retry_pending'])
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(a, b)),
  ])
  return [...new Set([...drafts, ...inbound, ...holds].map(r => r.prospect_id).filter(Boolean))]
}

async function threadRows(ids: string[]): Promise<InboxMessage[]> {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) chunks.push(ids.slice(i, i + ID_CHUNK))
  const parts = await Promise.all(chunks.map(chunk => paged<InboxMessage>((a, b) => supabase
    .from('inbox_messages_v').select('*')
    .in('prospect_id', chunk)
    .order('created_at', { ascending: true }).order('id', { ascending: true })
    .range(a, b))))
  return parts.flat()
}

/** One seat's DM numbers, read live. Throws on a failed read; never guesses. */
export async function fetchDmSeatCount(seat: Seat, now?: number): Promise<DmSeatCount> {
  const at = now ?? Date.now()
  // Explicit historical-time reads keep the original date-window path. The
  // quick RPC is a live snapshot and must not classify a past instant.
  const quick = now === undefined ? await firstRows() : null
  const ids = quick === null ? await candidateIds(seat, at) : []
  if ((quick === null && ids.length === 0) || (quick !== null && quick.length === 0)) return { drafts: 0, needs: 0 }
  const [rows, manualReplyIds] = await Promise.all([quick ?? threadRows(ids), fetchManualReplyIds()])
  // "Mark as solved" (outreach_prospects.solved_at) is not in the view: one small read for the
  // owed threads only, then TODAY'S rule (unansweredSince honours solvedAt). A failed read throws
  // like any other: the count says it could not be read, never a guess.
  const threads = groupThreads(dedupeMessages(rows), manualReplyIds, at)
  const solved = await fetchSolvedAt(owedIds(threads.filter(t => seatOf(t.client_id) === seat)))
  return countDmSeat(withSolved(threads, solved), seat, at)
}
