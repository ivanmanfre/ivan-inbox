import { useEffect, useSyncExternalStore } from 'react'
import type { PlaceId } from '../places'

// FAILED READS, per place, for the left panel ("1 failed" under the place's
// name) and the phone top bar ("failed" beside the place). The frame reports
// its own count reads; a page reports its own reads while it is mounted:
//
//   useReportFailed('lanes', failedReads)   // a number, 0 when all good
//
// Words only, never a dot or a "!" (coordinator assignment, Frame #4).
type Map_ = Partial<Record<PlaceId, number>>
let current: Map_ = {}
const owners = new Map<symbol, { place: PlaceId; n: number }>()
const subs = new Set<() => void>()

function publish() {
  const next: Map_ = {}
  for (const { place, n } of owners.values()) next[place] = (next[place] ?? 0) + n
  current = next
  for (const f of subs) f()
}

export function useReportFailed(place: PlaceId, n: number) {
  useEffect(() => {
    const k = Symbol(place)
    owners.set(k, { place, n })
    publish()
    return () => { owners.delete(k); publish() }
  }, [place, n])
}

export function useReportedFailures(): Map_ {
  return useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f) } }, () => current, () => current)
}
