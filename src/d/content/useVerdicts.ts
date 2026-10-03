import { useCallback, useEffect, useRef, useState } from 'react'
import { readVerdicts, type SavedVerdict } from '../../lib/verdicts'

// SAVED KEEP / DROP VERDICTS (run 39). The Review list hides a dropped draft and
// marks a kept one from what the database says, so a verdict outlives the tab.
// Read on mount, after every write (wb-rows-changed, debounced) and on focus.
// A failed read leaves the last good map in place and judging stays available:
// the server refuses a second, opposite verdict anyway.
export const VERDICT_WINDOW_DAYS = 45
const DEBOUNCE_MS = 400

export type VerdictsRead = { map: Map<string, SavedVerdict>; error: string | null; loaded: boolean }

export function useVerdicts(enabled = true): VerdictsRead {
  const [state, setState] = useState<VerdictsRead>({ map: new Map(), error: null, loaded: false })
  const seq = useRef(0)
  const alive = useRef(true)
  const run = useCallback(async () => {
    const mine = ++seq.current
    try {
      const since = new Date(Date.now() - VERDICT_WINDOW_DAYS * 86_400_000).toISOString()
      const rows = await readVerdicts(since)
      if (!alive.current || mine !== seq.current) return
      setState({ map: new Map(rows.map(v => [v.draft_id, v])), error: null, loaded: true })
    } catch (e) {
      if (!alive.current || mine !== seq.current) return
      setState(s => ({ map: s.map, error: e instanceof Error ? e.message : 'Could not read your verdicts.', loaded: s.loaded }))
    }
  }, [])
  useEffect(() => {
    alive.current = true
    if (!enabled) return () => { alive.current = false }
    let t: ReturnType<typeof setTimeout> | null = null
    const later = () => { if (t) clearTimeout(t); t = setTimeout(() => { t = null; void run() }, DEBOUNCE_MS) }
    const now = () => { void run() }
    void run()
    window.addEventListener('wb-rows-changed', later)
    window.addEventListener('focus', now)
    return () => {
      alive.current = false
      if (t) clearTimeout(t)
      window.removeEventListener('wb-rows-changed', later)
      window.removeEventListener('focus', now)
    }
  }, [enabled, run])
  return state
}
