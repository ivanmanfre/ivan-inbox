import { useCallback, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { parseFastFrame, splitSseBuffer } from './live'
import { buildPreReadMessages, parsePreRead, type PreReadThread } from './preread'

// The pre-read's only moving part. Everything it decides is in preread.ts; this
// hook is the request and the cache.
//
// 🔴 THREE GUARDS, and each one is here because the alternative is a bill:
//
//   · `run` is only ever called from a click handler. Nothing in this file is
//     an effect, so there is no render path that can start a call.
//   · ONE call at a time. A run while another is in flight is refused, so a
//     fast hand on a 58-row list cannot open 58 requests.
//   · A SESSION CAP. Past it the control says so instead of spending more.
//     Reloading clears it, which is a deliberate speed bump and not a lock.
//
// The transport is the EXISTING inbox-fast function, unchanged and undeployed
// by this run. It relays Anthropic's own stream, which live.ts already knows
// how to read, so there is no second parser to drift.

const FAST_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/inbox-fast`

export const PREREAD_SESSION_CAP = 40

export type PreReadState =
  | { s: 'none' }
  | { s: 'running' }
  | { s: 'done'; line: string }
  | { s: 'error'; why: string }

export type PreReadHandle = {
  get: (id: string) => PreReadState
  run: (t: PreReadThread) => void
  busy: boolean
  spent: number
  capped: boolean
}

export function usePreRead(): PreReadHandle {
  const [byId, setById] = useState<Record<string, PreReadState>>({})
  const [spent, setSpent] = useState(0)
  const inFlight = useRef(false)

  const run = useCallback((t: PreReadThread) => {
    if (inFlight.current) return
    if (byId[t.prospect_id]?.s === 'done') return
    if (spent >= PREREAD_SESSION_CAP) {
      setById(m => ({ ...m, [t.prospect_id]: { s: 'error', why: 'Enough for one sitting. Reload to read more.' } }))
      return
    }
    inFlight.current = true
    setById(m => ({ ...m, [t.prospect_id]: { s: 'running' } }))
    setSpent(n => n + 1)
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession()
        const jwt = data.session?.access_token
        if (!jwt) throw new Error('Sign in again to read this')
        const res = await fetch(FAST_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: buildPreReadMessages(t) }),
        })
        if (!res.ok || !res.body) throw new Error(`The summary service answered ${res.status}`)
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        let raw = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const { frames, rest } = splitSseBuffer(buf)
          buf = rest
          for (const f of frames) {
            const ev = parseFastFrame(f)
            if (ev.kind === 'delta') raw += ev.text
            else if (ev.kind === 'error') throw new Error(ev.detail)
          }
        }
        const line = parsePreRead(raw)
        setById(m => ({
          ...m,
          // An empty answer is reported as an empty answer. Printing a
          // confident-looking blank would be the worst outcome of the three.
          [t.prospect_id]: line
            ? { s: 'done', line }
            : { s: 'error', why: 'Nothing came back' },
        }))
      } catch (e) {
        setById(m => ({
          ...m,
          [t.prospect_id]: { s: 'error', why: e instanceof Error ? e.message : 'That did not work' },
        }))
      } finally {
        inFlight.current = false
      }
    })()
  }, [byId, spent])

  const get = useCallback((id: string): PreReadState => byId[id] ?? { s: 'none' }, [byId])

  return { get, run, busy: inFlight.current, spent, capped: spent >= PREREAD_SESSION_CAP }
}
