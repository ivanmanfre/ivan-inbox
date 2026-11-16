import { withTimeout } from '../d/ui/timeout'
import { readHandoff, writeHandoff } from './handoff'
import type { OpsDraft } from './ops'
import { redactCapability, swrSafe } from './swr'

/* OPERATIONS ROWS KEPT ON THE DEVICE (2026-11-16 speed review).
   Home and Ops read the newest 300 ops_drafts in full (body + context, ~230 KB gzip) on every open,
   focus and realtime change, though almost all of them (sent, discarded, expired) never change again.
   The rows as last read are kept here with a server digest of each (ops_drafts_digest_v, db/20261116a:
   md5 of the whole stored row). A read first asks for id + digest of the same 300 rows, then reads in
   full only the rows whose digest is new. The result is the same rows, in the same order, as the
   whole read.
   Capability links (approve_url / skip_url / ?k= bearer tokens) never reach the device (review r1, the
   swr lock): a finished row (sent, or blocked/discarded/expired) is saved with them removed, and a row
   still open with one is kept in memory only, so it is read again after a reload. */

const KEY = 'ops-rows:v1'
/** A device copy that has not answered by then is a miss: the whole read goes ahead. */
export const OPS_CACHE_READ_MS = 1_500
/** More changed rows than this: one whole read beats the id batches. */
export const OPS_REFETCH_MAX = 60
const ID_BATCH = 50

export type DigestRow = OpsDraft & { digest: string }
type Entry = { digest: string; row: OpsDraft }

/** An empty index over a device copy that had rows: a failure, never a cleared queue (Ivan's rule). */
export class OpsEmptyOverCache extends Error {
  constructor() { super('The ops read came back empty over a saved queue that had cards.') }
}
export type OpsRowCache = { user: string; rows: Record<string, Entry> }
export type OpsReads = {
  user: string | null
  /** id + digest of the rows the whole read would return, in its order. */
  index: () => Promise<{ id: string; digest: string }[]>
  /** The whole read, with digests. */
  whole: () => Promise<DigestRow[]>
  /** These ids in full, under the same filters (a row that left them is not returned). */
  byIds: (ids: string[]) => Promise<DigestRow[]>
}

let memory: OpsRowCache | null = null

function usable(c: unknown, user: string): OpsRowCache | null {
  if (!c || typeof c !== 'object') return null
  const v = c as Partial<OpsRowCache>
  if (v.user !== user || !v.rows || typeof v.rows !== 'object' || Object.keys(v.rows).length === 0) return null
  return v as OpsRowCache
}

async function load(user: string): Promise<OpsRowCache | null> {
  const hit = usable(memory, user)
  if (hit) return hit
  const stored = usable(await withTimeout(readHandoff<OpsRowCache>(KEY), OPS_CACHE_READ_MS).catch(() => null), user)
  if (stored && !usable(memory, user)) memory = stored
  return usable(memory, user)
}

const CAPABILITY_KEYS = new Set(['approve_url', 'skip_url', 'approve_all_url', 'action_url'])
const finished = (r: OpsDraft) => r.sent_at !== null || r.send_blocked_reason !== null

/** The row as it may sit on the device, or null when it may not. */
export function deviceSafe(r: OpsDraft): OpsDraft | null {
  if (swrSafe(JSON.stringify(r))) return r
  if (!finished(r)) return null
  const context = r.context && Object.fromEntries(Object.entries(r.context)
    .filter(([k]) => !CAPABILITY_KEYS.has(k))
    .map(([k, v]) => [k, typeof v === 'string' ? redactCapability(v) : v]))
  const redacted = { ...r, body: redactCapability(r.body) ?? r.body, context } as OpsDraft
  return swrSafe(JSON.stringify(redacted)) ? redacted : null
}

function save(user: string, entries: [string, Entry][]) {
  memory = { user, rows: Object.fromEntries(entries) }
  const stored: [string, Entry][] = []
  for (const [id, e] of entries) { const row = deviceSafe(e.row); if (row) stored.push([id, { digest: e.digest, row }]) }
  void writeHandoff(KEY, { user, rows: Object.fromEntries(stored) } satisfies OpsRowCache)
}

const entry = ({ digest, ...row }: DigestRow): Entry => ({ digest, row })

/** Throws when a read fails, like the whole read. Never saves an empty result. */
export async function readOpsRows(io: OpsReads): Promise<OpsDraft[]> {
  const user = io.user
  const cache = user ? await load(user) : null
  const seed = async () => {
    const entries = (await io.whole()).map(r => [r.id, entry(r)] as [string, Entry])
    // Every path, the fallbacks too (review r2): empty over a device copy is a failure.
    if (cache && entries.length === 0) throw new OpsEmptyOverCache()
    if (user && entries.length) save(user, entries)
    return entries.map(([, e]) => e.row)
  }
  if (!user || !cache) return seed()
  const index = await io.index()
  // Empty over a device copy that had rows: a failure the caller shows (after a reload useOps has no
  // rows on screen, so its own empty-over-rows rule cannot see it).
  if (index.length === 0) throw new OpsEmptyOverCache()
  const stale = index.filter(r => cache.rows[r.id]?.digest !== r.digest).map(r => r.id)
  if (stale.length > OPS_REFETCH_MAX) return seed()
  const fresh = new Map<string, Entry>()
  for (let i = 0; i < stale.length; i += ID_BATCH) {
    for (const r of await io.byIds(stale.slice(i, i + ID_BATCH))) fresh.set(r.id, entry(r))
  }
  // Every row must be the one the index named (review r1): a row that changed or vanished between the two
  // reads would mix two moments, or leave the newest-300 one short. Then one whole read decides.
  const want = new Map(index.map(r => [r.id, r.digest]))
  if (stale.some(id => fresh.get(id)?.digest !== want.get(id))) return seed()
  const entries: [string, Entry][] = index.map(({ id }) => [id, fresh.get(id) ?? cache.rows[id]])
  if (stale.length || entries.length !== Object.keys(cache.rows).length) save(user, entries)
  return entries.map(([, e]) => e.row)
}

/** Test seam: forget the in-memory copy. */
export function resetOpsRowMemory() { memory = null }
