/**
 * The hand-off between the page and the service worker.
 *
 * A push arrives while the app is closed. The worker can fetch the DMs list
 * right then, so the next open paints current rows instead of running the
 * 3 s read in front of Ivan (2026-09-14, "how can it feel like a true app").
 * The worker cannot see localStorage, where the session and the saved copy
 * live, so both sides meet in one IndexedDB store:
 *
 *   session        — the Supabase session JSON, written by whichever side
 *                    refreshed it last. The access token dies hourly and a
 *                    refresh ROTATES the refresh token, so the two sides must
 *                    never refresh from different copies: the page adopts the
 *                    newer copy before its client reads storage (the adapter
 *                    in src/lib/supabase.ts), and the worker only refreshes
 *                    when no window is open (shouldPrefetch).
 *   swr:<query>    — a saved copy in the exact SwrEntry shape src/lib/swr.ts
 *                    keeps in localStorage, adopted into localStorage before
 *                    the first render (adoptPrefetchedInbox) so useInbox's
 *                    synchronous seed sees it.
 */
import { INBOX_QUERY } from './inboxCache'
import { currentUserId, readSwr, swrKey, type SwrEntry } from './swr'

export const SESSION_KEY = 'session'
export const swrHandoffKey = (query: string): string => `swr:${query}`

type StoredSession = { expires_at?: unknown }

function expiresAt(raw: string | null): number {
  if (!raw) return -Infinity
  try {
    const e = (JSON.parse(raw) as StoredSession).expires_at
    return typeof e === 'number' ? e : -Infinity
  } catch { return -Infinity }
}

/** The session the page runs on: the later-expiring copy, the local one on a tie. */
export function newerSession(local: string | null, worker: string | null): string | null {
  if (!worker) return local
  if (!local) return expiresAt(worker) > -Infinity ? worker : null
  return expiresAt(worker) > expiresAt(local) ? worker : local
}

/** The saved copy the page paints from: the later one, never another user's. */
export function newerSwr<T>(local: SwrEntry<T> | null, worker: SwrEntry<T> | null, userId: string): SwrEntry<T> | null {
  if (!worker || typeof worker.savedAt !== 'string' || worker.user !== userId) return local
  if (!local) return worker
  return worker.savedAt > local.savedAt ? worker : local
}

/** A push may fetch only when the app is closed (an open page refetches itself and owns the refresh token) and a session is stored. */
export function shouldPrefetch(s: { windowClients: number; session: string | null }): boolean {
  return s.windowClients === 0 && !!s.session
}

const DB = 'inbox-handoff'
const STORE = 'kv'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('blocked'))
  })
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(db => new Promise<T>((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => { resolve(req.result); db.close() }
    req.onerror = () => { reject(req.error); db.close() }
  }))
}

export async function readHandoff<T>(key: string): Promise<T | null> {
  if (typeof indexedDB === 'undefined') return null
  try { return ((await tx<T | undefined>('readonly', s => s.get(key))) ?? null) } catch { return null }
}

export async function writeHandoff(key: string, value: unknown): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  try { await tx('readwrite', s => s.put(value, key)) } catch { /* quota, private mode */ }
}

export async function deleteHandoff(key: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  try { await tx('readwrite', s => s.delete(key)) } catch { /* nothing to drop */ }
}

/**
 * Before the first render: if the worker saved a fresher DMs copy, put it where
 * useInbox reads synchronously. Bounded so a wedged IndexedDB can never hold
 * the first paint; it resolves either way.
 */
export async function adoptPrefetchedInbox(): Promise<'adopted' | 'kept' | 'none'> {
  const worker = await Promise.race([
    readHandoff<SwrEntry<unknown>>(swrHandoffKey(INBOX_QUERY)),
    new Promise<null>(r => setTimeout(() => r(null), 300)),
  ])
  const userId = currentUserId()
  if (!worker || !userId) return 'none'
  const local = readSwr<unknown>(INBOX_QUERY)
  const pick = newerSwr(local, worker, userId)
  if (pick !== worker) return 'kept'
  try { localStorage.setItem(swrKey(worker.user, INBOX_QUERY), JSON.stringify(worker)) } catch { return 'kept' }
  return 'adopted'
}
