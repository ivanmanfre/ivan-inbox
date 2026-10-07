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
export function otherPerson(row: CallRow) {
  return people(row.participants).find(p => !/^ivan(?:\s+manfredi)?$/i.test(p.trim())) ?? callTitle(row.title)
}
