import type { ReactNode } from 'react'
import { Icon } from './icons'
import { cx } from './util'

/** One status line while something runs; flat the instant it resolves. */
export function Working({ live = true, children, className }:
  { live?: boolean; children?: ReactNode; className?: string }) {
  return (
    <span data-ds="Working" data-live={live} className={cx('ds-working ds-t-meta', className)} role="status">
      <Icon name={live ? 'loading' : 'check'} size={16} />
      {children}
    </span>
  )
}

/** A single dot with one ripple ring: this thing is live right now. */
export function LiveDot({ label }: { label: string }) {
  return <span data-ds="LiveDot" className="ds-live-dot" role="status" aria-label={label} />
}
