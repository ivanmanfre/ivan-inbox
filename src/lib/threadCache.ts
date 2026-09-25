/* ==========================================================================
   src/lib/threadCache.ts: the last-known turns of a Claude thread, on device.

   WHY. The phone lands on the Claude thread. Before this, a cold open painted
   "Ask anything." (the empty state) until the session restore, the thread read
   and the turns read had all crossed the network, then jumped to the real
   conversation. This keeps the last settled transcript of the threads he read
   and paints it in the first render; the rows are re-read behind it.

   RULES (same family as src/lib/swr.ts):
   1. PER USER. One key per Supabase user id (`tc1:<sub>`), re-checked on read.
      Another account on this device reads a miss, and foreign keys are dropped
      on the next write.
   2. CAPPED. The whole entry stays under CAP_CHARS. Older threads go first,
      then the oldest turns of the thread being written. Never a half-written
      JSON.
   3. NO CAPABILITY LINKS. Bodies go through redactCapability() and the final
      JSON through swrSafe(); an unsafe payload is refused and the old entry for
      that thread dropped.
   4. AN EMPTY RESULT OVER A KNOWN-NON-EMPTY THREAD IS A FAILED READ (N3b). The
      caller keeps the cached turns and marks them stale (emptyOverKnown).

   Two shapes per thread: `turns` (written by the page when a turn settles) or
   `rows` (the raw inbox_turns rows the service worker fetched at push time,
   adopted before the first render by src/lib/handoff.ts). Rows are turned into
   turns by the caller's own converter, so this file never imports the chat
   code and the worker never imports React.
   ========================================================================== */
import type { Turn } from '../exp/v2c/chat/events'
import type { TurnRow } from './turns'
import { currentUserId, redactCapability, swrSafe } from './swr'

export const THREAD_CACHE_PREFIX = 'tc1:'
export const THREAD_CACHE_CAP_CHARS = 150_000
const MAX_THREADS = 4

type Slot = { savedAt: string; turns?: Turn[]; rows?: TurnRow[] }
type Entry = { v: 1; user: string; threads: Record<string, Slot> }

export const threadCacheKey = (userId: string): string => `${THREAD_CACHE_PREFIX}${userId}`

function readEntry(userId: string): Entry | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(threadCacheKey(userId))
    if (!raw) return null
    const e = JSON.parse(raw) as Entry
    if (!e || e.v !== 1 || e.user !== userId || typeof e.threads !== 'object' || !e.threads) return null
    return e
  } catch { return null }
}

function dropForeign(userId: string): void {
  try {
    const doomed: string[] = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i)
      if (k && k.startsWith(THREAD_CACHE_PREFIX) && k !== threadCacheKey(userId)) doomed.push(k)
    }
    for (const k of doomed) localStorage.removeItem(k)
  } catch { /* private mode */ }
}

function cleanInput(input: unknown): unknown {
  try {
    const s = redactCapability(JSON.stringify(input ?? {}))
    return s && swrSafe(s) ? JSON.parse(s) : {}
  } catch { return {} }
}

const cleanTurn = (t: Turn): Turn => ({
  ...t,
  text: redactCapability(t.text) ?? '',
  tools: (t.tools ?? []).map(c => ({ ...c, input: cleanInput(c.input) })),
})

const cleanRow = (r: TurnRow): TurnRow => ({
  ...r,
  prompt: redactCapability(r.prompt) ?? '',
  answer: redactCapability(r.answer),
  context: null,
  error_detail: null,
})

/**
 * Write one thread's settled state. Returns what happened, for the tests; the
 * callers ignore it (a refused write only costs the next open its instant paint).
 */
