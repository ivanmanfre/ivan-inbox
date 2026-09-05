import type { ReactNode } from 'react'
import { cx } from './util'

export interface ListProps {
  /** 'flush' drops the container fill so the rows sit straight on the canvas. */
  flush?: boolean
  className?: string
  children?: ReactNode
  role?: string
  'aria-label'?: string
}

/** The grouped container. It draws the hairlines; rows never draw a box. */
export function List({ flush = false, className, children, ...rest }: ListProps) {
  return (
    <div data-ds="List" data-flush={flush} className={cx('ds-list', className)} {...rest}>
      {children}
    </div>
  )
}

export interface ListRowProps {
  /** The left column: a select mark, an avatar, a state dot. */
  anchor?: ReactNode
  title?: ReactNode
  /** The second line: the payload, the quote, the predicate. */
  sub?: ReactNode
  /** Chips under the title. */
  meta?: ReactNode
  /** The right column: a time, a count, a stage chip. */
  tail?: ReactNode
  /** Controls that stay invisible until the row is hovered or focused. */
  actions?: ReactNode
  selected?: boolean
  /** Keyboard focus (j/k), distinct from selection (x). */
  focused?: boolean
  unread?: boolean
  /** A live problem on this row. Never a backlog. */
  sev?: 'attention' | 'urgent'
  onClick?: () => void
  className?: string
  children?: ReactNode
}

export function ListRow({
  anchor, title, sub, meta, tail, actions, selected = false, focused = false,
  unread = false, sev, onClick, className, children,
}: ListRowProps) {
  const interactive = Boolean(onClick)
  const Tag = interactive ? 'button' : 'div'
  return (
    <Tag
      data-ds="ListRow"
      type={interactive ? 'button' : undefined}
      data-interactive={interactive}
      data-selected={selected}
      data-focused={focused}
      data-unread={unread}
      data-sev={sev}
      aria-selected={interactive ? selected : undefined}
      onClick={onClick}
      className={cx('ds-row', className)}
    >
      {anchor ? <span className="ds-row-anchor">{anchor}</span> : null}
      <span className="ds-row-main">
        {title ? <span className="ds-row-line ds-t-title ds-truncate">{title}</span> : null}
        {sub ? <span className="ds-t-body ds-dim ds-clamp-2">{sub}</span> : null}
        {meta ? <span className="ds-row-line">{meta}</span> : null}
        {children}
      </span>
      {tail || actions ? (
        <span className="ds-row-tail">
          {actions ? <span className="ds-row-actions">{actions}</span> : null}
          {tail}
        </span>
      ) : null}
    </Tag>
  )
}
