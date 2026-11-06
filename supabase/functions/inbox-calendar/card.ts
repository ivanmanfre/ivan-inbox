// BOOKING_CARD_OFFERED_SLOT_V1 (2026-11-06, report item #13). The "Book <time> for <email>" key on an Ops card made by the
// RISE Reply Drafter or the SwishDM reply triage after a prospect said yes to the time WE offered. Ivan's tap is the only
// trigger: this books that exact time through the owner's own scheduler (Mattan: the HubSpot link the drafter offers;
// Jonathan: his TidyCal Strategy Session), then db inbox_booking_card_commit records it, releases the held confirm reply
// (still unapproved) and closes the card. It never sends a message.
import { meetingRecord, type Receipt, type Slot } from './calendar.ts'

type Fetch = typeof globalThis.fetch
export type CardOwner = { client_id: 'risedtc' | 'swishdm'; name: string; provider: 'hubspot' | 'tidycal'; slug: string; secret_key: string; user_id: string; booking_url: string }
const owners: Record<string, CardOwner> = {
  risedtc: { client_id: 'risedtc', name: 'Mattan', provider: 'hubspot', slug: 'mattan5/rise-intro-call--li', secret_key: 'hubspot_mattan_private_app_token', user_id: '80659343', booking_url: 'https://meetings.hubspot.com/mattan5/rise-intro-call--li' },
  swishdm: { client_id: 'swishdm', name: 'Jonathan', provider: 'tidycal', slug: 'm5llvq1/strategy-session', secret_key: 'swishdm_tidycal_api_key', user_id: 'john@swishdm.com', booking_url: 'https://tidycal.com/m5llvq1/strategy-session' },
}
export const cardOwnerFor = (client: unknown): CardOwner | null => typeof client === 'string' ? owners[client] ?? null : null

export type Card = { id: string; kind: string; approved_at: string | null; sent_at: string | null; send_blocked_reason: string | null; context: Record<string, unknown> }
export type CardProspect = { id: string; name: string; client_id: string; call_booked_at: string | null; closed: boolean; company_domain: string | null }
export type CardBooking = { request_id: string; status: string; start?: string; calendar_event_id?: string | null; meeting_id?: string | null; booked_at?: string | null }
export type CardStore = {
  card(id: string): Promise<Card | null>
  prospect(id: string): Promise<CardProspect | null>
  existing(id: string, client: string): Promise<CardBooking | null>
  secret(key: string): Promise<string>
  claim(id: string, client: string, requestId: string, start: string, email: string, timezone: string): Promise<boolean>
  commit(requestId: string, cardId: string, event: string | null, meeting: string | null, booked: string | null): Promise<{ recorded?: boolean; released?: boolean; status?: string }>
}
// A 4xx answer to the booking POST means nothing was created: the request may be retried. Anything else is ambiguous.
export class Rejected extends Error {}

const uuid = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x)
const email = (x: unknown): x is string => typeof x === 'string' && x.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)
function validTz(v: unknown): v is string { if (typeof v !== 'string' || v.length > 80) return false; try { new Intl.DateTimeFormat('en-US', { timeZone: v }).format(); return true } catch { return false } }

async function call(url: string, secret: string, fetch: Fetch, init?: RequestInit) {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', Accept: 'application/json' }, signal: AbortSignal.timeout(20000) })
  if (init?.method === 'POST' && r.status >= 400 && r.status < 500) throw new Rejected(`The calendar refused the booking (${r.status}). Nothing was booked.`)
  if (!r.ok) throw Error('Calendar is unavailable. Try again.')
  return r.json()
}

