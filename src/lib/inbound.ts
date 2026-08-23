import { supabase } from './supabase'

// The INBOUND side of Lanes: the two automations that decide, with no human in the
// loop, whether a stranger ever reaches the inbox.
//
//   requests — `Outreach - Inbound Request Lane` judges received LinkedIn invitations
//              per seat, accepts the passes, and leaves the fails pending forever.
//   filtered — the triage inside the RISE reply detector classifies every chat on the
//              client's seat that maps to no known prospect, and registers only buyers.
//
// Both were invisible until 2026-08-23 (Ivan: "isolated, hidden campaigns that I don't
// have any visibility of"). db/040 gives them a shared shape; this file reads it.

export type InboundLaneKey = 'requests' | 'filtered'

export type InboundRow = {
  client_id: string
  lane: InboundLaneKey
  total: number
  d24: number
  d7: number
  d30: number
  passed: number
  dropped: number
  last_at: string | null
}

export type InboundDailyRow = {
  client_id: string
  lane: InboundLaneKey
  day: string
  n: number
}

// 🔴 A DELIBERATELY DIFFERENT STATUS VOCABULARY FROM THE OUTBOUND LANES, and the
// difference is the whole point. Outbound reads `stale` after 7 quiet days because a
// send lane that stops sending is broken. Inbound volume is 0-3 strangers a fortnight
// on a healthy seat, so borrowing that scale would paint every inbound lane red forever
// and the colour would stop meaning anything (the same "starved lane looks dead" trap
// the outreach diagnosis keeps hitting).
//
// `off` = this lane has recorded NO decisions for this client. That covers both "nobody
// armed it at onboarding" and "it is running and nothing came in", and 🔴 nothing in the
// data can currently separate the two: Rise's cold-DM filter is armed, running, and reads
// `off` because every recent inbound chat matched a known prospect. Splitting them needs a
// per-client lane manifest, which is the next slice. Until then the UI must not claim the
// stronger of the two readings.
export type InboundStatus = 'live' | 'quiet' | 'off'

export type InboundLane = {
  key: InboundLaneKey
  label: string
  blurb: string
  client_id: string
  total: number
  d7: number
  d30: number
  passed: number
  dropped: number
  last_at: string | null
  daily: number[] // 14 values, oldest -> newest, shared x-axis with every other lane
  status: InboundStatus
}

export type InboundDecision = {
  id: string
  client_id: string
  lane: InboundLaneKey
  decided_at: string
  who: string
  outcome: 'passed' | 'dropped'
  reason: string | null
  detail: string | null
  quote: string | null
  score: number | null
  link: string | null
  judged_blind: boolean
  surfaced: boolean
}

export const INBOUND_ORDER: InboundLaneKey[] = ['requests', 'filtered']

export const INBOUND_LABEL: Record<InboundLaneKey, string> = {
  requests: 'Connection requests',
  filtered: 'Cold-DM filter',
}

// Said in the operator's terms, because the whole failure mode here was not knowing these
// existed. Each line names what the automation DOES on its own.
export const INBOUND_BLURB: Record<InboundLaneKey, string> = {
  requests: 'Auto-accepts ICP invitations, leaves the rest pending',
  filtered: 'Drops clear cold sales before the inbox sees them',
}

// A lane goes quiet long before it is broken, so the window is generous on purpose.
const LIVE_DAYS = 14

export function inboundStatus(last_at: string | null, total: number, nowIso: string): InboundStatus {
  if (!last_at || total === 0) return 'off'
  const days = (new Date(nowIso).getTime() - new Date(last_at).getTime()) / 86_400_000
  return days <= LIVE_DAYS ? 'live' : 'quiet'
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a >= b ? a : b
}

// Pure so the status rules and the client roll-up are testable without a network.
export function buildInboundLanes(
  rows: InboundRow[],
  daily: InboundDailyRow[],
  client: 'all' | 'ivan' | 'risedtc' | 'arch',
  nowIso: string = new Date().toISOString(),
): InboundLane[] {
  const inClient = (id: string) => client === 'all' || id === client

  // Same shared-axis trick as buildLanes: one sorted day set across the whole result, so
  // two lanes with different activity still line their bars up under the same dates.
  const days = [...new Set(daily.map(d => d.day))].sort()
  const axis = days.slice(-14)

  return INBOUND_ORDER.map(key => {
    let total = 0, d7 = 0, d30 = 0, passed = 0, dropped = 0
    let last_at: string | null = null
    for (const r of rows) {
      if (r.lane !== key || !inClient(r.client_id)) continue
      total += r.total
      d7 += r.d7
      d30 += r.d30
      passed += r.passed
      dropped += r.dropped
      last_at = maxIso(last_at, r.last_at)
    }

    const perDay = new Map<string, number>()
    for (const d of daily) {
      if (d.lane !== key || !inClient(d.client_id)) continue
      perDay.set(d.day, (perDay.get(d.day) ?? 0) + d.n)
    }

    return {
      key,
      label: INBOUND_LABEL[key],
      blurb: INBOUND_BLURB[key],
      client_id: client,
      total, d7, d30, passed, dropped, last_at,
      daily: axis.map(day => perDay.get(day) ?? 0),
      status: inboundStatus(last_at, total, nowIso),
    }
  })
}

export async function fetchInbound(): Promise<InboundRow[]> {
  const { data, error } = await supabase.from('inbox_inbound_v').select('*')
  if (error) throw error
  return (data ?? []) as InboundRow[]
}

export async function fetchInboundDaily(): Promise<InboundDailyRow[]> {
  const { data, error } = await supabase.from('inbox_inbound_daily_v').select('*')
  if (error) throw error
  return (data ?? []) as InboundDailyRow[]
}

// The drill-in. Dropped decisions first is deliberate: a passed row already reached the
// inbox and can be read there, so the only thing this list can tell you that nothing else
// can is who the machine ended a conversation with.
export async function fetchInboundDecisions(
  lane: InboundLaneKey,
  client: 'all' | 'ivan' | 'risedtc' | 'arch',
  limit = 60,
): Promise<InboundDecision[]> {
  let q = supabase.from('inbox_inbound_decisions_v')
    .select('*')
    .eq('lane', lane)
    .order('decided_at', { ascending: false })
    .limit(limit)
  if (client !== 'all') q = q.eq('client_id', client)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as InboundDecision[]
}
