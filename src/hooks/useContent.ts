import { useCallback, useEffect, useId, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  bucketDrafts, fetchContentDrafts, fetchLaneProbe,
  type ContentBuckets, type ContentDraft, type ContentLane,
} from '../lib/content'

export function useContent(lane: ContentLane = 'ivan') {
  const [drafts, setDrafts] = useState<ContentDraft[]>([])
  const [buckets, setBuckets] = useState<ContentBuckets>(() => bucketDrafts([]))
  // matched = server-side exact count of the SAME filter, laneTotal = every row
  // in this lane. rows can be capped by PostgREST long before a header count
  // notices, and a filter bug that eats every row looks identical to an empty
  // board without laneTotal to compare against (D10 / blank-board #5).
  const [matched, setMatched] = useState<number | null>(null)
  const [laneTotal, setLaneTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  // Errors are surfaced, not swallowed to a calm empty list: an unreadable
  // board and an empty board must never render the same.
  const [error, setError] = useState<string | null>(null)

  // Every mount gets its own topic. supabase.channel() hands back the EXISTING
  // channel for a topic it already holds, so a second useContent() on screen
  // would bind postgres_changes to an already-subscribed channel — which throws
  // inside the effect and takes the whole tree down to a black screen (the
  // 754d32d fix, see useOps.ts). The lane is in the topic too, so the Ivan and
  // Rise views can be mounted side by side.
  const topic = `carousel_drafts:${lane}:${useId()}`

  const refresh = useCallback(() => {
    Promise.all([fetchContentDrafts(lane), fetchLaneProbe(lane)])
      .then(([page, probe]) => {
        setDrafts(page.rows)
        setBuckets(bucketDrafts(page.rows))
        setMatched(page.count ?? probe.scoped)
        setLaneTotal(probe.total)
        setError(null)
        setLoading(false)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'content unavailable')
        setLoading(false)
      })
  }, [lane])

  useEffect(() => {
    refresh()
    const ch = supabase.channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'carousel_drafts' }, refresh)
      .subscribe()
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => { supabase.removeChannel(ch); window.removeEventListener('focus', onFocus) }
  }, [refresh, topic])

  return { drafts, buckets, matched, laneTotal, loading, error, refresh }
}
