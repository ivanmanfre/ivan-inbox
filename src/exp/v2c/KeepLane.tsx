/* ==========================================================================
   KeepLane: one phone lane, kept mounted after its first visit.

   Native tab bars keep every tab alive. The phone used to unmount the lane it
   left and mount the one it opened, so every tap paid a full render, re-fired
   the lane's reads and dropped the scroll position (feel probe, 2026-09-25:
   Today 392ms tap-to-paint and 13 requests on every visit).

   A visited lane now stays in the tree. Every lane is stacked in one box
   (`.wb-lanes`), each absolutely filling it. While inactive a lane is:
   - `data-off`: `content-visibility:hidden` (never `visibility`, which is
     inherited and restyles the whole lane on every flip). The
     browser keeps its style and layout and skips its paint, so showing it
     again is a repaint, not a restyle of a few thousand nodes (display:none
     threw that state away and cost 40-60ms of style recalc at 4x CPU).
   - `inert`: no focus, no taps, out of the accessibility tree. The command
     layer's row walkers skip rows inside `[inert]`, because these rows keep
     their boxes and an offsetParent test alone would still find them.
   - FROZEN: `Frozen` below skips every re-render the Shell does while the lane
     is hidden (and the one that hides it), so an inbox refresh costs nothing
     for five hidden lanes. It re-renders with fresh props when shown again.
   - cut off from the phone chrome's head slot (RibSlotCtx is null inside), so
     only the visible lane's head adopts the chrome tiles.

   Scroll offsets are recorded while the lane is shown and written back when it
   is shown again: a belt for any engine without content-visibility, and for
   the phone chrome's own covers (Claude, a thread), which are display:none.

   The phone chrome can also cover EVERY lane at once (the Claude place, a DM
   thread takeover). It says so through LaneShownCtx, so the lane under the
   cover stays frozen and gets its scroll back when it is uncovered.

   Every hook sits above the one return; there is no early return here.
   ========================================================================== */
import { createContext, isValidElement, memo, useContext, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { RibSlotCtx } from '../../wb/kit'

/** False while the phone chrome covers every lane (Claude, a thread takeover). */
export const LaneShownCtx = createContext(true)

type Props = { active: boolean; lane: string; children: ReactNode }

/**
 * The same element tree, as far as a lane can tell: same types, keys and
 * values all the way down, with any two FUNCTIONS counted as equal. Every
 * function a lane is handed by the Shell is a state setter, a stable callback,
 * or a closure over those plus values that are themselves props (the lane,
 * the thread list), so a new function object alone never means new content.
 * Plain objects are compared by identity: a new one re-renders.
 */
export function sameTree(a: unknown, b: unknown, depth = 0): boolean {
  if (Object.is(a, b)) return true
  if (typeof a === 'function' && typeof b === 'function') return true
  if (depth > 16) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => sameTree(x, b[i], depth + 1))
  }
  if (isValidElement(a) && isValidElement(b)) {
    if (a.type !== b.type || a.key !== b.key) return false
    const pa = a.props as Record<string, unknown>
    const pb = b.props as Record<string, unknown>
    const ka = Object.keys(pa)
    return ka.length === Object.keys(pb).length && ka.every(k => k in pb && sameTree(pa[k], pb[k], depth + 1))
  }
  return false
}

/** The lane's content. It renders only while the lane is shown and only when
    its tree changed: leaving, staying hidden, and coming back to a lane whose
    data did not move all keep the last render. `minute` is part of the tree
    so relative ages ("3m ago") are never more than a minute old on reveal. */
const Frozen = memo(
  ({ children }: { active: boolean; minute: number; children: ReactNode }) => <>{children}</>,
  (a, b) => !b.active || (a.minute === b.minute && sameTree(a.children, b.children)),
)

export function KeepLane({ active, lane, children }: Props) {
  const slot = useContext(RibSlotCtx)
  const covered = !useContext(LaneShownCtx)
  const visible = active && !covered
  const host = useRef<HTMLDivElement>(null)
  const offsets = useRef(new Map<Element, [number, number]>())
  // Read by the scroll recorder: a lane being hidden can report a reset offset,
  // and that must not overwrite the one the reader left it at.
  const shown = useRef(visible)
  shown.current = visible

  // Record every scroller's offset inside this lane as it moves. Scroll events
  // do not bubble, so this listens in the capture phase.
  useEffect(() => {
    const el = host.current
    if (!el) return
    const seen = offsets.current
    const on = (e: Event) => {
      const t = e.target
      if (!shown.current) return
      if (t instanceof Element && el.contains(t)) seen.set(t, [t.scrollTop, t.scrollLeft])
    }
    el.addEventListener('scroll', on, { capture: true, passive: true })
    return () => el.removeEventListener('scroll', on, { capture: true })
  }, [])

  // Shown again: put every scroller back before the frame paints.
  useLayoutEffect(() => {
    if (!visible) return
    for (const [t, [top, left]] of offsets.current) {
      if (!t.isConnected) { offsets.current.delete(t); continue }
      if (t.scrollTop !== top) t.scrollTop = top
      if (t.scrollLeft !== left) t.scrollLeft = left
    }
  }, [visible])

  return (
    <div
      ref={host}
      className="wb-lane"
      data-lane={lane}
      data-off={active ? undefined : ''}
      inert={!active}
    >
      {/* The slot follows `active`, not `visible`: under a cover (Claude, a
          thread) nothing else wants the tiles, and keeping them where they are
          means uncovering the lane moves nothing. */}
      <RibSlotCtx.Provider value={active ? slot : null}>
        <Frozen active={visible} minute={Math.floor(Date.now() / 60_000)}>{children}</Frozen>
      </RibSlotCtx.Provider>
    </div>
  )
}
