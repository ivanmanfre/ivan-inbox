import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { Icon, type IconName } from './icons'
import { Badge } from './Badge'
import { cx } from './util'

export interface RailItemProps {
  icon: IconName
  label: string
  active?: boolean
  /** Nested under a group label (Content · Magnets · Styles · Strategy). */
  nested?: boolean
  /** A plain backlog. Neutral unless `sev` names a live problem. */
  count?: number
  sev?: 'attention' | 'urgent'
  /** What the count sums. A number whose predicate is unstated is a number to trust blindly. */
  countNote?: string
  /** Rendered as a presence pip instead of a numeral when the rail is collapsed. */
  collapsed?: boolean
  /** Shared id for the sliding active highlight. */
  markerId?: string
  onClick?: () => void
  tail?: ReactNode
}

export function RailItem({
  icon, label, active = false, nested = false, count, sev, countNote,
  collapsed = false, markerId = 'ds-rail-active', onClick, tail,
}: RailItemProps) {
  const hasCount = typeof count === 'number' && count > 0
  return (
    <button
      data-ds="RailItem"
      type="button"
      data-active={active}
      data-nested={nested}
      className="ds-rail-item"
      onClick={onClick}
      title={countNote}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
    >
      {active ? <motion.span layoutId={markerId} className="ds-rail-marker" /> : null}
      <Icon name={icon} size={20} />
      {!collapsed ? <span className="ds-rail-item-label ds-truncate">{label}</span> : null}
      {!collapsed && (hasCount || tail) ? (
        <span className="ds-rail-item-tail">
          {tail}
          {hasCount ? <Badge tone={sev ?? 'neutral'} label={countNote}>{count}</Badge> : null}
        </span>
      ) : null}
      {collapsed && hasCount ? <span className="ds-rail-pip" data-sev={sev} /> : null}
    </button>
  )
}

export interface RailProps {
  collapsed?: boolean
  top?: ReactNode
  footer?: ReactNode
  className?: string
  children?: ReactNode
}

/** The desktop nav rail: grouped places, counts, one sliding active highlight. */
export function Rail({ collapsed = false, top, footer, className, children }: RailProps) {
  return (
    <nav data-ds="Rail" data-collapsed={collapsed} className={cx('ds-rail', className)} aria-label="Places">
      {top ? <div className="ds-rail-top">{top}</div> : null}
      {children}
      <div className="ds-rail-spacer" />
      {footer}
    </nav>
  )
}

export function RailGroup({ label, collapsed = false, children }:
  { label?: string; collapsed?: boolean; children?: ReactNode }) {
  return (
    <div data-ds="RailGroup" className="ds-rail-group">
      {label && !collapsed ? <div className="ds-rail-group-label ds-t-eyebrow">{label}</div> : null}
      {children}
    </div>
  )
}

export function RailSeparator() {
  return <div data-ds="RailSeparator" className="ds-rail-sep" />
}
