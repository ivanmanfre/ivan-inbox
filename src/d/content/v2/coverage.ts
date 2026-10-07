import { warsawDay, warsawDow } from '../../ui/time'
import { DAY_MS, LANES, type Lane } from '../model'
import { dotOf } from '../calModel'
import type { PlanItem } from '../planModel'

// COVERAGE (SPEC-content §2.3, upgrade #2). The check Ivan makes again and
// again: every seat has at least 3 posts SET to go out next Mon-Fri. Pure,
// over the planner items the Calendar already holds (Warsaw day keys, so
// Rise's Pacific time never shifts a day). Only `set` counts: posted,
// dated-but-not-armed, review and queue-only rows are not coverage.
export const TARGET = 3

export type SeatCoverage = { lane: Lane; set: number; target: number; short: number; gaps: string[] }
export type Coverage = { days: string[]; seats: Record<Lane, SeatCoverage>; thisWeek: { set: number; posted: number } }

/** The five Warsaw weekday keys from `from` (inclusive) on. */
function weekdaysFrom(t: number, n = 5): string[] {
  const out: string[] = []
  for (let i = 0; out.length < n && i < 14; i++) {
    const x = t + i * DAY_MS
    const w = warsawDow(x)
    if (w !== 'Sat' && w !== 'Sun') out.push(warsawDay(x))
  }
  return out
}

/** Next week's Mon-Fri: the first Monday strictly after today, then four more weekdays. */
export function nextWeekDays(now: number): string[] {
  const noon = (t: number) => { const x = new Date(t); x.setUTCHours(10, 0, 0, 0); return x.getTime() }
  let t = noon(now) + DAY_MS
  for (let i = 0; i < 7 && warsawDow(t) !== 'Mon'; i++) t += DAY_MS
  return weekdaysFrom(t)
}

/** This week's Mon-Fri (on a weekend: the week that just ended). */
export function thisWeekDays(now: number): string[] {
  const noon = (t: number) => { const x = new Date(t); x.setUTCHours(10, 0, 0, 0); return x.getTime() }
  let t = noon(now)
  for (let i = 0; i < 7 && warsawDow(t) !== 'Mon'; i++) t -= DAY_MS
  return weekdaysFrom(t)
}

export function coverageOf(items: Record<Lane, Map<string, PlanItem[]>>, now: number): Coverage {
  const days = nextWeekDays(now)
  const seats = {} as Record<Lane, SeatCoverage>
  for (const lane of LANES) {
    let set = 0
    const gaps: string[] = []
    for (const k of days) {
      const n = (items[lane].get(k) ?? []).filter(it => dotOf(it) === 'set').length
      set += n
      if (n === 0) gaps.push(k)
    }
    const short = Math.max(0, TARGET - set)
    seats[lane] = { lane, set, target: TARGET, short, gaps: short > 0 ? gaps : [] }
  }
  let tSet = 0, tPosted = 0
  for (const lane of LANES) for (const k of thisWeekDays(now)) for (const it of items[lane].get(k) ?? []) {
    const d = dotOf(it)
    if (d === 'set') tSet++
    else if (d === 'posted') tPosted++
  }
  return { days, seats, thisWeek: { set: tSet, posted: tPosted } }
}
