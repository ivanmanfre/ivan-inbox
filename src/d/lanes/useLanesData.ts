/* ==========================================================================
   src/d/lanes/useLanesData.ts — every read the Lanes place draws, one hook.

   Each read settles on its own (allSettled): a failed governor read shows
   "?" on the Governor line and "1 failed" under Lanes, it never blanks the
   bands beside it. Polled every 60s while visible and on focus, like today's
   Control section (a stale tab must not impersonate a dead monitor).
   ========================================================================== */
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchPayload, isContractError, parsePayload, type CcPayload } from '../../lib/campaignControl'
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
import { recall, remember } from '../../lib/pageMemo'
import { supabase } from '../../lib/supabase'

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
const QUICK = new Set<Key>(['cc', 'gov', 'outcomes', 'health', 'perf', 'pipeline', 'replacement'])
type QuickSlot = { value?: unknown; error?: string | null }

async function fetchQuick(keys: Key[]): Promise<Record<string, QuickSlot>> {
  const { data, error } = await supabase.rpc('inbox_phone_lanes_pick_r2', { p_keys: keys.filter(k => QUICK.has(k)) })
  if (error) throw error
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Lanes summary returned no slots')
  return data as Record<string, QuickSlot>
}

function quickValue(k: Key, slots: Record<string, QuickSlot>): unknown {
  const slot = slots[k]
  if (!slot || typeof slot !== 'object' || slot.error || slot.value == null) throw new Error(slot?.error || `Lanes summary missing ${k}`)
  if (k === 'cc') {
    const parsed = parsePayload(slot.value)
    if (isContractError(parsed)) throw new Error(parsed.contract_error)
    return parsed
  }
  if (k === 'health') {
    if (typeof slot.value !== 'object' || Array.isArray(slot.value)) throw new Error('no seat health summary')
    return slot.value
  }
  if (!Array.isArray(slot.value)) throw new Error(`Lanes summary ${k} is not a list`)
  if (k === 'perf') return slot.value.map(r => {
    const row = r as Record<string, unknown>
    return { ...row,
      invites_7d: Number(row.invites_7d), dms_7d: Number(row.dms_7d), replied_7d: Number(row.replied_7d),
      positive_7d: Number(row.positive_7d), calls_7d: Number(row.calls_7d), calls_30d: Number(row.calls_30d),
      accept_judged: Number(row.accept_judged), accept_72h: Number(row.accept_72h),
    }
  })
  return slot.value
}
/** Heavier reads that move slowly: re-read every 5 minutes, not on every 60s tick. */
const SLOW = new Set<Key>(['ready', 'campSends', 'scans', 'inboundDaily'])
const SLOW_MS = 5 * 60_000

const empty = (): LanesData => Object.fromEntries(KEYS.map(k => [k, { value: null, failed: null }])) as unknown as LanesData

export function failedCount(d: LanesData): number {
  return KEYS.filter(k => d[k].failed && d[k].value == null).length
}

const memoKey = (k: Key) => `lanes:${k}`

/**
 * PERF-SMOOTH (2026-10-08): the last good value of each read (lib/pageMemo: this session, this user,
 * at most 30 min old), so a revisit of Lanes or Home paints the numbers it showed a minute ago instead
 * of 2.5 s of skeleton; the reads start on mount exactly as before and replace them. `at` is the
 * oldest seeded read's time, and only when every asked key was seeded: the page then judges the
 * monitor as of that read, never "silent" because the copy is old.
 */
export function seedLanes(keys: readonly Key[], now: number = Date.now()): { data: LanesData; at: number | null } {
  const data = empty()
  let oldest: number | null = null, all = keys.length > 0
  for (const k of keys) {
    const hit = recall<unknown>(memoKey(k), now)
    if (!hit) { all = false; continue }
    ;(data as Record<Key, Slot<unknown>>)[k] = { value: hit.value, failed: null }
    oldest = oldest == null ? hit.at : Math.min(oldest, hit.at)
  }
  return { data, at: all ? oldest : null }
}

/** `only`: read just these keys (Home reads the five it draws, never the whole Lanes set). Pass a module-level constant. */
export function useLanesData(only?: readonly Key[]): { data: LanesData; loading: boolean; at: number | null; refresh: () => void } {
  const [seed] = useState(() => seedLanes(only ?? KEYS))
  const [data, setData] = useState<LanesData>(seed.data)
  const [loading, setLoading] = useState(seed.at == null)
  const [at, setAt] = useState<number | null>(seed.at)
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
    const primaryKeys = keys.filter(k => k === 'cc' || k === 'gov')
    const otherQuickKeys = keys.filter(k => QUICK.has(k) && k !== 'cc' && k !== 'gov')
    const primary = primaryKeys.length ? withTimeout(fetchQuick(primaryKeys), 4000) : null
    // The visible monitor lands before the aggregate campaign/history reads.
    // Every other slot still follows; it cannot delay the first monitor rows.
    const secondary = primary && !only ? primary.then(() => {}, () => {}) : Promise.resolve()
    const quick = otherQuickKeys.length ? withTimeout(fetchQuick(otherQuickKeys), 4000) : null
    void Promise.allSettled(keys.map(k => {
      const direct = (): Promise<unknown> => READS[k]() as Promise<unknown>
      const summary = k === 'cc' || k === 'gov' ? primary : QUICK.has(k) ? quick : null
      const read: Promise<unknown> = summary
        ? summary.then(slots => quickValue(k, slots)).catch(direct)
        : primary && !only ? secondary.then(direct) : direct()
      return withTimeout<unknown>(read).then(
      v => { remember(memoKey(k), v); put(k, () => ({ value: v, failed: null })) },
      e => {
        failed.push(k)
        put(k, prev => ({ value: prev.value, failed: e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e ?? 'read failed') }))
        throw e
      },
    ) })).then(() => {
      done()
      if (!live.current || failed.length === 0 || retryT.current != null) return
      retryT.current = window.setTimeout(() => {
        retryT.current = null
        if (live.current && !pending.current) { pending.current = true; readKeys(failed, () => { pending.current = false }) }
      }, RETRY_MS)
    })
  }, [only])

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
