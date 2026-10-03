import { useSyncExternalStore } from 'react'
import { setVerdict, type SavedVerdict, type Verdict } from '../../lib/verdicts'

// ONE-TAP APPROVE / DROP WITH UNDO (run 39). The same hold model as Approve/Skip
// (decisions.ts): the tap is HELD for the Undo window and written when it ends,
// so Undo cancels a write that never happened (there is no undelete or
// approved -> review to get wrong). Held taps are written at once when the page
// is hidden or closed. A reason tapped while held rides along with the verdict;
// a reason tapped after the write is one more idempotent call (same verdict =
// replay that adds the reason). A failed write keeps the card and says why.
// Time to verdict: markShown(id) notes when the card (or the open post) was first
// on screen; the tap's distance from that rides on the FIRST write only.
export const VERDICT_HOLD_MS = 5000
/** An Approve strip stays this long after it is saved (long enough to read "Approved after your edit"), then folds. */
export const APPROVE_FOLD_MS = 2500

export type Phase = 'held' | 'saving' | 'saved' | 'failed'
export type Judged = {
  id: string
  verdict: Verdict
  lane: 'ivan' | 'risedtc' | 'arch'
  title: string
  phase: Phase
  reasons: string[]
  note: string | null
  /** A reason write after the verdict landed is in flight. */
  reasonSaving: boolean
  error: string | null
  saved: SavedVerdict | null
  /** The strip has been put away (a reason was given, or the next card was judged). */
  collapsed: boolean
  /** Idempotency key: a retried first write replays instead of writing twice. */
  invocation: string
  at: number
  /** Card first on screen (or post opened) to this tap, in ms; undefined when it was never seen being shown. */
  msToVerdict?: number
}

type Entry = Judged & { movedOn?: boolean; timer: ReturnType<typeof setTimeout> | null; onCommitted?: () => void }

const entries = new Map<string, Entry>()
const shownAt = new Map<string, number>()
let snapshot: ReadonlyMap<string, Judged> = new Map()
const listeners = new Set<() => void>()

function publish() {
  snapshot = new Map([...entries].map(([id, e]) => {
    const { timer: _t, onCommitted: _c, ...pub } = e
    return [id, pub]
  }))
  for (const l of listeners) l()
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const h = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

const sameReasons = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])
/** The saved row already carries the reason Ivan gave (Skip is stored as reason_skipped, not as a reason). */
const recorded = (saved: SavedVerdict, reasons: readonly string[]) =>
  reasons[0] === 'skip' ? saved.reason_skipped === true : sameReasons(saved.reasons, reasons)

/** The card (or the open post) is on screen now. First call per draft wins; later ones change nothing. */
export function markShown(id: string): void {
  if (!shownAt.has(id)) shownAt.set(id, Date.now())
}

async function commit(id: string): Promise<void> {
  const e = entries.get(id)
  if (!e || (e.phase !== 'held' && e.phase !== 'failed')) return
  if (e.timer) clearTimeout(e.timer)
  e.timer = null
  e.phase = 'saving'; e.error = null
  publish()
  try {
    const saved = await setVerdict(id, e.verdict, { reasons: e.reasons, note: e.note, invocation: e.invocation, msToVerdict: e.msToVerdict })
    const cur = entries.get(id)
    if (!cur) return
    cur.phase = 'saved'; cur.saved = saved
    if (cur.reasons.length && recorded(saved, cur.reasons)) cur.collapsed = true
    // Approve has nothing left to add once saved; a Drop folds too when Ivan has already moved to the next card.
    if (cur.movedOn) cur.collapsed = true
    else if (cur.verdict === 'keep') setTimeout(() => { const e = entries.get(id); if (e && e.phase === 'saved' && !e.collapsed) { e.collapsed = true; publish() } }, APPROVE_FOLD_MS)
    publish()
    // A reason given while the write was in flight: send it now (the replay adds it).
    if (cur.reasons.length && !recorded(saved, cur.reasons)) void saveReason(id)
    cur.onCommitted?.()
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('wb-rows-changed'))
  } catch (err) {
    const cur = entries.get(id)
    if (!cur) return
    cur.phase = 'failed'; cur.error = err instanceof Error ? err.message : 'That did not go through.'
    cur.collapsed = false
    publish()
  }
}

