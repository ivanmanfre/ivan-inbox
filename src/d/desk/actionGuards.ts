// Per action id, shared by every mounted row in this tab, with a subscription so a row mounted
// later (the desk reopened) sees an op that finishes in an earlier mount (Sol desk-ui r3 #2):
//  - inFlight: a commit, cancel or undo request is on the wire; nothing else is sent for that id.
//  - failedOp: the last op that failed with a network or server error, offered again on the row.
// No browser timer ever commits: the server commits a held action when its hold ends, unless
// Undo's compare-and-set (held -> cancelled) wins first (content-desk, commit 0d7edb6a).
type Op = 'commit' | 'cancel' | 'undo'
const inFlightMap = new Map<string, Op>()
const failedMap = new Map<string, { op: Op; error: string }>()
const listeners = new Set<() => void>()
let version = 0

function changed() { version++; listeners.forEach(l => l()) }

export const actionStore = {
  subscribe(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l) } },
  version(): number { return version },
  inFlight(id: string): Op | undefined { return inFlightMap.get(id) },
  failed(id: string): { op: Op; error: string } | undefined { return failedMap.get(id) },
  start(id: string, op: Op): boolean {
    if (inFlightMap.has(id)) return false
    inFlightMap.set(id, op); failedMap.delete(id); changed()
    return true
  },
  finish(id: string, failure?: { op: Op; error: string }): void {
    inFlightMap.delete(id)
    if (failure) failedMap.set(id, failure)
    changed()
  },
}

/** Tests only. */
export function resetActionGuards(): void { inFlightMap.clear(); failedMap.clear(); listeners.clear(); version = 0 }
