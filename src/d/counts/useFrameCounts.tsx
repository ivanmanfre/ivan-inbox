import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { fetchSystemAlerts, shapeAlerts, type AlertGroup, type SystemAlert } from '../../lib/systemAlerts'
import { SEATS, type Seat, type SeatNumbers } from '../seats'
import { fetchBellCounts, type BellCounts } from './bell'
import { fetchContentWaiting } from './content'
import { countDmSeat, fetchDmSeatCount, type DmSeatCount } from './dmDrafts'
import { useDInboxMaybe } from './inbox'
import { fetchAutomationHealth, fetchCallsToday, fetchMagnetsReview, type AutomationHealth } from './glance'
import { fetchNextCall, type NextCall } from './nextCall'
import { supabase } from '../../lib/supabase'
import { fetchOpsWaiting } from './ops'

// ---------------------------------------------------------------------------
// THE FRAME'S NUMBERS. One provider, mounted once by the Shell, read by the
// left panel, the dock, the bell and any page that wants the same number in its
// own headline (so the panel and the page can never disagree).
//
// Every slice is honest about itself: `value` null + `failed` false = not read
// yet, `failed` true = the last read failed (the last good value, if any, stays
// in `value` and the UI marks it). Seats are separate reads and separate
// numbers: one seat's failed read never blanks another seat.
//
// Re-read on mount, on focus / visible, every 3 minutes, when the service
// worker posts a push, on `refresh()` (a page calls it after a verb that
// changes a count, e.g. after sending a DM: `refresh('dms')`), and LIVE: a
// change on ops_drafts / carousel_drafts / lm_drafts_v2 / system_alerts
// (today's realtime channels) re-reads that count within 1.5 s, so a verb on
// any page moves the numbers without waiting for the poll.
//
// SAVED COPY: the last good value of every slice is kept on the device and
// painted on a cold boot with its own time (`at`), so the panel never opens on
// "…" when it has read before. A saved value is never newer than its stamp.
// ---------------------------------------------------------------------------

export type Slice<T> = { value: T | null; failed: boolean; at: number | null }

export type SystemAlertsRead = { rows: SystemAlert[]; groups: AlertGroup[]; critical: number }

export type CountKey = 'dms' | 'content' | 'ops' | 'nextCall' | 'bell' | 'alerts' | 'health' | 'magnets' | 'calls'

export type FrameCounts = {
  dms: Record<Seat, Slice<DmSeatCount>>
  content: Record<Seat, Slice<number>>
  ops: Slice<Record<Seat, number>>
  nextCall: Slice<NextCall>
  bell: Slice<BellCounts>
  alerts: Slice<SystemAlertsRead>
  /** Automation health (today's Workflows row): corroborated failures + the rest in 7 days. */
  health: Slice<AutomationHealth>
  /** Lead magnets at review, every lane. */
  magnets: Slice<number>
  /** Sales: calls today that have not started. */
  calls: Slice<number>
  refresh: (what?: CountKey | CountKey[]) => void
}

const EMPTY = <T,>(): Slice<T> => ({ value: null, failed: false, at: null })

const POLL_MS = 3 * 60_000
const ALL: CountKey[] = ['dms', 'content', 'ops', 'nextCall', 'bell', 'alerts', 'health', 'magnets', 'calls']
const SAVED = 'd-frame-counts-v1'
const LIVE_MS = 1500

type Saved = Partial<Record<string, Slice<unknown>>>

function readSaved(): Saved {
  try { return JSON.parse(localStorage.getItem(SAVED) ?? '{}') as Saved } catch { return {} }
}

/** A saved slice, painted as not-failed with its own stamp; a missing one is "not read yet". */
function seed<T>(saved: Saved, key: string): Slice<T> {
  const s = saved[key]
  return s && s.value != null && s.at != null ? { value: s.value as T, failed: false, at: s.at } : EMPTY<T>()
}

const Ctx = createContext<FrameCounts | null>(null)

