import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadReplySource, loadReplySources } from '../lib/replySources'
import type { Days, ReadState, ReplyMetrics, ReplyScope, SourceDetail } from '../lib/replySources'

// Credentials stay in memory. Only the generation enters the read identity.
function useScopeKey(scope: ReplyScope): string {
  const credential = scope.kind === 'board-token' ? scope.token : scope.kind === 'board-session' ? scope.session : ''
  const current = useRef({ credential, generation: 0 })
  if (current.current.credential !== credential) current.current = { credential, generation: current.current.generation + 1 }
  return JSON.stringify([scope.kind, scope.kind === 'operator' ? scope.clientId : null, scope.kind === 'operator' ? scope.campaignId : null, scope.kind === 'board-token' || scope.kind === 'board-session' ? scope.slug : null, current.current.generation])
}
function useReplyRead<T>(scope: ReplyScope, input: string | number, enabled: boolean, loader: () => Promise<ReadState<T>>): ReadState<T> {
  const scopeKey = useScopeKey(scope)
  const [auth, setAuth] = useState({ generation: 0, denied: false })
  const generation = useRef(0)
  const key = `${scopeKey}:${input}:${enabled}:${auth.generation}`
  const [read, setRead] = useState<{ key: string; state: ReadState<T> }>({ key: '', state: { kind: 'loading' } })
  useEffect(() => {
    if (scope.kind !== 'operator') return
    let firstAuthEvent = true
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const initial = firstAuthEvent
      firstAuthEvent = false
      // RPC auth awaits the SDK session initialization. Its first non-null initial
      // notification belongs to that same read, rather than a session change.
      if (initial && event === 'INITIAL_SESSION' && session && !auth.denied) return
      generation.current++ // Invalidate before React performs effect cleanup.
      setRead({ key: '', state: { kind: event === 'SIGNED_OUT' || !session ? 'denied' : 'loading' } })
      setAuth(a => ({ generation: a.generation + 1, denied: event === 'SIGNED_OUT' || !session }))
    })
    return () => data.subscription.unsubscribe()
  }, [scope.kind])
  useEffect(() => {
    if (!enabled || scope.kind === 'preview' || auth.denied && scope.kind === 'operator') return
    let live = true
    const request = ++generation.current
    setRead({ key, state: { kind: 'loading' } })
    void loader().then(state => { if (live && request === generation.current) setRead({ key, state }) })
    return () => { live = false }
    // key contains every request input, credential generation and auth generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  if (!enabled) return { kind: 'empty' }
  if (scope.kind === 'preview') return { kind: 'preview' }
  if (auth.denied && scope.kind === 'operator') return { kind: 'denied' }
  return read.key === key ? read.state : { kind: 'loading' }
}
export function useReplySources(scope: ReplyScope, days: Days): ReadState<ReplyMetrics> {
  return useReplyRead(scope, days, true, () => loadReplySources(scope, days))
}
export function useReplySource(scope: ReplyScope, prospectId: string, enabled: boolean): ReadState<SourceDetail> {
  return useReplyRead(scope, prospectId, enabled, () => loadReplySource(scope, prospectId))
}
