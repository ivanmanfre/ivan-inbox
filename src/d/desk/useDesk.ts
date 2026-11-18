// The desk's state: the saved copy paints in the first render (src/lib/swr.ts, the
// DMs view's way), a live read reconciles behind it, realtime keeps it current,
// and a send draws Ivan's bubble plus a reserved answer bubble at once.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { currentUserId, readSwr, redactCapability, writeSwr } from '../../lib/swr'
import { cancelAction, commitAction, readJobs, readMessages, sendDesk, subscribeDesk, undoAction, warmDesk, type ActionResult } from './api'
import { MOCK_USER, mockOn } from './mock'
import {
  cacheable, mergeRows, newKey, olderThan, optimisticPair, patch,
  type DeskAttachment, type DeskMessage, type T3Job,
} from './model'

const CACHE_Q = 'desk:messages:v1'

export type DeskHandle = {
  messages: DeskMessage[]
  jobs: Record<string, T3Job>
  /** The saved copy was painted and the live read has not answered yet. */
  fromCache: boolean
  loaded: boolean
  readFailed: boolean
  busy: boolean
  send: (text: string, opts?: { attachments?: DeskAttachment[]; voice?: boolean; chip?: boolean }) => void
  retry: (m: DeskMessage) => void
  act: (kind: 'undo' | 'commit' | 'cancel', actionId: string) => Promise<ActionResult>
  reload: () => void
  /** When a held action was delivered live to THIS mounted desk (its countdown start), else null. */
  liveHoldStart: (actionId: string) => number | null
  /** The original send of a failed answer is loaded, so a retry can resend it. */
  canRetry: (m: DeskMessage) => boolean
}

// Held actions commit on the SERVER when the hold ends, unless Undo's compare-and-set wins first
// (content-desk 0d7edb6a). The desk only shows the countdown for holds a live turn delivered to this
// mount; nothing in the browser ever commits by itself.
/** Tests only: kept for the test files' resets; countdown starts are per mount. */
export function resetLiveHolds(): void { /* per-mount state: nothing global to clear */ }

function userId(): string | null {
  return mockOn() ? MOCK_USER : currentUserId()
}

function toCache(list: DeskMessage[]): DeskMessage[] {
  // A capability link never sits in localStorage (swr.ts rule 3): the body is stored with the link taken out.
  return cacheable(list).map(m => ({ ...m, body: redactCapability(m.body) ?? '' }))
}

