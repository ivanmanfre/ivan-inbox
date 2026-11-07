import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { fetchXReview, xFlagItems, xWaitingCount, type XReviewList } from '../../lib/xReview'

// ONE X REVIEW READ FOR THE APP. The flag on Home, the X desk, its nav count and the review screen all read
// the same store, so a decision on the review screen moves the flag at once. Re-read on mount
// (if older than 15 s), on focus, every minute while visible, and every 5 s while anything is
// publishing / posting (so "Publishing…" turns into "Live on X" without a pull).

export type XState = { list: XReviewList | null; error: string | null; loading: boolean; at: number | null }

let st: XState = { list: null, error: null, loading: false, at: null }
const subs = new Set<() => void>()
const emit = () => subs.forEach(f => f())
let inflight: Promise<void> | null = null
// Bumped by every local change. A read that started before a change is stale (it could put back the
// photo Ivan just swapped away, Sol r1 2026-11-05): it is dropped and read again.
let rev = 0

export function refreshX(): Promise<void> {
  if (inflight) return inflight
  const started = rev
  st = { ...st, loading: true }
  emit()
  inflight = fetchXReview().then(
    list => { st = started === rev ? { list, error: null, loading: false, at: Date.now() } : { ...st, loading: false } },
    (e: unknown) => { st = { ...st, error: e instanceof Error ? e.message : String(e), loading: false } },
  ).finally(() => {
    inflight = null
    emit()
    if (started !== rev) void refreshX()
  })
  return inflight
}

/** Optimistic local change (e.g. the status right after Publish), replaced by the next read. */
export function patchX(f: (l: XReviewList) => XReviewList) {
  if (!st.list) return
  rev++
  st = { ...st, list: f(st.list) }
  emit()
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
const snap = () => st

/** Test hook. */
export function __resetXForTests(s: Partial<XState> = {}) { st = { list: null, error: null, loading: false, at: null, ...s }; inflight = null; rev = 0 }

export function useXReview() {
  const s = useSyncExternalStore(subscribe, snap, snap)
  const moving = useMemo(() => xFlagItems(s.list).some(i => i.state === 'moving'), [s.list])
  useEffect(() => {
    if (!st.at || Date.now() - st.at > 15_000) void refreshX()
    const onFocus = () => { if (document.visibilityState === 'visible') void refreshX() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus) }
  }, [])
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void refreshX() }, moving ? 5_000 : 60_000)
    return () => window.clearInterval(t)
  }, [moving])
  return { ...s, refresh: refreshX }
}

/**
 * THE X DESK'S ONE NUMBER (nav line, dock badge): items waiting on Ivan, off the same store as the
 * desk, so a decision there moves the count at once. Reads on mount when stale, on focus, and every
 * 3 min while visible (the frame counts' pace; the desk itself reads every minute while open).
 * n is null until the first read lands; failed = no list at all because the read failed.
 */
export function useXWaiting(): { n: number | null; failed: boolean } {
  const s = useSyncExternalStore(subscribe, snap, snap)
  useEffect(() => {
    if (!st.at || Date.now() - st.at > 15_000) void refreshX()
    const onFocus = () => { if (document.visibilityState === 'visible') void refreshX() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void refreshX() }, 180_000)
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); window.clearInterval(t) }
  }, [])
  return { n: s.list ? xWaitingCount(s.list) : null, failed: !s.list && s.error != null }
}
