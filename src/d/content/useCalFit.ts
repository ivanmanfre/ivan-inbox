import { useLayoutEffect, useState, type RefObject } from 'react'

// THE CALENDAR FILLS THE WINDOW (Ivan 2026-10-15: "the card can be slightly bigger ... it occupies
// a lot of space vertically", the month grid sat in short fixed rows over a big empty area, and the
// No date yet list ran far below it so a post down the list could not be dragged onto a day).
//
// Measures the room the calendar body has in its scrolling column and writes it as `--cal-fit`
// (px) on the section, so CSS can size the month grid's rows and the side rail to exactly the
// window: the grid fills it, the rail scrolls inside itself. Also reports the calendar's own width
// class, because the draft window can narrow the column without the main tier changing:
//   roomy  >= 1060 px  grid + 300 px rail
//   mid    >=  820 px  grid + 252 px rail
//   narrow  <  820 px  grid on top, the day list under it, the buffer as a dock pinned to the bottom
// Desktop only; the phone keeps its page scroll. Writes a style property, never React state per
// frame: the size class changes only when a threshold is crossed.

export type CalSize = 'roomy' | 'mid' | 'narrow'
export const FIT_MIN = 540
const BOTTOM_PAD = 14

export function sizeOf(w: number): CalSize {
  return w >= 1060 ? 'roomy' : w >= 820 ? 'mid' : 'narrow'
}

function scroller(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY
    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return p
  }
  return null
}

export function useCalFit(root: RefObject<HTMLElement | null>, body: RefObject<HTMLElement | null>, enabled: boolean, deps: readonly unknown[]): CalSize {
  const [size, setSize] = useState<CalSize>('roomy')
  useLayoutEffect(() => {
    const el = root.current
    if (!el || !enabled) { el?.style.removeProperty('--cal-fit'); return }
    const sc = scroller(el)
    let raf = 0
    const measure = () => {
      raf = 0
      const b = body.current
      if (!b) return
      const top = b.getBoundingClientRect().top
      // The body's top inside the scrolled content, so the answer does not change with the scroll.
      const scTop = sc ? sc.getBoundingClientRect().top : 0
      const offset = top - scTop + (sc ? sc.scrollTop : window.scrollY)
      const room = (sc ? sc.clientHeight : window.innerHeight) - offset - BOTTOM_PAD
      const fit = Math.max(FIT_MIN, Math.round(room))
      if (el.style.getPropertyValue('--cal-fit') !== `${fit}px`) el.style.setProperty('--cal-fit', `${fit}px`)
      const next = sizeOf(el.clientWidth)
      setSize(s => (s === next ? s : next))
    }
    const later = () => { if (!raf) raf = requestAnimationFrame(measure) }
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(later)
    ro?.observe(el)
    if (sc) ro?.observe(sc)
    window.addEventListener('resize', later)
    return () => { ro?.disconnect(); window.removeEventListener('resize', later); if (raf) cancelAnimationFrame(raf) }
  }, [enabled, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps
  return size
}
