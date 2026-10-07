// The draft saves itself (Ivan 09-27: "I want the direct editing capabilities"). 800 ms after the
// last keystroke, and at once on blur, the draft goes through today's guarded save (saveDraftText /
// saveDraftEmail: a row already approved, sent or discarded is a zero-row no-op, so a late save can
// never bring a sent draft back). A pending save is flushed when the thread changes, and cancelled
// by a verb that writes the draft itself (Send, Discard, Later, Mark as solved).
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Thread } from '../../lib/inbox'
import type { Edits } from './verbs'

export type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

export const AUTOSAVE_MS = 800

const same = (a: Edits, b: Edits) => a.main === b.main && a.email === b.email && a.companion === b.companion && a.cc === b.cc && a.companionCc === b.companionCc

export function useAutosave(t: Thread, edits: Edits, base: Edits, save: (t: Thread, ed: Edits) => Promise<string | null>) {
  const [state, setState] = useState<SaveState>('idle')
  const [why, setWhy] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  const pending = useRef<{ t: Thread; ed: Edits } | null>(null)
  const saved = useRef<Edits>(base)
  const draftId = t.draft?.id ?? ''

  const flush = useCallback(async () => {
    if (timer.current != null) { window.clearTimeout(timer.current); timer.current = null }
    const p = pending.current
    if (!p) return
    pending.current = null
    setState('saving')
    const err = await save(p.t, p.ed)
    if (err) { setState('failed'); setWhy(err); pending.current = pending.current ?? p; return }
    saved.current = p.ed
    setWhy(null)
    setState(pending.current ? 'saving' : 'saved')
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
