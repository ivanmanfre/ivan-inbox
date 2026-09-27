/* ==========================================================================
   src/d/lanes/useLanesData.ts — every read the Lanes place draws, one hook.

   Each read settles on its own (allSettled): a failed governor read shows
   "?" on the Governor line and "1 failed" under Lanes, it never blanks the
   bands beside it. Polled every 60s while visible and on focus, like today's
   Control section (a stale tab must not impersonate a dead monitor).
   ========================================================================== */
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchPayload, type CcPayload } from '../../lib/campaignControl'
import { fetchCampaignPerf, type CampaignPerf } from '../../lib/campaignPerf'
import {
  fetchGovernor, fetchOutcomes, fetchPipeline, fetchReplacement, fetchScanOpens, fetchViewedBack,
  type GovernorRow, type ScanOpenRow, type OutcomeRow, type PipelineRow, type ReplacementRow, type ViewedBackRow,
} from '../../lib/kpis'
import { fetchCampaignSends, type CampaignSend } from '../../lib/sends'
import { fetchInbound, fetchInboundDaily, type InboundDailyRow, type InboundRow } from '../../lib/inbound'
import { fetchSeatHealth, type SeatHealthSummary } from '../../lib/seatHealth'
import type { CameBackCard } from '../../wb/dms/cameBackData'
import type { Seat } from '../seats'
import { fetchCameBack, fetchCounters, fetchEngagers7d, fetchPauses, fetchWarmCount, type Counter, type Pauses } from './reads'
import type { Attempt } from './glance/model'
import { fetchLastAttempts } from './glance/reads'
import { fetchReady, type ReadyRead } from './glance/ready'

export type Slot<T> = { value: T | null; failed: string | null }
export type LanesData = {
  cc: Slot<CcPayload>
  perf: Slot<CampaignPerf[]>
  gov: Slot<GovernorRow[]>
  outcomes: Slot<OutcomeRow[]>
  pipeline: Slot<PipelineRow[]>
  replacement: Slot<ReplacementRow[]>
  viewed: Slot<ViewedBackRow[]>
  counters: Slot<Counter[]>
  inbound: Slot<InboundRow[]>
  inboundDaily: Slot<InboundDailyRow[]>
  scans: Slot<ScanOpenRow[]>
  campSends: Slot<CampaignSend[]>
  cameBack: Slot<CameBackCard[]>
  warm: Slot<number>
  engagers: Slot<Record<Seat, number>>
  health: Slot<SeatHealthSummary>
  pauses: Slot<Pauses>
  attempts: Slot<Record<Seat, Attempt | null | 'failed'>>
  ready: Slot<ReadyRead>
}
type Key = keyof LanesData

const READS: { [K in Key]: () => Promise<NonNullable<LanesData[K]['value']>> } = {
  cc: async () => {
    const s = await fetchPayload()
    if (s.state === 'ok') return s.payload
    throw new Error(s.state === 'error' ? `the send monitor's payload broke its contract: ${s.error}` : s.reason)
  },
  perf: fetchCampaignPerf,
  gov: fetchGovernor,
  outcomes: fetchOutcomes,
  pipeline: fetchPipeline,
  replacement: fetchReplacement,
  viewed: fetchViewedBack,
  counters: () => fetchCounters(),
  inbound: fetchInbound,
  inboundDaily: fetchInboundDaily,
  scans: fetchScanOpens,
  campSends: () => fetchCampaignSends('all'),
  cameBack: fetchCameBack,
  warm: fetchWarmCount,
  engagers: fetchEngagers7d,
  health: async () => {
    const h = await fetchSeatHealth()
    if (!h) throw new Error('no seat health summary')
    return h
  },
  pauses: fetchPauses,
  attempts: fetchLastAttempts,
  ready: () => fetchReady(),
}
const KEYS = Object.keys(READS) as Key[]

const empty = (): LanesData => Object.fromEntries(KEYS.map(k => [k, { value: null, failed: null }])) as unknown as LanesData

export function failedCount(d: LanesData): number {
  return KEYS.filter(k => d[k].failed && d[k].value == null).length
}

export function useLanesData(): { data: LanesData; loading: boolean; at: number | null; refresh: () => void } {
  const [data, setData] = useState<LanesData>(empty)
  const [loading, setLoading] = useState(true)
  const [at, setAt] = useState<number | null>(null)
  const live = useRef(true)
  const pending = useRef(false)

  const refresh = useCallback(() => {
    if (pending.current || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return
    pending.current = true
    // Each read lands on its own: a slow read (the ready counts) never holds the
    // monitor or the campaigns back. A failed re-read keeps the last good value
    // on screen and says it failed.
    const put = (k: Key, slot: (prev: Slot<unknown>) => Slot<unknown>) => {
      if (!live.current) return
      setData(prev => ({ ...prev, [k]: slot(prev[k] as Slot<unknown>) }) as LanesData)
    }
    void Promise.allSettled(KEYS.map(k => READS[k]().then(
      v => put(k, () => ({ value: v, failed: null })),
      e => { put(k, prev => ({ value: prev.value, failed: e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e ?? 'read failed') })); throw e },
    ))).then(() => {
      pending.current = false
      if (!live.current) return
      setAt(Date.now())
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    live.current = true
    refresh()
    const t = setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      live.current = false
      clearInterval(t)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [refresh])

  return { data, loading, at, refresh }
}
