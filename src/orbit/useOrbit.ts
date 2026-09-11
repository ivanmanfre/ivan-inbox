// src/orbit/useOrbit.ts — data hook for the Orbit shell.
//
// SWR-seeded (src/lib/swr.ts): the last reconciled graph for THIS tenant+range
// paints synchronously on mount, then a live RPC read replaces it behind the
// scene — same "never cache a failure, cache the reconciled state" contract
// every other hook in this app follows (src/hooks/useInbox.ts).
//
// Polls every 60s while the tab is visible, and takes a coalesced (1.5s)
// nudge off the existing outreach_messages realtime channel — its own topic
// per mount (useInbox.ts:129's rule: a second subscription on one topic
// throws and blacks out the tree). `prev` holds exactly one poll back, for
// OrbitCanvas's diff animations (arrivals, stage moves, fresh pulses).

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { readSwr, writeSwr } from '../lib/swr'
import { rangeOf, type OrbitFilters } from './filters'
import type { OrbitGraph, OrbitTenant } from './types'

const POLL_MS = 60_000
const COALESCE_MS = 1500

// Dev-only fixture escape hatch (?fixture=1), so a phone-viewport screenshot
// can be taken without a logged-in operator session — signal_graph is
// SECURITY DEFINER and 401s anon.
//
// 🔴 The fixture is FETCHED at runtime from a gitignored folder outside src/, never imported.
// A `await import('./__dev__/x.json')` behind an `import.meta.env.DEV` guard is NOT stripped:
// Vite still emits the JSON as its own chunk, and this repo's PWA precaches every chunk. On
// 2026-09-11 that put 2.0 MB of real prospect data — names, companies, message text for 1,125
// people — into `dist/assets/` on a PUBLIC GitHub Pages origin, downloaded by every visitor.
// The guard hid the code path, not the payload. Keep the fixture out of the module graph.
function fixtureRequested(): boolean {
  if (!import.meta.env.DEV) return false
  try { return new URLSearchParams(location.search).get('fixture') === '1' } catch { return false }
}

async function loadFixture(tenant: OrbitTenant): Promise<OrbitGraph | null> {
  if (!import.meta.env.DEV) return null
  try {
    // `orbit-fixtures/` sits at the repo root, is gitignored, and is not `public/`, so Vite's
    // dev server serves it while a production build never sees it.
    const name = tenant === 'risedtc' ? 'risedtc-30d.json' : 'ivan-30d.json' // arch: ivan stands in
    const res = await fetch(`/orbit-fixtures/${name}`)
    if (!res.ok) return null
    return (await res.json()) as OrbitGraph
  } catch {
    return null
  }
}

function graphQuery(tenant: OrbitTenant, from: string, to: string): string {
  return `orbit:${tenant}:${from}:${to}`
}

async function fetchGraph(tenant: OrbitTenant, from: string, to: string): Promise<OrbitGraph> {
  if (fixtureRequested()) {
    const fx = await loadFixture(tenant)
    if (fx) return fx
  }
  const { data, error } = await supabase.rpc('signal_graph', { p_client: tenant, p_from: from, p_to: to })
  if (error) throw error
  if (!data) throw new Error('signal_graph returned nothing')
  return data as OrbitGraph
}

export interface UseOrbitResult {
  graph: OrbitGraph | null
  prev: OrbitGraph | null
  loading: boolean
  error: string | null
  loadedAt: string | null
  refresh: () => void
}

export function useOrbit(filters: OrbitFilters): UseOrbitResult {
  const { from, to } = rangeOf(filters)
  const tenant = filters.tenant
  const query = graphQuery(tenant, from, to)

  // Kept in a ref (not state) so `refresh` can stay a permanently stable
  // callback — required for the realtime channel below, which must not
  // resubscribe (and therefore not churn) on every tenant/range change.
  const paramsRef = useRef({ tenant, from, to, query })
  paramsRef.current = { tenant, from, to, query }

  const [graph, setGraph] = useState<OrbitGraph | null>(() => readSwr<OrbitGraph>(query)?.payload ?? null)
  const [prev, setPrev] = useState<OrbitGraph | null>(null)
  const [loading, setLoading] = useState<boolean>(() => readSwr<OrbitGraph>(query) == null)
  const [error, setError] = useState<string | null>(null)
  const [loadedAt, setLoadedAt] = useState<string | null>(null)

  // The query this component is currently SEEDED/PAINTED for. When the shell
  // switches tenant or date range, this effect reseeds synchronously from
  // that query's own cache (never the previous tenant's graph) before the
  // live fetch below replaces it.
  const seededQuery = useRef(query)
  const prevGraphRef = useRef<OrbitGraph | null>(null)
  useEffect(() => {
    if (seededQuery.current === query) return
    seededQuery.current = query
    prevGraphRef.current = null
    const seed = readSwr<OrbitGraph>(query)
    setGraph(seed?.payload ?? null)
    setPrev(null)
    setLoading(seed == null)
    setError(null)
    setLoadedAt(null)
  }, [query])

  const refresh = useCallback(() => {
    const { tenant: t, from: f, to: tt, query: q } = paramsRef.current
    fetchGraph(t, f, tt).then(g => {
      // A response for a tenant/range the shell has already left — drop it,
      // rather than let a slow request for the OLD tenant overwrite the new
      // one's just-seeded paint.
      if (paramsRef.current.query !== q) return
      setPrev(prevGraphRef.current)
      prevGraphRef.current = g
      setGraph(g)
      setError(null)
      setLoadedAt(new Date().toISOString())
      setLoading(false)
      // Never cache a dev fixture read as if it were the reconciled live state.
      if (!fixtureRequested()) writeSwr(q, g)
    }).catch((e: unknown) => {
      if (paramsRef.current.query !== q) return
      setError(e instanceof Error ? e.message : 'the orbit graph did not load')
      setLoading(false)
    })
  }, [])

  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  // Fetch on mount AND every time the tenant/range actually changes.
  useEffect(() => { refreshRef.current() }, [query])

  // Poll + realtime, on a topic bound ONCE per mount (never re-subscribed on
  // a tenant/range change) — the exact discipline useInbox.ts:129 documents.
  const topic = `orbit:${useId()}`
  const pending = useRef<number | null>(null)
  useEffect(() => {
    const iv = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshRef.current()
    }, POLL_MS)
    const nudge = () => {
      if (pending.current !== null) return
      pending.current = window.setTimeout(() => { pending.current = null; refreshRef.current() }, COALESCE_MS)
    }
    const ch = supabase.channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outreach_messages' }, nudge)
      .subscribe()
    return () => {
      window.clearInterval(iv)
      if (pending.current !== null) { window.clearTimeout(pending.current); pending.current = null }
      supabase.removeChannel(ch)
    }
  }, [topic])

  return { graph, prev, loading, error, loadedAt, refresh }
}