// Is this exact 30 minute slot still offered by the owner's booking page right now?
export async function slotOpen(o: CardOwner, secret: string, slot: Slot, typeId: string, fetch: Fetch = globalThis.fetch): Promise<{ open: boolean; fields: string[] }> {
  const st = Date.parse(slot.start), en = Date.parse(slot.end)
  if (o.provider === 'hubspot') {
    const r = await call(`https://api.hubapi.com/scheduler/v3/meetings/meeting-links/book/${encodeURIComponent(o.slug)}?timezone=UTC`, secret, fetch)
    const users = r.allUsersBusyTimes
    if (r.isOffline !== false || r.linkType !== 'PERSONAL_LINK' || !Array.isArray(users) || users.length !== 1 || String(users[0]?.meetingsUser?.userId) !== o.user_id) throw Error('The owner calendar could not be verified.')
    if (r.customParams?.legalConsentEnabled) throw Error('This calendar needs consent fields. Book by hand on the booking page.')
    const required = (Array.isArray(r.customParams?.formFields) ? r.customParams.formFields : []).filter((f: { isRequired?: boolean }) => f.isRequired).map((f: { name: string }) => f.name).filter((n: string) => !['firstname', 'lastname', 'email'].includes(n))
    const av = r.linkAvailability?.linkAvailabilityByDuration?.['1800000']?.availabilities
    if (!Array.isArray(av)) throw Error('Availability could not be loaded.')
    return { open: av.some((a: { startMillisUtc: number; endMillisUtc: number }) => a.startMillisUtc === st && a.endMillisUtc === en), fields: required }
  }
  const me = await call('https://tidycal.com/api/me', secret, fetch)
  if (String(me?.email || '').toLowerCase() !== o.user_id) throw Error('The owner calendar could not be verified.')
  if (!/^\d+$/.test(typeId)) throw Error('The booking type is missing on the card.')
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const r = await call(`https://tidycal.com/api/booking-types/${typeId}/timeslots?starts_at=${encodeURIComponent(iso(st - 60000))}&ends_at=${encodeURIComponent(iso(st + 2 * 3600000))}`, secret, fetch)
  if (!Array.isArray(r?.data)) throw Error('Availability could not be loaded.')
  return { open: r.data.some((t: { starts_at: string; available_bookings: number }) => Date.parse(t.starts_at) === st && Number(t.available_bookings) > 0), fields: [] }
}

export async function bookSlot(o: CardOwner, secret: string, slot: Slot, who: { name: string; email: string; website: string | null }, tz: string, typeId: string, fetch: Fetch = globalThis.fetch): Promise<Receipt & { meeting_id?: string; booked_at?: string }> {
  const [firstName, ...last] = who.name.trim().split(/\s+/)
  if (o.provider === 'hubspot') {
    // The shape that booked Zech Strauser on 11-04 (same link, website is a required field on it).
    const r = await call(`https://api.hubapi.com/scheduler/v3/meetings/meeting-links/book?timezone=${encodeURIComponent(tz)}`, secret, fetch, { method: 'POST', body: JSON.stringify({
      slug: o.slug, firstName, lastName: last.join(' '), email: who.email, startTime: slot.start, duration: 1800000, timezone: tz, locale: 'en-us',
      formFields: who.website ? [{ name: 'website', value: who.website }] : [], legalConsentResponses: [] }) })
    if (r.isOffline !== false || typeof r.calendarEventId !== 'string' || !r.calendarEventId.trim() || Date.parse(r.start) !== Date.parse(slot.start) || Date.parse(r.end) !== Date.parse(slot.end)) throw Error('The calendar invite could not be confirmed. Check the owner calendar before trying again.')
    return { ...slot, calendar_event_id: r.calendarEventId }
  }
  const r = await call(`https://tidycal.com/api/booking-types/${typeId}/bookings`, secret, fetch, { method: 'POST', body: JSON.stringify({ starts_at: new Date(slot.start).toISOString().replace(/\.\d{3}Z$/, 'Z'), name: who.name.trim(), email: who.email, timezone: tz }) })
  const b = r?.data
  if (!b || !Number.isFinite(Number(b.id)) || Date.parse(b.starts_at) !== Date.parse(slot.start) || b.cancelled_at || !Number.isFinite(Date.parse(b.created_at))) throw Error('The TidyCal invite could not be confirmed. Check the owner calendar before trying again.')
  return { ...slot, calendar_event_id: `tidycal:${b.id}`, meeting_id: String(b.id), booked_at: new Date(b.created_at).toISOString() }
}

