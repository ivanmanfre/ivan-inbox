import { useEffect, useSyncExternalStore } from 'react'
import { deskFlagState, subscribeDeskFlags, type DeskFlagState } from './navFlag'

/**
 * For the shell's nav (Side, PhonePanel): re-render whenever the desk flags change, so the Claude
 * place appears or disappears in the same session, without waiting for a navigation (Sol desk-ui r2
 * #6). Also starts the authenticated flag read once (deduped in flags.ts), loaded lazily so the shell
 * does not pull the desk's code in up front.
 */
export function useDeskNav(): DeskFlagState {
  const s = useSyncExternalStore(subscribeDeskFlags, deskFlagState, deskFlagState)
  useEffect(() => {
    let live = true
    void import('./flags').then(m => { if (live) void m.refreshDeskFlags() }, () => {})
    return () => { live = false }
  }, [])
  return s
}
