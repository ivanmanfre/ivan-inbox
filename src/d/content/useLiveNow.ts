import { useEffect, useRef, useState } from 'react'
import { warsawDay } from '../ui/time'

/**
 * The page's clock. Read once at mount it went stale while Content stayed open: a post that missed
 * its slot never turned into "Did not go out" and after midnight the calendar kept yesterday as
 * Today. It ticks every minute and re-reads when the tab or phone app comes back to the front
 * (timers are paused while it is away).
 */
export function useLiveNow(ms = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const t = window.setInterval(tick, ms)
    const onVisible = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', tick)
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', tick) }
  }, [ms])
  return now
}

/**
 * The instant the week read is keyed on: it changes when the Warsaw day does and not on every
 * tick, so a minute passing never re-fetches the week.
 */
export function useDayAnchor(now: number): number {
  const anchor = useRef({ day: warsawDay(now), at: now })
  const day = warsawDay(now)
  if (anchor.current.day !== day) anchor.current = { day, at: now }
  return anchor.current.at
}
