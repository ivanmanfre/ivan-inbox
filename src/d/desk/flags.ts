import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from '../../lib/supabase'
import { deskFlagState, saveDeskFlags, subscribeDeskFlags, type DeskFlagState } from './navFlag'
import { mockOn } from './mock'

// One authenticated read of desk_config per 30 s at most, shared by every caller.
let inflight: Promise<void> | null = null
let lastRead = 0

export function refreshDeskFlags(): Promise<void> {
  if (inflight) return inflight
  if (Date.now() - lastRead < 30_000 && deskFlagState().read) return Promise.resolve()
  inflight = (async () => {
    try {
      const { data, error } = await supabase.from('desk_config').select('key,value')
      if (error || !data) return
      const got: Record<string, unknown> = Object.fromEntries(data.map(r => [r.key as string, r.value]))
      lastRead = Date.now()
      saveDeskFlags({
        desk_enabled: got.desk_enabled === true,
        nav_visible: got.nav_visible === true,
        t3_enabled: got.t3_enabled === true,
        triggers_enabled: got.triggers_enabled === true,
      })
    } finally { inflight = null }
  })()
  return inflight
}

/** The desk flags as the whole app sees them: this device's last read first, then the live read. */
export function useDeskFlags(): DeskFlagState {
  const s = useSyncExternalStore(subscribeDeskFlags, deskFlagState, deskFlagState)
  useEffect(() => { if (!mockOn()) void refreshDeskFlags() }, [])
  return mockOn() ? { ...s, desk_enabled: true, read: true } : s
}

/** Tests only. */
export function resetDeskFlagReads(): void { inflight = null; lastRead = 0 }
