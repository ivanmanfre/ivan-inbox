import { availability, ownerFor, type Slot } from '../inbox-calendar/calendar.ts'

type Db = { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

/** One real free time on the seat owner's calendar, labelled the way the reply drafters word it ("next Monday at 1:45pm CET"). */
export type OfferSlot = { start: string; label: string }

// The zone each seat's times are written in. Same zones as the lane reply drafters use when the recipient's is unknown.
const LABEL_ZONE: Record<string, { tz: string; name: (d: Date) => string }> = {
  arch: { tz: 'Europe/Zagreb', name: d => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zagreb', timeZoneName: 'short' }).formatToParts(d).find(p => p.type === 'timeZoneName')!.value },
  risedtc: { tz: 'America/New_York', name: () => 'ET' },
  ivan: { tz: 'America/New_York', name: () => 'ET' },
}

const parts = (ms: number, tz: string) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  .formatToParts(new Date(ms)).filter(p => p.type !== 'literal').map(p => [p.type, p.value])) as Record<string, string>

/** Up to `max` slots on different weekdays, at least 36 hours out (the reply drafters' rule), inside 09:00-17:00 in the label zone. */
export function pickSlots(slots: Slot[], client: string, now = Date.now(), max = 2): OfferSlot[] {
  const zone = LABEL_ZONE[client]
  if (!zone) return []
  const dayMs = (p: Record<string, string>) => Date.UTC(+p.year, +p.month - 1, +p.day)
  const weekStart = (p: Record<string, string>) => dayMs(p) - ((new Date(dayMs(p)).getUTCDay() + 6) % 7) * 86400000
  const today = parts(now, zone.tz)
  const out: (OfferSlot & { day: string })[] = []
  for (const s of [...slots].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))) {
    const start = Date.parse(s.start), end = Date.parse(s.end)
    if (!(start >= now + 36 * 3600000) || !(end > start)) continue
    const p = parts(start, zone.tz), e = parts(end - 1, zone.tz)
    if (['Sat', 'Sun'].includes(p.weekday) || +p.hour < 9 || +e.hour >= 17 || p.day !== e.day) continue
    const day = `${p.year}-${p.month}-${p.day}`
    if (out.some(o => o.day === day)) continue
    const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: zone.tz, weekday: 'long' }).format(new Date(start))
    const weeks = Math.round((weekStart(p) - weekStart(today)) / (7 * 86400000))
    const when = weeks === 0 ? `this ${weekday}` : weeks === 1 ? `next ${weekday}`
      : new Intl.DateTimeFormat('en-GB', { timeZone: zone.tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(start))
    const h = +p.hour, time = `${h % 12 || 12}${p.minute === '00' ? '' : `:${p.minute}`}${h < 12 ? 'am' : 'pm'}`
    out.push({ start: new Date(start).toISOString(), label: `${when} at ${time} ${zone.name(new Date(start))}`, day })
    if (out.length === max) break
  }
  return out.map(({ start, label }) => ({ start, label }))
}

/** Free times from the seat owner's live calendar, or null when it cannot be read (the email then asks without a time). */
export async function offerSlots(sb: Db, client: string, now = Date.now()): Promise<OfferSlot[] | null> {
  const owner = ownerFor(client), zone = LABEL_ZONE[client]
  if (!owner || !zone) return null
  try {
    const { data } = await sb.from('integration_config').select('value').eq('key', owner.secret_key).maybeSingle()
    if (!data?.value) return null
    const cal = await availability(owner, data.value, zone.tz, now)
    const picked = pickSlots(cal.slots, client, now)
    return picked.length ? picked : null
  } catch { return null }
}
