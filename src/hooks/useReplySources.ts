import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadReplySource, loadReplySources, snapshotFreshness, snapshotTime, SNAPSHOT_MAX_AGE_MS, SNAPSHOT_REFRESH_MS } from '../lib/replySources'
import type { Days, ReadState, ReplyMetrics, ReplyScope, SourceDetail } from '../lib/replySources'

// Credentials stay in memory. Only the generation enters the read identity.
function useScopeKey(scope: ReplyScope): string {
  const credential = scope.kind === 'board-token' ? scope.token : scope.kind === 'board-session' ? scope.session : ''
  const current = useRef({ credential, generation: 0 })
  if (current.current.credential !== credential) current.current = { credential, generation: current.current.generation + 1 }
  return JSON.stringify([scope.kind, scope.kind === 'operator' ? scope.clientId : null, scope.kind === 'operator' ? scope.campaignId : null, scope.kind === 'board-token' || scope.kind === 'board-session' ? scope.slug : null, current.current.generation])
}
const READ_INTERVAL_MS = 60000
function freshState<T extends { as_of: string }>(state: ReadState<T>): ReadState<T> {
  if (state.kind !== 'ready') return state
  const freshness = snapshotFreshness(state.data.as_of)
  if (freshness === 'unavailable') return { kind: 'unavailable' }
  return { kind: 'ready', data: state.data, ...(freshness === 'delayed' ? { delayed: true as const } : {}) }
}
function useReplyRead<T extends { as_of: string }>(scope: ReplyScope, input: string | number, enabled: boolean, loader: () => Promise<ReadState<T>>): ReadState<T> {
  const scopeKey = useScopeKey(scope)
  const [auth, setAuth] = useState({ generation: 0, denied: false })
  const generation = useRef(0)
  const key = `${scopeKey}:${input}:${enabled}:${auth.generation}`
  const [read, setRead] = useState<{ key: string; state: ReadState<T> }>({ key: '', state: { kind: 'loading' } })
  useEffect(() => {
    if (scope.kind !== 'operator') return
    let active = true
    let firstAuthEvent = true
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      const initial = firstAuthEvent
      firstAuthEvent = false
      // RPC auth awaits the SDK session initialization. Its first non-null initial
      // notification belongs to that same read, rather than a session change.
      if (initial && event === 'INITIAL_SESSION' && session && !auth.denied) return
      generation.current++ // Invalidate before React performs effect cleanup.
      setRead({ key: '', state: { kind: event === 'SIGNED_OUT' || !session ? 'denied' : 'loading' } })
      setAuth(a => ({ generation: a.generation + 1, denied: event === 'SIGNED_OUT' || !session }))
    })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [scope.kind])
  useEffect(() => {
    if (!enabled || scope.kind === 'preview' || auth.denied && scope.kind === 'operator') return
    let live = true, inFlight = false
    let lastAttempt: number | null = null
    setRead({ key, state: { kind: 'loading' } })
    const attempt = () => {
      // A visibility/focus event also enforces expiry if hidden-tab timers slept.
      setRead(current => current.key === key ? { key, state: freshState(current.state) } : current)
      if (!live || document.visibilityState !== 'visible' || inFlight || lastAttempt !== null && Date.now() - lastAttempt < READ_INTERVAL_MS) return
      lastAttempt = Date.now()
      inFlight = true
      const request = ++generation.current
      void loader().then(state => {
        if (live && request === generation.current) setRead({ key, state: freshState(state) })
      }).finally(() => { inFlight = false })
    }
    attempt()
    const interval = window.setInterval(attempt, READ_INTERVAL_MS)
    window.addEventListener('focus', attempt)
    document.addEventListener('visibilitychange', attempt)
    return () => {
      live = false
      generation.current++
      window.clearInterval(interval)
      window.removeEventListener('focus', attempt)
      document.removeEventListener('visibilitychange', attempt)
    }
    // key contains every request input, credential generation and auth generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  useEffect(() => {
    if (read.key !== key || read.state.kind !== 'ready') return
    const asOf = snapshotTime(read.state.data.as_of)
    const age = Date.now() - asOf
    const boundary = age <= SNAPSHOT_REFRESH_MS ? SNAPSHOT_REFRESH_MS : SNAPSHOT_MAX_AGE_MS
    const timeout = window.setTimeout(() => {
      setRead(current => current.key === key ? { key, state: freshState(current.state) } : current)
    }, Math.max(0, asOf + boundary + 1 - Date.now()))
    return () => window.clearTimeout(timeout)
  }, [key, read])
  if (!enabled) return { kind: 'empty' }
  if (scope.kind === 'preview') return { kind: 'preview' }
  if (auth.denied && scope.kind === 'operator') return { kind: 'denied' }
  return read.key === key ? freshState(read.state) : { kind: 'loading' }
}
export function useReplySources(scope: ReplyScope, days: Days): ReadState<ReplyMetrics> {
  return useReplyRead(scope, days, true, () => loadReplySources(scope, days))
}
export function useReplySource(scope: ReplyScope, prospectId: string, enabled: boolean): ReadState<SourceDetail> {
  return useReplyRead(scope, prospectId, enabled, () => loadReplySource(scope, prospectId))
}
