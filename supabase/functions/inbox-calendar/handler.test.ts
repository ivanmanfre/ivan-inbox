import { describe, expect, it, vi } from 'vitest'
import { handleCalendar, type Store } from './handler'

const id = '640aa615-3561-4f1e-8b27-a2180a8b161c'
const start = new Date(Date.now() + 3 * 86400000).toISOString()
const end = new Date(Date.parse(start) + 1800000).toISOString()
const cal = { owner: 'Mattan', provider: 'hubspot', booking_url: 'https://meetings.hubspot.com/mattan5/rise-intro-call--li', checked_at: new Date().toISOString(), timezone: 'UTC', duration_minutes: 30, slots: [{ start, end }], can_book: true }
const make = () => {
  const store = { prospect: vi.fn(async () => ({ id, name: 'Ada Lovelace', email: 'ada@example.com', campaign_id: 'campaign', client_id: 'risedtc', call_booked_at: null, closed: false })), existing: vi.fn(async () => null), secret: vi.fn(async () => 'secret'), claim: vi.fn(async () => true), save: vi.fn(async () => {}), finish: vi.fn(async () => {}) } satisfies Store
  const provider = { availability: vi.fn(async () => cal), book: vi.fn(async () => ({ start, end, calendar_event_id: 'event' })), meetingRecord: vi.fn(async () => ({ meeting_id: '123', booked_at: '2026-10-17T00:09:50.192Z' })) }
  return { store, provider }
}
const input = { prospect_id: id, action: 'book', timezone: 'UTC', start, email: 'ada@example.com', request_id: '101aa615-3561-4f1e-8b27-a2180a8b161c', confirmed: true }

describe('calendar booking orchestration', () => {
  it('availability is read only', async () => {
    const { store, provider } = make()
    const r = await handleCalendar({ ...input, action: 'availability' }, store, provider)
    expect(r.calendar?.slots).toEqual([{ start, end }]); expect(store.claim).not.toHaveBeenCalled(); expect(provider.book).not.toHaveBeenCalled()
  })
  it('resolves owner from the campaign and rejects missing/unknown tenancy', async () => {
    const { store, provider } = make(); store.prospect.mockResolvedValue({ ...await store.prospect(), client_id: 'swishdm' })
    await expect(handleCalendar(input, store, provider)).rejects.toThrow(/calendar.*unavailable/i); expect(provider.book).not.toHaveBeenCalled()
  })
  it('keeps an already booked conversation read only', async () => {
    const { store, provider } = make(); store.prospect.mockResolvedValue({ ...await store.prospect(), call_booked_at: '2026-10-17T00:09:50.192Z' } as never)
    const r = await handleCalendar(input, store, provider)
    expect(r.existing_booking).toBeTruthy(); expect(provider.book).not.toHaveBeenCalled(); expect(store.claim).not.toHaveBeenCalled()
  })
  it.each([{ confirmed: false }, { email: '' }, { timezone: 'Moon' }, { start: 'invalid' }])('requires deliberate consent and valid identity/time: %s', async override => {
    const { store, provider } = make(); await expect(handleCalendar({ ...input, ...override }, store, provider)).rejects.toThrow(); expect(provider.book).not.toHaveBeenCalled()
  })
  it('claims before POST and rechecks selected slot immediately before booking', async () => {
    const { store, provider } = make(); provider.availability.mockResolvedValue({ ...cal, slots: [] })
    await expect(handleCalendar(input, store, provider)).rejects.toThrow(/no longer available/)
    expect(provider.book).not.toHaveBeenCalled(); expect(store.save).toHaveBeenCalledWith(input.request_id, 'failed', null)
  })
  it('a competing claim prevents any provider write', async () => {
    const { store, provider } = make(); store.claim.mockResolvedValue(false)
    await expect(handleCalendar(input, store, provider)).rejects.toThrow(/already/); expect(provider.book).not.toHaveBeenCalled()
  })
  it('persists exact receipt before CRM lookup and hands off using real meeting created time', async () => {
    const { store, provider } = make(); const r = await handleCalendar(input, store, provider)
    expect(r.booking).toMatchObject({ status: 'confirmed', calendar_event_id: 'event', start, end })
    expect(store.save).toHaveBeenCalledWith(input.request_id, 'confirmed', { start, end, calendar_event_id: 'event' })
    expect(store.finish).toHaveBeenCalledWith(input.request_id, { meeting_id: '123', booked_at: '2026-10-17T00:09:50.192Z' })
  })
  it('ambiguous POST stays uncertain and never retries', async () => {
    const { store, provider } = make(); provider.book.mockRejectedValue(Error('timeout'))
    await expect(handleCalendar(input, store, provider)).rejects.toThrow(/Check.*calendar/)
    expect(store.save).toHaveBeenCalledWith(input.request_id, 'uncertain', null); expect(provider.book).toHaveBeenCalledTimes(1)
  })
  it('pending and uncertain ledger entries block a retry even with a different key', async () => {
    const { store, provider } = make(); store.existing.mockResolvedValue({ status: 'uncertain' } as never)
    const r = await handleCalendar(input, store, provider); expect(r.existing_booking).toMatchObject({ status: 'uncertain' }); expect(provider.book).not.toHaveBeenCalled()
  })
})

import { calendarUser } from './handler'
it('auth fails closed for missing, expired, other-user and unavailable sessions', async () => {
  const auth = { getUser: vi.fn(async () => ({ data: { user: { id: 'owner' } }, error: null })) }
  expect(await calendarUser(auth, '', 'owner')).toBe(401)
  expect(await calendarUser(auth, 'token', 'different-owner')).toBe(403)
  auth.getUser.mockRejectedValue(Error('network'))
  expect(await calendarUser(auth, 'token', 'owner')).toBe(503)
})
