/** Recipient wall time to one UTC instant. DST gaps and overlaps require another time. */
export function localSendInstant(date: string, time: string, timezone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error('Choose a date and time.')
  const [y, m, d] = date.split('-').map(Number)
  const [h, min] = time.split(':').map(Number)
  const wall = Date.UTC(y, m - 1, d, h, min)
  if (h > 23 || min > 59 || new Date(wall).toISOString().slice(0, 10) !== date) throw new Error('Choose a valid date and time.')
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const wanted = `${date}T${time}`
  const matches: number[] = []
  for (let offset = -840; offset <= 840; offset += 15) {
    const instant = wall + offset * 60000
    const p = Object.fromEntries(fmt.formatToParts(instant).map(x => [x.type, x.value]))
    if (`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` === wanted) matches.push(instant)
  }
  if (matches.length !== 1) throw new Error('That local time changes with daylight saving. Choose a different time.')
  return new Date(matches[0]).toISOString()
}

export function localSendDate(now: number, timezone: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

export function sendTimeLabel(at: string, timezone: string): string {
  return `${new Intl.DateTimeFormat('en-GB', { timeZone: timezone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at))} · ${timezone.replaceAll('_', ' ')}`
}

/** Only suggest a zone when all matching locations agree. */
export async function suggestTimezone(location: string | null): Promise<string | null> {
  if (!location?.trim()) return null
  const { cityMapping, lookupViaCity } = await import('city-timezones')
  const aliases: Record<string, string> = { 'united states': 'united states of america', usa: 'united states of america', uk: 'united kingdom', 'u.s.': 'united states of america' }
  const normalize = (s: string) => s.toLowerCase().replace(/^greater\s+/, '').replace(/\s+(metropolitan area|metro area|area|region)$/i, '').trim()
  const metro: Record<string, string> = { 'los angeles metropolitan area': 'Los Angeles, California, United States', 'san francisco bay area': 'San Francisco, California, United States', 'greater new york city area': 'New York, New York, United States' }
  const parts = (metro[location.toLowerCase().trim()] ?? location).split(',').map(normalize).map(s => aliases[s] ?? s)
  let found = lookupViaCity(parts[0])
  if (!found.length) found = cityMapping.filter(c => [c.country, c.province, c.iso2, c.iso3].some(v => (typeof v === 'string' ? v.toLowerCase() : '') === parts[0]))
  for (const part of parts.slice(1)) {
    const narrowed = found.filter(c => [c.country, c.province, c.iso2, c.iso3, c.state_ansi].some(v => (typeof v === 'string' ? v.toLowerCase() : '') === part))
    if (narrowed.length) found = narrowed
  }
  const zones = [...new Set(found.map(c => c.timezone))]
  return zones.length === 1 ? zones[0] : null
}
