import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { emptyReadOverRows, fetchOpsDrafts, type OpsDraft } from '../lib/ops'
import { forget, recall, remember } from '../lib/pageMemo'
import { currentUserId } from '../lib/swr'

const MEMO = 'ops:drafts'
const DONE_HOLD_MS = 120_000
const doneAt = new Map<string, number>()
const visibleRows = (rows: OpsDraft[]) => {
  const user = currentUserId()
  if (!user) return rows
  const now = Date.now()
  return rows.filter(row => {
    const key = `${user}:${row.id}`
    const at = doneAt.get(key)
    if (at === undefined) return true
    if (now - at <= DONE_HOLD_MS) return false
    doneAt.delete(key)
    return true
  })
}

// W6-2: `enabled` (default true, so every existing caller keeps today's
// always-on behaviour) lets a shared shell defer the read until the surface
// that actually renders ops drafts is on screen, instead of paying for it on
// every route's boot `Promise.all`. `refresh` still works with `enabled:
// false` (a caller can always ask by hand); only the automatic fetch and the
// realtime subscription are gated.
export function useOps(enabled = true) {
  const [seed] = useState(() => recall<OpsDraft[]>(MEMO))
  const [drafts, setDrafts] = useState<OpsDraft[]>(() => visibleRows(seed?.value ?? []))
  const [loading, setLoading] = useState(true)
  // "Nothing waiting on you." and "this queue failed to load" are different
  // facts and must not render the same (U3). Callers that ignore `error` and
  // `loadedAt` behave exactly as before.
  const [error, setError] = useState<string | null>(null)
  const [loadedAt, setLoadedAt] = useState<string | null>(() => seed ? new Date(seed.at).toISOString() : null)
  const [saved, setSaved] = useState(Boolean(seed))
  // Every mount gets its own topic. supabase.channel() hands back the EXISTING
  // channel for a topic it already holds, so a second useOps() on screen would
  // bind postgres_changes to an already-subscribed channel — which throws inside
  // the effect and takes the whole tree down to a black screen. The shared
  // channel is also fatal on the way out: one consumer unmounting would
  // removeChannel() realtime out from under the other.
  const topic = `ops_drafts:${useId()}`
  // The rows on screen, read inside `refresh` without making it re-create.
  const shown = useRef<OpsDraft[]>(visibleRows(seed?.value ?? []))
  const refresh = useCallback(() => {
    fetchOpsDrafts().then(rows => {
      // Ivan's rule: an EMPTY result over a board that had rows is a failure,
      // never a cleared queue. Keep the last good rows and their stamp.
      if (emptyReadOverRows(shown.current, rows)) {
        setError('The ops read came back empty over a board that had cards.')
        setLoading(false)
        return
      }
      // A confirmed action stays off the board during the existing two-minute
      // hold, including when a revisit paints a saved copy before the DB catches up.
      const visible = visibleRows(rows)
      shown.current = visible
      setDrafts(visible)
      if (!remember(MEMO, rows) && rows.length === 0) {
        // Only a validated empty read after confirmed actions may replace a
        // previously non-empty saved queue.
        forget(MEMO)
        remember(MEMO, rows)
      }
      setError(null)
      setLoadedAt(new Date().toISOString())
      setSaved(false)
      setLoading(false)
    }).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : 'ops queue unavailable')
      setLoading(false)
    })
  }, [])
  const markDone = useCallback((id: string) => {
    const user = currentUserId()
    if (user) doneAt.set(`${user}:${id}`, Date.now())
    const visible = visibleRows(shown.current.filter(d => d.id !== id))
    shown.current = visible
    setDrafts(visible)
    // Keep the last validated read intact; the tombstone filters it on revisit.
  }, [])
  useEffect(() => {
    if (!enabled) { setLoading(false); return }
    refresh()
    const ch = supabase.channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ops_drafts' }, refresh)
      .subscribe()
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => { supabase.removeChannel(ch); window.removeEventListener('focus', onFocus) }
  }, [refresh, topic, enabled])
  return { drafts, loading, error, loadedAt, saved, refresh, markDone }
}
