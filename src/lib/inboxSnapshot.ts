import { readHandoff, writeHandoff } from './handoff'
import type { InboxMessage } from './inbox'
import { changedSince, fetchConversations, mergeConversations, withOverlap } from './inboxDelta'

/* THE LAST WHOLE READ, KEPT ON THE DEVICE (2026-11-15 speed review).
   Every open of every place read the whole message view again: ~25 pages, ~7 MB gzip, 15-25 s on
   the phone, before the list could be called live. The view's rows as last read are kept here
   (IndexedDB, the handoff store; localStorage is far too small) with the server-clock watermark
   they are good from. An open with a usable snapshot asks inbox_changed_since which conversations
   moved and re-reads only those, the same incremental read the open app already runs every few
   minutes. The whole-view read still runs once the snapshot's whole read is FULL_EVERY_MS old, in
   the background, after the screen is live. */

const KEY = 'inbox-rows:v1'
/** inbox_changed_since answers for 6 hours and the sweep reads from 2 minutes before the watermark. */
export const SNAPSHOT_MAX_AGE_MS = 5 * 3_600_000
/** A snapshot read that has not answered by then is a miss: the whole read goes ahead. */
export const SNAPSHOT_READ_MS = 2_500
/** Incremental reads advance the stored snapshot at most this often (a write is a ~30 MB structured clone). */
export const SNAPSHOT_SAVE_EVERY_MS = 10 * 60_000

export type InboxSnapshot = {
  user: string
  rows: InboxMessage[]
  /** Server clock the rows are good from (inbox_changed_since `now`). */
  watermark: string
  /** When the last WHOLE read behind these rows landed (ms). */
  fullAt: number
}

/** A snapshot this user can start from now, or null. Never another user's, never an empty one. */
export function usableSnapshot(s: unknown, user: string | null, now: number): InboxSnapshot | null {
  if (!user || !s || typeof s !== 'object') return null
  const v = s as Partial<InboxSnapshot>
  if (v.user !== user || !Array.isArray(v.rows) || v.rows.length === 0 || typeof v.watermark !== 'string' || typeof v.fullAt !== 'number') return null
  const at = Date.parse(v.watermark)
  if (!Number.isFinite(at) || now - at >= SNAPSHOT_MAX_AGE_MS || at - now > 60_000) return null
  // The whole read behind it is bounded too: rolling watermarks never stretch it past this (review r1).
  if (now - v.fullAt >= SNAPSHOT_MAX_AGE_MS) return null
  return v as InboxSnapshot
}

export async function readInboxSnapshot(user: string | null, now: number = Date.now()): Promise<InboxSnapshot | null> {
  if (!user) return null
  return usableSnapshot(await readHandoff<InboxSnapshot>(KEY), user, now)
}

export async function writeInboxSnapshot(s: InboxSnapshot): Promise<void> {
  await writeHandoff(KEY, s)
}

/**
 * The snapshot brought up to now: the conversations inbox_changed_since names since its watermark,
 * re-read whole and swapped in (the same delta the open app's sweep runs). Null = cannot be trusted
 * (too old for the server, or an empty re-read of conversations it holds): read the whole view.
 * Throws when a read fails. Used by the page's warm start and the worker's push-time prefetch.
 */
export async function snapshotDelta(snap: InboxSnapshot): Promise<{ rows: InboxMessage[]; watermark: string } | null> {
  const c = await changedSince(withOverlap(snap.watermark))
  if (c.ids === null) return null
  const pids = new Set(c.ids)
  let rows = snap.rows
  if (pids.size > 0) {
    const fresh = await fetchConversations([...pids])
    if (fresh.length === 0 && rows.some(m => pids.has(m.prospect_id))) return null
    rows = mergeConversations(rows, pids, fresh)
  }
  return { rows, watermark: c.now }
}
