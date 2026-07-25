import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BriefAuthError, asBrief, asCounts, fetchBrief, isCountsShape, readCache, writeCache,
  fetchReplyCounts, type Brief, type BriefCounts, type ReplyCount,
} from '../lib/today'
import {
  fetchAccept, fetchGovernor, fetchPipeline,
  type AcceptRow, type GovernorRow, type PipelineRow,
} from '../lib/kpis'

export type TodayHealth = {
  accept: AcceptRow[]
  pipeline: PipelineRow[]
  governor: GovernorRow[]
  replies: ReplyCount[]
}

export type TodayState = {
  // Server scalars — the first thing that paints (counts mode is fast; the
  // full payload runs n8n REST inside and takes ~12s).
  counts: BriefCounts | null
  // Full payload. May be the localStorage projection (fromCache) rather than a
  // live fetch.
  brief: Brief | null
  fromCache: boolean
  // The full call came back in the counts shape — i.e. this session was
  // degraded to anon by the edge fn's auth gating. Render the strip, say so.
  degraded: boolean
  cachedAt: string | null
  loading: boolean
  refreshing: boolean
  error: string | null
  authError: boolean
  health: TodayHealth | null
  // Returns the in-flight run so pull-to-refresh can hold its spinner.
  refresh: () => Promise<void>
}

// A focus refresh cheaper than this often is just noise — the full brief is a
// ~12s call with an n8n round-trip inside it.
const FOCUS_THROTTLE_MS = 60_000

export function useToday(): TodayState {
  // (1) Paint from cache synchronously, before any network call.
  const cached = useMemo(() => readCache(), [])
  const [brief, setBrief] = useState<Brief | null>(cached?.brief ?? null)
  const [counts, setCounts] = useState<BriefCounts | null>(null)
  const [fromCache, setFromCache] = useState(cached != null)
  const [cachedAt, setCachedAt] = useState<string | null>(cached?.fetched_at ?? null)
  const [degraded, setDegraded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [authError, setAuthError] = useState(false)
  const [health, setHealth] = useState<TodayHealth | null>(null)

  const alive = useRef(true)
  const lastRun = useRef(0)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const refresh = useCallback(() => {
    lastRun.current = Date.now()
    setRefreshing(true)
    setError(null)

    // (2) counts mode — fast scalars for the top strip.
    const countsRun = fetchBrief('counts')
      .then(json => {
        const c = asCounts(json)
        if (c && alive.current) setCounts(c)
      })
      .catch(() => { /* the full call below reports the real failure */ })

    // (3) full payload — hydrates the zones and refreshes the cache.
    const fullRun = fetchBrief('full')
      .then(json => {
        if (!alive.current) return
        if (isCountsShape(json)) {
          // Auth-gated to anon: counts only. Keep whatever brief we already
          // have (cache) and mark the screen degraded instead of blanking it.
          const c = asCounts(json)
          if (c) setCounts(c)
          setDegraded(true)
          return
        }
        const b = asBrief(json)
        if (!b) throw new Error('Unexpected brief shape')
        setBrief(b)
        setFromCache(false)
        setDegraded(false)
        setAuthError(false)
        setCachedAt(new Date().toISOString())
        writeCache(b)
      })
      .catch((e: unknown) => {
        if (!alive.current) return
        if (e instanceof BriefAuthError) setAuthError(true)
        setError(e instanceof Error ? e.message : 'Could not load the brief')
      })

    // Health strip: same views the Sends overview reads, client-side only.
    const healthRun = Promise.all([
      fetchAccept(), fetchPipeline(), fetchGovernor(), fetchReplyCounts(),
    ])
      .then(([accept, pipeline, governor, replies]) => {
        if (alive.current) setHealth({ accept, pipeline, governor, replies })
      })
      .catch(() => { /* health is additive — never blocks the zones */ })

    return Promise.all([countsRun, fullRun, healthRun]).then(() => {
      if (!alive.current) return
      setRefreshing(false)
      setLoaded(true)
    })
  }, [])

  useEffect(() => {
    refresh()
    const onFocus = () => {
      if (Date.now() - lastRun.current > FOCUS_THROTTLE_MS) refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  return {
    counts, brief, fromCache, degraded, cachedAt,
    loading: !loaded && counts === null && brief === null,
    refreshing, error, authError, health,
    refresh,
  }
}
