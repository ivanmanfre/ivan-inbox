export type Slot = { start: string; end: string }
export type Owner = { client_id: string; name: string; provider: 'hubspot' | 'calendly'; booking_url: string; slug: string; secret_key: string; user_id: string }
const owners: Record<string, Owner> = {
  risedtc: { client_id: 'risedtc', name: 'Mattan', provider: 'hubspot', booking_url: 'https://meetings.hubspot.com/mattan5/rise-intro-call--li', slug: 'mattan5', secret_key: 'hubspot_mattan_private_app_token', user_id: '80659343' },
  arch: { client_id: 'arch', name: 'Davorin', provider: 'hubspot', booking_url: 'https://meetings-eu1.hubspot.com/davorin-smit', slug: 'davorin-smit', secret_key: 'hubspot_arch_private_app_token', user_id: '31390863' },
  ivan: { client_id: 'ivan', name: 'Ivan', provider: 'calendly', booking_url: 'https://calendly.com/im-ivanmanfredi/30min', slug: 'im-ivanmanfredi/30min', secret_key: 'ivan_calendly_pat', user_id: 'im@ivanmanfredi.com' },
}
export function ownerFor(client: unknown): Owner | null { return typeof client === 'string' ? owners[client] ?? null : null }
export function validTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 80) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); return true } catch { return false }
}
export type Booked = Slot & { label: string; ours: boolean }
export type Calendar = { owner: string; provider: string; booking_url: string; checked_at: string; timezone: string; duration_minutes: number; slots: Slot[]; can_book: boolean; busy?: Slot[]; booked?: Booked[]; booked_labels_unavailable?: boolean }
type Fetch = typeof globalThis.fetch
async function json(url: string, secret: string, fetch: Fetch, init?: RequestInit) {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000) })
  if (!r.ok) throw Error('Calendar is unavailable. Open the owner’s booking link or try again.')
  return r.json()
}
export async function availability(owner: Owner, secret: string, timezone: string, now = Date.now(), fetch: Fetch = globalThis.fetch): Promise<Calendar> {
  if (!validTimezone(timezone)) throw Error('Enter a valid timezone, such as America/New_York.')
  let slots: Slot[], canBook = false, busy: Slot[] = []
  if (owner.provider === 'hubspot') {
    const r = await json(`https://api.hubapi.com/scheduler/v3/meetings/meeting-links/book/${encodeURIComponent(owner.slug)}?timezone=${encodeURIComponent(timezone)}`, secret, fetch)
    const users = r.allUsersBusyTimes
    if (r.isOffline !== false || r.linkType !== 'PERSONAL_LINK' || !Array.isArray(users) || users.length !== 1 || users[0].isOffline !== false || String(users[0].meetingsUser?.userId) !== owner.user_id) throw Error('The owner calendar could not be verified. Use the booking link.')
    const available = r.linkAvailability?.linkAvailabilityByDuration?.['1800000']?.availabilities
    if (!Array.isArray(available)) throw Error('Availability could not be loaded. Use the booking link.')
    slots = available.filter((s: { startMillisUtc: number; endMillisUtc: number }) => Number.isFinite(s.startMillisUtc) && Number.isFinite(s.endMillisUtc)).map((s: { startMillisUtc: number; endMillisUtc: number }) => ({ start: new Date(s.startMillisUtc).toISOString(), end: new Date(s.endMillisUtc).toISOString() }))
    // CALENDAR_BOOKED_LABELS_V1: the owner's busy blocks, times only (HubSpot gives no titles); our own booked calls are
    // labelled from the booking ledger in the handler
    const raw = Array.isArray(users[0].busyTimes) ? users[0].busyTimes : Array.isArray(users[0].busyTimesUnmerged) ? users[0].busyTimesUnmerged : []
    busy = raw.filter((b: { start: number; end: number }) => Number.isFinite(b?.start) && Number.isFinite(b?.end) && b.end > b.start).map((b: { start: number; end: number }) => ({ start: new Date(b.start).toISOString(), end: new Date(b.end).toISOString() }))
    const fields = r.customParams?.formFields
    canBook = Array.isArray(fields) && !fields.some((f: { isRequired?: boolean; name: string }) => f.isRequired && !['firstname', 'lastname', 'email'].includes(f.name)) && !r.customParams?.legalConsentEnabled
  } else {
    const api = 'https://api.calendly.com/'
    const user = (await json(`${api}users/me`, secret, fetch)).resource
    if (user?.email !== owner.user_id || !String(user?.uri).startsWith(`${api}users/`)) throw Error('The calendar owner could not be verified.')
    const types = (await json(`${api}event_types?user=${encodeURIComponent(user.uri)}&active=true`, secret, fetch)).collection
    const type = types?.find((t: { scheduling_url: string }) => t.scheduling_url === owner.booking_url)
    if (type?.duration !== 30 || !String(type?.uri).startsWith(`${api}event_types/`)) throw Error('The owner’s 30 minute calendar is unavailable.')
    const available = (await json(`${api}event_type_available_times?event_type=${encodeURIComponent(type.uri)}&start_time=${encodeURIComponent(new Date(now + 3600000).toISOString())}&end_time=${encodeURIComponent(new Date(now + 7 * 86400000).toISOString())}`, secret, fetch)).collection
    if (!Array.isArray(available)) throw Error('Availability could not be loaded.')
    slots = available.filter(s => s.status === 'available' && s.invitees_remaining > 0 && Number.isFinite(Date.parse(s.start_time))).map(s => ({ start: new Date(s.start_time).toISOString(), end: new Date(Date.parse(s.start_time) + 1800000).toISOString() }))
  }
  slots = slots.filter(s => Date.parse(s.start) > now + 3600000 && Date.parse(s.start) < now + 31 * 86400000 && Date.parse(s.end) - Date.parse(s.start) === 1800000)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  busy = busy.filter(b => Date.parse(b.end) > now && Date.parse(b.start) < now + 31 * 86400000).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  return { owner: owner.name, provider: owner.provider, booking_url: owner.booking_url, checked_at: new Date(now).toISOString(), timezone, duration_minutes: 30, slots, can_book: canBook, busy }
}

