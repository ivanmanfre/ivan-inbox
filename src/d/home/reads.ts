/* ==========================================================================
   src/d/home/reads.ts — Home's reads:
     · Lanes' own reader (useLanesData), narrowed to the five keys Home draws;
     · one guarded, slim read for next week's posts across the three seats;
     · the frame's DM draft counts (useFrameCounts), already polled for the panel.
   Nothing new is queried. SELECT only.
   ========================================================================== */
import { useEffect, useState } from 'react'
import { dmNumbers, useFrameCounts } from '../counts/useFrameCounts'
import { useLanesData, type LanesKey } from '../lanes/useLanesData'
import type { Seat } from '../seats'
import type { Read } from './model'
import { useHomeContentWeek } from './contentWeek'

const KEYS: readonly LanesKey[] = ['cc', 'gov', 'pauses', 'attempts', 'ready']

export function useHome() {
  const lanes = useLanesData(KEYS)
  const [weekNow] = useState(() => Date.now())
  // A remembered copy (useLanesData's seed) is judged as of its own read, never as a silent monitor.
  const [now, setNow] = useState(() => lanes.at ?? Date.now())
  useEffect(() => { setNow(lanes.at ?? Date.now()) }, [lanes.at])
  const week = useHomeContentWeek(weekNow)
  const counts = useFrameCounts()
  const dn = dmNumbers(counts, 'drafts')
  const dr = (s: Seat): Read<number> => {
    const v = dn[s]
    return v != null ? { v } : counts.dms[s].failed ? { fail: 'the drafts count could not be read' } : { wait: true }
  }
  return {
    now,
    lanes: lanes.data,
    content: week.content,
    drafts: { ivan: dr('ivan'), risedtc: dr('risedtc'), arch: dr('arch') } as Record<Seat, Read<number>>,
    retry: {
      content: week.refresh,
      drafts: () => counts.refresh('dms'),
      lanes: lanes.refresh,
    },
  }
}
export type HomeData = ReturnType<typeof useHome>
