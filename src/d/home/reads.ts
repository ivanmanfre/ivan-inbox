/* ==========================================================================
   src/d/home/reads.ts — Home's reads, all borrowed:
     · Lanes' own reader (useLanesData), narrowed to the five keys Home draws;
     · the Content place's read x3 (useContent) for next week's posts;
     · the frame's DM draft counts (useFrameCounts), already polled for the panel.
   Nothing new is queried. SELECT only.
   ========================================================================== */
import { useEffect, useState } from 'react'
import { useContent } from '../../hooks/useContent'
import { dmNumbers, useFrameCounts } from '../counts/useFrameCounts'
import { contentWeek, nextWeekDays, type ContentWeek } from '../lanes/glance/model'
import { useLanesData, type LanesKey } from '../lanes/useLanesData'
import type { Seat } from '../seats'
import { useStalled } from '../ui/timeout'
import type { Read } from './model'

const KEYS: readonly LanesKey[] = ['cc', 'gov', 'pauses', 'attempts', 'ready']

export function useHome() {
  const lanes = useLanesData(KEYS)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { setNow(Date.now()) }, [lanes.at])
  const ivan = useContent('ivan')
  const rise = useContent('risedtc')
  const arch = useContent('arch')
  const counts = useFrameCounts()
  // Today's content hook has no timeout of its own: 12 s without an answer reads as failed, and it re-reads quietly.
  const stalled = {
    ivan: useStalled(!ivan.error && !ivan.loadedAt, ivan.refresh),
    risedtc: useStalled(!rise.error && !rise.loadedAt, rise.refresh),
    arch: useStalled(!arch.error && !arch.loadedAt, arch.refresh),
  }
  const days = nextWeekDays(now)
  const wk = (r: ReturnType<typeof useContent>, s: Seat): Read<ContentWeek> =>
    r.error ? { fail: r.error } : !r.loadedAt ? (stalled[s] ? { fail: 'no answer after 12 s' } : { wait: true }) : { v: contentWeek(r.drafts, s, days) }
  const dn = dmNumbers(counts, 'drafts')
  const dr = (s: Seat): Read<number> => {
    const v = dn[s]
    return v != null ? { v } : counts.dms[s].failed ? { fail: 'the drafts count could not be read' } : { wait: true }
  }
  return {
    now,
    lanes: lanes.data,
    content: { ivan: wk(ivan, 'ivan'), risedtc: wk(rise, 'risedtc'), arch: wk(arch, 'arch') } as Record<Seat, Read<ContentWeek>>,
    drafts: { ivan: dr('ivan'), risedtc: dr('risedtc'), arch: dr('arch') } as Record<Seat, Read<number>>,
    retry: {
      content: () => { ivan.refresh(); rise.refresh(); arch.refresh() },
      drafts: () => counts.refresh('dms'),
      lanes: lanes.refresh,
    },
  }
}
export type HomeData = ReturnType<typeof useHome>
