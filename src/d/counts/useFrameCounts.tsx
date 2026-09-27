import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { fetchSystemAlerts, shapeAlerts, type AlertGroup, type SystemAlert } from '../../lib/systemAlerts'
import { SEATS, type Seat, type SeatNumbers } from '../seats'
import { fetchBellCounts, type BellCounts } from './bell'
import { fetchContentWaiting } from './content'
import { fetchDmSeatCount, type DmSeatCount } from './dmDrafts'
import { fetchNextCall, type NextCall } from './nextCall'
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
// worker posts a push, and on `refresh()` (a page calls it after a verb that
// changes a count, e.g. after sending a DM: `refresh('dms')`).
// ---------------------------------------------------------------------------

export type Slice<T> = { value: T | null; failed: boolean; at: number | null }

export type SystemAlertsRead = { rows: SystemAlert[]; groups: AlertGroup[]; critical: number }

export type CountKey = 'dms' | 'content' | 'ops' | 'nextCall' | 'bell' | 'alerts'

export type FrameCounts = {
  dms: Record<Seat, Slice<DmSeatCount>>
  content: Record<Seat, Slice<number>>
  ops: Slice<Record<Seat, number>>
  nextCall: Slice<NextCall>
  bell: Slice<BellCounts>
  alerts: Slice<SystemAlertsRead>
  refresh: (what?: CountKey | CountKey[]) => void
}

const EMPTY = <T,>(): Slice<T> => ({ value: null, failed: false, at: null })
const perSeat = <T,>(): Record<Seat, Slice<T>> => ({ ivan: EMPTY<T>(), risedtc: EMPTY<T>(), arch: EMPTY<T>() })

const POLL_MS = 3 * 60_000
const ALL: CountKey[] = ['dms', 'content', 'ops', 'nextCall', 'bell', 'alerts']

const Ctx = createContext<FrameCounts | null>(null)

export type Readers = {
  dm: (s: Seat) => Promise<DmSeatCount>
  content: (s: Seat) => Promise<number>
  ops: () => Promise<Record<Seat, number>>
  nextCall: () => Promise<NextCall>
  bell: () => Promise<BellCounts>
  alerts: () => Promise<SystemAlertsRead>
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
}

export function FrameCountsProvider({ children, readers = LIVE }: { children: ReactNode; readers?: Readers }) {
  const [dms, setDms] = useState(perSeat<DmSeatCount>)
  const [content, setContent] = useState(perSeat<number>)
  const [ops, setOps] = useState(EMPTY<Record<Seat, number>>)
  const [nextCall, setNextCall] = useState(EMPTY<NextCall>)
  const [bell, setBell] = useState(EMPTY<BellCounts>)
  const [alerts, setAlerts] = useState(EMPTY<SystemAlertsRead>)
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
      v => { if (alive.current) set(() => ({ value: v, failed: false, at: Date.now() })) },
      (e: unknown) => {
        console.error(`[d] ${key} count read failed`, e)
        if (alive.current) set(prev => ({ ...prev, failed: true }))
      },
    ).finally(() => busy.current.delete(key))
  }, [])

  const refresh = useCallback((what?: CountKey | CountKey[]) => {
    const keys = what == null ? ALL : Array.isArray(what) ? what : [what]
    for (const k of keys) {
      if (k === 'dms') for (const s of SEATS) run(`dms:${s}`, () => readers.dm(s), f => setDms(p => ({ ...p, [s]: f(p[s]) })))
      if (k === 'content') for (const s of SEATS) run(`content:${s}`, () => readers.content(s), f => setContent(p => ({ ...p, [s]: f(p[s]) })))
      if (k === 'ops') run('ops', readers.ops, setOps)
      if (k === 'nextCall') run('nextCall', readers.nextCall, setNextCall)
      if (k === 'bell') run('bell', readers.bell, setBell)
      if (k === 'alerts') run('alerts', readers.alerts, setAlerts)
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

  const value = useMemo<FrameCounts>(
    () => ({ dms, content, ops, nextCall, bell, alerts, refresh }),
    [dms, content, ops, nextCall, bell, alerts, refresh],
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
