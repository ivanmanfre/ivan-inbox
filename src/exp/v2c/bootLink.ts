import { useEffect, useRef } from 'react'

export type BootLink = { lane?: string; section?: string }

/**
 * content-brain-06 C04: the boot deep link (`#exp/v2/strategy?lane=&section=`)
 * is ONE-SHOT. Shell parses it once at mount, before its own `[job]` effect
 * strips the query from the hash, and the lazy StrategyView can mount after
 * that strip (it does on the phone), so the link has to travel as props.
 * But StrategyView remounts on every Strategy re-entry, so handing the same
 * link on each mount would snap the shared lane back to the linked client
 * after the operator had switched away. The link is therefore held in a ref
 * and dropped the first time `job` LEAVES 'strategy'; clearing on entry would
 * race the lazy mount and re-open the phone defect.
 */
export function useOneShotBootLink(boot: BootLink, job: string): BootLink | null {
  const ref = useRef<BootLink | null>(boot.lane || boot.section ? { lane: boot.lane, section: boot.section } : null)
  useEffect(() => { if (job !== 'strategy') ref.current = null }, [job])
  return ref.current
}