export type Readers = {
  dm: (s: Seat) => Promise<DmSeatCount>
  content: (s: Seat) => Promise<number>
  ops: () => Promise<Record<Seat, number>>
  nextCall: () => Promise<NextCall>
  bell: () => Promise<BellCounts>
  alerts: () => Promise<SystemAlertsRead>
  health: () => Promise<AutomationHealth>
  magnets: () => Promise<number>
  calls: () => Promise<number>
}

async function readAlerts(): Promise<SystemAlertsRead> {
  const rows = await fetchSystemAlerts(100)
  const groups = shapeAlerts(rows)
  return { rows, groups, critical: groups.filter(g => g.severity === 'critical').length }
}

const LIVE: Readers = {
  dm: s => fetchDmSeatCount(s),
  content: s => fetchContentWaiting(s),
  ops: () => fetchOpsWaiting(),
  nextCall: () => fetchNextCall(),
  bell: () => fetchBellCounts(),
  alerts: readAlerts,
  health: () => fetchAutomationHealth(),
  magnets: () => fetchMagnetsReview(),
  calls: () => fetchCallsToday(),
}

export function FrameCountsProvider({ children, readers = LIVE }: { children: ReactNode; readers?: Readers }) {
  const live = readers === LIVE
  const [saved] = useState<Saved>(() => (live ? readSaved() : {}))
  const [dms, setDms] = useState(() => ({ ivan: seed<DmSeatCount>(saved, 'dms:ivan'), risedtc: seed<DmSeatCount>(saved, 'dms:risedtc'), arch: seed<DmSeatCount>(saved, 'dms:arch') }))
  const [content, setContent] = useState(() => ({ ivan: seed<number>(saved, 'content:ivan'), risedtc: seed<number>(saved, 'content:risedtc'), arch: seed<number>(saved, 'content:arch') }))
  const [ops, setOps] = useState(() => seed<Record<Seat, number>>(saved, 'ops'))
  const [nextCall, setNextCall] = useState(() => seed<NextCall>(saved, 'nextCall'))
  const [bell, setBell] = useState(() => seed<BellCounts>(saved, 'bell'))
  const [alerts, setAlerts] = useState(EMPTY<SystemAlertsRead>)
  const [health, setHealth] = useState(() => seed<AutomationHealth>(saved, 'health'))
  const [magnets, setMagnets] = useState(() => seed<number>(saved, 'magnets'))
  const [calls, setCalls] = useState(() => seed<number>(saved, 'calls'))
  // One read in flight per key: a focus event during a slow read does not
  // stack a second one on the database.
  const busy = useRef(new Set<string>())
  const alive = useRef(true)
  // Set on every mount, not only the first: StrictMode's rehearsal unmount runs
  // the cleanup once, and a flag left false would drop every read that lands.
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const run = useCallback(<T,>(key: string, read: () => Promise<T>, set: (f: (prev: Slice<T>) => Slice<T>) => void) => {
    if (busy.current.has(key)) return
    busy.current.add(key)
    read().then(
      v => {
        if (!alive.current) return
        const slice = { value: v, failed: false, at: Date.now() }
        set(() => slice)
        // System alerts carry bodies; every other slice is a few numbers.
        if (live && key !== 'alerts') {
          try { localStorage.setItem(SAVED, JSON.stringify({ ...readSaved(), [key]: slice })) } catch { /* full or private */ }
        }
      },
      (e: unknown) => {
        console.error(`[d] ${key} count read failed`, e)
        if (alive.current) set(prev => ({ ...prev, failed: true }))
      },
    ).finally(() => busy.current.delete(key))
  }, [live])

  const refresh = useCallback((what?: CountKey | CountKey[]) => {
    const keys = what == null ? ALL : Array.isArray(what) ? what : [what]
    for (const k of keys) {
      if (k === 'dms') for (const s of SEATS) run(`dms:${s}`, () => readers.dm(s), f => setDms(p => ({ ...p, [s]: f(p[s]) })))
      if (k === 'content') for (const s of SEATS) run(`content:${s}`, () => readers.content(s), f => setContent(p => ({ ...p, [s]: f(p[s]) })))
      if (k === 'ops') run('ops', readers.ops, setOps)
      if (k === 'nextCall') run('nextCall', readers.nextCall, setNextCall)
      if (k === 'bell') run('bell', readers.bell, setBell)
      if (k === 'alerts') run('alerts', readers.alerts, setAlerts)
      if (k === 'health') run('health', readers.health, setHealth)
      if (k === 'magnets') run('magnets', readers.magnets, setMagnets)
      if (k === 'calls') run('calls', readers.calls, setCalls)
    }
  }, [run, readers])

  useEffect(() => {
    refresh()
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    const onFocus = () => refresh()
    const onSw = (e: MessageEvent) => {
      if ((e.data as { type?: string } | undefined)?.type === 'push') refresh(['bell', 'dms', 'alerts'])
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    navigator.serviceWorker?.addEventListener?.('message', onSw)
    const t = window.setInterval(() => refresh(), POLL_MS)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
      navigator.serviceWorker?.removeEventListener?.('message', onSw)
      window.clearInterval(t)
    }
  }, [refresh])

  // LIVE: today's realtime tables, one coalesced re-read per count.
  useEffect(() => {
    if (!live) return
    const due = new Map<CountKey, number>()
    const nudge = (k: CountKey) => () => {
      if (due.has(k)) return
      due.set(k, window.setTimeout(() => { due.delete(k); refresh(k) }, LIVE_MS))
    }
    const ch = supabase.channel(`d-frame-counts:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ops_drafts' }, nudge('ops'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'carousel_drafts' }, nudge('content'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lm_drafts_v2' }, nudge('magnets'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'system_alerts' }, nudge('alerts'))
      .subscribe()
    return () => { for (const t of due.values()) window.clearTimeout(t); void supabase.removeChannel(ch) }
  }, [live, refresh])

  // DMs from the frame's ONE inbox (today's badge came off the same list), per seat,
  // live with its realtime channel and painted from its saved copy. The small
  // per-seat read above stays the answer until the inbox has rows, and when it fails.
  const inbox = useDInboxMaybe()
  const inboxThreads = inbox?.threads
  const inboxAt = inbox?.loadedAt ? Date.parse(inbox.loadedAt) : inbox?.cachedAt ? Date.parse(inbox.cachedAt) : null
  const dmsLive = useMemo(() => {
    if (!inboxThreads || inboxThreads.length === 0 || inboxAt == null) return null
    const now = Date.now()
    const one = (s: Seat): Slice<DmSeatCount> => ({ value: countDmSeat(inboxThreads, s, now), failed: false, at: inboxAt })
    return { ivan: one('ivan'), risedtc: one('risedtc'), arch: one('arch') }
  }, [inboxThreads, inboxAt])

  const value = useMemo<FrameCounts>(
    () => ({ dms: dmsLive ?? dms, content, ops, nextCall, bell, alerts, health, magnets, calls, refresh }),
    [dmsLive, dms, content, ops, nextCall, bell, alerts, health, magnets, calls, refresh],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** The frame's numbers. Must be called under the D Shell (every page is). */
export function useFrameCounts(): FrameCounts {
  const v = useContext(Ctx)
  if (!v) throw new Error('useFrameCounts outside the D Shell')
  return v
}

/** DMs per seat, as plain numbers (null = unknown). `which`: 'drafts' (panel) or 'needs' (DMs headline). */
export function dmNumbers(c: FrameCounts, which: keyof DmSeatCount = 'drafts'): SeatNumbers {
  return { ivan: c.dms.ivan.value?.[which] ?? null, risedtc: c.dms.risedtc.value?.[which] ?? null, arch: c.dms.arch.value?.[which] ?? null }
}

export function contentNumbers(c: FrameCounts): SeatNumbers {
  return { ivan: c.content.ivan.value, risedtc: c.content.risedtc.value, arch: c.content.arch.value }
}

export function opsNumbers(c: FrameCounts): SeatNumbers {
  const v = c.ops.value
  return v ? { ...v } : { ivan: null, risedtc: null, arch: null }
}

/** True when any seat's read of this kind failed (the UI says so, never shows a guess). */
export function seatFailed(s: Record<Seat, Slice<unknown>>): Record<Seat, boolean> {
  return { ivan: s.ivan.failed, risedtc: s.risedtc.failed, arch: s.arch.failed }
}
