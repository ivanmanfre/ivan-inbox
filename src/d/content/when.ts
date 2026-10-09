// WHEN: the pure parts of editing a post's date and time (WhenEditor). Day keys are 'YYYY-MM-DD'
// in the lane's own calendar, times 'HH:MM' in the lane's clock (laneTime). Date arithmetic is done
// on UTC noon, so no machine time zone can shift a day.

const pad = (n: number) => String(n).padStart(2, '0')
const keyOf = (t: number) => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` }
const noon = (key: string) => Date.parse(`${key}T12:00:00Z`)

/** A day key `n` days after `key`. */
export function addDays(key: string, n: number): string { return keyOf(noon(key) + n * 864e5) }

/** 0 = Monday … 6 = Sunday. */
export function isoDow(key: string): number { return (new Date(noon(key)).getUTCDay() + 6) % 7 }

/** A month as whole Monday-first weeks (the wall reads Monday to Friday). */
export function monthGrid(y: number, m: number): string[][] {
  const first = keyOf(Date.UTC(y, m, 1, 12))
  let k = addDays(first, -isoDow(first))
  const weeks: string[][] = []
  do {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(k, i)))
    k = addDays(k, 7)
  } while (Number(k.slice(5, 7)) - 1 === m && Number(k.slice(0, 4)) === y)
  return weeks
}

/**
 * What Ivan types into the time field, read generously: "9", "930", "0930", "9:30", "9.30",
 * "9h30", "3pm", "3:15 pm", "15", "1530", "noon". Null when it is not a time.
 */
export function parseHm(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, '')
  if (!s) return null
  if (s === 'noon' || s === 'midday') return '12:00'
  if (s === 'midnight') return '00:00'
  const m = s.match(/^(\d{1,2})(?:[:.h]?(\d{2}))?(am|pm|a|p)?$/) ?? s.match(/^(\d{1,2})(\d{2})(am|pm|a|p)?$/)
  if (!m) return null
  let h = Number(m[1]); const min = m[2] ? Number(m[2]) : 0
  const ap = m[3]
  if (min > 59) return null
  if (ap) {
    if (h < 1 || h > 12) return null
    if (ap.startsWith('p') && h !== 12) h += 12
    if (ap.startsWith('a') && h === 12) h = 0
  }
  if (h > 23) return null
  return `${pad(h)}:${pad(min)}`
}

/** `hm` moved by `minutes`, wrapping round the day. */
export function stepHm(hm: string, minutes: number): string {
  const [h, m] = hm.split(':').map(Number)
  const t = (((h * 60 + m + minutes) % 1440) + 1440) % 1440
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`
}

/** Half-hour slots for the time list, with the extras (current, usual) slotted in order. */
export function slots(extra: readonly string[] = [], from = 6, to = 23): string[] {
  const out = new Set<string>(extra)
  for (let h = from; h <= to; h++) { out.add(`${pad(h)}:00`); if (h < to) out.add(`${pad(h)}:30`) }
  return [...out].sort()
}

/** "16:00" → "4:00 PM" (Rise reads Pacific in 12-hour). */
export function hm12(hm: string): string {
  const [h, m] = hm.split(':').map(Number)
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`
}

export type Quick = { key: string; label: string; day: string }

/** One-tap days: a day later, a week later, the seat's next empty weekday. Never a past day. */
export function quickDays({ from, today, gap }: { from: string | null; today: string; gap: string | null }): Quick[] {
  const base = from && from >= today ? from : today
  const out: Quick[] = []
  if (from) {
    out.push({ key: 'd1', label: '+1 day', day: addDays(base, 1) })
    out.push({ key: 'w1', label: '+1 week', day: addDays(from, 7) >= today ? addDays(from, 7) : addDays(today, 7) })
  } else {
    out.push({ key: 'tomorrow', label: 'Tomorrow', day: addDays(today, 1) })
    out.push({ key: 'w1', label: 'Next week', day: addDays(today, 7 - isoDow(today)) })
  }
  if (gap && gap >= today && gap !== from) out.push({ key: 'gap', label: 'Next gap', day: gap })
  return out
}

/** Ivan's lane holds one post a day (the database's weekday guard): a taken day moves to the next free day, weekends included for a date set by hand. */
export function nextFree(day: string, taken: ReadonlySet<string>): string {
  let k = day
  for (let i = 0; i < 120 && taken.has(k); i++) k = addDays(k, 1)
  return k
}
