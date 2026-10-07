import { useEffect, useState } from 'react'
import type { Tier } from '../../shell/tier'

/** The main column's tier (.d-main[data-tier], written by useShellGeometry). null until measured or on the phone. */
export function useMainTier(enabled: boolean): Tier | null {
  const [tier, setTier] = useState<Tier | null>(null)
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return
    const main = document.querySelector<HTMLElement>('.d-main')
    if (!main) return
    const read = () => setTier((main.dataset.tier as Tier | undefined) ?? null)
    read()
    const mo = new MutationObserver(read)
    mo.observe(main, { attributes: true, attributeFilter: ['data-tier'] })
    return () => mo.disconnect()
  }, [enabled])
  return tier
}
