import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { FLAGS_OFF, cachedDeskFlags, saveDeskFlags, type DeskFlags } from './navFlag'
import { mockOn } from './mock'

/** Read desk_config once per mount; paint from the device's last read first. A failed read keeps that copy. */
export function useDeskFlags(): DeskFlags {
  const [flags, setFlags] = useState<DeskFlags>(() => (mockOn() ? { ...FLAGS_OFF, desk_enabled: true } : cachedDeskFlags() ?? FLAGS_OFF))
  useEffect(() => {
    if (mockOn()) return
    let live = true
    supabase.from('desk_config').select('key,value').then(({ data, error }) => {
      if (!live || error || !data) return
      const got: Record<string, unknown> = Object.fromEntries(data.map(r => [r.key as string, r.value]))
      const next: DeskFlags = {
        desk_enabled: got.desk_enabled === true,
        nav_visible: got.nav_visible === true,
        t3_enabled: got.t3_enabled === true,
        triggers_enabled: got.triggers_enabled === true,
      }
      saveDeskFlags(next)
      setFlags(next)
    })
    return () => { live = false }
  }, [])
  return flags
}
