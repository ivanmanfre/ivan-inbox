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
  /**
   * Present the chip as a LINK. A chip that leaves the page — the sales row's
   * document chips, which open a real browser tab — has to be an anchor, or
   * the middle click, the cmd-click and the browser's own "open in new tab"
   * all do nothing on it.
   */
  href?: string
  target?: string
  /** The anchor's tooltip, when the visible label is a one-word abbreviation. */
  title?: string
  /** Present a remove control inside the chip. */
  onRemove?: () => void
  removeLabel?: string
  /** A trailing count, drawn in mono so a column of chips aligns. */
  count?: number
  className?: string
}

export function Chip({
  children, icon, tone = 'neutral', selected = false, onClick, onRemove,
  removeLabel = 'Remove', count, className, href, target, title,
}: ChipProps) {
  const link = Boolean(href)
  const interactive = link || Boolean(onClick)
  const Tag = link ? 'a' : onClick ? 'button' : 'span'
  return (
    <Tag
      data-ds="Chip"
      data-tone={tone}
      data-selected={selected}
      data-interactive={interactive}
      // A link is not a toggle: `aria-pressed` on an anchor announces a state
      // it does not have.
      aria-pressed={!link && interactive ? selected : undefined}
      type={!link && interactive ? 'button' : undefined}
      href={href}
      target={target}
      rel={target === '_blank' ? 'noopener noreferrer' : undefined}
      title={title}
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
