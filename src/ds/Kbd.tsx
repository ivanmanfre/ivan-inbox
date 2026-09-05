import type { ReactNode } from 'react'
import { cx } from './util'

/** A key cap. Draw one per key; a chord is two caps side by side. */
export function Kbd({ children, className }: { children?: ReactNode; className?: string }) {
  return <kbd data-ds="Kbd" className={cx('ds-kbd', className)}>{children}</kbd>
}
