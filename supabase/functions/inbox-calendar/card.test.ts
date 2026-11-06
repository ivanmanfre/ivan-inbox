import { describe, expect, it, vi } from 'vitest'
import { bookSlot, handleBookCard, Rejected, slotOpen, type CardStore } from './card'

const now = Date.parse('2026-11-04T11:48:00Z')
const start = '2026-11-05T18:00:00.000Z', end = '2026-11-05T18:30:00.000Z'
const card = (ctx: Record<string, unknown> = {}) => ({ id: 'c0a8f7e2-1111-4222-8333-944455556666', kind: 'task', approved_at: null, sent_at: null, send_blocked_reason: null,
  context: { action: 'book_link', kind_detail: 'book_offered_slot', client_id: 'risedtc', prospect_id: 'b162a8cd-0399-4364-9058-5c5d03f255ed', draft_message_id: 'd1',
    booking: { provider: 'hubspot', start, end, label: 'this Thursday at 1pm ET', display_timezone: 'America/New_York', invite_email: 'zech@urture.com' }, ...ctx } })
const make = (over: Partial<CardStore> = {}) => {
  const store = {
    card: vi.fn(async () => card()), prospect: vi.fn(async () => ({ id: 'b162a8cd-0399-4364-9058-5c5d03f255ed', name: 'Zech Strauser', client_id: 'risedtc', call_booked_at: null, closed: false, company_domain: 'urture.com' })),
    existing: vi.fn(async () => null), secret: vi.fn(async () => 'secret'), claim: vi.fn(async () => true), commit: vi.fn(async () => ({ recorded: true, released: true })), ...over,
  } as unknown as CardStore & Record<string, ReturnType<typeof vi.fn>>
  const provider = { slotOpen: vi.fn(async () => ({ open: true, fields: ['website'] })), bookSlot: vi.fn(async () => ({ start, end, calendar_event_id: '3guaghhi2156cr9a5t6r6t1rag' })),
    meetingRecord: vi.fn(async () => ({ meeting_id: '120362198909', booked_at: '2026-11-04T12:54:12.388Z' })) }
  return { store, provider }
}
const input = { action: 'book_card', card_id: 'c0a8f7e2-1111-4222-8333-944455556666', request_id: '101aa615-3561-4f1e-8b27-a2180a8b161c', confirmed: true }

