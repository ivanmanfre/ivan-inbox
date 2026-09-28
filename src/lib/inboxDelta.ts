import { supabase } from './supabase'
import { dedupeMessages, type InboxMessage } from './inbox'

/* INCREMENTAL INBOX READS (2026-09-28, CB-24 Track L).

   The whole-view read (fetchMessages: ~9.3k rows, 12 page requests, ~18 s of
   database time) used to run on EVERY realtime event on outreach_messages and
   on EVERY window focus: about 0.75 times a minute, the single largest load on
   the database (pg_stat_statements, 2026-09-28). Now it runs on mount, on an
   explicit refresh (pull, Retry, after an action) and once it is
   FULL_EVERY_MS old while the page is visible. Everything else is a PROSPECT-SCOPED
   re-read: the conversations that changed are read again whole and swapped in.

   Swapping in whole conversations (never single rows) is what keeps the result
   identical to a full read: dedupeMessages keys on prospect_id, so a
   conversation's rows dedupe the same whether they arrive alone or with the
   rest, and a deleted row simply is not in the re-read.

   Which conversations changed comes from two places:
   - the realtime payload (INSERT/UPDATE carry prospect_id; a DELETE carries
     only the id, mapped through the rows we hold);
   - `inbox_changed_since(p_since)` (db, SECURITY DEFINER, returns only
     prospect ids + the server clock): messages created since, every
     update/delete since (the outreach_message_revisions trigger fires on every
     one of them), and prospects stamped updated_at since. It covers events
     realtime dropped while the phone slept. */

// 30 min. The budget for an idle open app is one view request a minute: a whole read is 12 page
// requests (0.4/min at 30 min); background conversation re-reads keep MIN_GAP_MS = 2 min apart
// (<= 0.5/min, every change owed meanwhile rides the same run); the 10-min sweep folds into that
// gap; new inbound messages skip the gap (~25 a day). Replayed over 24 h of real changes
// (H2-deploy, 2026-09-29): 0.66/min average, 0.95 worst hour. Anything a conversation re-read
// cannot see (a prospect or campaign field changed with no message write and no updated_at
// stamp) waits at most this long.
export const FULL_EVERY_MS = 30 * 60_000
/** Re-read overlap: a change committed late inside a long transaction is stamped at its start. */
export const WATERMARK_OVERLAP_MS = 120_000
const ID_CHUNK = 100

/** The full read's order: created_at, then id (both ascending, as PostgREST returns them). */
export function byCreatedThenId(a: InboxMessage, b: InboxMessage): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Swap the changed conversations into the rows we hold. `fresh` is the re-read
 * of exactly the prospects in `changed`; every held row of those prospects is
 * dropped first, so an update replaces, a delete (or discard that removed a
 * row) disappears, and an insert appears. The result is in full-read order and
 * deduped the way the full read is.
 */
export function mergeConversations(held: readonly InboxMessage[], changed: ReadonlySet<string>, fresh: readonly InboxMessage[]): InboxMessage[] {
  if (changed.size === 0) return held.slice()
  const out = held.filter(m => !changed.has(m.prospect_id))
  for (const m of fresh) if (changed.has(m.prospect_id)) out.push(m)
  out.sort(byCreatedThenId)
  return dedupeMessages(out)
}

type Payload = { eventType?: string; new?: Record<string, unknown> | null; old?: Record<string, unknown> | null }

/**
 * The conversation a realtime event touched. INSERT/UPDATE: new.prospect_id.
 * DELETE: old carries only the id (replica identity default), so the held rows
 * name the prospect. Null = cannot tell (an unknown deleted row, an oversized
 * payload): the caller falls back to the changed-since read.
 */
export function prospectOfEvent(p: Payload, idToProspect: ReadonlyMap<string, string>): string | null {
  const n = p.new && typeof p.new.prospect_id === 'string' ? p.new.prospect_id : null
  if (n) return n
  const o = p.old && typeof p.old.prospect_id === 'string' ? p.old.prospect_id : null
  if (o) return o
  const id = p.old && typeof p.old.id === 'string' ? p.old.id : null
  return id ? idToProspect.get(id) ?? null : null
}

/** Every row of these conversations, in full-read order. Chunked (PostgREST `in()` dies around 16 KB). */
export async function fetchConversations(prospectIds: readonly string[]): Promise<InboxMessage[]> {
  const chunks: string[][] = []
  for (let i = 0; i < prospectIds.length; i += ID_CHUNK) chunks.push(prospectIds.slice(i, i + ID_CHUNK))
  const parts = await Promise.all(chunks.map(async chunk => {
    const rows: InboxMessage[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('inbox_messages_v').select('*')
        .in('prospect_id', chunk)
        .order('created_at', { ascending: true }).order('id', { ascending: true })
        .range(from, from + 999)
      if (error) throw error
      rows.push(...(data as InboxMessage[]))
      if (!data || data.length < 1000) break
    }
    return rows
  }))
  return parts.flat()
}

/**
 * The server clock, and which conversations changed after `since` (server
 * time). `since` null returns just the clock: taken right before a full read,
 * it is the watermark that read is good from. `ids` null = the watermark is
 * too old to answer from (over 6 h): the caller reads the whole view instead.
 */
export async function changedSince(since: string | null): Promise<{ now: string; ids: string[] | null }> {
  const { data, error } = await supabase.rpc('inbox_changed_since', { p_since: since })
  if (error) throw error
  const d = data as { now: string; ids: string[] | null }
  return { now: d.now, ids: since === null ? [] : d.ids }
}

/** `since` minus the overlap, as an ISO string for the RPC. */
export function withOverlap(watermark: string): string {
  return new Date(Date.parse(watermark) - WATERMARK_OVERLAP_MS).toISOString()
}
