import { useSyncExternalStore } from 'react'
import { approveDraft, skipDraft } from '../../lib/content'

// ONE-TAP APPROVE / SKIP WITH UNDO (Ivan 29 Sep: "much nicer, smooth and useful").
//
// The per-row confirm is gone. Instead the decision is HELD for the life of its
// Undo toast and written when the toast ends: Undo cancels a write that never
// happened, so there is no reverse write to get wrong (approved -> review is not
// a transition anything else in the app makes). The screen reads the held
// decision at once (usePendingDecisions), so the card leaves and the next one
// moves up without waiting on the database.
//
// Every held decision is written straight away when the page is hidden or
// unloaded (pagehide / visibilitychange), so closing the app inside the window
// does not drop it. If that last write does not land, the draft simply stays in
// review: the safe side.
//
// The writes are today's approveDraft / skipDraft, unchanged (Ivan's lane only,
// the same filters). Approve never publishes; Skip marks the draft disqualified.
export type Decision = 'approve' | 'skip'

/** How long a decision waits for Undo; the toast that carries Undo lives exactly this long. */
export const HOLD_MS = 8000

type Held = {
  kind: Decision
  timer: ReturnType<typeof setTimeout> | null
  onCommitted?: () => void
  onFailed?: (e: unknown) => void
}

const held = new Map<string, Held>()
let snapshot: ReadonlyMap<string, Decision> = new Map()
const listeners = new Set<() => void>()

function publish() {
  snapshot = new Map([...held].map(([id, h]) => [id, h.kind]))
  for (const l of listeners) l()
}

const WRITE: Record<Decision, (id: string) => Promise<void>> = {
  approve: id => approveDraft(id),
  skip: id => skipDraft(id),
}

async function commit(id: string): Promise<void> {
  const h = held.get(id)
  if (!h) return
  if (h.timer) clearTimeout(h.timer)
  h.timer = null
  try {
    await WRITE[h.kind](id)
    held.delete(id)
    publish()
    h.onCommitted?.()
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('wb-rows-changed'))
  } catch (e) {
    held.delete(id)
    publish()
    h.onFailed?.(e)
  }
}

/**
 * Hold a decision on a draft and write it after `ms` (default HOLD_MS) unless
 * undone. A second decision on the same draft replaces the first.
 */
export function holdDecision(id: string, kind: Decision, o: { ms?: number; onCommitted?: () => void; onFailed?: (e: unknown) => void } = {}): void {
  const prev = held.get(id)
  if (prev?.timer) clearTimeout(prev.timer)
  const h: Held = { kind, timer: null, onCommitted: o.onCommitted, onFailed: o.onFailed }
  held.set(id, h)
  h.timer = setTimeout(() => { void commit(id) }, o.ms ?? HOLD_MS)
  publish()
  listenForLeave()
}

/** Cancel a held decision. False when it is already being written (too late to undo). */
export function undoDecision(id: string): boolean {
  const h = held.get(id)
  if (!h || !h.timer) return false
  clearTimeout(h.timer)
  held.delete(id)
  publish()
  return true
}

/** Write every held decision now (the page is going away). */
export function flushDecisions(): Promise<void> {
  return Promise.all([...held.keys()].filter(id => held.get(id)?.timer).map(id => commit(id))).then(() => undefined)
}

export function heldDecisions(): ReadonlyMap<string, Decision> {
  return snapshot
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

/** The decisions waiting on their Undo window, by draft id. */
export function usePendingDecisions(): ReadonlyMap<string, Decision> {
  return useSyncExternalStore(subscribe, heldDecisions, heldDecisions)
}

let listening = false
function listenForLeave() {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('pagehide', () => { void flushDecisions() })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flushDecisions() })
}

/** Tests only: drop every held decision without writing. */
export function resetDecisionsForTest(): void {
  for (const h of held.values()) if (h.timer) clearTimeout(h.timer)
  held.clear()
  publish()
}
