import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { spring, fadeT } from './motion'
import { Icon, type IconName } from './icons'
import { Button } from './Button'
import { IconButton } from './IconButton'
import { cx } from './util'

export interface ToastItem {
  id: string
  message: ReactNode
  tone?: 'neutral' | 'clear' | 'attention' | 'urgent'
  icon?: IconName
  /** The undo affordance the signature action earns. */
  actionLabel?: string
  onAction?: () => void
}

export function Toast({ item, onDismiss }: { item: ToastItem; onDismiss?: (id: string) => void }) {
  return (
    <div data-ds="Toast" data-tone={item.tone ?? 'neutral'} className={cx('ds-toast')} role="status">
      {item.icon ? <Icon name={item.icon} size={16} /> : null}
      <span className="ds-toast-main ds-t-body ds-truncate">{item.message}</span>
      {item.actionLabel && item.onAction ? (
        <Button variant="quiet" size="sm" onClick={item.onAction}>{item.actionLabel}</Button>
      ) : null}
      {onDismiss ? <IconButton icon="close" label="Dismiss" size="sm" onClick={() => onDismiss(item.id)} /> : null}
    </div>
  )
}

/** Stacked toasts. Every leave goes through AnimatePresence. */
export function ToastStack({ items, onDismiss }: { items: ToastItem[]; onDismiss?: (id: string) => void }) {
  return (
    <div data-ds="ToastStack" className="ds-toast-stack">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4, transition: fadeT }}
            transition={spring}
          >
            <Toast item={t} onDismiss={onDismiss} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
