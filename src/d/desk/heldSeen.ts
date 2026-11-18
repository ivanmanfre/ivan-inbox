// held_seen: the server arms a held action's commit timer only when Ivan could first SEE its row
// (backend contract after Sol backend r2): the tab is visible and the row is on screen. Sent once per
// action id per tab (module level, so a reopened desk does not send it again), batched per tick;
// only a failed report is sent again, when the row is next visibly rendered or the tab returns.
// The countdown runs to the server's own hold_until for that row (also when it was armed earlier,
// e.g. in another tab). If the call or that id fails, the row keeps Undo and "Do it now" and shows no
// countdown; if the row is no longer held, the desk reads it back.
import { markHeldSeen, type HeldSeenResult } from './api'
import { actionStore } from './actionGuards'

// 'manual': the server recorded the sighting and set no deadline (every hold waits for Do it now, server r19+):
// no countdown, and the report is never sent again.
type Seen = { state: 'pending' } | { state: 'armed'; until: number } | { state: 'manual' } | { state: 'failed' } | { state: 'settled' }
const seen = new Map<string, Seen>()
const listeners = new Set<() => void>()
let version = 0
let queue: string[] = []
let flushing = false

function changed() { version++; listeners.forEach(l => l()) }

export const heldSeenStore = {
  subscribe(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l) } },
  version(): number { return version },
  get(id: string): Seen | undefined { return seen.get(id) },
}

/** The row is visibly on screen: arm its hold on the server once. Returns nothing; the store updates. */
export function reportHeldSeen(id: string): void {
  // Once per id; a failed report (offline) is tried again on the next visible render or tab return.
  // Never after Ivan tapped Undo on it, whatever that cancel's result (Sol desk-ui r6 #1).
  if (actionStore.undoTapped(id)) return
  const prev = seen.get(id)
  if (prev && prev.state !== 'failed') return
  seen.set(id, { state: 'pending' })
  queue.push(id)
  changed()
  if (flushing) return
  flushing = true
  queueMicrotask(async () => {
    // An Undo tapped while the report waited for this tick wins: that id is not sent.
    const ids = queue.splice(0).filter(x => !actionStore.undoTapped(x) || (seen.delete(x), changed(), false))
    flushing = false
    // The server takes at most 10 ids per call.
    // Each batch re-checks the Undo taps right before its call (a batch can wait behind an earlier one),
    // and markHeldSeen checks again after the session token resolves; an empty batch sends nothing.
    const wanted = (x: string) => !actionStore.undoTapped(x)
    for (let i = 0; i < ids.length; i += 10) {
      const part = ids.slice(i, i + 10).filter(x => wanted(x) || (seen.delete(x), false))
      if (!part.length) { changed(); continue }
      const r: HeldSeenResult = await markHeldSeen(part, wanted).catch(() => ({ ok: false }))
      const byId = new Map((r.results ?? []).map(e => [e.id, e]))
      for (const x of part) {
        // Tapped while this call was on its way: it is not reported, and never will be.
        if (!wanted(x)) { seen.delete(x); continue }
        const e = byId.get(x)
        const until = e?.hold_until ? Date.parse(e.hold_until) : NaN
        if (!e || e.error) seen.set(x, { state: 'failed' })
        else if (e.state && e.state !== 'held') seen.set(x, { state: 'settled' })
        else if (Number.isFinite(until)) seen.set(x, { state: 'armed', until })
        // Recorded with no deadline: a manual hold. Not a failure, so it is not reported again on every render.
        else if (e.seen_at) seen.set(x, { state: 'manual' })
        else seen.set(x, { state: 'failed' }) // no deadline and no record: no countdown, keep the buttons
      }
      changed()
    }
  })
}

/** Tests only. */
export function resetHeldSeen(): void { seen.clear(); listeners.clear(); queue = []; flushing = false; version = 0 }
