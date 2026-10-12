import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent } from 'react'

// Hover intent for the Weeks cards (spec 2026-10-12 §3a): 500 ms to open the first card, 80 ms while scanning
// ("warm": a card is open, or one closed less than 900 ms ago), 140 ms to close. Keyboard focus opens like hover.
// A touch pointer never opens it, and nothing opens when `enabled` is false (phone, no hovering pointer).

export const HOVER_OPEN_MS = 500
export const HOVER_WARM_MS = 80
export const HOVER_CLOSE_MS = 140
export const HOVER_WARM_WINDOW_MS = 900

type Bind = {
  onPointerEnter: (e: PointerEvent<HTMLElement>) => void
  onPointerLeave: (e: PointerEvent<HTMLElement>) => void
  onFocus: (e: FocusEvent<HTMLElement>) => void
  onBlur: (e: FocusEvent<HTMLElement>) => void
}

export function useHoverIntent(enabled = true): { bind: (key: string) => Bind; open: string | null; anchor: DOMRect | null; close: () => void } {
  const [state, setState] = useState<{ key: string; anchor: DOMRect } | null>(null)
  const tOpen = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tClose = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openKey = useRef<string | null>(null)
  const lastClosed = useRef(Number.NEGATIVE_INFINITY)
  const on = useRef(enabled)
  const quiet = useRef(false)
  const was = useRef(enabled)
  useLayoutEffect(() => { on.current = enabled }, [enabled])

  const clear = useCallback(() => {
    if (tOpen.current) clearTimeout(tOpen.current)
    if (tClose.current) clearTimeout(tClose.current)
    tOpen.current = tClose.current = null
  }, [])
  const shut = useCallback(() => {
    if (openKey.current != null) lastClosed.current = Date.now()
    openKey.current = null
    setState(null)
  }, [])
  const close = useCallback(() => { clear(); shut() }, [clear, shut])

  const enter = useCallback((key: string, el: HTMLElement) => {
    if (!on.current) return
    if (tClose.current) { clearTimeout(tClose.current); tClose.current = null }
    if (tOpen.current) { clearTimeout(tOpen.current); tOpen.current = null }
    if (openKey.current === key) return
    const warm = openKey.current != null || Date.now() - lastClosed.current < HOVER_WARM_WINDOW_MS
    tOpen.current = setTimeout(() => {
      tOpen.current = null
      if (!on.current) return
      openKey.current = key
      setState({ key, anchor: el.getBoundingClientRect() })
    }, warm ? HOVER_WARM_MS : HOVER_OPEN_MS)
  }, [])
  const leave = useCallback(() => {
    if (tOpen.current) { clearTimeout(tOpen.current); tOpen.current = null }
    if (openKey.current == null || tClose.current) return
    tClose.current = setTimeout(() => { tClose.current = null; shut() }, HOVER_CLOSE_MS)
  }, [shut])

  const bind = useCallback((key: string): Bind => ({
    onPointerEnter: e => { if (e.pointerType !== 'touch') { quiet.current = false; enter(key, e.currentTarget) } },
    onPointerLeave: e => { if (e.pointerType !== 'touch') leave() },
    onFocus: e => { if (!quiet.current) enter(key, e.currentTarget) },
    onBlur: () => leave(),
  }), [enter, leave])

  // Turned off (the panel opened, layout or pointer changed): nothing stays open, no timer fires later. After it
  // turns back on it stays quiet: the focus that returns to the card does not reopen it, until the pointer moves
  // or a keyboard user moves on (Tab or an arrow key: the keydown comes before the focus it moves).
  useEffect(() => {
    const before = was.current
    was.current = enabled
    if (!enabled) { close(); if (before) quiet.current = true; return }
    if (!quiet.current) return
    const off = () => { window.removeEventListener('pointermove', wake); window.removeEventListener('keydown', key, true) }
    const wake = () => { quiet.current = false; off() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Tab' || e.key.startsWith('Arrow')) wake() }
    window.addEventListener('pointermove', wake)
    window.addEventListener('keydown', key, true)
    return off
  }, [enabled, close])
  useEffect(() => clear, [clear])

  return { bind, open: state?.key ?? null, anchor: state?.anchor ?? null, close }
}
