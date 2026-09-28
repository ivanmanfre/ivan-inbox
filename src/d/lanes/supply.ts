/* The chosen seat's lead supply, pure: who is ready to invite (per lane, the
   sender's own filter), the runway at the current invite pace, and the refill
   (people newly qualified ÷ people invited, inbox_replacement_v) over 7 days,
   with the last 14 days day by day for the in/out chart. The runway and refill
   math is the one the Control cell always printed ("runway 3d · refill 1.36x"). */
import type { Seat } from '../seats'
import { readyOf, type ReadyLane } from './glance/ready'
import type { LanesData } from './useLanesData'

export type SupplyDay = { day: string; inn: number; out: number }
export type Supply = {
  /** Ready to invite now, null while unread. */
  ready: number | null
  lanes: ReadyLane[]
  /** Invites per day: the 7-day average, or today's governor count when higher. */
  rate: number
  /** Whole days of ready people at that pace; null when unknown or nothing is sent. */
  runwayDays: number | null
  /** Qualified in ÷ sent out, last 7 days; null with nothing sent. */
  refill: number | null
  in7: number
  out7: number
  /** When more go out than come in: days until the ready pool is empty. */
  emptyIn: number | null
  days: SupplyDay[] | null
}

const DAY = 864e5

export function supplyOf(d: LanesData, seat: Seat, now: number): Supply {
  const g = d.gov.value?.find(x => x.client_id === seat)
  const pipe = (d.pipeline.value ?? []).filter(p => p.client_id === seat)
  const rs = d.ready.value ? readyOf(d.ready.value, seat, g) : null
  const ready = rs ? rs.total : d.pipeline.value ? pipe.reduce((a, p) => a + p.sendable, 0) : null
  const rate = Math.max(pipe.reduce((a, p) => a + p.sent_7d, 0) / 7, g?.daily_used ?? 0)
  const runwayDays = ready != null && rate > 0 ? Math.floor(ready / rate) : null
  const rows = d.replacement.value ? d.replacement.value.filter(r => r.client_id === seat) : null
  const cut = new Date(now - 7 * DAY).toISOString().slice(0, 10)
  const wk = (rows ?? []).filter(r => r.day >= cut)
  const in7 = wk.reduce((a, r) => a + r.qualified_in, 0), out7 = wk.reduce((a, r) => a + r.sent_out, 0)
  const refill = out7 > 0 ? Math.round((in7 / out7) * 100) / 100 : null
  const emptyIn = ready != null && in7 < out7 && rate > 0 ? Math.max(0, Math.floor(ready / Math.max(0.1, (out7 - in7) / 7))) : null
  const days = rows ? Array.from({ length: 14 }, (_, i) => {
    const day = new Date(now - (13 - i) * DAY).toISOString().slice(0, 10)
    const on = rows.filter(r => r.day.slice(0, 10) === day)
    return { day, inn: on.reduce((a, r) => a + r.qualified_in, 0), out: on.reduce((a, r) => a + r.sent_out, 0) }
  }) : null
  return { ready, lanes: rs?.lanes ?? [], rate, runwayDays, refill, in7, out7, emptyIn, days }
}
