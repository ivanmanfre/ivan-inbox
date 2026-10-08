import type { Lane } from './model'

// EACH LANE'S CLOCK (2026-10-08). The publishers fire at a UTC instant; people read it in their own
// zone. Mattan's panel shows RISE in Pacific time, Davorin's shows ARCH in Zagreb (same offsets as
// Warsaw), Ivan reads Warsaw. A day move keeps the wall-clock time in the lane's own zone, so a RISE
// post at 7:00 AM PT stays at 7:00 AM PT across the weeks the EU and US clocks change on different
// Sundays, and a new date starts at the lane's usual posting time (RISE 7:00 AM PT = 14:00 UTC, its
// standing slot; ARCH 11:00; Ivan 09:00), never at midnight Pacific.
export const LANE_TZ: Record<Lane, string> = { ivan: 'Europe/Warsaw', risedtc: 'America/Los_Angeles', arch: 'Europe/Warsaw' }
export const LANE_DEFAULT_HM: Record<Lane, string> = { ivan: '09:00', risedtc: '07:00', arch: '11:00' }
export const LANE_TZ_WORD: Record<Lane, string> = { ivan: 'Warsaw', risedtc: 'PT', arch: 'Warsaw' }

const parts = (t: number, tz: string) => {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(t)
  const g = (k: string) => Number(p.find(x => x.type === k)?.value ?? 0)
  return { y: g('year'), m: g('month'), d: g('day'), H: g('hour') % 24, M: g('minute') }
}

/** 'HH:MM' of an instant in a zone. */
export function hmIn(iso: string, tz: string): string {
  const { H, M } = parts(Date.parse(iso), tz)
  return `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}`
}

/** 'YYYY-MM-DD' of an instant in a zone. */
export function dayIn(iso: string, tz: string): string {
  const { y, m, d } = parts(Date.parse(iso), tz)
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** The UTC instant of a wall-clock day + time in a zone (DST-correct: two passes over the offset). */
export function zonedToUtc(day: string, hm: string, tz: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const [H, M] = hm.split(':').map(Number)
  const want = Date.UTC(y, m - 1, d, H, M)
  const offset = (t: number) => { const p = parts(t, tz); return Date.UTC(p.y, p.m - 1, p.d, p.H, p.M) - t }
  let t = want - offset(want)
  t = want - offset(t)
  return new Date(t).toISOString()
}

/** "7:00 AM PT" / "16:00 Warsaw": how the lane's owner reads the time. */
export function laneTimeWord(iso: string, lane: Lane): string {
  const hm = hmIn(iso, LANE_TZ[lane])
  if (lane !== 'risedtc') return `${hm} ${LANE_TZ_WORD[lane]}`
  const [H, M] = hm.split(':').map(Number)
  return `${((H + 11) % 12) + 1}:${String(M).padStart(2, '0')} ${H < 12 ? 'AM' : 'PM'} PT`
}
