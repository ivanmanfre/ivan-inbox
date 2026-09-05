import type { ReactNode } from 'react'
import { Icon, type IconName } from './icons'
import { cx } from './util'

export interface ChipProps {
  children?: ReactNode
  icon?: IconName
  tone?: 'neutral' | 'quiet' | 'accent' | 'clear' | 'attention' | 'urgent'
  selected?: boolean
  /** Present the chip as a filter toggle. */
  onClick?: () => void
  /** Present a remove control inside the chip. */
  onRemove?: () => void
  removeLabel?: string
  /** A trailing count, drawn in mono so a column of chips aligns. */
  count?: number
  className?: string
}

export function Chip({
  children, icon, tone = 'neutral', selected = false, onClick, onRemove,
  removeLabel = 'Remove', count, className,
}: ChipProps) {
  const interactive = Boolean(onClick)
  const Tag = interactive ? 'button' : 'span'
  return (
    <Tag
      data-ds="Chip"
      data-tone={tone}
      data-selected={selected}
      data-interactive={interactive}
      aria-pressed={interactive ? selected : undefined}
      type={interactive ? 'button' : undefined}
      onClick={onClick}
      className={cx('ds-chip', className)}
    >
      {icon ? <Icon name={icon} size={16} /> : null}
      {children}
      {typeof count === 'number' ? <span className="ds-t-mono">{count}</span> : null}
      {onRemove ? (
        <span
          role="button"
          tabIndex={0}
          aria-label={removeLabel}
          className="ds-chip-x"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRemove() } }}
        >
          <Icon name="close" size={16} />
        </span>
      ) : null}
    </Tag>
  )
}
