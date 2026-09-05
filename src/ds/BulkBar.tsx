import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { spring, fadeT } from './motion'
import { Button } from './Button'
import { cx } from './util'

export interface BulkBarProps {
  open: boolean
  /** "{n} drafts selected" — the noun comes from the rows, never from here. */
  count: ReactNode
  /** The action buttons. Only the caps every selected row shares. */
  actions?: ReactNode
  /** Why an action is missing, or why nothing can be changed. */
  note?: ReactNode
  /** Mid-run: "{done} of {total}". */
  progress?: { done: number; total: number }
  onSelectAll?: () => void
  selectAllLabel?: string
  onClear?: () => void
  className?: string
}

/** The floating selection bar. Slides up on the first selection, away on clear. */
export function BulkBar({
  open, count, actions, note, progress, onSelectAll, selectAllLabel = 'Select all', onClear, className,
}: BulkBarProps) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          data-ds="BulkBar"
          role="region"
          aria-label="Bulk actions"
          className={cx('ds-bulkbar', className)}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16, transition: fadeT }}
          transition={spring}
        >
          <div className="ds-bulkbar-top">
            <span className="ds-bulkbar-count ds-t-body">{count}</span>
            {actions ? <span className="ds-bulkbar-actions">{actions}</span> : null}
            {onSelectAll ? <Button variant="quiet" size="sm" onClick={onSelectAll}>{selectAllLabel}</Button> : null}
            {onClear ? <Button variant="quiet" size="sm" onClick={onClear}>Clear</Button> : null}
          </div>
          {note ? <span className="ds-bulkbar-note ds-t-meta">{note}</span> : null}
          {progress ? (
            <span className="ds-bulkbar-progress" aria-label={`${progress.done} of ${progress.total}`}>
              <span style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
            </span>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
