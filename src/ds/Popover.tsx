import { AnimatePresence, motion } from 'motion/react'
import type { CSSProperties, ReactNode } from 'react'
import { fadeT } from './motion'
import { Icon, type IconName } from './icons'
import { cx } from './util'

export interface PopoverProps {
  open: boolean
  /** Positioning is the caller's; the popover only draws and animates. */
  style?: CSSProperties
  label: string
  className?: string
  children?: ReactNode
}

export function Popover({ open, style, label, className, children }: PopoverProps) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          data-ds="Popover"
          role="menu"
          aria-label={label}
          style={style}
          className={cx('ds-popover', className)}
          initial={{ opacity: 0, y: -4, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.985 }}
          transition={fadeT}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

export function PopoverItem({ icon, tone = 'default', onClick, tail, disabled, children }: {
  icon?: IconName
  tone?: 'default' | 'danger'
  onClick?: () => void
  tail?: ReactNode
  /** An item that is present but not available yet, so the menu never changes
   * shape under the cursor between one open and the next. */
  disabled?: boolean
  children?: ReactNode
}) {
  return (
    <button data-ds="PopoverItem" type="button" role="menuitem" data-tone={tone} className="ds-popover-item" disabled={disabled} onClick={onClick}>
      {icon ? <Icon name={icon} size={16} /> : null}
      <span className="ds-popover-item-label ds-truncate">{children}</span>
      {tail}
    </button>
  )
}
