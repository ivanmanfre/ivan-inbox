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
import { nextWeekDays } from '../lanes/glance/model'
import type { Seat } from '../seats'
import type { Read } from './model'
import { useHomeContentWeek } from './contentWeek'

const KEYS: readonly LanesKey[] = ['cc', 'gov', 'pauses', 'attempts', 'ready']

/** A clock for the 'Next week' strip: it only moves when the target week changes, so an app left open across a weekend rolls to the new week. */
export function useWeekClock(): number {
  const [weekNow, setWeekNow] = useState(() => Date.now())
  useEffect(() => {
    const check = () => setWeekNow(prev => {
      const now = Date.now()
      return nextWeekDays(prev)[0].key === nextWeekDays(now)[0].key ? prev : now
    })
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    const t = window.setInterval(check, 10 * 60_000)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(t); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', onVisible) }
  }, [])
  return weekNow
}

export function useHome() {
  const lanes = useLanesData(KEYS)
  const weekNow = useWeekClock()
  // A remembered copy (useLanesData's seed) is judged as of its own read, never as a silent monitor.
  const [now, setNow] = useState(() => lanes.at ?? Date.now())
  useEffect(() => { setNow(lanes.at ?? Date.now()) }, [lanes.at])
  const week = useHomeContentWeek(weekNow)
  const counts = useFrameCounts()
  const dn = dmNumbers(counts, 'drafts')
  // #36: the DM number is the same one the sidebar and the phone tab draw (threads that need him:
  // an unanswered reply or a draft); the drafts count rides under it as "N drafted".
  const wn = dmNumbers(counts, 'needs')
  const dr = (s: Seat, n = dn): Read<number> => {
    const v = n[s]
    return v != null ? { v } : counts.dms[s].failed ? { fail: 'the DM count could not be read' } : { wait: true }
  }
  return {
    now,
    lanes: lanes.data,
    content: week.content,
    drafts: { ivan: dr('ivan'), risedtc: dr('risedtc'), arch: dr('arch') , swishdm: dr('swishdm'), anna: dr('anna')} as Record<Seat, Read<number>>,
    waiting: { ivan: dr('ivan', wn), risedtc: dr('risedtc', wn), arch: dr('arch', wn), swishdm: dr('swishdm', wn), anna: dr('anna', wn) } as Record<Seat, Read<number>>,
    retry: {
      content: week.refresh,
      drafts: () => counts.refresh('dms'),
      lanes: lanes.refresh,
    },
  }
}
export type HomeData = ReturnType<typeof useHome>
