import { useEffect, useState } from 'react'
import { fetchWeekEvents } from '../../lib/salesPacks'
import { callPhase, dayKey } from '../../wb/sales/match'

// THE SALES NUMBER (rebuild, blueprint v3 decision 9): calls today that have
// not started yet. Action items from past calls stay inside Sales and never
// reach the icon, because nothing marks them done, and a number you cannot
// clear never goes down (9 Sep).
//
// `n` is undefined until the first read lands, so the icon never shows a
// made-up 0; `failed` is set when the read errors, so the icon says so.
const POLL_MS = 5 * 60_000

type Ev = { start_time: string; end_time: string | null }

export function upcomingToday(events: Ev[], now: Date): number {
  const today = dayKey(now)
  return events.filter(e => dayKey(e.start_time) === today && callPhase(e, now) === 'upcoming').length
}

export function useSalesToday(): { n: number | undefined; failed: boolean } {
  const [state, setState] = useState<{ n: number | undefined; failed: boolean }>({ n: undefined, failed: false })
  useEffect(() => {
    let alive = true
    let events: Ev[] | null = null
    const read = async () => {
      const now = new Date()
      try {
        // 36h either side covers "today" in Warsaw from any clock; the day is
        // decided by dayKey, not by this window.
        events = await fetchWeekEvents(new Date(now.getTime() - 36e5 * 36), new Date(now.getTime() + 36e5 * 36))
        if (alive) setState({ n: upcomingToday(events, now), failed: false })
      } catch {
        if (alive) setState(s => ({ n: s.n, failed: true }))
      }
    }
    void read()
    // A call that starts drops off the icon without a new read.
    const tick = setInterval(() => {
      if (events && alive) setState(s => (s.failed ? s : { n: upcomingToday(events!, new Date()), failed: false }))
    }, 60_000)
    const poll = setInterval(read, POLL_MS)
    return () => { alive = false; clearInterval(tick); clearInterval(poll) }
  }, [])
  return state
}
