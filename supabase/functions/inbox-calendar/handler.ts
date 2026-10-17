import { availability, book, meetingRecord, ownerFor, validTimezone, type Receipt } from './calendar.ts'
export type Booking = { status: string; start?: string; end?: string; calendar_event_id?: string; meeting_id?: string; request_id?: string; booked_at?: string; handoff?: boolean }
export type Prospect = { id: string; name: string; email: string | null; campaign_id: string; client_id: string; call_booked_at: string | null; closed: boolean }
export type Store = {
  prospect(id: string): Promise<Prospect | null>
  existing(id: string, client: string): Promise<Booking | null>
  secret(key: string): Promise<string>
  claim(id: string, client: string, requestId: string, start: string, email: string, timezone: string): Promise<boolean>
  save(requestId: string, status: 'failed' | 'confirmed' | 'uncertain', receipt: Receipt | null): Promise<void>
  finish(requestId: string, meeting: { meeting_id: string; booked_at: string }): Promise<void>
}
const uuid = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x)
const providers = { availability, book, meetingRecord }
export async function handleCalendar(input: Record<string, unknown>, store: Store, provider = providers) {
  if (!uuid(input.prospect_id) || !['availability', 'book'].includes(String(input.action)) || !validTimezone(input.timezone)) throw Error('A conversation and valid timezone are required.')
  const p = await store.prospect(input.prospect_id)
  if (!p) throw Error('Conversation not found.')
  const owner = ownerFor(p.client_id)
  if (!owner) throw Error('Calendar is unavailable for this conversation.')
  const base = { owner: owner.name, booking_url: owner.booking_url, timezone: input.timezone, email: p.email }
  const existing = await store.existing(p.id, p.client_id)
  if (existing) {
    // Recover the CRM handoff from a saved successful receipt without another invite.
    if (existing.status === 'confirmed' && !existing.meeting_id && existing.request_id && existing.calendar_event_id && existing.start && existing.end) {
      try {
        const secret = await store.secret(owner.secret_key)
        const meeting = await provider.meetingRecord(owner, secret, existing as Receipt)
        if (meeting) { await store.finish(existing.request_id, meeting); Object.assign(existing, meeting, { handoff: true }) }
      } catch { /* Receipt remains valid; the normal tracker can finish the handoff. */ }
    }
    return { ...base, existing_booking: existing }
  }
  if (p.call_booked_at) return { ...base, existing_booking: { status: 'booked', booked_at: p.call_booked_at } as Booking }
  if (p.closed) throw Error('This conversation is paused or closed.')
  const secret = await store.secret(owner.secret_key)
  if (input.action === 'availability') return { ...base, calendar: await provider.availability(owner, secret, input.timezone) }
  if (input.confirmed !== true || !uuid(input.request_id) || typeof input.start !== 'string' || !Number.isFinite(Date.parse(input.start)) || Date.parse(input.start) <= Date.now() + 3600000 || typeof input.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || input.email.length > 254 || p.name.trim().split(/\s+/).length < 2) throw Error('Confirm their agreement, full name, email and a future slot before booking.')
  if (owner.provider !== 'hubspot') throw Error('Book through the owner’s calendar link.')
  const start = new Date(input.start).toISOString(), email = input.email.trim().toLowerCase(), key = input.request_id
  if (!await store.claim(p.id, p.client_id, key, start, email, input.timezone)) throw Error('A booking is already in progress or recorded. Refresh before continuing.')
  let slot
  try {
    const fresh = await provider.availability(owner, secret, input.timezone)
    slot = fresh.slots.find(s => s.start === start)
    if (!fresh.can_book) throw Error('This calendar requires additional information. Use the owner’s booking link.')
    if (!slot) throw Error('That time is no longer available. Refresh and choose another time.')
  } catch (e) { await store.save(key, 'failed', null); throw e }
  let receipt: Receipt
  try {
    receipt = await provider.book(owner, secret, slot, { name: p.name, email }, input.timezone)
    await store.save(key, 'confirmed', receipt)
  } catch {
    // Any failure after entering POST is ambiguous, including a receipt write failure.
    // Leave a durable lock. A retry, reload or a new request key cannot book again.
    try { await store.save(key, 'uncertain', null) } catch { /* pending also blocks retries */ }
    throw Error('Booking could not be confirmed. Check the owner calendar before trying again; automatic retry is blocked.')
  }
  let handoff = false, meeting: { meeting_id: string; booked_at: string } | null = null
  try {
    meeting = await provider.meetingRecord(owner, secret, receipt)
    if (meeting) { await store.finish(key, meeting); handoff = true }
  } catch { /* Confirmed invite is saved. CRM sync can be recovered on refresh. */ }
  return { ...base, booking: { status: 'confirmed', ...receipt, ...meeting, handoff } as Booking }
}

type Auth = { getUser(token: string): Promise<{ data: { user: { id: string } | null }; error: { status?: number } | null }> }
export async function calendarUser(auth: Auth, token: string, allowed: string): Promise<number | null> {
  if (!token) return 401
  try {
    const { data, error } = await auth.getUser(token)
    if (error) return [401, 403].includes(error.status ?? 0) ? 401 : 503
    if (!data.user) return 401
    return data.user.id === allowed ? null : 403
  } catch { return 503 }
}
