import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Layout, PlaceId } from '../places'

// Today's KeepLane kept a visited lane's scroll. D mounts one page at a time,
// so the frame keeps the scroll per place instead: saved on the way out,
// put back on the way in once the page is tall enough (it may still be reading).
const saved = new Map<string, number>()

function scroller(layout: Layout): { get: () => number; set: (y: number) => void; room: () => number } {
  if (layout === 'desktop') {
    // SPEC-shell-spacing §2.6: .d-body never scrolls; each page marks its primary scroller
    // data-d-scroll (first match). A page that has not marked one keeps the .d-body fallback.
    const el = () => document.querySelector<HTMLElement>('.d-body [data-d-scroll]') ?? document.querySelector<HTMLElement>('.d-body')
    return { get: () => el()?.scrollTop ?? 0, set: y => { const e = el(); if (e) e.scrollTop = y }, room: () => { const e = el(); return e ? e.scrollHeight - e.clientHeight : 0 } }
  }
  const se = () => document.scrollingElement ?? document.documentElement
  return { get: () => window.scrollY, set: y => window.scrollTo(0, y), room: () => se().scrollHeight - window.innerHeight }
}

export function useKeepScroll(place: PlaceId, layout: Layout, hash: string) {
  // One key per place and sub (Content's Magnets is not Content's Planner); one-shot keys do not count.
  const key = `${layout}:${place}:${hash.split('?')[0]}`
  const cur = useRef(key)
  // Recorded as he scrolls (capture: the desktop body's scroll does not bubble), so the value
  // is the one he left, not one clamped by the next page's shorter height.
  useLayoutEffect(() => {
    cur.current = key
    let raf = 0
    const on = () => {
      if (raf) return
      raf = requestAnimationFrame(() => { raf = 0; if (cur.current === key) saved.set(key, scroller(layout).get()) })
    }
    document.addEventListener('scroll', on, true)
    return () => { document.removeEventListener('scroll', on, true); cancelAnimationFrame(raf) }
  }, [key, layout])
  useEffect(() => {
    const y = saved.get(key)
    if (!y) return
    const s = scroller(layout)
    let tries = 0
    let raf = 0
    const put = () => {
      if (s.room() >= y || tries++ > 90) { s.set(Math.min(y, s.room())); return }
      raf = requestAnimationFrame(put)
    }
    raf = requestAnimationFrame(put)
    return () => cancelAnimationFrame(raf)
  }, [key, layout])
}
