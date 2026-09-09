import { useCallback, useEffect, useState } from 'react'
import { fetchAudienceSummary, type AudienceSummary } from '../lib/audience'
import type { ContentLane } from '../lib/content'

/* The Strategy tab's audience block (W16).

   READ-ONLY and deliberately dumb about refresh: no realtime channel, no
   focus refetch. The block sits under a text editor Ivan is typing into, and
   a background refetch that re-renders half the screen mid-sentence is the
   behaviour `useStrategy` already refuses for the same reason. It loads on a
   lane change and on the manual refresh, and nothing else.

   Hooks are declared unconditionally at the top of the function, and the
   component that calls this one mounts it above every early return. That is
   not style: a hook placed after `if (st.error) return` blanked every DM
   conversation in this app for about an hour on 2026-09-09. */
export function useAudience(lane: ContentLane) {
  const [summary, setSummary] = useState<AudienceSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // When the last read LANDED — not when it was asked for. An empty block with
  // a fresh stamp is confirmed empty; one with no stamp has never been read.
  const [loadedAt, setLoadedAt] = useState<string | null>(null)

  const refresh = useCallback(() => {
    let live = true
    setLoading(true)
    // DEV ONLY. The audn_* views are not deployed, so the live app can only
    // ever render `unavailable`. `?audnFixture=1` swaps in the census-shaped
    // fixture so the `normal` layout can actually be looked at on a phone.
    // The guard is a compile-time constant in a production build, so Rollup
    // drops the branch and never emits the fixture chunk.
    if (import.meta.env.DEV && typeof window !== 'undefined'
      && new URLSearchParams(window.location.search).get('audnFixture') === '1') {
      void import('../lib/audience.fixtures').then(m => {
        if (!live) return
        setSummary(m.fixtureSummary(lane))
        setError(null)
        setLoadedAt(new Date().toISOString())
        setLoading(false)
      })
      return () => { live = false }
    }
    fetchAudienceSummary(lane)
      .then(s => {
        if (!live) return
        setSummary(s)
        setError(null)
        setLoadedAt(new Date().toISOString())
        setLoading(false)
      })
      .catch((e: unknown) => {
        // fetchAudienceSummary soft-fails every source into the summary, so
        // reaching this is a bug in this module rather than a missing view —
        // it still has to be SHOWN, never swallowed into an empty block.
        if (!live) return
        setError(e instanceof Error ? e.message : 'audience unavailable')
        setLoading(false)
      })
    return () => { live = false }
  }, [lane])

  // A lane switch during an in-flight read must not let the old lane's rows
  // land under the new lane's label, so the effect's cleanup disowns them.
  useEffect(() => refresh(), [refresh])

  return { summary, state: summary?.state ?? null, error, loading, loadedAt, refresh }
}
