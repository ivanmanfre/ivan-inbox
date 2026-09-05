import type { ReactNode } from 'react'
import { cx } from './util'

export interface HeaderProps {
  title?: ReactNode
  /** One line under the title: a count, a freshness stamp, a predicate. */
  sub?: ReactNode
  /** Back control, avatar, anything before the title. */
  lead?: ReactNode
  /** Actions on the trailing edge. */
  tail?: ReactNode
  sticky?: boolean
  className?: string
  children?: ReactNode
}

/** The surface header. Title and one predicate line; actions on the tail. */
export function Header({ title, sub, lead, tail, sticky = false, className, children }: HeaderProps) {
  return (
    <header data-ds="Header" data-sticky={sticky} className={cx('ds-header', className)}>
      {lead ? <div className="ds-header-lead">{lead}</div> : null}
      <div className="ds-header-main">
        {title ? <h1 className="ds-t-page ds-truncate">{title}</h1> : null}
        {sub ? <div className="ds-t-meta ds-truncate">{sub}</div> : null}
        {children}
      </div>
      {tail ? <div className="ds-header-tail">{tail}</div> : null}
    </header>
  )
}
