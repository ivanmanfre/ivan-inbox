import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// AN ANCHORED POPOVER, and it exists because a native `title` is not one.
//
// What it replaces: `ContentCalendar.tsx` passed `title={tip}` to the chip's
// face. A native title cannot be styled, waits about a second before it opens,
// is unreachable by keyboard, and the browser puts it where the browser likes,
// which is what Ivan saw when the tooltip landed nowhere near the cell it was
// describing.
//
// NO NEW DEPENDENCY. The app has exactly three and keeps three. Positioning is
// `getBoundingClientRect` plus arithmetic, rendered through `createPortal` from
// react-dom, which is already one of the three. CSS anchor positioning was the
// other candidate and is not used: `anchor-name` is Chrome 125+ with no Safari
// or Firefox support at the time of writing, so it would have been a fallback
// path plus this path, which is two implementations of one thing.
//
// THE ONE RULE THAT IS NOT ABOUT TASTE: the popover must never cover the cell
// it describes. It is positioned against the AVOID rect (the day cell), not
// against the chip, so it lands outside the cell rather than on top of the
// eleven other things in it. Vertical placement flips when there is no room
// below; horizontal placement clamps to the viewport, which is the case that
// breaks at the right edge and is why every edge is in the evidence.

const GUTTER = 8

export type Placed = { top: number; left: number; side: 'below' | 'above' }

/**
 * Where the panel goes, given what it is anchored to and what it must not
 * cover. Exported and pure so the edge cases are testable without a browser:
 * the four corners are arithmetic, not a screenshot.
 */
export function place(
  anchor: { left: number; right: number; top: number; bottom: number },
  avoid: { left: number; right: number; top: number; bottom: number },
  size: { w: number; h: number },
  vp: { w: number; h: number },
): Placed {
  // BELOW THE CELL FIRST. Reading order runs down the month, so a panel under
  // the day it belongs to is the one that does not make the eye jump back.
  let side: 'below' | 'above' = 'below'
  let top = avoid.bottom + GUTTER
  if (top + size.h > vp.h - GUTTER) {
    const above = avoid.top - GUTTER - size.h
    // Flip only if flipping actually buys room. On a short viewport neither
    // side fits and the panel is clamped into view rather than being pushed
    // off the bottom, because a tooltip you cannot read is worse than one
    // sitting closer to its cell than the gutter would like.
    if (above >= GUTTER) { side = 'above'; top = above }
    else top = Math.max(GUTTER, vp.h - GUTTER - size.h)
  }
  // Aligned to the CHIP horizontally, because that is the thing being pointed
  // at, then clamped. The clamp is the right-edge fix: without it a panel on a
  // Saturday cell runs past the viewport and the text is unreachable.
  let left = anchor.left
  if (left + size.w > vp.w - GUTTER) left = vp.w - GUTTER - size.w
  if (left < GUTTER) left = GUTTER
  return { top, left, side }
}

/**
 * The panel itself.
 *
 * `anchor` is the element the pointer or the focus ring is on. `avoid` is the
 * rect it may not cover, and defaults to the anchor. Both are read live at
 * render, at scroll and at resize, so the panel tracks the grid instead of
 * detaching from it.
 */
export function CalPopover({ id, role, label, anchorEl, avoidEl, onDismiss, children }: {
  id: string
  role: 'tooltip' | 'dialog'
  label?: string
  anchorEl: HTMLElement | null
  avoidEl?: HTMLElement | null
  onDismiss: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<Placed | null>(null)
  // Two frames, deliberately: the panel is measured at opacity 0 and only then
  // told to animate in, so the spring runs from the RIGHT place. Springing from
  // 0,0 to the anchor is the flicker every hand-rolled popover ships with once.
  const [shown, setShown] = useState(false)

  const measure = useCallback(() => {
    const el = ref.current
    if (!el || !anchorEl) return
    const a = anchorEl.getBoundingClientRect()
    const v = (avoidEl ?? anchorEl).getBoundingClientRect()
    const r = el.getBoundingClientRect()
    setPos(place(a, v, { w: r.width, h: r.height }, { w: window.innerWidth, h: window.innerHeight }))
  }, [anchorEl, avoidEl])

  useLayoutEffect(() => {
    measure()
    const f = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(f)
  }, [measure])

  useEffect(() => {
    const on = () => measure()
    // `true` on scroll: the grid scrolls inside a pane, not on the window, and
    // a non-capturing window listener never hears that.
    window.addEventListener('scroll', on, true)
    window.addEventListener('resize', on)
    return () => {
      window.removeEventListener('scroll', on, true)
      window.removeEventListener('resize', on)
    }
  }, [measure])

  // ESCAPE, on the document, because a tooltip opened by hover has no focus to
  // hang a handler on and the key still has to work.
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onDismiss() } }
    document.addEventListener('keydown', k, true)
    return () => document.removeEventListener('keydown', k, true)
  }, [onDismiss])

  // A DIALOG TAKES FOCUS, a tooltip never does. The overflow panel is opened by
  // a click or by Enter on the "+N" button and its rows are real controls, so
  // the caret has to be inside it; a tooltip is a description of something the
  // focus is already on, and moving focus into it would take the focus off the
  // thing being described.
  useEffect(() => {
    if (role !== 'dialog') return
    const f = ref.current?.querySelector<HTMLElement>('button:not(:disabled), [tabindex="0"]')
    f?.focus()
  }, [role])

  if (!anchorEl) return null
  return createPortal(
    <>
      {/* LIGHT DISMISS, dialog only. Transparent, full-viewport, and BEHIND the
          panel: a click anywhere else closes it, which is the behaviour every
          menu on this app already has and the one a mouse operator tries
          first. A tooltip gets none of this because it closes when the pointer
          or the focus leaves the chip. */}
      {role === 'dialog' && (
        <div className="cal-pop-scrim" onMouseDown={onDismiss} aria-hidden />
      )}
    <div
      ref={ref}
      id={id}
      role={role}
      aria-label={label}
      aria-modal={role === 'dialog' ? false : undefined}
      className="cal-pop"
      data-side={pos?.side ?? 'below'}
      data-in={shown && pos ? '1' : '0'}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
    >
      {children}
    </div>
    </>,
    document.body,
  )
}