describe('Book key on an accepted-time card', () => {
  it('books the exact accepted time and commits the provider meeting id + created time (Zech)', async () => {
    const { store, provider } = make()
    const r = await handleBookCard(input, store, provider as never, now)
    expect(r).toMatchObject({ status: 'booked', recorded: true, released: true })
    expect(store.claim).toHaveBeenCalledWith('b162a8cd-0399-4364-9058-5c5d03f255ed', 'risedtc', input.request_id, start, 'zech@urture.com', 'America/New_York')
    expect(provider.bookSlot).toHaveBeenCalledTimes(1)
    expect(store.commit).toHaveBeenLastCalledWith(input.request_id, input.card_id, '3guaghhi2156cr9a5t6r6t1rag', '120362198909', '2026-11-04T12:54:12.388Z')
  })
  it('needs the deliberate tap', async () => {
    const { store, provider } = make()
    await expect(handleBookCard({ ...input, confirmed: false }, store, provider as never, now)).rejects.toThrow(); expect(provider.bookSlot).not.toHaveBeenCalled()
  })
  it.each([[{ kind_detail: 'send_invite' }], [{ client_id: 'arch' }], [{ booking: { provider: 'tidycal', start, end, invite_email: 'zech@urture.com', display_timezone: 'America/New_York' } }]])('refuses a card that is not a bookable accepted time: %j', async ctx => {
    const { store, provider } = make({ card: vi.fn(async () => card(ctx)) } as never)
    await expect(handleBookCard(input, store, provider as never, now)).rejects.toThrow(); expect(store.claim).not.toHaveBeenCalled()
  })
  it('a prospect on another seat is refused', async () => {
    const { store, provider } = make({ prospect: vi.fn(async () => ({ id: 'x', name: 'Zech Strauser', client_id: 'swishdm', call_booked_at: null, closed: false, company_domain: null })) } as never)
    await expect(handleBookCard(input, store, provider as never, now)).rejects.toThrow(/not on that seat/); expect(provider.bookSlot).not.toHaveBeenCalled()
  })
  it('an existing booking or an unconfirmed one blocks a second invite', async () => {
    for (const status of ['booked', 'pending', 'uncertain']) {
      const { store, provider } = make({ existing: vi.fn(async () => ({ request_id: 'r', status })) } as never)
      const r = await handleBookCard(input, store, provider as never, now)
      expect(r.status).toBe('blocked'); expect(provider.bookSlot).not.toHaveBeenCalled(); expect(store.claim).not.toHaveBeenCalled()
    }
  })
  it('a confirmed invite for the same time finishes its record without booking again', async () => {
    const { store, provider } = make({ existing: vi.fn(async () => ({ request_id: 'r0', status: 'confirmed', start, calendar_event_id: 'ev' })) } as never)
    const r = await handleBookCard(input, store, provider as never, now)
    expect(r).toMatchObject({ status: 'booked', already: true }); expect(provider.bookSlot).not.toHaveBeenCalled()
    expect(store.commit).toHaveBeenCalledWith('r0', input.card_id, 'ev', '120362198909', '2026-11-04T12:54:12.388Z')
  })
  it('a time that is no longer free marks the claim failed and never POSTs', async () => {
    const { store, provider } = make(); provider.slotOpen.mockResolvedValue({ open: false, fields: [] })
    await expect(handleBookCard(input, store, provider as never, now)).rejects.toThrow(/no longer free/)
    expect(provider.bookSlot).not.toHaveBeenCalled(); expect(store.commit).toHaveBeenCalledWith(input.request_id, input.card_id, null, null, null)
  })
  it('a required field we cannot fill (no website on file) books nothing', async () => {
    const { store, provider } = make({ prospect: vi.fn(async () => ({ id: 'b162a8cd-0399-4364-9058-5c5d03f255ed', name: 'Zech Strauser', client_id: 'risedtc', call_booked_at: null, closed: false, company_domain: null })) } as never)
    await expect(handleBookCard(input, store, provider as never, now)).rejects.toThrow(/website/); expect(provider.bookSlot).not.toHaveBeenCalled()
  })
  it('a 4xx refusal frees the claim; an ambiguous failure keeps it locked', async () => {
    const a = make(); a.provider.bookSlot.mockRejectedValue(new Rejected('refused (400)'))
    await expect(handleBookCard(input, a.store, a.provider as never, now)).rejects.toThrow(/refused/); expect(a.store.commit).toHaveBeenCalledWith(input.request_id, input.card_id, null, null, null)
    const b = make(); b.provider.bookSlot.mockRejectedValue(Error('timeout'))
    await expect(handleBookCard(input, b.store, b.provider as never, now)).rejects.toThrow(/Check the owner calendar/); expect(b.store.commit).not.toHaveBeenCalled()
  })
  it('CRM lag: invite confirmed, record pending, card asks for a second tap', async () => {
    const { store, provider } = make({ commit: vi.fn(async () => ({ recorded: false, released: true })) } as never); provider.meetingRecord.mockResolvedValue(null as never)
    const r = await handleBookCard(input, store, provider as never, now)
    expect(r).toMatchObject({ status: 'booked', recorded: false }); expect(store.commit).toHaveBeenCalledWith(input.request_id, input.card_id, '3guaghhi2156cr9a5t6r6t1rag', null, null)
  })
  it('saves the receipt before the CRM lookup, then records with the meeting id', async () => {
    const { store, provider } = make()
    await handleBookCard(input, store, provider as never, now)
    expect(store.commit.mock.calls.map(c => c.slice(2))).toEqual([['3guaghhi2156cr9a5t6r6t1rag', null, null], ['3guaghhi2156cr9a5t6r6t1rag', '120362198909', '2026-11-04T12:54:12.388Z']])
  })
  it('a receipt that cannot be saved says so with the receipt id, and never books again', async () => {
    const { store, provider } = make({ commit: vi.fn(async () => { throw Error('db down') }) } as never)
    const r = await handleBookCard(input, store, provider as never, now)
    expect(r).toMatchObject({ status: 'booked', recorded: false }); expect(r.message).toContain('3guaghhi2156cr9a5t6r6t1rag'); expect(provider.bookSlot).toHaveBeenCalledTimes(1)
  })
})

