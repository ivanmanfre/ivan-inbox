import { useCallback, useEffect, useId, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  bucketDrafts, groupByStage, fetchContentDrafts, fetchDraftDetail, fetchIdeaCandidates,
  fetchIdeaCounts, fetchLaneProbe, fetchScheduledQueue, splitIdeas,
  type ContentBuckets, type ContentDraft, type ContentDraftDetail, type ContentLane,
  type ContentStages, type IdeaCandidate, type IdeaCounts, type ScheduledQueueRow,
} from '../lib/content'
import { fetchAlerts, fetchDailySummaries, type AgentSummary } from '../lib/agent'
import { fetchResources, fetchStyleRoster, type Resource, type StylePrompt } from '../lib/styles'

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
  // Mattan views can be mounted side by side.
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

// ---------- the row sets the content section reads BESIDE the drafts ----------
//
// Each one is a plain fetch-on-mount with the same three-state discipline as
// useContent (error surfaced, loadedAt stamped only on success, empty ≠
// unreadable). None of them subscribes to realtime: a second postgres_changes
// binding per section is exactly the collision the useId() namespacing exists
// for, and none of these tables changes while Ivan is looking at it.

type Aux<T> = { rows: T; loading: boolean; error: string | null; loadedAt: string | null; refresh: () => void }

function useAux<T>(load: () => Promise<T>, initial: T, deps: unknown[]): Aux<T> {
  const [rows, setRows] = useState<T>(initial)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadedAt, setLoadedAt] = useState<string | null>(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps)
  const refresh = useCallback(() => {
    setLoading(true)
    run()
      .then(r => { setRows(r); setError(null); setLoadedAt(new Date().toISOString()); setLoading(false) })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'unavailable')
        setLoading(false)
      })
  }, [run])
  useEffect(() => { refresh() }, [refresh])
  return { rows, loading, error, loadedAt, refresh }
}

// R4 — the publish queue. 152 rows read by NOTHING in the shipped app; this is
// its first consumer. No lane argument and none needed: scheduled_posts has no
// client_id column, so it is Ivan's by construction (IA §2.3).
export function useScheduledQueue(enabled: boolean) {
  return useAux<ScheduledQueueRow[]>(
    () => (enabled ? fetchScheduledQueue() : Promise.resolve([])), [], [enabled])
}

// R7 — the Ideas stage. Also tenancy-column-less, also Ivan by construction.
//
// Phase 6 ask 3: the rows come back whole and are PARTITIONED by content_type
// here (splitIdeas), while the per-kind denominators come from their own
// count=exact head probes rather than from the partition — the page is capped
// at 500, and a proportion drawn off a capped page is the fabricated-figure
// failure D2 names. The two lanes each read one side of `split`; nothing is
// dropped, because `other` is a real bucket the posts lane renders.
const EMPTY_COUNTS: IdeaCounts = { total: null, post: null, lead_magnet: null, other: null }

export function useIdeaCandidates(enabled: boolean) {
  const [count, setCount] = useState<number | null>(null)
  const [counts, setCounts] = useState<IdeaCounts>(EMPTY_COUNTS)
  const aux = useAux<IdeaCandidate[]>(
    () => (enabled
      ? Promise.all([fetchIdeaCandidates(), fetchIdeaCounts()])
        .then(([p, c]) => { setCount(p.count); setCounts(c); return p.ideas })
      : Promise.resolve([])),
    [], [enabled])
  return { ...aux, count, counts, split: splitIdeas(aux.rows) }
}

// R6 — resources, now lane-scoped (the read change IA §7 names).
export function useResources(lane: ContentLane) {
  return useAux<Resource[]>(() => fetchResources(lane), [], [lane])
}

// R5 — the style roster. Shared registry (scope='shared'), rendered in both
// lanes; only the PREVIEWS are lane-scoped, and those are computed from the
// lane's already-loaded rows rather than fetched.
export function useStyleRoster() {
  return useAux<StylePrompt[]>(() => fetchStyleRoster(), [], [])
}

// R8/R9 — the two n8nclaw streams IA §6 places in Ivan's lane: the alert COUNT
// (every live row is outside the 14-day window, so the count is the whole
// story) and the daily summaries. Read-only; no ack, no send.
export function useAgentDigest(enabled: boolean) {
  const [olderUnsent, setOlderUnsent] = useState(0)
  const aux = useAux<AgentSummary[]>(
    () => (enabled
      ? Promise.all([fetchAlerts(), fetchDailySummaries()])
        .then(([alerts, summaries]) => { setOlderUnsent(alerts.olderUnsent); return summaries })
      : Promise.resolve([])),
    [], [enabled])
  return { ...aux, olderUnsent }
}
