import type { ReactNode } from 'react'
import { cx } from './util'

/** A hairline. One separation device per boundary: this OR a wash OR spacing. */
export function Divider({ className }: { className?: string }) {
  return <hr data-ds="Divider" className={cx('ds-divider', className)} />
}

export interface DayHeaderProps {
  /** The day, the lane, the group. */
  label: ReactNode
  /** A live count that condenses into the bar as the list scrolls. */
  tail?: ReactNode
  sticky?: boolean
  className?: string
}

/** The sticky group header a long list carries between its days. */
export function DayHeader({ label, tail, sticky = true, className }: DayHeaderProps) {
  return (
    <div data-ds="DayHeader" data-sticky={sticky} className={cx('ds-dayheader', className)}>
      <span className="ds-t-eyebrow">{label}</span>
      <span className="ds-dayheader-rule" />
      {tail ? <span className="ds-t-mono">{tail}</span> : null}
    </div>
  )
}