async function saveReason(id: string): Promise<void> {
  const e = entries.get(id)
  if (!e || e.phase !== 'saved') return
  e.reasonSaving = true; e.error = null
  publish()
  try {
    const saved = await setVerdict(id, e.verdict, { reasons: e.reasons, note: e.note })
    const cur = entries.get(id)
    if (!cur) return
    cur.saved = saved; cur.reasonSaving = false; cur.collapsed = true
    publish()
  } catch (err) {
    const cur = entries.get(id)
    if (!cur) return
    cur.reasonSaving = false; cur.error = `The reason was not saved: ${err instanceof Error ? err.message : 'try again'}`
    publish()
  }
}

/** One tap: hold Approve or Drop for the Undo window, then write it. A second tap on the same card is ignored. */
export function judge(id: string, verdict: Verdict, meta: { lane: Judged['lane']; title: string; ms?: number; onCommitted?: () => void }): void {
  const prev = entries.get(id)
  if (prev && prev.phase !== 'failed') return
  if (prev?.timer) clearTimeout(prev.timer)
  // The previous card's strip folds away once Ivan moves on (its write still runs to the end).
  for (const e of entries.values()) if (e.id !== id) { if (e.phase === 'saved') e.collapsed = true; else if (e.phase !== 'failed') e.movedOn = true }
  const seen = shownAt.get(id)
  const e: Entry = {
    id, verdict, lane: meta.lane, title: meta.title, phase: 'held', reasons: [], note: null, reasonSaving: false,
    error: null, saved: null, collapsed: false, invocation: prev?.invocation ?? uuid(), at: Date.now(), timer: null,
    onCommitted: meta.onCommitted,
    msToVerdict: seen === undefined ? undefined : Math.max(0, Date.now() - seen),
  }
  entries.set(id, e)
  e.timer = setTimeout(() => { void commit(id) }, meta.ms ?? VERDICT_HOLD_MS)
  publish()
  listenForLeave()
}

/** Undo: cancel a held tap. False when it is already being written or written (too late). */
export function undoVerdict(id: string): boolean {
  const e = entries.get(id)
  if (!e || e.phase !== 'held') return false
  if (e.timer) clearTimeout(e.timer)
  entries.delete(id)
  publish()
  return true
}

/** The reason chip: one more tap. Rides along if the verdict is still held; otherwise one replay write. */
export function giveReason(id: string, reason: string, note: string | null = null): void {
  const e = entries.get(id)
  // Approve takes no reasons: only a drop has the why.
  if (!e || e.verdict !== 'drop') return
  e.reasons = [reason]
  if (note && note.trim()) e.note = note.trim().slice(0, 500)
  if (e.phase === 'saved') { void saveReason(id); return }
  publish()
}

/** Write a failed tap again (same idempotency key, so a write that did land replays). */
export function retryVerdict(id: string): void { void commit(id) }

/** Put a strip away. A failed tap is forgotten (nothing was written, the card comes back as it was). */
export function forgetVerdict(id: string): void {
  const e = entries.get(id)
  if (!e) return
  if (e.phase === 'failed') { entries.delete(id); publish(); return }
  if (e.phase === 'saved') { e.collapsed = true; publish() }
}

/** Write every held tap now (the page is going away). */
export function flushVerdicts(): Promise<void> {
  return Promise.all([...entries.values()].filter(e => e.phase === 'held').map(e => commit(e.id))).then(() => undefined)
}

function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } }
const read = () => snapshot

/** This session's taps by draft id (held, saving, saved or failed). */
export function useJudged(): ReadonlyMap<string, Judged> {
  return useSyncExternalStore(subscribe, read, read)
}
export function judgedNow(): ReadonlyMap<string, Judged> { return snapshot }

let listening = false
function listenForLeave() {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('pagehide', () => { void flushVerdicts() })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flushVerdicts() })
}

/** Tests only. */
export function resetVerdictsForTest(): void {
  for (const e of entries.values()) if (e.timer) clearTimeout(e.timer)
  entries.clear()
  shownAt.clear()
  publish()
}
