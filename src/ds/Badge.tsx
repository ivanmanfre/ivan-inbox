import type { ReactNode } from 'react'
import { cx } from './util'

export type BadgeTone = 'neutral' | 'accent' | 'clear' | 'attention' | 'urgent'

export interface BadgeProps {
  /** A count, a word, or nothing when the variant is a dot. */
  children?: ReactNode
  /** Severity tones are live signals only: a stopped thing, never a backlog. */
  tone?: BadgeTone
  /** 'count' a numeral pill · 'dot' presence only · 'ring' an outline count. */
  variant?: 'count' | 'dot' | 'ring'
  /** Spoken name when the badge is the only carrier of the state. */
  label?: string
  className?: string
}

export function Badge({ children, tone = 'neutral', variant = 'count', label, className }: BadgeProps) {
  return (
    <span
      data-ds="Badge"
      data-tone={tone}
      data-variant={variant}
      className={cx('ds-badge', className)}
      role={label ? 'status' : undefined}
      aria-label={label}
    >
      {variant === 'dot' ? null : children}
    </span>
  )
}
