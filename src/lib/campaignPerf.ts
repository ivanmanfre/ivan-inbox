import { supabase } from './supabase'

// Per-campaign performance for the Lanes home (db/214 inbox_campaign_perf_v).
// Server-side aggregate: one row per non-archived campaign, so no 1000-row clamp.
export type CampaignPerf = {
  campaign_id: string
  campaign_name: string
  client_id: string
  is_active: boolean
  invites_7d: number
  dms_7d: number
  replied_7d: number
  positive_7d: number
  calls_7d: number
  calls_30d: number
  accept_judged: number
  accept_72h: number
  last_send: string | null
}

export type Seat = 'ivan' | 'risedtc' | 'arch'
export const SEATS: Seat[] = ['ivan', 'risedtc', 'arch']
export const SEAT_NAME: Record<Seat, string> = { ivan: 'Ivan', risedtc: 'Rise', arch: 'Arch' }

export async function fetchCampaignPerf(): Promise<CampaignPerf[]> {
  const { data, error } = await supabase.from('inbox_campaign_perf_v').select('*')
  if (error) throw error
  // bigint counts arrive as strings from PostgREST when they exceed int4; coerce.
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({
    ...(r as unknown as CampaignPerf),
    invites_7d: Number(r.invites_7d), dms_7d: Number(r.dms_7d),
    replied_7d: Number(r.replied_7d), positive_7d: Number(r.positive_7d),
    calls_7d: Number(r.calls_7d), calls_30d: Number(r.calls_30d),
    accept_judged: Number(r.accept_judged), accept_72h: Number(r.accept_72h),
  }))
}

// The client's own prefix says nothing inside that client's group.
export function shortName(name: string): string {
  return name
    .replace(/^RiseDTC\s*[—–-]\s*/i, '')
    .replace(/^ARCH\.?\s*Influencer Agency\s*[—–-]\s*/i, '')
    .trim()
}

export const isWorking = (c: CampaignPerf) =>
  c.invites_7d + c.dms_7d + c.replied_7d + c.calls_30d > 0

export type SeatGroup = { seat: Seat; shown: CampaignPerf[]; quiet: CampaignPerf[]; paused: CampaignPerf[] }

// "Active" = the flag is on or it sent something this week. Working campaigns
// show as cards, busiest first; active ones with nothing this week fold behind
// "+N quiet"; paused ones with nothing fold behind "+N paused", except on
// Ivan's seat, where paused campaigns are retired history (ruling 25 Jul).
export function groupBySeat(rows: CampaignPerf[], seats: Seat[] = SEATS): SeatGroup[] {
  return seats.map(seat => {
    const mine = rows.filter(r => r.client_id === seat)
    const shown = mine.filter(isWorking)
      .sort((a, b) => (b.invites_7d + b.dms_7d) - (a.invites_7d + a.dms_7d) || b.replied_7d - a.replied_7d)
    const idle = mine.filter(r => !isWorking(r))
    return {
      seat,
      shown,
      quiet: idle.filter(r => r.is_active),
      paused: seat === 'ivan' ? [] : idle.filter(r => !r.is_active),
    }
  })
}

// The answer on top: replies this week per seat, then calls. Never a sum of
// invitations across seats (each seat has its own cap).
export function answerLine(rows: CampaignPerf[], seats: Seat[] = SEATS): string {
  const per = seats.map(s => ({ s, n: rows.filter(r => r.client_id === s).reduce((t, r) => t + r.replied_7d, 0) }))
  const total = per.reduce((t, p) => t + p.n, 0)
  const calls = rows.filter(r => seats.includes(r.client_id as Seat)).reduce((t, r) => t + r.calls_7d, 0)
  const callsPart = calls === 0 ? 'No calls booked yet.' : `${calls} ${calls === 1 ? 'call' : 'calls'} booked.`
  if (seats.length === 1) return `${total} replied this week. ${callsPart}`
  return `${total} replied this week: ${per.map(p => `${SEAT_NAME[p.s]} ${p.n}`).join(', ')}. ${callsPart}`
}

// "25% accepted within 72h (30 of 118 old enough to judge)"; a dash, never 0%,
// when nothing is old enough yet.
export function acceptLine(c: CampaignPerf): string {
  if (c.accept_judged === 0) return 'Accept rate: — (no invitation is 72h old yet)'
  const pct = Math.round((c.accept_72h / c.accept_judged) * 100)
  return `${pct}% accepted within 72h (${c.accept_72h} of ${c.accept_judged} old enough to judge)`
}
