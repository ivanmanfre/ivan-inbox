/* ==========================================================================
   src/wb/takeover/index.tsx — the shared window shell (S16, S17, S18).

   The reading register Ivan asked back for: "when i open a content idea or
   review do not just open it on the side its literally impossible to read…
   make it like before on the interface that opens a window so i can properly
   read". A draft, a lead magnet or a call opens as an overlay over the canvas,
   never as a 420px peer. The CHAT peer and ThreadPeer are untouched.

   Rebuilt from src/exp/v2c/Takeover.tsx on `src/ds`. The prop names are the
   old ones (`label`, `sub`, `onClose`, `mobile`, `children`, `bodyClass`), so
   W3's magnet window and W4's call window can move over one file at a time and
   keep a fallback to the old shell while they do.

   What it gains is the three-pane form the panes PICKS §1 composites (rail
   mechanic from `shadcn/sidebar`, grouped section labels and count pills from
   `arunjdass/dashboard-sidebar`): an optional queue `rail` on the left, the
   document in the middle, an optional inspector `peer` on the right, and a
   `foot` that sticks under the document rather than scrolling away with it.
   Below 1180px the two rails fold under the document in a single column and
   stay reachable by scroll; nothing is dropped at any width.

   Layer: `--ds-z-dialog` minus one, because the confirm sheets this window
   opens (ds Dialog / Sheet) have to land ON TOP of it.
   ========================================================================== */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { IconButton } from '../../ds'
import { fadeT, spring } from '../../ds/motion'
import './takeover.css'

export interface TakeoverProps {
  /** The window's own name, and its accessible name. */
  label: string
  sub?: ReactNode
  onClose: () => void
  mobile: boolean
  children: ReactNode
  /** Header controls that belong to the window, not to the document. */
  tail?: ReactNode
  /** The queue rail. Left of the document on a wide canvas, under it below 1180. */
  rail?: ReactNode
  /** The inspector. Right of the document on a wide canvas, under it below 1180. */
  peer?: ReactNode
  /** Pinned under the document, inside its column: the decision bar. */
  foot?: ReactNode
  /**
   * Opt OUT of the centred reading measure. A window that owns its own
   * geometry (the draft window's three panes) passes its own class; a plain
   * reader gets the comfortable column by default.
   */
  bodyClass?: string
}

export function Takeover({
  label, sub, onClose, mobile, children, tail, rail, peer, foot, bodyClass,
}: TakeoverProps) {
  // Esc closes, from anywhere — the window is modal.
  //
  // 🔴 EXCEPT out of a field. This listener is a NATIVE one on `window`; React
  // attaches its synthetic handlers at the root container, which is BELOW
  // window, so a `stopPropagation()` inside a textarea's onKeyDown cannot stop
  // it. Before this guard, Escape in the draft editor cancelled the edit AND
  // closed the whole window in the same keypress — the inner meaning of Escape
  // (leave this field) has to win over the outer one (leave this window), and
  // the second Escape still closes because the field is no longer focused.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)) return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const panes = Boolean(rail || peer)

  return (
    <AnimatePresence>
      <motion.div
        className="a-tk-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={fadeT}
        // Backdrop click closes on desktop. On the phone the window IS the
        // screen, so there is no backdrop to click and the back chevron and
        // the close mark carry it.
        onClick={mobile ? undefined : onClose}
      >
        <motion.section
          className="a-tk"
          data-panes={panes ? '' : undefined}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          initial={{ opacity: 0, scale: mobile ? 1 : 0.98, y: mobile ? 24 : 0 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: mobile ? 1 : 0.98 }}
          transition={spring}
          onClick={e => e.stopPropagation()}
        >
          <header className="a-tk-head">
            {mobile && (
              <IconButton icon="back" label="Back" variant="ghost" onClick={onClose} />
            )}
            <span className="a-tk-ttl">
              <span className="a-tk-n">{label}</span>
              {sub ? <span className="a-tk-s">{sub}</span> : null}
            </span>
            {tail ? <span className="a-tk-tail">{tail}</span> : null}
            <IconButton icon="close" label="Close" variant="ghost" onClick={onClose} />
          </header>

          <div className={`a-tk-body${bodyClass ? ` ${bodyClass}` : ''}`}>
            {rail ? <aside className="a-tk-rail">{rail}</aside> : null}
            <div className="a-tk-main">
              <div className={panes || bodyClass ? 'a-tk-doc' : 'a-tk-col'}>{children}</div>
              {foot ? <div className="a-tk-foot">{foot}</div> : null}
            </div>
            {peer ? <aside className="a-tk-peer">{peer}</aside> : null}
          </div>
        </motion.section>
      </motion.div>
    </AnimatePresence>
  )
}

/**
 * A queue-rail section: an eyebrow with its own count, then its rows
 * (`arunjdass/dashboard-sidebar`). A count never appears without a predicate,
 * so the eyebrow carries the noun.
 */
export function TakeoverRailHead({ label, tail }: { label: ReactNode; tail?: ReactNode }) {
  return (
    <div className="a-tk-railhead">
      <span className="a-eyebrow">{label}</span>
      {tail ? <span className="a-mono a-dim">{tail}</span> : null}
    </div>
  )
}

// The rendered-HTML preview, in a SANDBOXED iframe.
//
// sandbox WITHOUT allow-scripts: nothing in the artifact can execute —
// `allow-same-origin` alone grants no code execution, it only lets THIS parent
// read the frame's document to size it honestly (script execution is gated
// exclusively by allow-scripts). If the measurement is ever unreadable the
// frame keeps a fixed height and scrolls internally, which the spec allows.
export function HtmlPreview({ html, title }: { html: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [h, setH] = useState(480)
  return (
    <iframe
      ref={ref}
      className="a-tk-frame"
      title={title}
      sandbox="allow-same-origin"
      srcDoc={html}
      style={{ height: h }}
      onLoad={() => {
        try {
          const doc = ref.current?.contentDocument
          const measured = Math.max(
            doc?.body?.scrollHeight ?? 0,
            doc?.documentElement?.scrollHeight ?? 0,
          )
          if (measured > 0) setH(Math.min(Math.max(measured + 8, 160), 1200))
        } catch { /* measurement refused → the fixed, scrollable height stands */ }
      }}
    />
  )
}
