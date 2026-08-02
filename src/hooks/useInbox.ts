import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchMessages, groupThreads, type Thread } from '../lib/inbox'
import { playChime } from '../lib/chime'

// A burst of dispatcher writes (one row every ~2 min per active lane, plus
// phantom-duplicate bursts) used to trigger one full 20k-row re-page EACH.
// Realtime and focus refreshes are absorbed into a single trailing run: the
// first event schedules a refresh, every event inside the window rides on it.
// A caller-initiated refresh() (pull-to-refresh, a retry tap) is never delayed.
const COALESCE_MS = 1500

export function useInbox() {
  const [threads, setThreads] = useState<Thread[]>([])
  const [loading, setLoading] = useState(true)
  // A failed fetch and an empty inbox must never render the same (U2). Callers
  // that ignore `error` behave exactly as before.
  const [error, setError] = useState<string | null>(null)
  // When the last SUCCESSFUL load landed. An empty list with a fresh stamp is
  // "genuinely empty"; an empty list with no stamp at all is "never loaded".
  const [loadedAt, setLoadedAt] = useState<string | null>(null)
  // Newest inbound timestamp we've already seen — a refresh that surfaces an
  // inbound row newer than this plays the chime. Null until first load so the
  // initial fetch never dings.
  const newestInbound = useRef<string | null>(null)
  // Every mount gets its own topic. supabase.channel() hands back the EXISTING
  // channel for a topic it already holds, so a second useInbox() on screen
  // would bind postgres_changes to an already-subscribed channel — which throws
  // inside the effect and takes the whole tree down to a black screen. This
  // hook was the one exception to the rule every other hook follows
  // (useOps.ts:8-15, useContent.ts:28-35, useAgent.ts:21-26); it no longer is.
  const topic = `inbox:${useId()}`
  const refresh = useCallback(() => {
    fetchMessages().then(rows => {
      const latest = rows
        .filter(m => m.direction === 'inbound')
        .map(m => m.created_at).sort().at(-1) ?? null
      if (latest && newestInbound.current && latest > newestInbound.current) playChime()
      if (latest) newestInbound.current = latest
      setThreads(groupThreads(rows))
      setError(null)
      setLoadedAt(new Date().toISOString())
      setLoading(false)
    }).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : 'inbox unavailable')
      setLoading(false)
    })
  }, [])
  const pending = useRef<number | null>(null)
  useEffect(() => {
    refresh()
    // Trailing-edge coalesce: while a refresh is already scheduled, further
    // events are dropped rather than queued.
    const nudge = () => {
      if (pending.current !== null) return
      pending.current = window.setTimeout(() => { pending.current = null; refresh() }, COALESCE_MS)
    }
    const ch = supabase.channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outreach_messages' }, nudge)
      .subscribe()
    window.addEventListener('focus', nudge)
    return () => {
      if (pending.current !== null) { clearTimeout(pending.current); pending.current = null }
      supabase.removeChannel(ch)
      window.removeEventListener('focus', nudge)
    }
  }, [refresh, topic])
  return { threads, loading, error, loadedAt, refresh }
}
