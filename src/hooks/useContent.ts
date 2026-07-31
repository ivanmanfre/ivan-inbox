import { useCallback, useEffect, useId, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  bucketDrafts, groupByStage, fetchContentDrafts, fetchDraftDetail, fetchLaneProbe,
  type ContentBuckets, type ContentDraft, type ContentDraftDetail, type ContentLane,
  type ContentStages,
} from '../lib/content'

export function useContent(lane: ContentLane = 'ivan') {
  const [drafts, setDrafts] = useState<ContentDraft[]>([])
  const [buckets, setBuckets] = useState<ContentBuckets>(() => bucketDrafts([]))
  // The same rows grouped a second way: triage (buckets) for the candidates
  // that render "what needs me", lifecycle (stages) for the pipeline queue.
  // Both are derived from ONE fetch — adding the second grouping costs a pass
  // over an already-loaded array, not a second round trip.
  const [stages, setStages] = useState<ContentStages>(() => groupByStage([]))
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
  // When the last SUCCESSFUL read landed. An empty board with a fresh stamp is
  // confirmed empty; an empty board with no stamp has never been read at all.
  const [loadedAt, setLoadedAt] = useState<string | null>(null)

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
        setStages(groupByStage(page.rows))
        setMatched(page.count ?? probe.scoped)
        setLaneTotal(probe.total)
        setError(null)
        setLoadedAt(new Date().toISOString())
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

  // `buckets` stays first and unchanged in the shape — cand-b destructures it.
  return { drafts, buckets, stages, matched, laneTotal, loading, error, loadedAt, refresh }
}

// One full row, fetched only when a card is opened. Deliberately NOT realtime-
// subscribed: the list hook above already re-fetches on any carousel_drafts
// change and passes a new id/refresh down, and a second postgres_changes
// binding per opened draft is exactly the collision the 754d32d fix exists for.
//
// `missing` is its own state, separate from `error`: a draft that was deleted
// while the queue was open and a draft that couldn't be READ are different
// facts, and D10 forbids rendering them the same way.
export function useDraftDetail(id: string | null, reloadKey: unknown = 0) {
  const [detail, setDetail] = useState<ContentDraftDetail | null>(null)
  const [missing, setMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let live = true
    setLoading(true)
    fetchDraftDetail(id)
      .then(row => {
        if (!live) return
        setDetail(row)
        setMissing(row === null)
        setError(null)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (!live) return
        setError(e instanceof Error ? e.message : 'draft unavailable')
        setLoading(false)
      })
    return () => { live = false }
  }, [id, reloadKey])

  return { detail, missing, loading, error }
}
