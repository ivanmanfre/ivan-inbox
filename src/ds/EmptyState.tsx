import type { ReactNode } from 'react'
import { Icon, type IconName } from './icons'
import { Skeleton } from './Skeleton'
import { cx } from './util'

export interface EmptyStateProps {
  icon?: IconName
  title: ReactNode
  /** What was checked, so an empty screen reads as a live read and not a stall. */
  sub?: ReactNode
  action?: ReactNode
  /** Faint ghost rows behind the copy instead of a void. */
  ghosts?: boolean
  className?: string
}

export function EmptyState({ icon = 'inbox', title, sub, action, ghosts = false, className }: EmptyStateProps) {
  return (
    <div data-ds="EmptyState" className={cx('ds-empty', className)}>
      {ghosts ? (
        <div className="ds-empty-ghosts" aria-hidden="true">
          <Skeleton shape="line" /><Skeleton shape="line" /><Skeleton shape="line" />
        </div>
      ) : null}
      <span className="ds-empty-mark"><Icon name={icon} size={24} /></span>
      <div className="ds-empty-main">
        <span className="ds-t-title">{title}</span>
        {sub ? <span className="ds-t-body ds-dim">{sub}</span> : null}
      </div>
      {action}
    </div>
  )
}
