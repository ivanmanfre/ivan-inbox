import { useEffect, useMemo, useRef, useState } from 'react'
import { BRAIN_INVALIDATED, type BrainInvalidation } from '../../../hooks/useBrainMembers'
import type { ContentDraft } from '../../../lib/content'
import { supabase } from '../../../lib/supabase'

// WHY REVIEW'S COUNTS JUMPED BETWEEN CLICKS (Ivan 2026-10-15: "the number of topics changes with every
// click I do"). Review's rows come from five reads that each refresh on their own: the week read and the
// four seat reads, again on every window focus, every `wb-rows-changed` (each approve, drop, skip, board
// write) and every realtime change anywhere in carousel_drafts. Every one of those refreshes FIRST strips
// the Content Brain member drafts (cb34_p2_member) and only puts them back once that read, or the member
// recheck behind it, answers. On 15 Oct that was 18 of the 74 drafts in review (Ivan 11, Arch 6, Rise 1),
// so the seat tabs, the heading and the open post's "N of M" drifted anywhere between 56 and 74 on each
// refresh, depending on which reads had landed.
//
// The fix keeps a member draft that was on screen in its place while it is being re-read, for at most
// HOLD_MS. Only member rows are held (an ordinary row that disappears is really gone). A held row drops at
// once on an explicit visibility event for it (BRAIN_INVALIDATED, cb34_p2_visibility_events) and every
// held row drops on an auth change, so a revoked release never lingers; a row the re-read does not bring
// back leaves when the hold runs out.
export const HOLD_MS = 30_000

type Seen = { row: ContentDraft; at: number }

export function steadyMerge(prev: ReadonlyMap<string, Seen>, rows: readonly ContentDraft[], t: number, revoked: ReadonlySet<string>): { rows: ContentDraft[]; held: Set<string>; next: Map<string, Seen> } {
  const next = new Map<string, Seen>()
  const present = new Set(rows.map(r => r.id))
  for (const r of rows) if (r.cb34_p2_member === true) next.set(r.id, { row: r, at: t })
  const held = new Set<string>()
  const extra: ContentDraft[] = []
  for (const [id, s] of prev) {
    if (present.has(id) || revoked.has(id) || t - s.at >= HOLD_MS) continue
    next.set(id, s)
    held.add(id)
    extra.push(s.row)
  }
  return { rows: extra.length ? [...rows, ...extra] : rows as ContentDraft[], held, next }
}

/** Review's rows with on-screen member drafts held through a re-read (see above). */
export function useSteadyRows(rows: ContentDraft[]): { rows: ContentDraft[]; held: ReadonlySet<string> } {
  const seen = useRef(new Map<string, Seen>())
  const revoked = useRef(new Set<string>())
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const onInvalid = (e: Event) => {
      const id = (e as CustomEvent<BrainInvalidation>).detail?.draftId
      if (!id || !seen.current.has(id)) return
      revoked.current.add(id); seen.current.delete(id); setTick(n => n + 1)
    }
    window.addEventListener(BRAIN_INVALIDATED, onInvalid)
    let sub: { unsubscribe: () => void } | null = null
    try {
      sub = supabase.auth?.onAuthStateChange?.((event: string) => {
        if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return
        seen.current = new Map(); setTick(n => n + 1)
      })?.data?.subscription ?? null
    } catch { sub = null }
    return () => { window.removeEventListener(BRAIN_INVALIDATED, onInvalid); sub?.unsubscribe() }
  }, [])
  const out = useMemo(() => {
    // A row that came back from a fresh read is no longer revoked.
    for (const r of rows) revoked.current.delete(r.id)
    const m = steadyMerge(seen.current, rows, Date.now(), revoked.current)
    seen.current = m.next
    return m
  }, [rows, tick])
  // A held row that never comes back leaves when its hold runs out.
  useEffect(() => {
    if (!out.held.size) return
    const t = setTimeout(() => setTick(n => n + 1), HOLD_MS + 50)
    return () => clearTimeout(t)
  }, [out])
  return { rows: out.rows, held: out.held }
}
