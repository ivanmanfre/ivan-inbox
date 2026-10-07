import { MotionConfig } from 'motion/react'
import type { ReactNode } from 'react'
import { springSettle } from './motion'
import { useMotionLevel } from './motionLevel'
import { useSkin } from './useSkin'

/**
 * Wrap the app (and the gallery) once. `reducedMotion="user"` makes every
 * motion component honour the OS setting without a single per-component
 * check; the CSS collapse in ds.css does the same for the CSS half.
 * Under the brief skin's `motion` section, Daily Brief's Motion Off forces
 * reduced motion too, and the default transition becomes the settle spring.
 */
export function Motion({ children }: { children: ReactNode }) {
  const skinMotion = useSkin('motion')
  const level = useMotionLevel()
  return (
    <MotionConfig reducedMotion={skinMotion && level === 'off' && typeof document !== 'undefined' && document.visibilityState !== 'hidden' ? 'always' : 'user'}
      transition={skinMotion ? springSettle : undefined}>
      {children}
    </MotionConfig>
  )
}
