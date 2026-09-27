import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchPackIndex, fetchWeekEvents, subscribePacks, type SalesPack, type WeekEvent } from '../../lib/salesPacks'
import { fetchCalls, type CallRow } from '../../lib/transcripts'
import { dayKey, weekWindow } from '../../wb/sales/match'

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
  const [events, setEvents] = useState<WeekEvent[]>([])
  const [packs, setPacks] = useState<SalesPack[]>([])
  const [calls, setCalls] = useState<CallRow[]>([])
  const [ev, setEv] = useState<ReadState>('loading')
  const [pk, setPk] = useState<ReadState>('loading')
  const [cl, setCl] = useState<ReadState>('loading')
  const [evErr, setEvErr] = useState('')
  const [reads, setReads] = useState(0)
  const retry = useCallback(() => setReads(n => n + 1), [])
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    void (async () => {
      const [e, p, c] = await Promise.allSettled([fetchWeekEvents(week.from, week.to), fetchPackIndex(), fetchCalls()])
      if (!alive.current) return
      if (e.status === 'fulfilled') { setEvents(e.value); setEv('ok'); setEvErr('') }
      else { setEv('failed'); setEvErr(e.reason instanceof Error ? e.reason.message : String(e.reason?.message ?? e.reason)) }
      if (p.status === 'fulfilled') { setPacks(p.value); setPk('ok') } else setPk('failed')
      if (c.status === 'fulfilled') { setCalls(c.value); setCl('ok') } else setCl('failed')
    })()
    const off = subscribePacks(() => { fetchPackIndex().then(r => { if (alive.current) { setPacks(r); setPk('ok') } }).catch(() => { /* keep the last */ }) })
    return () => { alive.current = false; off() }
  }, [week, reads])

  return { now, week, events, packs, calls, state: { events: ev, packs: pk, calls: cl }, eventsError: evErr, retry }
}