/** Busy blocks with our own booked calls named (11-26: "what's booked Monday" took four API calls). HubSpot merges
 * touching blocks, so a block is split around our bookings: our calls carry their label, the rest stays "Busy". A
 * booking with no block yet (calendar sync lag) is listed too. */
export function labelBusy(busy: Slot[], ours: Booked[]): Booked[] {
  const t = (x: string) => Date.parse(x), iso = (ms: number) => new Date(ms).toISOString()
  const used = new Set<number>(), out: Booked[] = []
  for (const b of busy) {
    const hits = ours.map((o, i) => ({ o, i })).filter(x => t(x.o.start) < t(b.end) && t(b.start) < t(x.o.end)).sort((x, y) => t(x.o.start) - t(y.o.start))
    let cursor = t(b.start)
    for (const { o, i } of hits) {
      if (t(o.start) > cursor) out.push({ start: iso(cursor), end: iso(Math.min(t(o.start), t(b.end))), label: 'Busy', ours: false })
      if (!used.has(i)) out.push(o)
      used.add(i); cursor = Math.max(cursor, t(o.end))
    }
    if (cursor < t(b.end)) out.push({ start: iso(cursor), end: b.end, label: 'Busy', ours: false })
  }
  ours.forEach((o, i) => { if (!used.has(i)) out.push(o) })
  return out.sort((a, b) => t(a.start) - t(b.start))
}
export type Receipt = Slot & { calendar_event_id: string }
export async function book(owner: Owner, secret: string, slot: Slot, identity: { name: string; email: string }, timezone: string, fetch: Fetch = globalThis.fetch): Promise<Receipt> {
  if (owner.provider !== 'hubspot') throw Error('Book through the owner’s booking link.')
  const [firstName, ...last] = identity.name.trim().split(/\s+/)
  const r = await json(`https://api.hubapi.com/scheduler/v3/meetings/meeting-links/book?timezone=${encodeURIComponent(timezone)}`, secret, fetch, {
    method: 'POST', body: JSON.stringify({ slug: owner.slug, firstName, lastName: last.join(' '), email: identity.email, startTime: Date.parse(slot.start), duration: 1800000, timezone, locale: 'en-us', guestEmails: [], likelyAvailableUserIds: [], formFields: [] }),
  })
  if (r.isOffline !== false || typeof r.calendarEventId !== 'string' || !r.calendarEventId.trim() || Date.parse(r.start) !== Date.parse(slot.start) || Date.parse(r.end) !== Date.parse(slot.end)) throw Error('The calendar invite could not be confirmed. Check the owner calendar before trying again.')
  return { ...slot, calendar_event_id: r.calendarEventId }
}

// CRM search can lag the scheduler. A missing CRM result never causes a second booking POST.
export async function meetingRecord(_owner: Owner, secret: string, receipt: Receipt, fetch: Fetch = globalThis.fetch) {
  const r = await json('https://api.hubapi.com/crm/v3/objects/meetings/search', secret, fetch, { method: 'POST', body: JSON.stringify({
    filterGroups: [{ filters: [{ propertyName: 'hs_i_cal_uid', operator: 'EQ', value: `${receipt.calendar_event_id}@google.com` }] }, { filters: [{ propertyName: 'hs_i_cal_uid', operator: 'EQ', value: receipt.calendar_event_id }] }],
    properties: ['hs_createdate', 'hs_meeting_start_time', 'hs_meeting_end_time', 'hs_i_cal_uid'], limit: 2,
  }) })
  if (r.results?.length !== 1) return null
  const m = r.results[0], p = m.properties
  if (!/^\d+$/.test(String(m.id)) || !Number.isFinite(Date.parse(p?.hs_createdate)) || ![receipt.calendar_event_id, `${receipt.calendar_event_id}@google.com`].includes(p.hs_i_cal_uid) || Date.parse(p.hs_meeting_start_time) !== Date.parse(receipt.start) || Date.parse(p.hs_meeting_end_time) !== Date.parse(receipt.end)) return null
  return { meeting_id: String(m.id), booked_at: new Date(p.hs_createdate).toISOString() }
}
