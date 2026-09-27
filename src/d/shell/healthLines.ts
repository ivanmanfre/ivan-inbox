import type { SeatHealth as Seat, SeatHealthSummary } from '../../lib/seatHealth'
import { warsawDayTime } from '../ui/time'

export const STALE_MS = 5 * 60 * 60 * 1000

export type HealthLine = { key: string; text: string; link: string | null }

/** Pure: the lines the banner draws. Empty = draw nothing. */
export function healthLines(s: SeatHealthSummary | null, now: number = Date.now()): HealthLine[] {
  if (!s) return []
  const out: HealthLine[] = s.seats.filter((x: Seat) => x.degraded).map(x => ({
    key: x.id,
    text: `${x.name}: ${x.account !== 'OK' ? 'LinkedIn seat disconnected' : 'Sales Nav session dead'}`,
    link: x.link,
  }))
  const t = Date.parse(s.updated_at)
  if (!Number.isFinite(t) || now - t > STALE_MS) {
    out.push({ key: 'stale', text: `Seat guard silent since ${Number.isFinite(t) ? warsawDayTime(t) + ' Warsaw' : 'an unknown time'}. Check the seat guard workflow.`, link: null })
  }
  return out
}
