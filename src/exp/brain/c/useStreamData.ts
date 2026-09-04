// useStreamData.ts, the non-pure wiring around the pure functions in
// stream.ts/turnAugment.ts: notification polling (mount, visibilitychange, SW
// push message), the two permitted writes (read_at / dismissed_at), and the
// per-turn row lookup that gives turns a real timestamp and error_code.
//
// Everything that can be pure already is (stream.ts, turnAugment.ts,
// families.ts), this file is only the effects those pure functions need to run
// against real data.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Turn } from '../../v2c/chat/events'
import type { ChatHandle } from '../../v2c/useChat'
import {
  dismissGroup, dismissNotification, listNotifications, listTurns, markNotificationsRead,
  type Notification,
} from '../../../lib/turns'
import { mockFlag } from '../../v2c/mock'
import { DEMO_NOTIFICATIONS } from './demoNotifications'
import { augmentTurns, type AugmentedTurn, type TurnRowMeta } from './turnAugment'

// `?wbmock=notif:demo` — see demoNotifications.ts for why this exists: the
// live table is real but young, and holds none of the 17 measured families
// yet. Read once, same idiom as every other wbmock lever in this app.
const NOTIF_DEMO = mockFlag('notif') === 'demo'

// ---------- persisted, whitelisted enum state (the today.ts idiom) ----------

function readEnum<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
  } catch {
    return fallback
  }
}

function usePersistedEnum<T extends string>(key: string, allowed: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(() => readEnum(key, allowed, fallback))
  const set = useCallback((v: T) => {
    setValue(v)
    try { localStorage.setItem(key, v) } catch { /* quota / private mode */ }
  }, [key])
  return [value, set] as const
}

function usePersistedBool(key: string, fallback: boolean) {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(key)
      return v === null ? fallback : v === '1'
    } catch { return fallback }
  })
  const set = useCallback((v: boolean) => {
    setValue(v)
    try { localStorage.setItem(key, v ? '1' : '0') } catch { /* quota / private mode */ }
  }, [key])
  return [value, set] as const
}

export { usePersistedEnum, usePersistedBool }

// ---------- notifications ----------

export function useNotifications() {
  const [rows, setRows] = useState<Notification[]>([])
  const [loadedAt, setLoadedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)

  const load = useCallback(async () => {
    if (NOTIF_DEMO) {
      setRows(DEMO_NOTIFICATIONS)
      setLoadedAt(new Date().toISOString())
      setError(null)
      return
    }
    try {
      const data = await listNotifications({ limit: 200 })
      if (!alive.current) return
      setRows(data)
      setLoadedAt(new Date().toISOString())
      setError(null)
    } catch (e) {
      if (!alive.current) return
      setError(e instanceof Error ? e.message : 'Notifications did not load.')
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void load()
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    // The service worker's own push handler posts {type:'push'} back to every
    // open client so a tab that never left the foreground still refetches ,
    // D4 chose polling over realtime specifically because push is the wake
    // signal on a phone; this is that wake signal reaching the open tab.
    let onSw: ((e: MessageEvent) => void) | null = null
    if ('serviceWorker' in navigator) {
      onSw = (e: MessageEvent) => { if ((e.data as { type?: string })?.type === 'push') void load() }
      navigator.serviceWorker.addEventListener('message', onSw)
    }
    return () => {
      alive.current = false
      document.removeEventListener('visibilitychange', onVisible)
      if (onSw) navigator.serviceWorker.removeEventListener('message', onSw)
    }
  }, [load])

  const dismissOne = useCallback(async (id: string) => {
    setRows(rs => rs.filter(r => r.id !== id))
    // Demo rows are not real ids; a PATCH against them would be a live write
    // with no row behind it. Local-only, same as every other demo path here.
    if (NOTIF_DEMO) return
    try { await dismissNotification(id) } catch { void load() }
  }, [load])

  const dismissMany = useCallback(async (ids: string[], groupKey: string | null) => {
    setRows(rs => rs.filter(r => !ids.includes(r.id)))
    if (NOTIF_DEMO) return
    try {
      if (groupKey) await dismissGroup(groupKey)
      else await Promise.all(ids.map(id => dismissNotification(id)))
    } catch { void load() }
  }, [load])

  const markRead = useCallback(async (ids: string[]) => {
    const unread = ids
    if (unread.length === 0) return
    const now = new Date().toISOString()
    setRows(rs => rs.map(r => (unread.includes(r.id) && !r.read_at ? { ...r, read_at: now } : r)))
    if (NOTIF_DEMO) return
    try { await markNotificationsRead(unread) } catch { /* the next load reconciles */ }
  }, [])

  return { rows, loadedAt, error, refresh: load, dismissOne, dismissMany, markRead }
}

// ---------- turns, augmented with a real time + error_code ----------

export function useAugmentedTurns(chat: ChatHandle): AugmentedTurn[] {
  const [rowMeta, setRowMeta] = useState<Record<string, TurnRowMeta>>({})
  const fallback = useRef<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    const id = chat.threadId
    if (!id) { setRowMeta({}); return }
    const load = async () => {
      try {
        const rows = await listTurns(id)
        if (!alive) return
        const map: Record<string, TurnRowMeta> = {}
        for (const r of rows) map[r.id] = { at: r.created_at, errorCode: r.error_code }
        setRowMeta(map)
      } catch { /* keep the previous map; new turns still get a fallback time */ }
    }
    void load()
    return () => { alive = false }
    // Re-read whenever the transcript changes shape or the turn finishes, so a
    // freshly-landed row's real created_at/error_code replace the fallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.threadId, chat.turns.length, chat.status])

  const fallbackAt = useCallback((t: Turn): string => {
    const key = t.turnId ?? t.id
    if (!fallback.current[key]) fallback.current[key] = new Date().toISOString()
    return fallback.current[key]
  }, [])

  return useMemo(() => augmentTurns(chat.turns, rowMeta, fallbackAt), [chat.turns, rowMeta, fallbackAt])
}
