import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchPackIndex, fetchWeekEvents, subscribePacks, type SalesPack, type WeekEvent } from '../../lib/salesPacks'
import { fetchCalls, type CallRow } from '../../lib/transcripts'
import { dayKey, weekWindow } from '../../wb/sales/match'
import { recall, remember } from '../../lib/pageMemo'

const eventsKey = (from: Date, to: Date) => `sales:events:${from.toISOString()}:${to.toISOString()}`
const PACKS_KEY = 'sales:packs'
const CALLS_KEY = 'sales:calls'
const emptyOverKnown = <T,>(rows: T[], known: T[]) => rows.length === 0 && known.length > 0

// The three Sales reads, independent: one failing never blanks the other two,
// and each says so on its own. Read-only. The clock ticks every 30 s so Join
// lights inside the hour; the fortnight moves only when the Warsaw day does.
export type ReadState = 'loading' | 'ok' | 'failed'

export function useSalesData() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t) }, [])
  const today = dayKey(now)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const week = useMemo(() => weekWindow(new Date()), [today])
  const [events, setEvents] = useState<WeekEvent[]>(() => recall<WeekEvent[]>(eventsKey(week.from, week.to))?.value ?? [])
  const [packs, setPacks] = useState<SalesPack[]>(() => recall<SalesPack[]>(PACKS_KEY)?.value ?? [])
  const [calls, setCalls] = useState<CallRow[]>(() => recall<CallRow[]>(CALLS_KEY)?.value ?? [])
  const [ev, setEv] = useState<ReadState>(() => recall(eventsKey(week.from, week.to)) ? 'ok' : 'loading')
  const [pk, setPk] = useState<ReadState>(() => recall(PACKS_KEY) ? 'ok' : 'loading')
  const [cl, setCl] = useState<ReadState>(() => recall(CALLS_KEY) ? 'ok' : 'loading')
  const [saved, setSaved] = useState(() => ({ events: Boolean(recall(eventsKey(week.from, week.to))), packs: Boolean(recall(PACKS_KEY)), calls: Boolean(recall(CALLS_KEY)) }))
  const [evErr, setEvErr] = useState('')
  const rows = useRef({ events, packs, calls })
  const activeWeek = useRef(eventsKey(week.from, week.to))
  const [reads, setReads] = useState(0)
  const retry = useCallback(() => setReads(n => n + 1), [])
  const readAt = useRef(0)
  // Back on the screen after five minutes away = read again, quietly (today's
  // Sales): a booking or a new transcript lands without a Retry.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && readAt.current > 0 && Date.now() - readAt.current > 5 * 60_000) setReads(n => n + 1)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  useEffect(() => {
    let active = true
    const key = eventsKey(week.from, week.to)
    if (activeWeek.current !== key) {
      activeWeek.current = key
      const seeded = recall<WeekEvent[]>(key)
      rows.current.events = seeded?.value ?? []
      setEvents(rows.current.events)
      setEv(seeded ? 'ok' : 'loading')
      setSaved(s => ({ ...s, events: Boolean(seeded) }))
    }
    void fetchWeekEvents(week.from, week.to).then(value => {
      if (!active) return
      readAt.current = Date.now()
      if (emptyOverKnown(value, rows.current.events)) {
        setEv('failed'); setEvErr('The calendar returned empty over known events.'); return
      }
      rows.current.events = value; setEvents(value); setEv('ok'); setEvErr(''); setSaved(s => ({ ...s, events: false })); remember(key, value)
    }).catch(reason => {
      if (!active) return
      readAt.current = Date.now()
      setEv('failed'); setEvErr(reason instanceof Error ? reason.message : String(reason?.message ?? reason))
    })
    void fetchPackIndex().then(value => {
      if (!active) return
      readAt.current = Date.now()
      if (emptyOverKnown(value, rows.current.packs)) { setPk('failed'); return }
      rows.current.packs = value; setPacks(value); setPk('ok'); setSaved(s => ({ ...s, packs: false })); remember(PACKS_KEY, value)
    }).catch(() => { if (active) { readAt.current = Date.now(); setPk('failed') } })
    void fetchCalls().then(value => {
      if (!active) return
      readAt.current = Date.now()
      if (emptyOverKnown(value, rows.current.calls)) { setCl('failed'); return }
      rows.current.calls = value; setCalls(value); setCl('ok'); setSaved(s => ({ ...s, calls: false })); remember(CALLS_KEY, value)
    }).catch(() => { if (active) { readAt.current = Date.now(); setCl('failed') } })
    const off = subscribePacks(() => { fetchPackIndex().then(r => {
      if (!active) return
      if (emptyOverKnown(r, rows.current.packs)) { setPk('failed'); return }
      rows.current.packs = r; setPacks(r); setPk('ok'); setSaved(s => ({ ...s, packs: false })); remember(PACKS_KEY, r)
    }).catch(() => { if (active) setPk('failed') }) })
    return () => { active = false; off() }
  }, [week, reads])

  return { now, week, events, packs, calls, state: { events: ev, packs: pk, calls: cl }, saved, eventsError: evErr, retry }
}
