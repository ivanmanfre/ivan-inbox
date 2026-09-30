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
import { RETRY_MS, withTimeout } from '../ui/timeout'

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
export type LanesKey = keyof LanesData
type Key = LanesKey

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
/** Heavier reads that move slowly: re-read every 5 minutes, not on every 60s tick. */
const SLOW = new Set<Key>(['ready', 'campSends', 'scans', 'inboundDaily'])
const SLOW_MS = 5 * 60_000

const empty = (): LanesData => Object.fromEntries(KEYS.map(k => [k, { value: null, failed: null }])) as unknown as LanesData

export function failedCount(d: LanesData): number {
  return KEYS.filter(k => d[k].failed && d[k].value == null).length
}

/** `only`: read just these keys (Home reads the five it draws, never the whole Lanes set). Pass a module-level constant. */
export function useLanesData(only?: readonly Key[]): { data: LanesData; loading: boolean; at: number | null; refresh: () => void } {
  const [data, setData] = useState<LanesData>(empty)
  const [loading, setLoading] = useState(true)
  const [at, setAt] = useState<number | null>(null)
  const live = useRef(true)
  const pending = useRef(false)
  const slowAt = useRef(0)

  const retryT = useRef<number | null>(null)
  const readKeys = useCallback((keys: Key[], done: () => void) => {
    // Each read lands on its own: a slow read (the ready counts) never holds the
    // monitor or the campaigns back. A failed re-read keeps the last good value
    // on screen and says it failed. No read waits past READ_TIMEOUT_MS: it
    // turns into that failed state, and the failed keys re-read quietly after
    // RETRY_MS.
    const put = (k: Key, slot: (prev: Slot<unknown>) => Slot<unknown>) => {
      if (!live.current) return
      setData(prev => ({ ...prev, [k]: slot(prev[k] as Slot<unknown>) }) as LanesData)
    }
    const failed: Key[] = []
    void Promise.allSettled(keys.map(k => withTimeout<unknown>(READS[k]()).then(
      v => put(k, () => ({ value: v, failed: null })),
      e => {
        failed.push(k)
        put(k, prev => ({ value: prev.value, failed: e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e ?? 'read failed') }))
        throw e
      },
    ))).then(() => {
      done()
      if (!live.current || failed.length === 0 || retryT.current != null) return
      retryT.current = window.setTimeout(() => {
        retryT.current = null
        if (live.current && !pending.current) { pending.current = true; readKeys(failed, () => { pending.current = false }) }
      }, RETRY_MS)
    })
  }, [])

  const poll = useCallback((force = false) => {
    if (pending.current || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return
    pending.current = true
    const withSlow = force || Date.now() - slowAt.current >= SLOW_MS
    if (withSlow) slowAt.current = Date.now()
    readKeys((only ?? KEYS).filter(k => withSlow || !SLOW.has(k)), () => {
      pending.current = false
      if (!live.current) return
      setAt(Date.now())
      setLoading(false)
    })
  }, [readKeys, only])

  const refresh = useCallback(() => poll(true), [poll])

  useEffect(() => {
    live.current = true
    const tick = () => poll()
    tick()
    const t = setInterval(tick, 60_000)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      live.current = false
      clearInterval(t)
      if (retryT.current != null) { window.clearTimeout(retryT.current); retryT.current = null }
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [poll])

  return { data, loading, at, refresh }
}
