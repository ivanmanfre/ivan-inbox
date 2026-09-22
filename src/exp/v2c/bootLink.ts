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
/**
 * Content's historical Sources shortcut (`?sources=1` / `?section=sources`) is the
 * same lazy-mount case: the router folds it into "job = strategy" and deliberately
 * drops `section` (route.ts), and StrategyView used to re-read the alias off
 * `location.hash` at mount, which the phone has already stripped. Resolve it here,
 * once, from the hash the page booted with.
 */
export function sourcesAliasAtBoot(hash: string): boolean {
  const q = new URLSearchParams(hash.split('?')[1] ?? '')
  return q.get('sources') === '1' || q.get('section') === 'sources'
}

export function useOneShotBootLink(boot: BootLink, job: string, sourcesAlias = false): BootLink | null {
  const section = boot.section ?? (sourcesAlias ? 'research' : undefined)
  const ref = useRef<BootLink | null>(boot.lane || section ? { lane: boot.lane, section } : null)
  useEffect(() => { if (job !== 'strategy') ref.current = null }, [job])
  return ref.current
}
