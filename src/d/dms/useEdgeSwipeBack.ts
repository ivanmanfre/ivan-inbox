// iOS-style edge swipe-back for the phone thread (inbox-phone-oxygen B1). A touch that starts at the
// left edge (x < 24px) drags the thread with the finger; release past 30% of the width, or a quick
// flick, runs the SAME Back handler the [data-verb="back"] key runs; anything less springs back.
// Phone and touch only (touch events never fire for a mouse); Reduce Motion: no drag, still navigates.
import { useEffect, useRef, type RefObject } from 'react'

const EDGE = 24
const COMMIT = 0.3
const FLICK = 0.5 // px per ms

export function useEdgeSwipeBack(ref: RefObject<HTMLElement | null>, enabled: boolean, onBack: () => void) {
  const back = useRef(onBack)
  back.current = onBack
  useEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    let s: { x: number; y: number; t: number; mode: 'wait' | 'drag' | 'off'; dx: number } | null = null
    const settle = (to: string, ms: number) => {
      el.style.transition = `transform ${ms}ms var(--po-ease, cubic-bezier(.16,1,.3,1))`
      el.style.transform = to
    }
    const onStart = (e: TouchEvent) => {
      const p = e.touches[0]
      s = e.touches.length === 1 && p.clientX < EDGE ? { x: p.clientX, y: p.clientY, t: e.timeStamp, mode: 'wait', dx: 0 } : null
    }
    const onMove = (e: TouchEvent) => {
      if (!s || s.mode === 'off') return
      const p = e.touches[0]
      const dx = p.clientX - s.x, dy = p.clientY - s.y
      if (s.mode === 'wait') {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        if (dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.2) { s.mode = 'drag'; if (!still()) { el.style.animation = 'none'; el.style.transition = 'none' } } else { s.mode = 'off'; return }
      }
      s.dx = Math.max(0, dx)
      if (e.cancelable) e.preventDefault()
      if (!still()) el.style.transform = `translateX(${s.dx}px)`
    }
    const onEnd = (e: TouchEvent) => {
      const g = s
      s = null
      if (!g || g.mode !== 'drag') return
      const w = el.offsetWidth || window.innerWidth
      const v = g.dx / Math.max(1, e.timeStamp - g.t)
      const go = g.dx > w * COMMIT || (v > FLICK && g.dx > 24)
      if (!go) { if (!still()) { settle('translateX(0)', 380); window.setTimeout(() => { if (el.isConnected) { el.style.transition = ''; el.style.transform = '' } }, 420) } return }
      if (still()) { back.current(); return }
      settle('translateX(100%)', 240)
      window.setTimeout(() => {
        back.current()
        // An unsaved-changes confirm that was declined leaves the thread open: bring it back.
        window.setTimeout(() => { if (el.isConnected) { settle('translateX(0)', 380); window.setTimeout(() => { if (el.isConnected) { el.style.transition = ''; el.style.transform = '' } }, 420) } }, 600)
      }, 200)
    }
    const onCancel = () => {
      const g = s
      s = null
      if (g?.mode === 'drag' && !still()) { settle('translateX(0)', 380); window.setTimeout(() => { if (el.isConnected) { el.style.transition = ''; el.style.transform = '' } }, 420) }
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onCancel, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart); el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd); el.removeEventListener('touchcancel', onCancel)
    }
  }, [ref, enabled])
}
