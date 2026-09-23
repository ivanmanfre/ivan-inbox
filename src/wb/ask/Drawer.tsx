/* ==========================================================================
   src/wb/ask/Drawer.tsx — goal run inbox-agent-drawer-2026-09-12, Seat B.

   2026-09-23 (Ivan): "that claude sheet on the right is so annoying... it's
   occupying so much space... It should just be a small icon". Collapsed is now
   ZERO width: the rail's own Claude item (icon + live dot + unread dot) is the
   one way in, so the 72px column of two duplicate glyphs is gone.

   D2: Claude is no longer a peer on desktop. It is a persistent right column
   of the plate: 72px collapsed (a stack of two ways to open it, plus a live
   dot while a turn is running), 380px open (the exact pane Shell used to dock
   as the `chat` peer, unchanged — only where it lives moved). Shell decides
   WHETHER the pane is mounted (only while open, so the lazy Ask chunk is not
   paid for on every desktop boot); this component only ever draws the shell
   around it and the two controls that open it.

   Nothing here reads localStorage or the hash — that state lives in Shell
   (`wb-drawer`), because Shell is the one place that already persists
   `wb-railmin` the same way and the two toggles should not drift apart into
   two different storage patterns for the same kind of "how I left it" state.
   ========================================================================== */
import { motion, useReducedMotion } from 'motion/react'
import { fadeT } from '../../ds'
import type { ReactNode } from 'react'

export function Drawer({
  open, children,
}: {
  open: boolean
  /** The pane Shell built for the `chat` peer today (BrainAsk or
      AskPaneDirect, `onClose` wired to the collapse). Only rendered by the
      caller while `open`, so pass `null` while collapsed. */
  children: ReactNode
}) {
  const reduced = useReducedMotion()
  return (
    <aside className="a-drawer" data-open={open || undefined} data-drawer>
      {open ? (
        /* The column's WIDTH is animated by CSS (`.a-drawer` in chrome.css);
           what mounts inside it arrives on a fade, so the pane does not snap
           into existence a frame before the column has finished widening.
           Opacity only — no transform — because the pane holds a `position:
           fixed` sheet (the feed) and a transformed ancestor would position it
           against this box instead of the viewport. */
        <motion.div
          className="a-drawer-pane"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={fadeT}
        >{children}</motion.div>
      ) : null}
    </aside>
  )
}
