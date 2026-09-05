import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { fadeT, spring } from './motion'
import { Button } from './Button'
import { cx } from './util'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  /** What the confirm actually does, said plainly. */
  sub?: ReactNode
  size?: 'default' | 'wide'
  /** Replaces the default confirm/cancel pair. */
  foot?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  onConfirm?: () => void
  /** The confirm removes something for good. */
  danger?: boolean
  busy?: boolean
  className?: string
  children?: ReactNode
}

/** The dialog scales from .96 and fades in over the one duration. */
export function Dialog({
  open, onClose, title, sub, size = 'default', foot,
  confirmLabel, cancelLabel = 'Cancel', onConfirm, danger = false, busy = false,
  className, children,
}: DialogProps) {
  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            className="ds-scrim"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={fadeT}
            onClick={onClose}
          />
          <div className="ds-dialog-wrap">
            <motion.div
              data-ds="Dialog"
              role="dialog"
              aria-modal="true"
              aria-label={typeof title === 'string' ? title : 'Dialog'}
              data-size={size}
              className={cx('ds-dialog', className)}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={spring}
            >
              {title || sub ? (
                <div className="ds-dialog-head">
                  <div className="ds-dialog-head-main">
                    {title ? <div className="ds-t-title">{title}</div> : null}
                    {sub ? <div className="ds-t-body ds-dim">{sub}</div> : null}
                  </div>
                </div>
              ) : null}
              {children ? <div className="ds-dialog-body">{children}</div> : null}
              <div className="ds-dialog-foot">
                {foot ?? (
                  <>
                    <Button variant="quiet" onClick={onClose}>{cancelLabel}</Button>
                    {confirmLabel ? (
                      <Button
                        variant={danger ? 'danger' : 'primary'}
                        busy={busy}
                        onClick={onConfirm}
                      >
                        {confirmLabel}
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            </motion.div>
          </div>
        </>
      ) : null}
    </AnimatePresence>
  )
}
