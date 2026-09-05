import type { ReactNode } from 'react'
import { cx } from './util'

export interface CardProps {
  title?: ReactNode
  sub?: ReactNode
  /** Leading mark: an avatar, a kind icon, a lane badge. */
  lead?: ReactNode
  /** Trailing controls in the head. */
  tail?: ReactNode
  /** The action row at the bottom. */
  foot?: ReactNode
  tone?: 'default' | 'quiet' | 'raised'
  selected?: boolean
  onClick?: () => void
  className?: string
  children?: ReactNode
}

/** The card. Depth is the surface step plus a hairline, never a shadow. */
export function Card({
  title, sub, lead, tail, foot, tone = 'default', selected = false, onClick, className, children,
}: CardProps) {
  const interactive = Boolean(onClick)
  return (
    <div
      data-ds="Card"
      data-tone={tone}
      data-selected={selected}
      data-interactive={interactive}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={interactive ? (e) => { if (e.key === 'Enter') onClick?.() } : undefined}
      className={cx('ds-card', className)}
    >
      {title || lead || tail ? (
        <div className="ds-card-head">
          {lead}
          <div className="ds-card-head-main">
            {title ? <div className="ds-t-title">{title}</div> : null}
            {sub ? <div className="ds-t-meta">{sub}</div> : null}
          </div>
          {tail}
        </div>
      ) : null}
      {children}
      {foot ? <div className="ds-card-foot">{foot}</div> : null}
    </div>
  )
}
