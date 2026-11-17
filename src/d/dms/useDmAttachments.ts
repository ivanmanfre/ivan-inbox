import { useEffect, useMemo, useRef, useState } from 'react'
import type { Thread } from '../../lib/inbox'
import { fetchDmAttachments, type DmAttachments, type DmFile } from '../../lib/dmAttachments'

// The last read per person, in memory only (the links are signed and short-lived: never a saved copy).
// `at` is when the read STARTED.
const cache = new Map<string, { key: string; data: DmAttachments; at: number }>()
// The read under way per person: a pane that is closed and opened again joins it, it never starts a second.
const pending = new Map<string, { key: string; at: number; p: Promise<DmAttachments> }>()
const FRESH_MS = 60_000
/** Read again this long before the links run out, so a chip on a thread left open still opens. */
const RENEW_BEFORE_MS = 5 * 60_000
/** A failed read with files on screen is tried again this often, this many times, then left alone. */
const RETRY_MS = 60_000
const MAX_RETRIES = 4

/** Test seam. */
export function clearDmAttachmentsCache() { cache.clear(); pending.clear() }

/** Room for this device's clock against the clock that stamped the message. */
const CLOCK_SLACK_MS = 2 * 60_000

/**
 * A read answers for every message that was on the chat when it started. So when the newest message here
 * moves to one sent before that read began (the rest of the conversation landing after its first rows),
 * the read already covers it: only a message sent after the read started needs another one.
 */
function covers(read: { key: string; at: number }, key: string, newest: number): boolean {
  return read.key === key || newest < read.at - CLOCK_SLACK_MS
}

function readOnce(pid: string, key: string, newest: number): Promise<DmAttachments> {
  const going = pending.get(pid)
  if (going && covers(going, key, newest)) return going.p
  const at = Date.now()
  const p: Promise<DmAttachments> = fetchDmAttachments(pid)
    .then(data => { cache.set(pid, { key, data, at }); return data })
    .finally(() => { if (pending.get(pid)?.p === p) pending.delete(pid) })
  pending.set(pid, { key, at, p })
  return p
}

const hasFiles = (d: DmAttachments) => d.byMessage.size > 0 || d.loose.length > 0
const shut = (f: DmFile): DmFile => ({ ...f, href: null })
/** The same files with nothing to tap: their links have run out and could not be renewed. */
function withoutLinks(d: DmAttachments): DmAttachments {
  return { byMessage: new Map([...d.byMessage].map(([id, files]) => [id, files.map(shut)])), loose: d.loose.map(l => ({ ...l, files: l.files.map(shut) })), expiresAt: d.expiresAt }
}

/**
 * The files on this conversation, or null (none known yet, no LinkedIn chat, or the read failed).
 * Null renders the thread exactly as it was before files existed here.
 * `enabled: false` is a pane that was shown without being opened: it shows a read it already has and
 * never starts one.
 */
export function useDmAttachments(t: Pick<Thread, 'prospect_id' | 'messages'>, enabled = true): DmAttachments | null {
  // Only a thread with a LinkedIn chat can carry files. The key is the newest message on it: it moves when
  // one lands or is sent, and stays put while older pages of the same conversation are still being read in
  // (a count would move with every page, and each move is a provider read).
  const chat = t.messages.some(m => m.unipile_chat_id)
  let newest = 0
  if (chat) for (const m of t.messages) if (m.direction === 'inbound' || m.sent_at) newest = Math.max(newest, Date.parse(m.sent_at ?? m.created_at) || 0)
  const key = chat ? `${t.prospect_id}:${newest}` : ''
  const [read, setRead] = useState<{ pid: string; data: DmAttachments } | null>(null)
  const [tick, setTick] = useState(0)
  const [, setClock] = useState(0)
  const fails = useRef(0)
  useEffect(() => {
    if (!key) return
    const pid = t.prospect_id
    const hit = cache.get(pid)
    const now = Date.now()
    let current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const later = (ms: number) => { timer = setTimeout(() => { if (current) setTick(n => n + 1) }, ms) }
    const stop = () => { current = false; clearTimeout(timer) }
    // Nothing to renew on a thread with no files.
    const renewAt = (data: DmAttachments) => { if (hasFiles(data)) later(Math.max(30_000, data.expiresAt - RENEW_BEFORE_MS - Date.now())) }
    if (hit) setRead({ pid, data: hit.data })
    if (hit && covers(hit, key, newest) && now - hit.at < FRESH_MS && hit.data.expiresAt - now > RENEW_BEFORE_MS) { renewAt(hit.data); return stop }
    if (!enabled) return stop
    void readOnce(pid, key, newest).then(data => {
      if (!current) return
      fails.current = 0
      setRead({ pid, data })
      renewAt(data)
    }).catch(() => {
      // The thread keeps what it had. With files on screen their links are running out, so try again a few times.
      const had = cache.get(pid)?.data
      if (current && had && hasFiles(had) && fails.current < MAX_RETRIES) { fails.current++; later(RETRY_MS) }
    })
    return stop
  }, [key, tick, enabled]) // eslint-disable-line react-hooks/exhaustive-deps
  // Back from the background with links about to run out: read again.
  useEffect(() => {
    if (!key || !enabled) return
    const onShow = () => {
      const hit = cache.get(t.prospect_id)
      if (document.visibilityState === 'visible' && hit && hit.data.expiresAt - Date.now() < RENEW_BEFORE_MS) setTick(n => n + 1)
    }
    document.addEventListener('visibilitychange', onShow)
    return () => document.removeEventListener('visibilitychange', onShow)
  }, [key, enabled, t.prospect_id])
  const mine = key && read?.pid === t.prospect_id && hasFiles(read.data) ? read.data : null
  // Links that ran out and could not be renewed stop being links: the chip stays, a tap opens nothing.
  const expiresAt = mine?.expiresAt ?? 0
  useEffect(() => {
    const ms = expiresAt - Date.now()
    if (ms <= 0) return
    const id = setTimeout(() => setClock(n => n + 1), ms + 50)
    return () => clearTimeout(id)
  }, [expiresAt])
  const expired = !!mine && mine.expiresAt <= Date.now()
  return useMemo(() => mine && expired ? withoutLinks(mine) : mine, [mine, expired])
}
