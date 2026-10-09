import { useEffect, useRef } from 'react'

// THE CALENDAR'S HANDS. One pointer engine for the whole calendar, mouse and
// finger alike, because HTML5 drag-and-drop never fires on a phone.
//
//  · Mouse: press a post and move 5px, it lifts and follows the pointer.
//  · Finger: hold a post ~0.3s (a small buzz), then drag; the page stops
//    scrolling while you hold it. Move before the hold ends and it is a
//    scroll or a swipe, never a drag.
//  · A horizontal swipe anywhere on the grid pages months (or two-week lines).
//  · Holding a lifted post at the calendar's left or right edge (or past it, over
//    the draft panel), or over the ‹ › keys, pages too, so a post can travel to
//    any later week or month. The edges light up while you drag (2026-10-09: the
//    old trigger was the SCREEN edge, which the draft panel covered).
//
// Contract with the markup (plain data attributes, so any view can join):
//   [data-cal-id][data-cal-lane]   a post that can be lifted
//   [data-cal-refuse="why"]        a post that must not move (says why on lift)
//   [data-cal-day][data-cal-lane?] a day that accepts a drop (lane-bound if set)
//   [data-cal-noswipe]             a strip that scrolls sideways itself (no paging)
//   [data-cal-page="-1|1"]         a key that pages while a post hovers it
//   .cal-stage                     the paged area; its edges page a held post
// The engine never writes: a drop calls onDrop, which owns the confirm and Undo.
// Moves are applied to the DOM directly (transform), never through React state,
// so a drag costs no re-render per frame.

export type CalGestureOpts = {
  onDrop: (id: string, lane: string, day: string) => void
  onRefuse: (why: string) => void
  /** Live horizontal offset while a swipe is under the finger. */
  onSwipeMove: (dx: number) => void
  /** Swipe released: -1 = earlier, 1 = later, 0 = spring back. */
  onSwipeEnd: (dir: -1 | 0 | 1, dx: number) => void
  /** Page while a lifted post rests at the screen edge. */
  onEdgePage: (dir: -1 | 1) => void
  /** What the hot cell says while a post hovers it ("Thu 15 Oct · 16:00 Warsaw"). */
  labelFor?: (id: string, lane: string, day: string) => string | null
  reducedMotion: boolean
}

const HOLD_MS = 320
const SLOP = 8
const EDGE = 44
const EDGE_MS = 480
const EDGE_REPEAT_MS = 1200

type Mode = 'idle' | 'press' | 'pending' | 'swipe' | 'drag'

