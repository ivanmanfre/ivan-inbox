import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useVisibleMotion } from './useVisibleMotion'

/** Hold a shown skeleton for 380 ms. Polling does not replay the reveal. */
export function Reveal({ reading, children, skeleton }: { reading: boolean; children: ReactNode; skeleton: ReactNode }) {
  const [held, setHeld] = useState(reading)
  const began = useRef(Date.now())
  const ref = useRef<HTMLSpanElement>(null)
  const level = useVisibleMotion(ref)
  useEffect(() => {
    if (reading) { began.current = Date.now(); setHeld(true); return }
    const t = window.setTimeout(() => setHeld(false), level === 'off' ? 0 : Math.max(0, 380 - (Date.now() - began.current)))
    return () => window.clearTimeout(t)
  }, [reading, level])
  return <span ref={ref} className="ols-reveal" data-motion={level} aria-busy={reading || held || undefined}>
    {reading || held ? skeleton : <span className="ols-revealed">{children}</span>}
  </span>
}
