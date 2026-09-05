/* ==========================================================================
   src/wb/call/Takeover.tsx — the takeover shell, local to W4.

   W2 owns the shared `src/wb/takeover`. At the time this wave branched that
   module did not exist on this branch, so the call window carries its own copy
   of the SAME three-pane shell: scrim, head, and a body whose children lay
   themselves out as main / inspector / queue rail. When W2's shell lands, this
   file is one import away from being deleted — the props are the same three the
   old `src/exp/v2c/Takeover.tsx` took (`label`, `sub`, `onClose`, `mobile`).

   Behaviour is the old file's, unchanged:
     · Escape closes, from anywhere, EXCEPT out of a field. The listener is a
       NATIVE one on `window`; React attaches its synthetic handlers at the root
       container, which is BELOW window, so a `stopPropagation()` inside a
       textarea's onKeyDown cannot stop it. Without the guard, Escape in a field
       would cancel the edit AND close the window in one keypress.
     · Backdrop click closes on desktop. On mobile the window IS the screen, so
       there is no backdrop to click and the back control carries it.
   ========================================================================== */
import { useEffect, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { IconButton } from '../../ds'
import { fadeT, pop } from '../../ds/motion'
import './call.css'

export function Takeover({ label, sub, onClose, mobile, children }: {
  label: string
  sub?: string | null
  onClose: () => void
  mobile: boolean
  children: ReactNode
}) {
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
        onClick={mobile ? undefined : onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={fadeT}
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
        >
          <div className="a-tk-head">
            {mobile && <IconButton icon="back" label="Back" onClick={onClose} />}
            <div className="a-tk-ttl">
              <div className="a-tk-n">{label}</div>
              {sub && <div className="a-tk-s a-mono">{sub}</div>}
            </div>
            <IconButton icon="close" label="Close" onClick={onClose} />
          </div>
          <div className="a-tk-body">{children}</div>
        </motion.section>
      </motion.div>
    </AnimatePresence>
  )
}
