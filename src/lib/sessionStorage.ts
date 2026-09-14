import { newerSession } from './handoff'

type LocalLike = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

/**
 * THE PAGE'S SESSION STORAGE, with the worker's copy folded in.
 *
 * The service worker refreshes the token at push time when the app is closed
 * (src/sw.ts), and a refresh ROTATES the refresh token: a page that then woke
 * up on its own older copy would refresh a revoked token and be signed out
 * (seen 2026-09-14 in the gate: reusing an ancestor token once its child had
 * been used killed the whole family). So on the first read of the SESSION key,
 * and again on every return to the foreground, the later-expiring of the two
 * copies wins and is written back locally; every session write goes to both
 * places, so the worker never holds a copy older than the page's.
 *
 * Keyed on purpose: supabase-js reads `<key>-code-verifier` through the same
 * adapter, and an unkeyed first read would spend the consultation on it and
 * write the session under the wrong name.
 */
export function makePageStorage(deps: {
  local: LocalLike
  readWorker: () => Promise<string | null>
  writeWorker: (value: string) => Promise<void>
  deleteWorker: () => Promise<void>
}) {
  let consultWorker = true
  const isSession = (key: string) => key.endsWith('-auth-token')
  return {
    consultWorkerAgain(): void { consultWorker = true },
    async getItem(key: string): Promise<string | null> {
      const local = deps.local.getItem(key)
      if (!consultWorker || !isSession(key)) return local
      consultWorker = false
      const pick = newerSession(local, await deps.readWorker())
      if (pick && pick !== local) deps.local.setItem(key, pick)
      return pick
    },
    setItem(key: string, value: string): void {
      deps.local.setItem(key, value)
      if (isSession(key)) void deps.writeWorker(value)
    },
    removeItem(key: string): void {
      deps.local.removeItem(key)
      if (isSession(key)) void deps.deleteWorker()
    },
  }
}
