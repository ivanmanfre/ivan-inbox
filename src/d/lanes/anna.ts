import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { withTimeout } from '../ui/timeout'
import { STUDIO_NAME, type StudioSeat } from '../seats'

export type AnnaEvent = {
  id: string; name: string; company: string | null; linkedin_url: string; status: string
  invited_at: string | null; accepted_at: string | null; last_reply_at: string | null; error: string | null
}
export type LinkedInSetup = { key: string; name: string; verified_at: string; week_caps: number[] }
export type AnnaStatus = {
  qualified_queued: number; setups: LinkedInSetup[]
  enabled: boolean; pause_reason: string | null; daily_cap: number
  sent_today: number; pending: number; accepted: number; replied: number; queued: number
  last_sync_at: string | null; events: AnnaEvent[]
}
export type AnnaRead = { value: AnnaStatus | null; error: string | null; busy: boolean }

export function parseAnnaStatus(value: unknown, seat: StudioSeat = 'anna'): AnnaStatus {
  const s = value as AnnaStatus | null
  if (!s || typeof s.enabled !== 'boolean' || !Array.isArray(s.events)
    || ![s.daily_cap, s.sent_today, s.pending, s.accepted, s.replied, s.queued, s.qualified_queued].every(n => Number.isInteger(n) && n >= 0)
    || !Array.isArray(s.setups) || s.setups.some(l => !l || typeof l.key !== 'string' || typeof l.name !== 'string' || !Number.isFinite(Date.parse(l.verified_at)) || !Array.isArray(l.week_caps) || l.week_caps.length !== 4 || l.week_caps.some(n => !Number.isInteger(n) || n <= 0))
    || s.events.some(e => !e || typeof e.id !== 'string' || typeof e.name !== 'string' || typeof e.status !== 'string' || typeof e.linkedin_url !== 'string')) {
    throw new Error(`${STUDIO_NAME[seat]}’s lane returned an incomplete reading.`)
  }
  return s
}

/** Anna's overview keeps its original name; Leah's (2026-11-23) has the same shape. */
const OVERVIEW: Record<StudioSeat, string> = { anna: 'inbox_linkedin_lane_overview', leah: 'leah_linkedin_lane_overview' }

export async function fetchAnnaStatus(seat: StudioSeat = 'anna'): Promise<AnnaStatus> {
  const { data, error } = await supabase.rpc(OVERVIEW[seat])
  if (error) throw error
  return parseAnnaStatus(data, seat)
}

/** No saved enabled-state: pause/resume always waits for the server and a fresh read. */
export function useAnnaLane(seat: StudioSeat = 'anna') {
  const [read, setRead] = useState<AnnaRead>({ value: null, error: null, busy: false })
  const alive = useRef(false), generation = useRef(0), controlling = useRef(false)
  const refresh = useCallback(async () => {
    if (controlling.current) return
    const g = ++generation.current
    try {
      const value = await withTimeout(fetchAnnaStatus(seat))
      if (alive.current && g === generation.current) setRead({ value, error: null, busy: false })
    } catch (e) {
      if (alive.current && g === generation.current) setRead(s => ({ ...s, error: e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e) }))
    }
  }, [seat])
  useEffect(() => {
    alive.current = true
    void refresh()
    const tick = () => { if (document.visibilityState !== 'hidden') void refresh() }
    const timer = window.setInterval(tick, 60_000)
    window.addEventListener('focus', tick)
    return () => { alive.current = false; generation.current++; window.clearInterval(timer); window.removeEventListener('focus', tick) }
  }, [refresh])
  const control = useCallback(async (enabled: boolean) => {
    if (controlling.current) return
    controlling.current = true
    ++generation.current
    setRead(s => ({ ...s, busy: true, error: null }))
    try {
      const { error } = await withTimeout(Promise.resolve(supabase.rpc(`${seat}_lane_control`, { p_enabled: enabled })))
      if (error) throw error
      const value = await withTimeout(fetchAnnaStatus(seat))
      if (alive.current) setRead({ value, error: null, busy: false })
    } catch (e) {
      // An unanswered write may have landed; do not offer another toggle on stale state.
      if (alive.current) setRead({ value: null, busy: false, error: `Could not verify the lane setting. Refresh before changing it again. ${String((e as { message?: string })?.message ?? e)}` })
    } finally { controlling.current = false }
  }, [seat])
  return { read, refresh, control }
}
