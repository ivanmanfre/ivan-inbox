/* ==========================================================================
   THE TAKEOVER SHELL — LOCAL COPY.

   W2 owns the shared shell at `src/wb/takeover`. It had not landed on this
   branch when S17 was built, so this is the same three-pane structure written
   here against the design system, with the SAME contract (label, sub, close,
   mobile, a body class that opts out of the centred measure) so the import can
   be swapped for W2's in one line. Named in NOTES.

   Copied from `src/exp/v2c/Takeover.tsx`: the Escape handler, its field guard
   and the backdrop rule are that file's, byte for byte in behaviour.
   ========================================================================== */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { fadeT, IconButton, pop, spring } from '../../ds'
import './magnet.css'

export function Takeover({ label, sub, onClose, mobile, children, bodyClass }: {
  label: string
  sub?: string | null
  onClose: () => void
  mobile: boolean
  children: ReactNode
  /** Opt OUT of the centred reading column. A multi-column reader owns its own
      geometry; everything else gets the comfortable measure by default. */
  bodyClass?: string
}) {
  // Escape closes, from anywhere — the window is modal.
  //
  // EXCEPT out of a field. This listener is a NATIVE one on `window`; React
  // attaches its synthetic handlers at the root container, which is BELOW
  // window, so a `stopPropagation()` inside a textarea's onKeyDown cannot stop
  // it. Without this guard, Escape in the editor cancelled the edit AND closed
  // the whole window in the same keypress. The inner meaning of Escape (leave
  // this field) has to win over the outer one (leave this window), and the
  // second Escape still closes because the field is no longer focused.
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

  return (
    <AnimatePresence>
      <motion.div
        className="a-tk-scrim ds-body"
        // Backdrop click closes on desktop. On the phone the window IS the
        // screen, so there is no backdrop to click and the back mark carries it.
        onClick={mobile ? undefined : onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: fadeT }}
        exit={{ opacity: 0, transition: fadeT }}
      >
        <motion.section
          className="a-tk"
          role="dialog"
          aria-modal="true"
          aria-label={label}
          onClick={e => e.stopPropagation()}
          variants={pop}
          initial="hidden"
          animate="show"
          exit="exit"
          transition={spring}
        >
          <div className="a-tk-head">
            {mobile && <IconButton icon="back" label="Back" onClick={onClose} />}
            <div className="a-tk-ttl">
              <div className="a-tk-n">{label}</div>
              {sub && <div className="a-tk-s">{sub}</div>}
            </div>
            <IconButton icon="close" label="Close" onClick={onClose} />
          </div>
          <div className={`a-tk-body${bodyClass ? ` ${bodyClass}` : ''}`}>
            {bodyClass ? children : <div className="a-tk-col">{children}</div>}
          </div>
        </motion.section>
      </motion.div>
    </AnimatePresence>
  )
}

// The rendered-HTML preview, in a SANDBOXED iframe.
//
// sandbox WITHOUT allow-scripts: nothing in the artifact can execute —
// `allow-same-origin` alone grants no code execution, it only lets THIS parent
// read the frame's document to size it honestly. If the measurement is ever
// unreadable the frame keeps a fixed height and scrolls internally.
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
