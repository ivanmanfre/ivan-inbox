import type { ArchFillOffer, ArchFillWeek } from '../../../lib/archFill'
import { zonedToUtc } from '../laneTime'
import { DAY_MS, spacedFrom } from '../model'

// WHICH REPURPOSED POST GOES TO WHICH SLOT (review 2026-11-06 #25). Pure. Next week's open weekdays at ARCH's real
// time (the read's slot_hm, Zagreb), as many as the week is short of its target, oldest repurposed post first.
// Picks are spread two days apart when the week allows it, else one day apart; never within 24 h or on the same
// day as a post already dated. The database checks all of it again on the tap.

export type FillPair = { offer: ArchFillOffer; at: string; day: string }

/** Lead time the database asks for (arch_fill_commit refuses a slot less than 15 minutes ahead). */
const LEAD_MS = 15 * 60_000

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

export function fillPairs({ offered, week, busy, slotHm, tz, now }: {
  offered: readonly ArchFillOffer[]
  /** The server's week (arch_fill_week): start, target, posts already dated. */
  week: ArchFillWeek
  /** Every dated instant on the plan (posts already set), ISO. */
  busy: readonly string[]
  slotHm: string
  tz: string
  now: number
}): FillPair[] {
  const need = Math.max(0, (Number.isFinite(week.target) ? week.target : 0) - (Number.isFinite(week.dated) ? week.dated : 0))
  const k = Math.min(need, offered.length)
  if (k === 0) return []
  const slots = [0, 1, 2, 3, 4].map(n => addDays(week.start, n))
    .map(day => ({ day, t: Date.parse(zonedToUtc(day, slotHm, tz)) }))
    .filter(s => Number.isFinite(s.t) && s.t > now + LEAD_MS && spacedFrom(busy, s.t))
  const picked: { day: string; t: number }[] = []
  for (const gap of [2, 1]) {
    for (const s of slots) {
      if (picked.length >= k) break
      if (picked.some(p => p.day === s.day)) continue
      if (picked.every(p => Math.abs(p.t - s.t) >= gap * DAY_MS)) picked.push(s)
    }
  }
  picked.sort((a, b) => a.t - b.t)
  return picked.map((s, i) => ({ offer: offered[i], at: new Date(s.t).toISOString(), day: s.day }))
}

const REASON: Record<string, string> = {
  overlap: 'too close to the original',
  removed_by_davorin: 'Davorin took it off his board',
  original_not_posted: 'the original is not a posted ARCH post',
  no_text: 'it has no text',
}
/** One plain line per held repurposed draft. */
export const heldWhy = (reason: string, overlap: number | null) =>
  `${REASON[reason] ?? 'it does not qualify'}${reason === 'overlap' && overlap != null ? ` (${overlap.toFixed(2)} overlap, limit 0.40)` : ''}`
