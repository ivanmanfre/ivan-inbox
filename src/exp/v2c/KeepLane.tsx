/* ==========================================================================
   KeepLane: one phone lane, kept mounted after its first visit.

   Native tab bars keep every tab alive. The phone used to unmount the lane it
   left and mount the one it opened, so every tap paid a full render, re-fired
   the lane's reads and dropped the scroll position (feel probe, 2026-09-25:
   Today 392ms tap-to-paint and 13 requests on every visit).

   A visited lane now stays in the tree. While inactive it is:
   - `hidden` (display:none) and `inert`: no paint, no focus, no taps. The
     command layer's row walkers already skip rows with no offsetParent.
   - FROZEN: `Frozen` below skips every re-render the Shell does while the lane
     is hidden (and the one that hides it), so an inbox refresh costs nothing
     for five hidden lanes. It re-renders with fresh props when shown again.
   - cut off from the phone chrome's head slot (RibSlotCtx is null inside), so
     only the visible lane's head adopts the chrome tiles.

   Scroll offsets are recorded while the lane is shown and written back when it
   is shown again: WebKit drops a scroller's offset across display:none.

   The phone chrome can also cover EVERY lane at once (the Claude place, a DM
   thread takeover). It says so through LaneShownCtx, so the lane under the
   cover stays frozen and gets its scroll back when it is uncovered.

   Every hook sits above the one return; there is no early return here.
   ========================================================================== */
import { createContext, memo, useContext, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { RibSlotCtx } from '../../wb/kit'

/** False while the phone chrome covers every lane (Claude, a thread takeover). */
export const LaneShownCtx = createContext(true)

type Props = { active: boolean; lane: string; children: ReactNode }

/** The lane's content. It renders only while the lane is shown: leaving and
    staying hidden both keep the last render, so a hidden lane costs nothing. */
const Frozen = memo(
  ({ children }: { active: boolean; children: ReactNode }) => <>{children}</>,
  (_a, b) => !b.active,
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
      hidden={!active}
      inert={!active}
    >
      {/* The slot follows `active`, not `visible`: under a cover (Claude, a
          thread) nothing else wants the tiles, and keeping them where they are
          means uncovering the lane moves nothing. */}
      <RibSlotCtx.Provider value={active ? slot : null}>
        <Frozen active={visible}>{children}</Frozen>
      </RibSlotCtx.Provider>
    </div>
  )
}
