// Pull to refresh for the phone list (today's usePullToRefresh numbers: 64 px trigger, 92 px cap,
// half resistance). Unlike today's hook, the list is not its own scroller in D (the page scrolls),
// so it engages only when the element's real scroll parent is at the very top.
import { useEffect, useRef, useState, type RefObject } from 'react'

const TRIGGER = 64, MAX = 92, RESIST = 0.5

function scrollTopOf(el: HTMLElement): number {
  for (let p: HTMLElement | null = el; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p.scrollTop
  }
  return document.scrollingElement?.scrollTop ?? window.scrollY
}

export function usePull(ref: RefObject<HTMLElement | null>, onRefresh: () => void) {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const start = useRef(0)
  const active = useRef(false)
  const cur = useRef(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onStart = (e: TouchEvent) => { if (!refreshing && scrollTopOf(el) <= 0) { start.current = e.touches[0].clientY; active.current = true } }
    const onMove = (e: TouchEvent) => {
      if (!active.current) return
      const dy = e.touches[0].clientY - start.current
      if (dy <= 0) { cur.current = 0; setPull(0); return }
      if (e.cancelable) e.preventDefault()
      cur.current = Math.min(MAX, dy * RESIST); setPull(cur.current)
    }
    const onEnd = () => {
      if (!active.current) return
      active.current = false
      if (cur.current >= TRIGGER) {
        setRefreshing(true); setPull(TRIGGER)
        Promise.resolve(onRefresh()).finally(() => window.setTimeout(() => { setRefreshing(false); setPull(0); cur.current = 0 }, 600))
      } else { setPull(0); cur.current = 0 }
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart); el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd); el.removeEventListener('touchcancel', onEnd)
    }
  }, [ref, onRefresh, refreshing])
  return { pull, refreshing, trigger: TRIGGER }
}
