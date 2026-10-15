import { warsawDay, warsawDow } from '../../ui/time'
import { DAY_MS, LANES, type Lane } from '../model'
import { dotOf } from '../calModel'
import type { PlanItem } from '../planModel'

// COVERAGE (SPEC-content §2.3, upgrade #2). The check Ivan makes again and
// again: every seat has at least 3 posts SET to go out next Mon-Fri. Pure,
// over the planner items the Calendar already holds (Warsaw day keys, so
// Rise's Pacific time never shifts a day). Only `set` counts: posted,
// dated-but-not-armed, review and queue-only rows are not coverage.
// The target is a parameter (2026-10-15: Content Brain read "3 of 3 scheduled" while Ivan's direction says
// 4 a week, Rise 5, Arch 3): a seat with no target passed keeps the old floor of 3.
export const TARGET = 3

export type SeatCoverage = { lane: Lane; set: number; target: number; short: number; gaps: string[] }
export type WeekCount = { set: number; posted: number }
/** `thisWeek` sums every seat; `thisWeekBy` keeps each seat's own count (thisWeekFor reads the picked ones). */
export type Coverage = { days: string[]; seats: Record<Lane, SeatCoverage>; thisWeek: WeekCount; thisWeekBy: Record<Lane, WeekCount> }

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

export function coverageOf(items: Record<Lane, Map<string, PlanItem[]>>, now: number, targets: Partial<Record<Lane, number | null>> = {}): Coverage {
  const days = nextWeekDays(now)
  const seats = {} as Record<Lane, SeatCoverage>
  for (const lane of LANES) {
    const t = targets[lane]
    const target = typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : TARGET
    let set = 0
    const gaps: string[] = []
    for (const k of days) {
      const n = (items[lane].get(k) ?? []).filter(it => dotOf(it) === 'set').length
      set += n
      if (n === 0) gaps.push(k)
    }
    const short = Math.max(0, target - set)
    seats[lane] = { lane, set, target, short, gaps: short > 0 ? gaps : [] }
  }
  const thisWeekBy = {} as Record<Lane, WeekCount>
  for (const lane of LANES) {
    const w: WeekCount = { set: 0, posted: 0 }
    for (const k of thisWeekDays(now)) for (const it of items[lane].get(k) ?? []) {
      const d = dotOf(it)
      if (d === 'set') w.set++
      else if (d === 'posted') w.posted++
    }
    thisWeekBy[lane] = w
  }
  return { days, seats, thisWeek: thisWeekFor({ thisWeekBy }, LANES), thisWeekBy }
}

/**
 * This week over the seats on screen only (audit 2026-10-15: Ivan picked read "9 posted, 2 to go",
 * every seat summed, when his own week was 3 posted, 1 to go).
 */
export function thisWeekFor(cov: Pick<Coverage, 'thisWeekBy'>, lanes: readonly Lane[]): WeekCount {
  let set = 0, posted = 0
  for (const l of lanes) { set += cov.thisWeekBy[l]?.set ?? 0; posted += cov.thisWeekBy[l]?.posted ?? 0 }
  return { set, posted }
}
