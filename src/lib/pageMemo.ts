/* ==========================================================================
   src/lib/pageMemo.ts: the in-memory "last good read" a page paints on its
   next visit while it reads again (PERF-SMOOTH, 2026-10-08).

   WHY. Every place in D mounts afresh on each visit (Shell keys the page by
   place), and pages like Lanes kept their reads in component state, so a
   revisit drew skeletons for 0.5 to 2.5 s although the same numbers had been
   on screen a minute earlier. This keeps the last good value per read for the
   life of the page (memory only: nothing is written to storage, nothing
   survives a reload) so the revisit paints at once and the read that starts on
   mount replaces it.

   THE RULES, enforced here, not at the call sites:
   1. ONLY A GOOD READ IS REMEMBERED. Call `remember` from a read that
      resolved; a failure never reaches it, so a failure can never become a paint.
   2. AN EMPTY LIST OVER A KNOWN-NON-EMPTY ONE IS NOT REMEMBERED (the N3b rule:
      a lost session reads as zero rows). The screen still shows what the read
      said; only the memory keeps the last non-empty copy.
   3. NEVER CROSS USERS. Every entry carries the session's user id and reads
      back only for that id.
   4. NEVER OLDER THAN `MEMO_MAX_AGE_MS`. A copy older than that is a miss: a
      cold honest paint beats a stale screen that looks live.
   ========================================================================== */
import { currentUserId } from './swr'

export const MEMO_MAX_AGE_MS = 30 * 60_000

type Entry = { user: string; at: number; value: unknown }
const store = new Map<string, Entry>()

const listLength = (v: unknown): number | null => (Array.isArray(v) ? v.length : null)

export type RememberOpts = {
  at?: number
  user?: string | null
  /** The list inside the value that rule 2 judges (default: the value itself, when it is an array). */
  list?: (value: unknown) => unknown
}

/** Keep a good read. Returns false when rule 2 or 3 refused it. */
export function remember(key: string, value: unknown, opts: RememberOpts = {}): boolean {
  const user = opts.user === undefined ? currentUserId() : opts.user
  if (!user) return false
  const list = opts.list ?? ((v: unknown) => v)
  const prev = store.get(key)
  if (prev && prev.user === user && listLength(list(value)) === 0 && (listLength(list(prev.value)) ?? 0) > 0) return false
  store.set(key, { user, at: opts.at ?? Date.now(), value })
  return true
}

/** The last good read for this user, if it is young enough; else null. */
export function recall<T>(key: string, now: number = Date.now(), user: string | null = currentUserId()): { value: T; at: number } | null {
  if (!user) return null
  const e = store.get(key)
  if (!e || e.user !== user || now - e.at > MEMO_MAX_AGE_MS || now < e.at - 60_000) return null
  return { value: e.value as T, at: e.at }
}

/** Drop one key (a page whose read was answered with a refusal) or, with no key, everything. */
export function forget(key?: string): void {
  if (key === undefined) store.clear(); else store.delete(key)
}
