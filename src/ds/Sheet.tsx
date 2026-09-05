import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { springSoft, fadeT } from './motion'
import { IconButton } from './IconButton'
import { cx } from './util'

export interface SheetProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  sub?: ReactNode
  /** The action row pinned under the scroll. */
  foot?: ReactNode
  /** Draw the drag grip. A sheet that tracks a finger says so. */
  grip?: boolean
  className?: string
  children?: ReactNode
}

/**
 * The bottom sheet. It tracks the finger 1:1 and springs back to its snap
 * point; a flick past the threshold dismisses. The scrim fades with distance.
 */
export function Sheet({ open, onClose, title, sub, foot, grip = true, className, children }: SheetProps) {
  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            className="ds-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fadeT}
            onClick={onClose}
          />
          <motion.div
            data-ds="Sheet"
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === 'string' ? title : 'Sheet'}
            className={cx('ds-sheet', className)}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={springSoft}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => { if (info.offset.y > 120 || info.velocity.y > 600) onClose() }}
          >
            {grip ? <div className="ds-sheet-grip"><span /></div> : null}
            {title || sub ? (
              <div className="ds-sheet-head">
                <div className="ds-sheet-head-main">
                  {title ? <div className="ds-t-title">{title}</div> : null}
                  {sub ? <div className="ds-t-meta">{sub}</div> : null}
                </div>
                <IconButton icon="close" label="Close" onClick={onClose} />
              </div>
            ) : null}
            <div className="ds-sheet-body">{children}</div>
            {foot ? <div className="ds-sheet-foot">{foot}</div> : null}
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  )
}
