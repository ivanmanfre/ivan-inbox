import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'

// One selection pill and one hover pill per nav that glide between rows, as Brief's native sidebar
// does (matchedGeometryEffect "selection" / "hover"). Ivan 2026-10-08: the web "doesn't feel like the
// inbox app ... less stylish and worse animations".

export type GlideRect = { x: number; y: number; w: number; h: number }

/** Where el sits inside box, from offset* so a parent mid-transform cannot skew it. Null when el is outside box. */
export function rectIn(el: HTMLElement, box: HTMLElement): GlideRect | null {
  let x = 0, y = 0
  let n: HTMLElement | null = el
  while (n && n !== box) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent as HTMLElement | null }
  return n === box ? { x, y, w: el.offsetWidth, h: el.offsetHeight } : null
}

export function glideStyle(r: GlideRect | null) {
  return r ? { transform: `translate(${r.x}px,${r.y}px)`, width: r.w, height: r.h } : undefined
}

/** `dep` changes whenever the selected row may have moved (the route). */
export function useNavGlide(dep: string) {
  const ref = useRef<HTMLElement>(null)
  const [sel, setSel] = useState<GlideRect | null>(null)
  const [hov, setHov] = useState<GlideRect | null>(null)
  // The first placement never animates: the pill is simply there, it glides only when it moves.
  const [ready, setReady] = useState(false)
  const measure = useCallback(() => {
    const box = ref.current
    if (!box) return
    const on = box.querySelector<HTMLElement>('a.d-on')
    setSel(on ? rectIn(on, box) : null)
  }, [])
  useLayoutEffect(() => { measure() }, [dep, measure])
  useLayoutEffect(() => {
    const box = ref.current
    const id = requestAnimationFrame(() => setReady(true))
    if (!box || typeof ResizeObserver === 'undefined') return () => cancelAnimationFrame(id)
    const ro = new ResizeObserver(measure)
    ro.observe(box)
    return () => { cancelAnimationFrame(id); ro.disconnect() }
  }, [measure])
  const onPointerOver = useCallback((e: PointerEvent) => {
    const box = ref.current
    const row = (e.target as HTMLElement).closest<HTMLElement>('a,button')
    if (!box || !row || !box.contains(row) || row.classList.contains('d-on')) { setHov(null); return }
    setHov(rectIn(row, box))
  }, [])
  const onPointerLeave = useCallback(() => setHov(null), [])
  return { ref, sel, hov, ready, onPointerOver, onPointerLeave }
}
