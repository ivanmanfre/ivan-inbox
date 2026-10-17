import { describe, expect, it, vi } from 'vitest'
import { availability, book, ownerFor, validTimezone } from './calendar'

const now = Date.parse('2026-10-17T00:00:00Z')
const start = '2026-10-20T18:00:00.000Z'
const end = '2026-10-20T18:30:00.000Z'
const fixture = () => ({ isOffline: false, linkType: 'PERSONAL_LINK', customParams: { formFields: [] }, allUsersBusyTimes: [{ isOffline: false, meetingsUser: { userId: '80659343' } }], linkAvailability: { linkAvailabilityByDuration: { '1800000': { availabilities: [{ startMillisUtc: Date.parse(start), endMillisUtc: Date.parse(end) }, { startMillisUtc: now - 1, endMillisUtc: now + 1799999 }] } } } })
const jsonFetch = (data: unknown) => vi.fn(async () => Response.json(data))

describe('owner calendar providers', () => {
  it('never maps missing or unknown campaign identity to a calendar', () => {
    expect(ownerFor(null)).toBeNull(); expect(ownerFor('swishdm')).toBeNull(); expect(ownerFor('rise')).toBeNull()
    expect(ownerFor('arch')?.slug).toBe('davorin-smit')
    expect(ownerFor('risedtc')?.slug).toBe('mattan5')
  })
  it('requires a real timezone', () => { expect(validTimezone('America/New_York')).toBe(true); expect(validTimezone('California')).toBe(false) })
  it('returns exact future instants, duration and caller timezone without leaking busy events', async () => {
    const fetch = jsonFetch(fixture())
    const result = await availability(ownerFor('risedtc')!, 'secret', 'America/New_York', now, fetch)
    expect(result.slots).toEqual([{ start, end }]); expect(result.timezone).toBe('America/New_York'); expect(result.duration_minutes).toBe(30)
    expect(JSON.stringify(result)).not.toContain('meetingsUser')
    expect(fetch.mock.calls[0][0]).toContain('/book/mattan5?timezone=America%2FNew_York')
  })
  it.each(['offline', 'wrong owner', 'wrong type'])('refuses %s calendars', async issue => {
    const f = fixture()
    if (issue === 'offline') f.isOffline = true
    if (issue === 'wrong owner') f.allUsersBusyTimes[0].meetingsUser.userId = '999'
    if (issue === 'wrong type') f.linkType = 'ROUND_ROBIN_CALENDAR'
    await expect(availability(ownerFor('risedtc')!, 'secret', 'UTC', now, jsonFetch(f))).rejects.toThrow()
  })
  it('required qualifiers disable direct booking instead of fabricating an answer', async () => {
    const f = { ...fixture(), customParams: { formFields: [{ name: 'revenue', isRequired: true }] } }
    const r = await availability(ownerFor('risedtc')!, 'secret', 'UTC', now, jsonFetch(f))
    expect(r.can_book).toBe(false); expect(r.booking_url).toBe('https://meetings.hubspot.com/mattan5/rise-intro-call--li')
  })
  it('posts one invite and accepts only a real online event for the exact slot', async () => {
    const fetch = jsonFetch({ isOffline: false, calendarEventId: 'event-1', start, end })
    const result = await book(ownerFor('risedtc')!, 'secret', { start, end }, { name: 'Ada Lovelace', email: 'ada@example.com' }, 'UTC', fetch)
    expect(result.calendar_event_id).toBe('event-1')
    const payload = JSON.parse(fetch.mock.calls[0][1].body)
    expect(payload).toMatchObject({ slug: 'mattan5', email: 'ada@example.com', startTime: 1792519200000, duration: 1800000, formFields: [] })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it.each([{ isOffline: true, calendarEventId: '', start, end }, { isOffline: false, calendarEventId: 'x', start, end: start }])('rejects ambiguous provider confirmation', async receipt => {
    await expect(book(ownerFor('risedtc')!, 'secret', { start, end }, { name: 'Ada Lovelace', email: 'ada@example.com' }, 'UTC', jsonFetch(receipt))).rejects.toThrow('could not be confirmed')
  })
  it('never retries a provider timeout', async () => {
    const fetch = vi.fn(async () => { throw Error('timeout') })
    await expect(book(ownerFor('risedtc')!, 'secret', { start, end }, { name: 'Ada Lovelace', email: 'ada@example.com' }, 'UTC', fetch)).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('Calendly checks account and exact event link, shows live slots and leaves booking to its link', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ resource: { email: 'im@ivanmanfredi.com', uri: 'https://api.calendly.com/users/ivan' } }))
      .mockResolvedValueOnce(Response.json({ collection: [{ uri: 'https://api.calendly.com/event_types/30min', scheduling_url: 'https://calendly.com/im-ivanmanfredi/30min', duration: 30 }] }))
      .mockResolvedValueOnce(Response.json({ collection: [{ start_time: start, status: 'available', invitees_remaining: 1 }] }))
    const r = await availability(ownerFor('ivan')!, 'secret', 'UTC', now, fetch)
    expect(r.slots).toEqual([{ start, end }]); expect(r.can_book).toBe(false)
  })
})