export function useCalGestures(root: React.RefObject<HTMLElement | null>, opts: CalGestureOpts) {
  const o = useRef(opts)
  o.current = opts
  useEffect(() => {
    const el = root.current
    if (!el) return
    let mode: Mode = 'idle'
    let pid = -1
    let sx = 0, sy = 0, lx = 0, lt = 0, vx = 0
    let item: HTMLElement | null = null
    let ghost: HTMLElement | null = null
    let gx = 0, gy = 0 // pointer offset inside the lifted post
    let hot: HTMLElement | null = null
    let hold = 0, edgeT = 0, edgeDir: -1 | 0 | 1 = 0
    let raf = 0, px = 0, py = 0
    let noswipe = false
    let seenStage = false
    let layer: HTMLElement | null = null

    const clearHold = () => { if (hold) { window.clearTimeout(hold); hold = 0 } }
    const clearEdge = () => { if (edgeT) { window.clearTimeout(edgeT); edgeT = 0 } edgeDir = 0; el.querySelector('.cal-stage')?.setAttribute('data-cal-edge', '0') }
    const setHot = (d: HTMLElement | null) => {
      if (d === hot) return
      hot?.classList.remove('cal-hot')
      hot?.removeAttribute('data-cal-drop')
      hot = d
      hot?.classList.add('cal-hot')
      const id = item?.dataset.calId, lane = item?.dataset.calLane, day = d?.dataset.calDay
      const label = d && id && lane && day ? o.current.labelFor?.(id, lane, day) : null
      if (d && label) d.setAttribute('data-cal-drop', label)
    }
    const dayAt = (x: number, y: number): HTMLElement | null => {
      const t = document.elementFromPoint(x, y) as HTMLElement | null
      const d = t?.closest<HTMLElement>('[data-cal-day]') ?? null
      if (!d || !item) return null
      const lane = d.dataset.calLane
      return lane && lane !== item.dataset.calLane ? null : d
    }
    const stageEl = () => el.querySelector<HTMLElement>('.cal-stage')
    /** -1 / 1 when a held post rests on a paging key, at the calendar's side edge, or past it (the draft panel). */
    const edgeDirAt = (x: number, y: number): -1 | 0 | 1 => {
      const key = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-cal-page]')
      if (key) return key.dataset.calPage === '-1' ? -1 : 1
      const b = stageEl()?.getBoundingClientRect()
      if (!b || y < b.top - 8 || y > b.bottom + 8) return x < EDGE ? -1 : x > window.innerWidth - EDGE ? 1 : 0
      // A post lifted from the side rail starts outside the calendar: its edges count once it has been over it.
      const inside = x >= b.left + EDGE && x <= b.right - EDGE
      if (inside) seenStage = true
      if (!seenStage) return 0
      return x < b.left + EDGE ? -1 : x > b.right - EDGE ? 1 : 0
    }
    const swallowClick = () => {
      const stop = (e: Event) => { e.stopPropagation(); e.preventDefault() }
      window.addEventListener('click', stop, { capture: true, once: true })
      window.setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 400)
    }
    const paint = () => {
      raf = 0
      if (!ghost) return
      ghost.style.transform = `translate3d(${px - gx}px,${py - gy}px,0) scale(1.04)`
      setHot(dayAt(px, py))
      const dir = edgeDirAt(px, py)
      if (dir !== edgeDir) {
        clearEdge()
        edgeDir = dir
        stageEl()?.setAttribute('data-cal-edge', String(dir))
        if (dir) {
          const tick = () => { o.current.onEdgePage(dir as -1 | 1); edgeT = window.setTimeout(tick, EDGE_REPEAT_MS) }
          edgeT = window.setTimeout(tick, EDGE_MS)
        }
      }
    }

    const lift = () => {
      if (!item) return
      const why = item.dataset.calRefuse
      if (why) {
        item.classList.remove('cal-refuse'); void item.offsetWidth; item.classList.add('cal-refuse')
        o.current.onRefuse(why)
        mode = 'idle'
        return
      }
      const r = item.getBoundingClientRect()
      gx = sx - r.left; gy = sy - r.top
      ghost = item.cloneNode(true) as HTMLElement
      ghost.removeAttribute('id')
      ghost.classList.add('cal-ghost')
      Object.assign(ghost.style, { width: `${r.width}px`, height: `${r.height}px`, left: '0px', top: '0px' })
      ghost.style.transform = `translate3d(${r.left}px,${r.top}px,0)`
      // A layer on <body> that carries the calendar's classes, so the lifted
      // copy keeps its look (phone chip, card) without living inside a
      // transformed or clipped ancestor.
      layer = document.createElement('div')
      layer.className = `${el.className} cal-layer`
      layer.appendChild(ghost)
      ;(el.closest('.d-app') ?? document.body).appendChild(layer)
      item.classList.add('cal-lifted')
      document.documentElement.classList.add('cal-dragging')
      navigator.vibrate?.(8)
      mode = 'drag'
      seenStage = false
      px = sx; py = sy
      if (!raf) raf = requestAnimationFrame(paint)
    }

    const land = (to: DOMRect | null) => {
      const g = ghost, it = item, lay = layer
      ghost = null; layer = null
      if (!g) return
      const done = () => { lay?.remove(); it?.classList.remove('cal-lifted') }
      if (o.current.reducedMotion) { done(); return }
      const from = it?.isConnected ? it.getBoundingClientRect() : null
      const target = to ?? from
      if (!target) { done(); return }
      g.classList.add('cal-ghost-land')
      g.style.transform = `translate3d(${target.left + (to ? 4 : 0)}px,${target.top + (to ? 4 : 0)}px,0) scale(${to ? 0.6 : 1})`
      g.style.opacity = to ? '0' : '1'
      window.setTimeout(done, 260)
    }

    const end = (drop: boolean) => {
      clearHold(); clearEdge()
      if (raf) { cancelAnimationFrame(raf); raf = 0 }
      if (mode === 'drag') {
        const d = drop ? dayAt(px, py) : null
        setHot(null)
        document.documentElement.classList.remove('cal-dragging')
        // The card's hover preview stays shut a moment after a drop (the pointer rests on the card).
        document.documentElement.classList.add('cal-dropped'); window.setTimeout(() => document.documentElement.classList.remove('cal-dropped'), 1500)
        swallowClick()
        const id = item?.dataset.calId, lane = item?.dataset.calLane
        land(d ? d.getBoundingClientRect() : null)
        if (d && id && lane && d.dataset.calDay) o.current.onDrop(id, lane, d.dataset.calDay)
      } else if (mode === 'swipe') {
        const w = el.clientWidth || 1
        const dx = lx - sx
        const dir: -1 | 0 | 1 = dx < -w * 0.18 || vx < -0.45 ? 1 : dx > w * 0.18 || vx > 0.45 ? -1 : 0
        swallowClick()
        o.current.onSwipeEnd(dir, dx)
      }
      mode = 'idle'; item = null; pid = -1
    }

    const down = (e: PointerEvent) => {
      if (mode !== 'idle' || (e.pointerType === 'mouse' && e.button !== 0)) return
      const t = e.target as HTMLElement
      if (t.closest('input,select,textarea,[data-cal-nogesture]')) return
      pid = e.pointerId
      sx = lx = e.clientX; sy = e.clientY; lt = e.timeStamp; vx = 0
      item = t.closest<HTMLElement>('[data-cal-id]')
      noswipe = !!t.closest('[data-cal-noswipe]')
      if (e.pointerType === 'mouse') { mode = item ? 'pending' : 'idle'; return }
      mode = 'press'
      if (item) hold = window.setTimeout(() => { hold = 0; if (mode === 'press') lift() }, HOLD_MS)
    }
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pid || mode === 'idle') return
      const dx = e.clientX - sx, dy = e.clientY - sy
      const dt = Math.max(1, e.timeStamp - lt)
      vx = vx * 0.4 + ((e.clientX - lx) / dt) * 0.6
      lx = e.clientX; lt = e.timeStamp
      if (mode === 'pending') {
        if (Math.hypot(dx, dy) > 5) lift()
        return
      }
      if (mode === 'press') {
        if (Math.hypot(dx, dy) < SLOP) return
        clearHold()
        if (!noswipe && Math.abs(dx) > Math.abs(dy) * 1.2) { mode = 'swipe'; try { el.setPointerCapture(pid) } catch { /* gone */ } }
        else { mode = 'idle'; item = null }
        return
      }
      if (mode === 'swipe') { o.current.onSwipeMove(dx); return }
      if (mode === 'drag') { px = e.clientX; py = e.clientY; if (!raf) raf = requestAnimationFrame(paint) }
    }
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pid) return
      // A quick release can land beyond the last pointermove, including the
      // move that only lifted the card. Hit-test where the pointer was released.
      if (mode === 'drag') { px = e.clientX; py = e.clientY }
      end(true)
    }
    const cancel = (e: PointerEvent) => { if (e.pointerId === pid) end(false) }
    // A finger holding a lifted post must not scroll the page. Registered
    // non-passive up front: the browser decides on the FIRST touchmove.
    const touchmove = (e: TouchEvent) => { if (mode === 'drag' || mode === 'swipe') e.preventDefault() }
    const menu = (e: Event) => { if (mode !== 'idle' || (e.target as HTMLElement).closest('[data-cal-id]')) e.preventDefault() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && mode === 'drag') end(false) }
    const nativeDrag = (e: DragEvent) => { if ((e.target as HTMLElement).closest?.('[data-cal-id]')) e.preventDefault() }

    el.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    el.addEventListener('touchmove', touchmove, { passive: false })
    el.addEventListener('contextmenu', menu)
    el.addEventListener('dragstart', nativeDrag)
    window.addEventListener('keydown', key)
    return () => {
      end(false)
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      el.removeEventListener('touchmove', touchmove)
      el.removeEventListener('contextmenu', menu)
      el.removeEventListener('dragstart', nativeDrag)
      window.removeEventListener('keydown', key)
    }
  }, [root])
}
