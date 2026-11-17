import { useEffect, useState } from 'react'
import type { Thread } from '../../lib/inbox'
import { fetchDmAttachments, type DmAttachments } from '../../lib/dmAttachments'

// The last read per person, in memory only (the links are signed and short-lived: never a saved copy).
const cache = new Map<string, { key: string; data: DmAttachments; at: number }>()
const FRESH_MS = 60_000
/** Read again this long before the links run out, so a chip on a thread left open still opens. */
const RENEW_BEFORE_MS = 5 * 60_000

/** Test seam. */
export function clearDmAttachmentsCache() { cache.clear() }

/**
 * The files on this conversation, or null (none known yet, no LinkedIn chat, or the read failed).
 * Null renders the thread exactly as it was before files existed here.
 */
export function useDmAttachments(t: Pick<Thread, 'prospect_id' | 'messages'>): DmAttachments | null {
  // Only a thread with a LinkedIn chat can carry files. The key moves when a message lands or is sent.
  const chat = t.messages.some(m => m.unipile_chat_id)
  const key = chat ? `${t.prospect_id}:${t.messages.filter(m => m.direction === 'inbound' || m.sent_at).length}` : ''
  const [read, setRead] = useState<{ pid: string; data: DmAttachments } | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!key) return
    const pid = t.prospect_id
    const hit = cache.get(pid)
    const now = Date.now()
    let current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const renewAt = (data: DmAttachments) => {
      // Nothing to renew on a thread with no files.
      if (!data.byMessage.size && !data.loose.length) return
      timer = setTimeout(() => { if (current) setTick(n => n + 1) }, Math.max(30_000, data.expiresAt - RENEW_BEFORE_MS - Date.now()))
    }
    if (hit) setRead({ pid, data: hit.data })
    if (hit && hit.key === key && now - hit.at < FRESH_MS && hit.data.expiresAt - now > RENEW_BEFORE_MS) { renewAt(hit.data); return () => { current = false; clearTimeout(timer) } }
    void fetchDmAttachments(pid).then(data => {
      cache.set(pid, { key, data, at: Date.now() })
      if (!current) return
      setRead({ pid, data })
      renewAt(data)
    }).catch(() => { /* the thread keeps what it had */ })
    return () => { current = false; clearTimeout(timer) }
  }, [key, tick]) // eslint-disable-line react-hooks/exhaustive-deps
  // Back from the background with links about to run out: read again.
  useEffect(() => {
    if (!key) return
    const onShow = () => {
      const hit = cache.get(t.prospect_id)
      if (document.visibilityState === 'visible' && hit && hit.data.expiresAt - Date.now() < RENEW_BEFORE_MS) setTick(n => n + 1)
    }
    document.addEventListener('visibilitychange', onShow)
    return () => document.removeEventListener('visibilitychange', onShow)
  }, [key, t.prospect_id])
  if (!key || read?.pid !== t.prospect_id) return null
  const d = read.data
  return d.byMessage.size || d.loose.length ? d : null
}
