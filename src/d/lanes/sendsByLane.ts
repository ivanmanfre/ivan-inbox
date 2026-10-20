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
import type { Seat } from '../seats'
import { warsawDay } from '../ui/time'
import { laneInfo } from './laneInfo'
import { INTEREST_LABEL } from './interest'

export type SentRow = { campaign_id: string; sent_at: string; lane: string | null; vertical: string | null }
export type SeatSends = { rows: SentRow[]; campaigns: Record<string, string> }

const VERT: Record<string, string> = { games: 'Games', apps: 'Apps', d2c: 'D2C', pc: 'PC' }
export const VERT_ORDER = ['games', 'apps', 'd2c', 'pc', 'none'] as const
export const vertLabel = (k: string) => VERT[k] ?? (k === 'none' ? 'Not set' : k)

export async function fetchSeatSends(seat: Seat, now = Date.now()): Promise<SeatSends> {
  const since = new Date(now - 8 * 864e5).toISOString()
  const rows: SentRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('inbox_interest_prospects_v')
      .select('campaign_id,sent_at:connection_sent_at,lane:source_lane,vertical:copy_vertical')
      .eq('client_id', seat).gte('connection_sent_at', since)
      .order('connection_sent_at', { ascending: false }).range(from, from + 999)
    if (error) throw error
    rows.push(...(data ?? []) as SentRow[])
    if ((data ?? []).length < 1000) break
  }
  return { rows, campaigns: {} }
}

export type MixLane = { key: string; label: string; info: string | null; n: number; verts: Array<{ key: string; n: number }> }
export type Mix = { total: number; lanes: MixLane[]; byVertical: boolean }

/** PURE: the window's invites per lane, largest first, each split by vertical when the seat has verticals (Arch). */
export function mixOf(s: SeatSends, seat: Seat, window: 'today' | '7d', now: number): Mix {
  const today = warsawDay(now)
  const cut = warsawDay(now - 6 * 864e5)
  const rows = s.rows.filter(r => r.lane && r.lane in INTEREST_LABEL).filter(r => { const d = warsawDay(r.sent_at); return window === 'today' ? d === today : d >= cut })
  const byVertical = seat === 'arch'
  const lanes = new Map<string, MixLane>()
  for (const r of rows) {
    const key = r.lane!
    const label = INTEREST_LABEL[key as keyof typeof INTEREST_LABEL]
    const l = lanes.get(key) ?? { key, label, info: laneInfo(seat, key), n: 0, verts: [] }
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
