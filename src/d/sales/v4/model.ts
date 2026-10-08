import { callTitle, people, type CallRow } from '../../../lib/transcripts'
import { dayKey, weekWindow } from '../../../wb/sales/match'
import type { Fortnight } from '../model'
import type { ReadState } from '../useSalesData'

const addDay = (key: string, n: number) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
export function fortnightDays(f: Fortnight, now: Date) {
  const first = dayKey(weekWindow(now).from), today = dayKey(now)
  const events = Object.values(f).flat()
  return Array.from({ length: 14 }, (_, i) => {
    const day = addDay(first, i)
    return { day, today: day === today, weekend: i % 7 > 4, rows: events.filter(r => dayKey(r.ev.start_time) === day) }
  })
}
export function callsByWeek(calls: CallRow[], now: Date, state: ReadState = 'ok') {
  if (state !== 'ok') return null
  const monday = dayKey(weekWindow(now).from)
  return Array.from({ length: 8 }, (_, i) => {
    const day = addDay(monday, (i - 7) * 7), end = addDay(day, 7)
    const rows = calls.filter(c => c.date && dayKey(c.date) >= day && dayKey(c.date) < end)
    const lengths = rows.filter(c => c.duration_minutes != null)
    return { day, n: rows.length, avg: lengths.length ? Math.round(lengths.reduce((a, c) => a + c.duration_minutes!, 0) / lengths.length) : null, current: i === 7 }
  })
}
const IVAN = /^ivan(?:\s+manfredi)?$/i

/** The other person, read off a calendar title when the attendee list is empty:
 *  "Meet - 30 min with Ivan (Derek Chinners)" → Derek Chinners, "Meet - Paolo and Ivan Manfredi"
 *  → Paolo, "Meet - Mattan x Ivan - IOS Biweekly" → Mattan. Anything else keeps its title. */
export function nameFromTitle(title: string | null | undefined): string {
  const t = callTitle(title)
  const s = t.replace(/^(?:meet|zoom meeting|google meet)\s*[-–:]\s*/i, '').trim()
  const paren = s.match(/\bwith ivan(?: manfredi)?\s*\(([^)]+)\)/i)
  if (paren) return paren[1].trim()
  for (const part of s.split(/\s+[-–|/]+\s+/)) {
    const names = part.split(/\s+(?:x|and|&|<>)\s+/i).map(n => n.trim())
    if (names.length < 2 || !names.some(n => IVAN.test(n))) continue
    const other = names.find(n => n && !IVAN.test(n))
    if (other) return other
  }
  return t
}

export function otherPerson(row: CallRow) {
  return people(row.participants).find(p => !IVAN.test(p.trim())) ?? nameFromTitle(row.title)
}
