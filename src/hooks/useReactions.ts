import { useCallback, useEffect, useState } from 'react'
import {
  approveReaction, canApprove, fetchOccupiedDays, fetchReactionDesk, killReaction,
  nextFreeSlot, type ReactionRow,
} from '../lib/reactions'

// The reaction desk's state.
//
// Like the Strategy tab and unlike every other content hook, this one holds
// text Ivan is typing. So: no realtime channel and no focus refetch — a refresh
// while he is mid-sentence would replace the textarea with the version the
// server saw BEFORE that sentence. Refresh is manual only.
//
// Bodies are kept in a map keyed by candidate id rather than on the row, so a
// manual refresh can replace the rows without discarding takes he has already
// written for the ones that survive.

// 🔴 A PostgREST failure is NOT an Error instance — supabase-js throws a plain
// `{message, code, details}`. An `e instanceof Error` check therefore swallows
// the only sentence that says what broke: selecting a non-existent column
// rendered as the useless "reaction desk unavailable" until this existed.
function errText(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>
    const msg = typeof o.message === 'string' ? o.message : null
    const code = typeof o.code === 'string' ? o.code : null
    if (msg) return code ? `${msg} (${code})` : msg
  }
  return fallback
}
export function useReactions(enabled: boolean) {
  const [rows, setRows] = useState<ReactionRow[]>([])
  const [bodies, setBodies] = useState<Record<string, string>>({})
  const [occupied, setOccupied] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [done, setDone] = useState<{ id: string; scheduledAt: string } | null>(null)

  const refresh = useCallback(() => {
    if (!enabled) return
    setLoading(true)
    Promise.all([fetchReactionDesk(), fetchOccupiedDays()])
      .then(([r, days]) => {
        setRows(r)
        setOccupied(days)
        setError(null)
      })
      .catch((e: unknown) => setError(errText(e, 'reaction desk unavailable')))
      .finally(() => setLoading(false))
  }, [enabled])

  useEffect(() => { refresh() }, [refresh])

  const setBody = useCallback((id: string, body: string) => {
    setBodies(b => ({ ...b, [id]: body }))
  }, [])

  const kill = useCallback(async (id: string) => {
    setBusy(id)
    setActionError(null)
    try {
      await killReaction(id)
      // Drop it locally rather than refetching: the row is gone by definition,
      // and a refetch here would throw away the other bodies in flight.
      setRows(rs => rs.filter(r => r.id !== id))
    } catch (e: unknown) {
      setActionError(errText(e, 'kill failed'))
    } finally {
      setBusy(null)
    }
  }, [])

  const approve = useCallback(async (row: ReactionRow) => {
    const body = bodies[row.id] ?? ''
    if (!canApprove(body)) return
    setBusy(row.id)
    setActionError(null)
    try {
      // The slot is computed at approve time, not at render time: two approvals
      // in one sitting must not both claim the same day.
      const at = nextFreeSlot(occupied, new Date())
      const res = await approveReaction(row, body, at)
      setOccupied(o => [...o, res.scheduledAt.slice(0, 10)])
      setRows(rs => rs.filter(r => r.id !== row.id))
      setDone({ id: row.id, scheduledAt: res.scheduledAt })
    } catch (e: unknown) {
      setActionError(errText(e, 'approve failed'))
    } finally {
      setBusy(null)
    }
  }, [bodies, occupied])

  return {
    rows, bodies, loading, error, busy, actionError, done,
    setBody, kill, approve, refresh,
    // Shown next to the button so the day is visible BEFORE the click, not
    // reported after it.
    nextSlot: nextFreeSlot(occupied, new Date()),
  }
}