describe('providers', () => {
  const st = Date.parse(start), en = Date.parse(end)
  it('HubSpot: the offered link, its busy-owner check and the required website field', async () => {
    const fetch = vi.fn(async () => Response.json({ isOffline: false, linkType: 'PERSONAL_LINK', customParams: { formFields: [{ name: 'website', isRequired: true }, { name: 'gross_margins', isRequired: false }] }, allUsersBusyTimes: [{ meetingsUser: { userId: 80659343 } }], linkAvailability: { linkAvailabilityByDuration: { '1800000': { availabilities: [{ startMillisUtc: st, endMillisUtc: en }] } } } }))
    const r = await slotOpen({ client_id: 'risedtc', name: 'Mattan', provider: 'hubspot', slug: 'mattan5/rise-intro-call--li', secret_key: 'k', user_id: '80659343', booking_url: '' }, 's', { start, end }, '', fetch as never)
    expect(r).toEqual({ open: true, fields: ['website'] }); expect(String(fetch.mock.calls[0][0])).toContain('/book/mattan5%2Frise-intro-call--li?')
  })
  it('HubSpot POST uses the shape that booked Zech', async () => {
    const fetch = vi.fn(async () => Response.json({ isOffline: false, calendarEventId: 'ev', start, end }))
    await bookSlot({ client_id: 'risedtc', name: 'Mattan', provider: 'hubspot', slug: 'mattan5/rise-intro-call--li', secret_key: 'k', user_id: '80659343', booking_url: '' }, 's', { start, end }, { name: 'Zech Strauser', email: 'zech@urture.com', website: 'urture.com' }, 'America/New_York', '', fetch as never)
    expect(JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({ slug: 'mattan5/rise-intro-call--li', firstName: 'Zech', lastName: 'Strauser', email: 'zech@urture.com', startTime: start, duration: 1800000, formFields: [{ name: 'website', value: 'urture.com' }] })
  })
  it('HubSpot 400 is a clean refusal, 500 is ambiguous', async () => {
    const o = { client_id: 'risedtc', name: 'Mattan', provider: 'hubspot', slug: 'x', secret_key: 'k', user_id: '1', booking_url: '' } as const
    await expect(bookSlot(o, 's', { start, end }, { name: 'A B', email: 'a@b.co', website: null }, 'UTC', '', vi.fn(async () => new Response('{}', { status: 400 })) as never)).rejects.toBeInstanceOf(Rejected)
    await expect(bookSlot(o, 's', { start, end }, { name: 'A B', email: 'a@b.co', website: null }, 'UTC', '', vi.fn(async () => new Response('{}', { status: 500 })) as never)).rejects.not.toBeInstanceOf(Rejected)
  })
  it('TidyCal: exact timeslot check and booking receipt with its own id and created time', async () => {
    const o = { client_id: 'swishdm', name: 'Jonathan', provider: 'tidycal', slug: '', secret_key: 'k', user_id: 'john@swishdm.com', booking_url: '' } as const
    const f1 = vi.fn(async (u: string) => Response.json(u.endsWith('/me') ? { email: 'John@SwishDM.com' } : { data: [{ starts_at: '2026-11-05T18:00:00Z', available_bookings: 1 }] }))
    expect(await slotOpen(o, 's', { start, end }, '2132756', f1 as never)).toEqual({ open: true, fields: [] })
    const f2 = vi.fn(async () => Response.json({ data: { id: 991, starts_at: '2026-11-05T18:00:00Z', created_at: '2026-11-04T12:00:01Z', cancelled_at: null } }))
    const r = await bookSlot(o, 's', { start, end }, { name: 'Jen Boville', email: 'jen@example.com', website: null }, 'America/Toronto', '2132756', f2 as never)
    expect(r).toMatchObject({ calendar_event_id: 'tidycal:991', meeting_id: '991', booked_at: '2026-11-04T12:00:01.000Z' })
    expect(String(f2.mock.calls[0][0])).toBe('https://tidycal.com/api/booking-types/2132756/bookings')
  })
})
