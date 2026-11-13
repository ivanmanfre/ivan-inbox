import { useEffect, useSyncExternalStore } from 'react'
import { readNextPosts, type NextPost } from '../../../lib/contentNext'

// THE POSTS GOING OUT NEXT, ONE READ FOR THE CONTENT PAGE (db: content_next_posts). The landing and Ivan's Review list
// read this one store. It re-reads on open, when the app comes back to the front, after any write on the page
// (wb-rows-changed), every 5 minutes in front, and every 20 seconds while a row is still settling (the automatic check
// is running, or the queued copy is catching up with an edit), so a row settles without a reload.

export type NextSnap = { posts: NextPost[]; loaded: boolean; failed: boolean; version: number }
let snap: NextSnap = { posts: [], loaded: false, failed: false, version: 0 }
const subs = new Set<() => void>()
let inflight: Promise<NextPost[] | null> | null = null
let wired = false
let settle: number | null = null
const POLL_MS = 5 * 60_000
const SETTLE_MS = 20_000
/** The landing waits for this read, so it never waits longer than this. */
const READ_MS = 8_000

function publish(next: NextSnap) { snap = next; for (const l of subs) l() }
const settling = (posts: readonly NextPost[]) => posts.some(p => p.state === 'checking' || !p.in_sync)

function timed<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('The next posts took too long to load.')), ms)
    p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })
}

/** Re-read the upcoming posts. Resolves to the fresh list, or null when the read failed (the last list stays on screen
 *  and the snapshot says it failed: a failure is never "nothing is going out"). */
export function refreshNextPosts(): Promise<NextPost[] | null> {
  if (inflight) return inflight
  inflight = timed(readNextPosts(), READ_MS)
    .then(posts => { publish({ posts, loaded: true, failed: false, version: snap.version + 1 }); return posts as NextPost[] | null },
      e => { console.warn('[d] next posts read failed', e instanceof Error ? e.message : e); publish({ ...snap, loaded: true, failed: true, version: snap.version + 1 }); return null })
    .finally(() => {
      inflight = null
      if (settle != null) { window.clearTimeout(settle); settle = null }
      if (typeof window !== 'undefined' && subs.size > 0 && settling(snap.posts)) {
        settle = window.setTimeout(() => { settle = null; if (document.visibilityState === 'visible') void refreshNextPosts() }, SETTLE_MS)
      }
    })
  return inflight
}

function wire() {
  if (wired || typeof window === 'undefined') return
  wired = true
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshNextPosts() })
  window.addEventListener('wb-rows-changed', () => { void refreshNextPosts() })
  window.setInterval(() => { if (document.visibilityState === 'visible') void refreshNextPosts() }, POLL_MS)
}

const subscribe = (l: () => void) => { subs.add(l); return () => { subs.delete(l) } }
const read = () => snap

export function useNextPosts(): NextSnap {
  const s = useSyncExternalStore(subscribe, read, read)
  useEffect(() => {
    wire()
    if (!snap.loaded && !inflight) void refreshNextPosts()
  }, [])
  return s
}

/** Tests only. */
export function resetNextPostsForTest(next: Partial<NextSnap> = {}): void {
  inflight = null
  if (settle != null) { clearTimeout(settle); settle = null }
  snap = { posts: [], loaded: false, failed: false, version: 0, ...next }
  for (const l of subs) l()
}
