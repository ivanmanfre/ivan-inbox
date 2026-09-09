/* ==========================================================================
   src/lib/swr.ts — the stale-while-revalidate store behind the instant paint.

   WHY IT EXISTS. Every open of the phone app waited on Supabase before it drew
   a single row: DMs painted a skeleton for 1 to 5 s on LTE, Today's masthead sat
   on a "still loading" band. The JS is already service-worker cached, so the only
   thing missing on a second open is the DATA. This keeps the last reconciled
   payload on the device and paints it at once, then refetches behind it.

   STORAGE: localStorage, not IndexedDB. Deliberate. The paint has to happen in
   the FIRST render pass or it is not an instant paint, and localStorage is the
   only web storage a React initialiser can read synchronously; IndexedDB is
   async, so it would land a frame or more later and reintroduce the flash of
   skeleton this whole layer exists to remove. Today's brief cache
   (lib/today.ts) already made the same call and has run on this origin for
   months. The cost is the size cap below, which is why every write is measured
   and a payload that will not fit is refused rather than half-written.

   THREE RULES, all enforced here rather than at each call site:
   1. NEVER CACHE A FAILURE. `okToCache` is the only door; a 4xx/5xx or a thrown
      fetch writes nothing, so a bad read can never become a bad paint.
   2. NEVER CROSS USERS. Every key carries the JWT `sub` of the session that
      wrote it. A different account on the same device reads a different key and
      the foreign keys are dropped on the next write.
   3. NEVER CACHE A CAPABILITY LINK. Same whitelist lock Today's cache carries:
      approve_url / skip_url / action_url / `?k=` are bearer tokens that send
      real messages, and localStorage on this origin is readable by anything
      that ends up running here. A payload carrying one is refused outright.
   ========================================================================== */

export const SWR_PREFIX = 'swr1:'

// 2 MB. localStorage is ~5 MB per origin on Safari and this origin also holds
// the Supabase session and Today's brief cache, so a single payload gets under
// half the budget. A payload over the cap is refused, never truncated: a
// truncated list would paint counts that disagree with their own rows.
export const SWR_CAP_BYTES = 2_000_000

export type SwrEntry<T> = { savedAt: string; user: string; payload: T }

/** The key a payload is stored under. One shape, so nothing else has to guess. */
export function swrKey(userId: string, query: string): string {
  return `${SWR_PREFIX}${userId}:${query}`
}

/**
 * Which user a stored key belongs to. Returns null for anything that is not
 * one of ours, so the sweep below can never delete a key it does not own.
 */
export function swrKeyUser(key: string): string | null {
  if (!key.startsWith(SWR_PREFIX)) return null
  const rest = key.slice(SWR_PREFIX.length)
  const i = rest.indexOf(':')
  return i > 0 ? rest.slice(0, i) : null
}

/** Only a 2xx may become a paint. Everything else leaves the cache alone. */
export function okToCache(status: number): boolean {
  return status >= 200 && status < 300
}

// Second lock on the whitelist, byte-identical in intent to lib/today.ts's
// cacheSafe(): if a projection ever stringifies with a capability-token pattern
// in it, the write is refused (fail closed) rather than trusting the projection
// was kept correct upstream.
export function swrSafe(json: string): boolean {
  return !/approve_url|skip_url|action_url|[?&]k=/.test(json)
}

/**
 * The user id the cache is keyed by: the `sub` claim of the Supabase session
 * sitting in localStorage. Read straight out of storage rather than through
 * supabase.auth.getSession(), which is a promise and would push the first paint
 * past the frame this layer exists to hit.
 */
export function readUserIdFrom(raw: string | null): string | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { access_token?: unknown; user?: { id?: unknown } }
    if (typeof parsed.user?.id === 'string' && parsed.user.id) return parsed.user.id
    if (typeof parsed.access_token !== 'string') return null
    const body = parsed.access_token.split('.')[1]
    if (!body) return null
    const claims = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: unknown }
    return typeof claims.sub === 'string' && claims.sub ? claims.sub : null
  } catch {
    return null
  }
}

export function currentUserId(): string | null {
  if (typeof localStorage === 'undefined') return null
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i)
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) {
        const id = readUserIdFrom(localStorage.getItem(k))
        if (id) return id
      }
    }
  } catch { /* private mode */ }
  return null
}

/**
 * Read the entry for this user and query. Signed out, or a cache written by a
 * different account, reads as a miss: rule 2 above is enforced by the key AND
 * re-checked on the way out, so a hand-edited key cannot leak a payload.
 */
export function readSwr<T>(query: string, userId: string | null = currentUserId()): SwrEntry<T> | null {
  if (!userId || typeof localStorage === 'undefined') return null
  let raw: string | null
  try { raw = localStorage.getItem(swrKey(userId, query)) } catch { return null }
  if (!raw) return null
  try {
    const e = JSON.parse(raw) as SwrEntry<T>
    if (!e || typeof e.savedAt !== 'string' || e.user !== userId) return null
    return e
  } catch { return null }
}

export type SwrWriteResult = 'written' | 'no-user' | 'too-big' | 'unsafe' | 'failed'

/**
 * Write the RECONCILED state, never a raw response. The call sites hand this the
 * array the screen is actually rendering, so a row the app has already removed
 * locally cannot come back on the next open.
 */
export function writeSwr<T>(query: string, payload: T, userId: string | null = currentUserId()): SwrWriteResult {
  if (!userId || typeof localStorage === 'undefined') return 'no-user'
  let json: string
  try {
    json = JSON.stringify({ savedAt: new Date().toISOString(), user: userId, payload })
  } catch { return 'failed' }
  if (json.length > SWR_CAP_BYTES) return 'too-big'
  if (!swrSafe(json)) return 'unsafe'
  try {
    localStorage.setItem(swrKey(userId, query), json)
  } catch {
    // Quota. Drop every other user's keys and this user's other queries once,
    // then try again; a second failure is a miss, not a half-written payload.
    dropForeignKeys(userId)
    try { localStorage.setItem(swrKey(userId, query), json) } catch { return 'failed' }
  }
  dropForeignKeys(userId)
  return 'written'
}

/** Every swr key that does not belong to this user goes. */
export function dropForeignKeys(userId: string): void {
  if (typeof localStorage === 'undefined') return
  const doomed: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i)
      const owner = k ? swrKeyUser(k) : null
      if (k && owner && owner !== userId) doomed.push(k)
    }
    for (const k of doomed) localStorage.removeItem(k)
  } catch { /* private mode */ }
}
