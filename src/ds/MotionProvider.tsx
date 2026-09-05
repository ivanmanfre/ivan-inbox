import { MotionConfig } from 'motion/react'
import type { ReactNode } from 'react'

/**
 * Wrap the app (and the gallery) once. `reducedMotion="user"` makes every
 * motion component honour the OS setting without a single per-component
 * check; the CSS collapse in ds.css does the same for the CSS half.
 */
export function Motion({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}
