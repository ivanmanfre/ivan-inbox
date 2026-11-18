import { useEffect, type RefObject } from 'react'

/**
 * iOS keeps the layout viewport full height when the keyboard opens and only
 * shrinks the VISUAL viewport, so a bottom composer ends up under the keyboard.
 * This writes the covered height to `--dk-kb` on the element (0 when closed) and
 * pins the window's scroll at 0 so focus never jumps the page. The composer sits
 * `--dk-kb` above the bottom. Browsers without visualViewport keep 0.
 */
export function keyboardInset(innerHeight: number, vvHeight: number, vvOffsetTop: number): number {
  const covered = innerHeight - (vvHeight + vvOffsetTop)
  return covered > 40 ? Math.round(covered) : 0
}

/** The keyboard (or anything like it) takes more than 40 px of the visible height. */
export function keyboardOpen(innerHeight: number, vvHeight: number): boolean {
  return innerHeight - vvHeight > 40
}

export function useKeyboardInset(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    const el = ref.current
    if (!vv || !el) return
    let raf = 0
    const sync = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        // The keyboard is up when the visible height drops; the top and bottom insets are measured apart, so a
        // visual viewport iOS pans up (offsetTop > 0, nothing covered below) still puts the head at its top.
        const open = keyboardOpen(window.innerHeight, vv.height)
        // Open: the whole covered height counts, however small (a panned viewport can leave 36 px under the keys).
        const kb = open ? Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop))) : keyboardInset(window.innerHeight, vv.height, vv.offsetTop)
        el.style.setProperty('--dk-vh', `${Math.round(vv.height)}px`)
        el.style.setProperty('--dk-kb', `${kb}px`)
        el.style.setProperty('--dk-top', `${open ? Math.max(0, Math.round(vv.offsetTop)) : 0}px`)
        el.toggleAttribute('data-kb', open)
        // iOS scrolls the whole page to reveal a focused field; the desk already moved the field up.
        if (open && window.scrollY !== 0) window.scrollTo(0, 0)
      })
    }
    sync()
    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync)
    return () => { cancelAnimationFrame(raf); vv.removeEventListener('resize', sync); vv.removeEventListener('scroll', sync) }
  }, [ref])
}
