import { useEffect, useRef, useState } from 'react'

// Lightweight pull-to-refresh for a scroll container. Only engages when the
// container is already scrolled to the very top, so it never fights normal
// scrolling. Returns the live pull distance + a refreshing flag for the UI.

const TRIGGER = 64 // px pulled past which a release fires a refresh
const MAX = 92 // px cap on the visible rubber-band
const RESIST = 0.5 // drag resistance (pulling 100px moves the indicator 50px)

export function usePullToRefresh(
  ref: React.RefObject<HTMLElement | null>,
  onRefresh: () => void | Promise<void>,
) {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef(0)
  const active = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    function onStart(e: TouchEvent) {
      if (el!.scrollTop <= 0 && !refreshing) {
        startY.current = e.touches[0].clientY
        active.current = true
      }
    }
    function onMove(e: TouchEvent) {
      if (!active.current) return
      const dy = e.touches[0].clientY - startY.current
      if (dy <= 0) { setPull(0); return }
      // Pulling down while at the top — take over so the page doesn't bounce.
      if (e.cancelable) e.preventDefault()
      setPull(Math.min(MAX, dy * RESIST))
    }
    async function onEnd() {
      if (!active.current) return
      active.current = false
      if (pull >= TRIGGER) {
        setRefreshing(true)
        setPull(TRIGGER)
        try { await onRefresh() } finally {
          setRefreshing(false)
          setPull(0)
        }
      } else {
        setPull(0)
      }
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [ref, onRefresh, pull, refreshing])

  return { pull, refreshing, trigger: TRIGGER }
}
