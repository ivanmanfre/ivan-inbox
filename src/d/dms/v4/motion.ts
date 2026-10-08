// Brief 4 DMs motion hooks (SPEC-dms §2.9). Pointer listeners and CSS custom properties only: no
// React state, so a hover never re-renders a row. Call them unconditionally at the top of the
// component that owns the element, with `enabled` as an argument (09-09 hook rule).
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

/** el's box inside `box`, from offset* so a parent mid-transform cannot skew it. */
function offsetIn(el: HTMLElement, box: HTMLElement): { x: number; y: number; w: number; h: number } | null {
  let x = 0, y = 0
  let node: HTMLElement | null = el
  while (node && node !== box) {
    x += node.offsetLeft; y += node.offsetTop
    node = node.offsetParent as HTMLElement | null
  }
  return node === box ? { x, y, w: el.offsetWidth, h: el.offsetHeight } : null
}

/** One hover pill per list: it glides between rows (150ms) and fades on leave; never over the selected row. */
export function useHoverPill(ref: RefObject<HTMLElement | null>, rowSel: string, enabled: boolean) {
  useEffect(() => {
    const box = ref.current
    if (!box || !enabled || typeof window.matchMedia !== 'function' || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    let on = false
    const put = (r: { x: number; y: number; w: number; h: number }) => {
      box.style.setProperty('--hx', `${r.x}px`); box.style.setProperty('--hy', `${r.y}px`)
      box.style.setProperty('--hw', `${r.w}px`); box.style.setProperty('--hh', `${r.h}px`)
    }
    const off = () => { on = false; box.style.setProperty('--ho', '0') }
    const over = (e: PointerEvent) => {
      const row = (e.target as Element | null)?.closest?.(rowSel) as HTMLElement | null
      if (!row || !box.contains(row) || row.matches('.dm-sel')) { off(); return }
      const r = offsetIn(row, box)
      if (!r) return
      if (!on) { box.classList.add('dx-snap'); put(r); void box.offsetWidth; box.classList.remove('dx-snap') } else put(r)
      on = true
      box.style.setProperty('--ho', '1')
    }
    box.addEventListener('pointerover', over)
    box.addEventListener('pointerleave', off)
    return () => { box.removeEventListener('pointerover', over); box.removeEventListener('pointerleave', off) }
  }, [ref, rowSel, enabled])
}

/** A measured segmented thumb: writes --tx/--tw on the track for the [aria-selected=true] tab. */
export function useThumb(ref: RefObject<HTMLElement | null>, trackSel: string, pick: string, enabled: boolean) {
  const previous = useRef(pick)
  useLayoutEffect(() => {
    const host = ref.current
    const track = host?.matches(trackSel) ? host : host?.querySelector<HTMLElement>(trackSel)
    if (!track || !enabled) return
    const place = () => {
      const on = track.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      if (!on || !on.offsetWidth) { track.removeAttribute('data-dx-thumb'); return }
      track.style.setProperty('--tx', `${on.offsetLeft}px`); track.style.setProperty('--tw', `${on.offsetWidth}px`)
      track.setAttribute('data-dx-thumb', '1')
    }
    place()
    if (previous.current !== pick && !document.hidden && !document.documentElement.classList.contains('brief-motion-off') && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      track.classList.remove('dx-thumb-jump'); void track.offsetWidth; track.classList.add('dx-thumb-jump')
    }
    previous.current = pick
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(place)
    ro.observe(track)
    return () => ro.disconnect()
  }, [ref, trackSel, pick, enabled])
}

/** The open thread stays at its end when the dock grows (the composer opens) or late content lands,
 *  unless he scrolled up to read. Replaces Brief 3.0's injected pin for the v4 thread. */
export function useStickToEnd(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled || typeof ResizeObserver === 'undefined') return
    const atEnd = () => el.scrollHeight - el.scrollTop - el.clientHeight < 24
    let pinned = atEnd()
    const onScroll = () => { pinned = atEnd() }
    const ro = new ResizeObserver(() => { if (pinned) el.scrollTop = el.scrollHeight })
    ro.observe(el)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => { ro.disconnect(); el.removeEventListener('scroll', onScroll) }
  }, [ref, enabled])
}
