// The desk's state: the saved copy paints in the first render (src/lib/swr.ts, the
// DMs view's way), a live read reconciles behind it, realtime keeps it current,
// and a send draws Ivan's bubble plus a reserved answer bubble at once.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { currentUserId, readSwr, redactCapability, writeSwr } from '../../lib/swr'
import { cancelAction, commitAction, readJobs, readMessages, sendDesk, subscribeDesk, undoAction, type ActionResult } from './api'
import { MOCK_USER, mockOn } from './mock'
import {
  cacheable, mergeRows, newKey, optimisticPair, patch,
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
}

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

  const apply = useCallback((fn: (l: DeskMessage[]) => DeskMessage[]) => {
    setMessages(prev => {
      const next = fn(prev)
      if (next !== prev) writeSwr(CACHE_Q, toCache(next), uid)
      return next
    })
  }, [uid])

  // Live read: reconciles the saved copy (stored rows replace, local rows stay).
  useEffect(() => {
    let live = true
    readMessages().then(rows => {
      if (!live) return
      // Stored rows replace the saved copy; a send still in flight (its bubble and its answer) stays.
      apply(prev => {
        const open = new Set(prev.filter(m => m.answers).map(m => m.answers))
        return mergeRows(prev.filter(m => m.local || m.answers || (m.client_key && open.has(m.client_key))), rows)
      })
      setLoaded(true); setFromCache(false); setReadFailed(false)
    }, () => { if (live) { setReadFailed(true); setLoaded(true) } })
    return () => { live = false }
  }, [n, apply])

  // Jobs referenced by cards: read once each, then realtime keeps them.
  const jobIds = useMemo(() => [...new Set(messages.map(m => m.meta.t3_job?.id).filter((x): x is string => !!x))].sort().join(','), [messages])
  useEffect(() => {
    if (!jobIds) return
    let live = true
    readJobs(jobIds.split(',')).then(js => { if (live) setJobs(prev => ({ ...prev, ...Object.fromEntries(js.map(j => [j.id, j])) })) }, () => {})
    return () => { live = false }
  }, [jobIds])

  useEffect(() => {
    if (!uid) return
    return subscribeDesk(topic, uid, {
      message: m => apply(prev => mergeRows(prev, [m])),
      job: j => setJobs(prev => ({ ...prev, [j.id]: j })),
      resubscribed: () => setN(x => x + 1),
    })
  }, [uid, topic, apply])

  // Coming back to the app re-reads: a proactive message may have landed while the phone was locked.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') setN(x => x + 1) }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const run = useCallback((text: string, key: string, opts: { attachments?: DeskAttachment[]; voice?: boolean; chip?: boolean }) => {
    setBusy(true)
    const phId = `stream:${key}`
    void sendDesk({ text, client_key: key, ...opts }, {
      onAck: a => apply(prev => patch(prev, `local:${key}`, m => ({ ...m, id: a.user_message_id || m.id, local: undefined }))),
      onDelta: t => setMessages(prev => patch(prev, phId, m => ({ ...m, body: m.body + t }))),
      onFinal: m => apply(prev => mergeRows(prev.filter(x => x.id !== phId), [m])),
      onError: (_code, detail) => apply(prev => patch(
        patch(prev, `local:${key}`, m => ({ ...m, local: 'failed' })),
        phId, m => ({ ...m, status: 'error', body: '', error: detail ?? 'The desk did not answer. Tap to try again.' }),
      )),
    }).then(end => {
      setBusy(false)
      // The socket dropped before the answer: the row is the truth, so drop the bubble and read it back
      // (realtime brings the answer too, whenever the function finishes writing it).
      if (end === 'dropped') { setMessages(prev => prev.filter(m => m.id !== phId)); setTimeout(() => setN(x => x + 1), 1200) }
    })
  }, [apply])

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
    const key = m.answers ?? m.client_key
    const asked = listRef.current.find(x => x.role === 'user' && x.client_key === key)
    if (!asked) return
    setMessages(prev => prev.filter(x => x !== asked && x.id !== `stream:${key}` && x.id !== `local:${key}`))
    send(asked.body, { attachments: asked.meta.attachments, voice: asked.meta.voice })
  }, [send])

  const act = useCallback(async (kind: 'undo' | 'commit' | 'cancel', actionId: string) => {
    const r = await (kind === 'undo' ? undoAction(actionId) : kind === 'commit' ? commitAction(actionId) : cancelAction(actionId))
    if (r.message) apply(prev => mergeRows(prev, [r.message!]))
    return r
  }, [apply])

  const reload = useCallback(() => setN(x => x + 1), [])
  return { messages, jobs, fromCache, loaded, readFailed, busy, send, retry, act, reload }
}