export function useDesk(): DeskHandle {
  const uid = userId()
  const seed = useMemo(() => readSwr<DeskMessage[]>(CACHE_Q, uid)?.payload ?? null, [uid])
  const [messages, setMessages] = useState<DeskMessage[]>(() => seed ?? [])
  const [fromCache, setFromCache] = useState(!!seed)
  const [loaded, setLoaded] = useState(false)
  const [readFailed, setReadFailed] = useState(false)
  const [jobs, setJobs] = useState<Record<string, T3Job>>({})
  const [busy, setBusy] = useState(false)
  const [n, setN] = useState(0)
  const topic = `desk:${useId()}`
  const listRef = useRef(messages)
  listRef.current = messages
  // Countdown starts of holds a live turn delivered to this mount (display only).
  const liveHolds = useRef(new Map<string, number>())

  const apply = useCallback((fn: (l: DeskMessage[]) => DeskMessage[]) => {
    setMessages(prev => {
      const next = fn(prev)
      if (next !== prev) writeSwr(CACHE_Q, toCache(next), uid)
      return next
    })
  }, [uid])

  // Build the brief while Ivan reads and types.
  useEffect(() => { void warmDesk() }, [])

  // Stored rows this session merged while a history read was in flight (realtime, a turn's final
  // row, an action's answer, an acked user row): the snapshot may predate them, so they are merged
  // again on top of it and never erased (Sol desk-ui r1 #3).
  const sinceRead = useRef<Map<string, DeskMessage> | null>(null)
  const note = useCallback((rows: DeskMessage[]) => {
    const j = sinceRead.current
    if (!j) return
    for (const r of rows) {
      const have = j.get(r.id) ?? listRef.current.find(m => m.id === r.id && !m.local)
      if (have && olderThan(r, have)) continue // an older write never replaces a newer one in the journal
      j.set(r.id, r)
    }
  }, [])
  const mergeLive = useCallback((rows: DeskMessage[], drop?: (m: DeskMessage) => boolean) => {
    note(rows)
    apply(prev => mergeRows(drop ? prev.filter(m => !drop(m)) : prev, rows))
  }, [apply, note])
  // Sends that ended (final, error or a dropped socket): an unmatched 'sending' row for one of
  // these keys was never stored, so it shows "Not sent" with a retry (Sol desk-ui r1 #4).
  const ended = useRef(new Set<string>())

  // Live read: reconciles the saved copy (stored rows replace, local rows stay).
  useEffect(() => {
    let live = true
    sinceRead.current = new Map()
    readMessages().then(rows => {
      if (!live) return
      const late = [...(sinceRead.current?.values() ?? [])]
      sinceRead.current = null
      apply(prev => {
        // Stored rows replace the saved copy; a send still in flight (its bubble and its answer) stays.
        const open = new Set(prev.filter(m => m.answers).map(m => m.answers))
        let next = mergeRows(prev.filter(m => m.local || m.answers || (m.client_key && open.has(m.client_key))), rows)
        if (late.length) next = mergeRows(next, late)
        const stored = new Set(next.filter(m => !m.local && m.client_key).map(m => m.client_key))
        return next.map(m => ((m.local === 'sending' || m.local === 'unconfirmed') && m.client_key && ended.current.has(m.client_key) && !stored.has(m.client_key)
          ? { ...m, local: 'failed' as const, error: 'Not sent.' } : m))
      })
      setLoaded(true); setFromCache(false); setReadFailed(false)
    }, () => {
      if (!live) return
      sinceRead.current = null
      // The check could not reach the server: a send that ended without a confirmed row is not left on
      // "Sending"; it says it is unconfirmed and offers Check again and Retry (Sol desk-ui r2 #4).
      apply(prev => prev.map(m => (m.local === 'sending' && m.client_key && ended.current.has(m.client_key)
        ? { ...m, local: 'unconfirmed' as const, error: 'Not confirmed.' } : m)))
      setReadFailed(true); setLoaded(true)
    })
    return () => { live = false }
  }, [n, apply])

  // Jobs referenced by cards: read once each, then realtime keeps them.
  const jobIds = useMemo(() => [...new Set(messages.map(m => m.meta.t3_job?.id).filter((x): x is string => !!x))].sort().join(','), [messages])
  useEffect(() => {
    if (!jobIds) return
    let live = true
    readJobs(jobIds.split(',')).then(js => { if (live) setJobs(prev => ({ ...prev, ...Object.fromEntries(js.map(j => [j.id, j])) })) }, () => {})
    return () => { live = false }
    // n: a reconnect or a return to the app re-reads the jobs too, not only new job ids
  }, [jobIds, n])

  useEffect(() => {
    if (!uid) return
    return subscribeDesk(topic, uid, {
      message: m => mergeLive([m]),
      job: j => setJobs(prev => ({ ...prev, [j.id]: j })),
      resubscribed: () => setN(x => x + 1),
    })
  }, [uid, topic, mergeLive])

  // Coming back to the app re-reads: a proactive message may have landed while the phone was locked.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') setN(x => x + 1) }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const run = useCallback((text: string, key: string, opts: { attachments?: DeskAttachment[]; voice?: boolean; chip?: boolean }) => {
    setBusy(true)
    const phId = `stream:${key}`
    let acked = false
    void sendDesk({ text, client_key: key, ...opts }, {
      onAck: a => {
        acked = true
        // Journal the stored question NOW, not inside the queued state update: a stale history read
        // resolving in the same batch must not drop it (Sol desk-ui r3 #3).
        const mine = listRef.current.find(m => m.id === `local:${key}`)
        const stored: DeskMessage = {
          ...(mine ?? { role: 'user' as const, origin: 'operator' as const, body: text, status: 'done' as const, client_key: key, created_at: new Date().toISOString(),
            meta: { ...(opts.attachments?.length ? { attachments: opts.attachments } : {}), ...(opts.voice ? { voice: true } : {}) } }),
          id: a.user_message_id || `local:${key}`, local: undefined,
        }
        if (a.user_message_id) note([stored])
        apply(prev => patch(prev, `local:${key}`, m => ({ ...m, id: a.user_message_id || m.id, local: undefined })))
      },
      onDelta: t => setMessages(prev => patch(prev, phId, m => ({ ...m, body: m.body + t }))),
      onFinal: m => {
        // Holds delivered by this live turn are the only ones that may count down and commit.
        for (const x of m.meta.actions ?? []) if (x.state === 'held' && !liveHolds.current.has(x.id)) liveHolds.current.set(x.id, Date.now())
        mergeLive([m], x => x.id === phId)
      },
      onError: (_code, detail) => apply(prev => patch(
        patch(prev, `local:${key}`, m => ({ ...m, local: 'failed' })),
        phId, m => ({ ...m, status: 'error', body: '', error: detail ?? 'The desk did not answer. Tap to try again.' }),
      )),
    }).then(end => {
      setBusy(false)
      ended.current.add(key)
      // The socket dropped before the answer: the row is the truth, so drop the bubble and read it back
      // (realtime brings the answer too, whenever the function finishes writing it). A send that never
      // got its ack and has no stored row then shows "Not sent" with a retry.
      if (end === 'dropped') {
        setMessages(prev => prev.filter(m => m.id !== phId))
        setTimeout(() => setN(x => x + 1), acked ? 1200 : 300)
      }
    })
  }, [apply, note, mergeLive])

  const send = useCallback((text: string, opts: { attachments?: DeskAttachment[]; voice?: boolean; chip?: boolean } = {}) => {
    const t = text.trim()
    if (!t && !opts.attachments?.length) return
    const key = newKey()
    const meta = { ...(opts.attachments?.length ? { attachments: opts.attachments } : {}), ...(opts.voice ? { voice: true } : {}) }
    const [me, ph] = optimisticPair(t, key, new Date(), meta)
    setMessages(prev => [...prev, me, ph])
    run(t, key, opts)
  }, [run])

  const retry = useCallback((m: DeskMessage) => {
    // The send this failure belongs to: the placeholder's key, a stored error row's meta.client_key,
    // or the user row's own key (Sol desk-ui r1 #5).
    const key = m.answers ?? m.meta.client_key ?? m.client_key
    if (!key) return
    const asked = listRef.current.find(x => x.role === 'user' && x.client_key === key)
    if (!asked) return
    setMessages(prev => prev.filter(x => x !== asked && x !== m && x.id !== `stream:${key}` && x.id !== `local:${key}`))
    send(asked.body, { attachments: asked.meta.attachments, voice: asked.meta.voice })
  }, [send])

  const act = useCallback(async (kind: 'undo' | 'commit' | 'cancel', actionId: string) => {
    const r = await (kind === 'undo' ? undoAction(actionId) : kind === 'commit' ? commitAction(actionId) : cancelAction(actionId))
    if (r.message) mergeLive([r.message])
    // Lost a race (a cancel won, another tab committed): read the row back to show what really happened.
    if (!r.ok && (r.error === 'not_held' || r.error === 'nothing_to_undo')) setN(x => x + 1)
    return r
  }, [mergeLive])

  const canRetry = useCallback((m: DeskMessage) => {
    const key = m.answers ?? m.meta.client_key ?? m.client_key
    return !!key && listRef.current.some(x => x.role === 'user' && x.client_key === key)
  }, [])

  const reload = useCallback(() => setN(x => x + 1), [])
  const liveHoldStart = useCallback((id: string) => liveHolds.current.get(id) ?? null, [])
  return { messages, jobs, fromCache, loaded, readFailed, busy, send, retry, act, reload, liveHoldStart, canRetry }
}
