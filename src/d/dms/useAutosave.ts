// The draft saves itself (Ivan 09-27: "I want the direct editing capabilities"). 800 ms after the
// last keystroke, and at once on blur, the draft goes through today's guarded save (saveDraftText /
// saveDraftEmail: a row already approved, sent or discarded is a zero-row no-op, so a late save can
// never bring a sent draft back). A pending save is flushed when the thread changes, and cancelled
// by a verb that writes the draft itself (Send, Discard, Later, Mark as solved).
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Thread } from '../../lib/inbox'
import type { Edits } from './verbs'
import { sameEmailComposition } from '../../lib/emailCompositionSave'

export type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

export const AUTOSAVE_MS = 800

const same = (a: Edits, b: Edits) => a.main === b.main && a.email === b.email && a.companion === b.companion && a.cc === b.cc && a.companionCc === b.companionCc
  && sameEmailComposition(a.mainComposition, b.mainComposition) && sameEmailComposition(a.emailComposition, b.emailComposition) && sameEmailComposition(a.companionComposition, b.companionComposition)

type SaveResult = string | null | { thread: Thread }

export function useAutosave(t: Thread, edits: Edits, base: Edits, save: (t: Thread, ed: Edits) => Promise<SaveResult>) {
  const [state, setState] = useState<SaveState>('idle')
  const [why, setWhy] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  const pending = useRef<{ t: Thread; ed: Edits } | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)
  const saved = useRef<Edits>(base)
  const draftId = t.draft?.id ?? ''

  const flush = useCallback(async () => {
    if (timer.current != null) { window.clearTimeout(timer.current); timer.current = null }
    if (inFlight.current) return inFlight.current
    if (!pending.current) return
    const work = (async () => {
      while (pending.current) {
        if (timer.current != null) { window.clearTimeout(timer.current); timer.current = null }
        const p = pending.current
        pending.current = null
        setState('saving')
        let result: SaveResult
        try { result = await save(p.t, p.ed) }
        catch (error) { result = error instanceof Error ? error.message : String(error) }
        if (typeof result === 'string' && result) {
          setState('failed'); setWhy(result); pending.current = pending.current ?? p
          return
        }
        saved.current = p.ed
        setWhy(null)
        // A later local edit can use only the row this write actually returned as its CAS baseline.
        // A thread refreshed externally during the write keeps its own row and conflict guard.
        const queued = pending.current as { t: Thread; ed: Edits } | null
        if (result && typeof result === 'object' && queued) {
          const next = result.thread
          pending.current = { ...queued, t: {
            ...queued.t,
            draft: queued.t.draft?.id === p.t.draft?.id && sameEmailComposition(queued.t.draft, p.t.draft) ? next.draft : queued.t.draft,
            companionDraft: queued.t.companionDraft?.id === p.t.companionDraft?.id && sameEmailComposition(queued.t.companionDraft, p.t.companionDraft) ? next.companionDraft : queued.t.companionDraft,
          } }
        }
      }
      setState('saved')
    })()
    inFlight.current = work
    try { await work } finally { if (inFlight.current === work) inFlight.current = null }
  }, [save])

  const cancel = useCallback(() => {
    if (timer.current != null) { window.clearTimeout(timer.current); timer.current = null }
    pending.current = null
  }, [])

  // A new draft row: its text is the saved baseline; anything pending on the old one is flushed.
  useEffect(() => {
    saved.current = base
    setState('idle'); setWhy(null)
    return () => { void flush() }
  }, [draftId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!t.draft) return
    // Back to what the row already holds (typed and undone, or the server's own new text): nothing to save.
    if (same(edits, saved.current) || same(edits, base)) {
      if (timer.current != null) { window.clearTimeout(timer.current); timer.current = null }
      pending.current = null
      return
    }
    pending.current = { t, ed: edits }
    if (timer.current != null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { timer.current = null; void flush() }, AUTOSAVE_MS)
  }, [edits]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (timer.current != null) window.clearTimeout(timer.current) }, [])

  const retry = useCallback(() => { if (!pending.current && t.draft) pending.current = { t, ed: edits }; void flush() }, [flush, t, edits])
  /** An edit typed and not yet written (the 800 ms wait). Read through the ref, so no new hook. */
  const isPending = () => pending.current !== null
  return { state, why, flush, cancel, retry, isPending }
}
