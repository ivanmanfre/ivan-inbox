/* Who the invites went to, per lane (Ivan 09-28: "on the daily send... which
   lane we send to: applications, games. Before that another separation: warm
   engagers, cold lane, hiring signal").
   Lane: Arch stores it per person (enrichment_data.lane, one campaign holds
   every lane); Ivan and Rise run one campaign per lane, so the campaign IS the
   lane there. Vertical (Arch only): enrichment_data.copy_vertical, the
   vertical the sender itself resolved for the copy (games / apps / d2c / pc).
   One SELECT per seat, invites confirmed sent (connection_sent_at), last 7
   Warsaw days; "today" is the Warsaw day. Nothing writes. */
import { supabase } from '../../lib/supabase'
import { shortName } from '../../lib/campaignPerf'
import type { Seat } from '../seats'
import { warsawDay } from '../ui/time'
import { laneLabel } from './labels'

export type SentRow = { campaign_id: string; sent_at: string; lane: string | null; vertical: string | null }
export type SeatSends = { rows: SentRow[]; campaigns: Record<string, string> }

const VERT: Record<string, string> = { games: 'Games', apps: 'Apps', d2c: 'D2C', pc: 'PC' }
export const VERT_ORDER = ['games', 'apps', 'd2c', 'pc', 'none'] as const
export const vertLabel = (k: string) => VERT[k] ?? (k === 'none' ? 'Not set' : k)

export async function fetchSeatSends(seat: Seat, now = Date.now()): Promise<SeatSends> {
  let cq = supabase.from('outreach_campaigns').select('id,name,client_id')
  cq = seat === 'ivan' ? cq.is('client_id', null) : cq.eq('client_id', seat)
  const { data: camps, error: ce } = await cq
  if (ce) throw ce
  const campaigns = Object.fromEntries(((camps ?? []) as { id: string; name: string }[]).map(c => [c.id, c.name]))
  const ids = Object.keys(campaigns)
  if (!ids.length) return { rows: [], campaigns }
  const since = new Date(now - 8 * 864e5).toISOString()
  const { data, error } = await supabase.from('outreach_prospects')
    .select('campaign_id,sent_at:connection_sent_at,lane:enrichment_data->>lane,vertical:enrichment_data->>copy_vertical')
    .in('campaign_id', ids).gte('connection_sent_at', since).order('connection_sent_at', { ascending: false }).limit(2000)
  if (error) throw error
  return { rows: (data ?? []) as SentRow[], campaigns }
}

export type MixLane = { key: string; label: string; n: number; verts: Array<{ key: string; n: number }> }
export type Mix = { total: number; lanes: MixLane[]; byVertical: boolean }

/** PURE: the window's invites per lane, largest first, each split by vertical when the seat has verticals (Arch). */
export function mixOf(s: SeatSends, seat: Seat, window: 'today' | '7d', now: number): Mix {
  const today = warsawDay(now)
  const cut = warsawDay(now - 6 * 864e5)
  const rows = s.rows.filter(r => { const d = warsawDay(r.sent_at); return window === 'today' ? d === today : d >= cut })
  const byVertical = seat === 'arch'
  const lanes = new Map<string, MixLane>()
  for (const r of rows) {
    const key = byVertical ? (r.lane ?? 'none') : r.campaign_id
    const label = byVertical ? (r.lane ? (r.lane === 'engager_warm' ? 'Warm engagers' : laneLabel(r.lane)) : 'No lane recorded') : shortName(s.campaigns[r.campaign_id] ?? 'Unknown campaign')
    const l = lanes.get(key) ?? { key, label, n: 0, verts: [] }
    l.n += 1
    if (byVertical) {
      const v = r.vertical && VERT[r.vertical] ? r.vertical : 'none'
      const hit = l.verts.find(x => x.key === v)
      if (hit) hit.n += 1; else l.verts.push({ key: v, n: 1 })
    }
    lanes.set(key, l)
  }
  const order = (k: string) => (VERT_ORDER as readonly string[]).indexOf(k)
  const out = [...lanes.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
  for (const l of out) l.verts.sort((a, b) => order(a.key) - order(b.key))
  return { total: rows.length, lanes: out, byVertical }
}