export function writeThreadCache(
  threadId: string,
  data: { turns: Turn[] } | { rows: TurnRow[]; savedAt?: string },
  userId: string | null = currentUserId(),
): 'written' | 'no-user' | 'empty' | 'unsafe' | 'too-big' | 'failed' {
  if (!userId || typeof localStorage === 'undefined' || !threadId) return 'no-user'
  const slot: Slot = 'turns' in data
    ? { savedAt: new Date().toISOString(), turns: data.turns.map(cleanTurn) }
    : { savedAt: data.savedAt ?? new Date().toISOString(), rows: data.rows.map(cleanRow) }
  const list = slot.turns ?? slot.rows ?? []
  if (list.length === 0) return 'empty'
  const prev = readEntry(userId)
  const threads: Record<string, Slot> = {}
  // Newest first, the one being written leading, capped in count.
  const others = Object.entries(prev?.threads ?? {})
    .filter(([id]) => id !== threadId)
    .sort((a, b) => (a[1].savedAt < b[1].savedAt ? 1 : -1))
    .slice(0, MAX_THREADS - 1)
  const build = () => JSON.stringify({ v: 1, user: userId, threads } satisfies Entry)
  threads[threadId] = slot
  for (const [id, s] of others) threads[id] = s
  let json = build()
  // Over the cap: older threads leave first, then the head of this one.
  while (json.length > THREAD_CACHE_CAP_CHARS && Object.keys(threads).length > 1) {
    const last = Object.keys(threads).pop()!
    delete threads[last]
    json = build()
  }
  while (json.length > THREAD_CACHE_CAP_CHARS) {
    const arr = (slot.turns ?? slot.rows)!
    if (arr.length <= 1) return 'too-big'
    arr.splice(0, Math.max(1, Math.ceil(arr.length / 8)))
    json = build()
  }
  if (!swrSafe(json)) {
    delete threads[threadId]
    try { localStorage.setItem(threadCacheKey(userId), build()) } catch { /* nothing to keep */ }
    return 'unsafe'
  }
  try {
    localStorage.setItem(threadCacheKey(userId), json)
  } catch {
    dropForeign(userId)
    try { localStorage.setItem(threadCacheKey(userId), json) } catch { return 'failed' }
  }
  dropForeign(userId)
  return 'written'
}

/**
 * The last-known turns of one thread, or null. Ids are re-minted (`c<n>`) so a
 * cached turn can never share a React key with one the live hook mints later.
 */
export function readThreadCache(
  threadId: string | null,
  fromRows: (rows: TurnRow[]) => Turn[],
  userId: string | null = currentUserId(),
): { turns: Turn[]; savedAt: string } | null {
  if (!threadId || !userId) return null
  const slot = readEntry(userId)?.threads[threadId]
  if (!slot || typeof slot.savedAt !== 'string') return null
  let turns: Turn[]
  try {
    turns = slot.turns ?? (slot.rows ? fromRows(slot.rows) : [])
  } catch { return null }
  if (!Array.isArray(turns) || turns.length === 0) return null
  return { turns: turns.map((t, i) => ({ ...t, id: `c${i}` })), savedAt: slot.savedAt }
}

/** When the saved copy of one thread was written, or null. Used by the hand-off to keep the newer copy. */
export function threadCacheSavedAt(threadId: string, userId: string | null = currentUserId()): string | null {
  if (!userId) return null
  return readEntry(userId)?.threads[threadId]?.savedAt ?? null
}

/**
 * Carry the ids of turns already on screen onto a fresh read of the same rows,
 * so replacing the cached paint with the network truth does not remount (and
 * re-animate) every card. Matched on (row id, role); anything new keeps its own.
 */
export function keepIds(prev: Turn[], fresh: Turn[]): Turn[] {
  if (prev.length === 0) return fresh
  const byRow = new Map<string, string>()
  for (const t of prev) if (t.turnId) byRow.set(`${t.turnId}:${t.role}`, t.id)
  const used = new Set<string>()
  return fresh.map(t => {
    const id = t.turnId ? byRow.get(`${t.turnId}:${t.role}`) : undefined
    if (!id || used.has(id)) return t
    used.add(id)
    return { ...t, id }
  })
}

/** N3b: a read that came back empty while the screen holds a known-non-empty thread is a failure, never a truth. */
export function emptyOverKnown(onScreen: Turn[], freshCount: number): boolean {
  return freshCount === 0 && onScreen.length > 0
}