const providers = { slotOpen, bookSlot, meetingRecord }
export async function handleBookCard(input: Record<string, unknown>, store: CardStore, provider = providers, now = Date.now()) {
  if (!uuid(input.card_id) || !uuid(input.request_id) || input.confirmed !== true) throw Error('Tap Book on the card to book this time.')
  const card = await store.card(input.card_id)
  const ctx = (card?.context ?? {}) as Record<string, unknown>
  const bk = (ctx.booking ?? {}) as Record<string, unknown>
  if (!card || card.kind !== 'task' || ctx.action !== 'book_link' || ctx.kind_detail !== 'book_offered_slot' || !bk.start) throw Error('This card cannot book a call.')
  if (card.sent_at || card.send_blocked_reason) throw Error('This card is already closed.')
  const o = cardOwnerFor(ctx.client_id)
  if (!o || bk.provider !== o.provider || !uuid(ctx.prospect_id)) throw Error('This card has no owner calendar.')
  const slot = { start: new Date(String(bk.start)).toISOString(), end: new Date(String(bk.end)).toISOString() }
  const to = String(bk.invite_email || '').trim().toLowerCase(), tz = String(bk.display_timezone || '')
  if (!email(to) || !validTz(tz) || Date.parse(slot.end) - Date.parse(slot.start) !== 1800000) throw Error('The card is missing the time, timezone or invite email.')
  const p = await store.prospect(ctx.prospect_id)
  if (!p || p.client_id !== o.client_id) throw Error('This conversation is not on that seat.')
  const typeId = String(bk.booking_type_id ?? '')
  const secret = await store.secret(o.secret_key)

  // Already booked or in flight for this prospect: never a second invite. A confirmed invite for this exact time
  // finishes its record and releases the confirm.
  const existing = await store.existing(p.id, o.client_id)
  if (existing) {
    if (existing.status === 'confirmed' && existing.calendar_event_id && existing.start && Date.parse(existing.start) === Date.parse(slot.start)) {
      let meeting = existing.meeting_id ? { meeting_id: existing.meeting_id, booked_at: String(existing.booked_at) } : null
      if (!meeting && o.provider === 'hubspot') { try { meeting = await provider.meetingRecord(o as never, secret, { ...slot, calendar_event_id: existing.calendar_event_id }) } catch { meeting = null } }
      const c = await store.commit(existing.request_id, card.id, existing.calendar_event_id, meeting?.meeting_id ?? null, meeting?.booked_at ?? null)
      return { status: 'booked', start: slot.start, recorded: !!c.recorded, released: !!c.released, already: true }
    }
    return { status: 'blocked', existing: existing.status, message: existing.status === 'confirmed' || existing.status === 'booked' ? 'A call is already booked for this person. Nothing new was booked.' : 'A booking for this person is in progress or unconfirmed. Check the owner calendar. Nothing new was booked.' }
  }
  if (p.call_booked_at) return { status: 'blocked', existing: 'booked', message: 'A call is already booked for this person. Nothing new was booked.' }
  if (p.closed) throw Error('This conversation is paused or closed.')
  if (Date.parse(slot.start) <= now + 3600000) throw Error('That time is less than an hour away. Book by hand if it still works.')
  if (p.name.trim().split(/\s+/).length < 2) throw Error('A full name is needed for the invite. Book by hand.')
  const key = input.request_id
  if (!await store.claim(p.id, o.client_id, key, slot.start, to, tz)) throw Error('A booking is already in progress or recorded. Refresh before continuing.')

  try {
    const open = await provider.slotOpen(o, secret, slot, typeId)
    if (!open.open) throw Error('That time is no longer free on the calendar. Offer a new time in the thread.')
    const missing = open.fields.filter(f => !(f === 'website' && p.company_domain))
    if (missing.length) throw Error('The booking page needs ' + missing.join(', ') + '. Book by hand.')
  } catch (e) { await store.commit(key, card.id, null, null, null); throw e }

  let receipt
  try { receipt = await provider.bookSlot(o, secret, slot, { name: p.name, email: to, website: p.company_domain }, tz, typeId) }
  catch (e) {
    if (e instanceof Rejected) { await store.commit(key, card.id, null, null, null); throw e }
    // Anything after the POST started is ambiguous: the ledger stays pending, so a retry can never book twice.
    throw Error('Booking could not be confirmed. Check the owner calendar before trying again; another booking is blocked.')
  }
  // Sol r1 #3: save the receipt first (ledger confirmed + confirm released), so a later failure can never strand it.
  let meeting: { meeting_id: string; booked_at: string } | null = receipt.meeting_id && receipt.booked_at ? { meeting_id: receipt.meeting_id, booked_at: receipt.booked_at } : null
  let c: { recorded?: boolean; released?: boolean } | null = null
  for (let i = 0; i < 2 && !c; i++) { try { c = await store.commit(key, card.id, receipt.calendar_event_id, meeting?.meeting_id ?? null, meeting?.booked_at ?? null) } catch { c = null } }
  if (!c) return { status: 'booked', start: slot.start, recorded: false, released: false, message: `The invite was sent (calendar receipt ${receipt.calendar_event_id}) but could not be saved. Record it with Booked on this card and reply in the thread yourself.` }
  if (!meeting && o.provider === 'hubspot') {
    try { meeting = await provider.meetingRecord(o as never, secret, receipt) } catch { meeting = null }
    if (meeting) { try { c = await store.commit(key, card.id, receipt.calendar_event_id, meeting.meeting_id, meeting.booked_at) } catch { /* the receipt is saved; the next tap finishes the record */ } }
  }
  return { status: 'booked', start: slot.start, recorded: !!c.recorded, released: !!c.released }
}
