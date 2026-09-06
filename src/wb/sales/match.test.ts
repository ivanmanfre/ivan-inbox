import { describe, expect, it } from 'vitest'
import { describeTimes, groupEvents, matchPack, weekWindow } from './match'
import type { WeekEvent } from '../../lib/salesPacks'

// EVERY NAME IN THIS FILE IS INVENTED. The repo is public; a fixture is not a
// place to keep a real person's address. Ada Lovelace's Analytical Engines and
// Grace Hopper's Naval Ordnance stand in for the shapes that actually broke the
// matcher: a booking tool that truncates the display name in the title, and a
// company whose domain carries a hyphen its slug does not.

const evt = (o: Partial<WeekEvent> & { id: string }): WeekEvent => ({
  title: '', start_time: '2026-09-08T18:30:00.000Z',
  end_time: null, attendees: [], meeting_url: null, is_all_day: false,
  is_test: null, meeting_type: null, source: null, referral_token: null,
  booking_source_path: null, ...o,
})

const SLUGS = ['lovelace-analyticalengines', 'hopper-navalordnance']

describe('weekWindow', () => {
  it('opens on the Warsaw Monday and closes on the Sunday of the FOLLOWING week', () => {
    // Sunday 2026-09-06, 23:40 in Warsaw (21:40 UTC, CEST = UTC+2). The strict
    // one-week form would have held nothing but calls already over, which is the
    // measurement that ruled D1.
    const w = weekWindow(new Date('2026-09-06T21:40:00.000Z'))
    expect(w.from.toISOString()).toBe('2026-08-30T22:00:00.000Z') // Mon 08-31 00:00 Warsaw
    expect(w.to.toISOString()).toBe('2026-09-13T21:59:59.000Z')   // Sun 09-13 23:59:59 Warsaw
    expect(w.mondayLabel).toBe('Aug 31')
  })

  it('reads the WARSAW day, not the UTC one', () => {
    // 22:30 UTC on Sunday is already 00:30 Monday in Warsaw, so this instant
    // belongs to the next week. Reading getUTCDay() here would be off by seven.
    const w = weekWindow(new Date('2026-09-06T22:30:00.000Z'))
    expect(w.mondayLabel).toBe('Sep 7')
    expect(w.from.toISOString()).toBe('2026-09-06T22:00:00.000Z')
  })

  it('survives the autumn clock change inside its own window', () => {
    // Warsaw leaves CEST on Sunday 2026-10-25. A window that opened at UTC+2 has
    // to close at UTC+1, which is what the second offset pass buys.
    const w = weekWindow(new Date('2026-10-21T09:00:00.000Z'))
    expect(w.from.toISOString()).toBe('2026-10-18T22:00:00.000Z') // Mon 10-19 00:00, UTC+2
    expect(w.to.toISOString()).toBe('2026-11-01T22:59:59.000Z')   // Sun 11-01 23:59:59, UTC+1
  })
})

describe('groupEvents', () => {
  // Tuesday 2026-09-08, 11:00 in Warsaw.
  const now = new Date('2026-09-08T09:00:00.000Z')
  const rows = [
    evt({ id: 'e-next', start_time: '2026-09-15T09:00:00.000Z' }),
    evt({ id: 'e-later', start_time: '2026-09-10T10:30:00.000Z' }),
    evt({ id: 'e-today-pm', start_time: '2026-09-08T18:30:00.000Z' }),
    evt({ id: 'e-today-am', start_time: '2026-09-08T06:00:00.000Z' }),
    evt({ id: 'e-yesterday', start_time: '2026-09-07T11:00:00.000Z' }),
    evt({ id: 'e-friday', start_time: '2026-09-04T19:00:00.000Z' }),
  ]

  it('splits the fortnight into today, the rest of this week, next week and what is done', () => {
    const g = groupEvents(rows, now)
    expect(g.today.map(e => e.id)).toEqual(['e-today-am', 'e-today-pm'])
    expect(g.later.map(e => e.id)).toEqual(['e-later'])
    expect(g.next.map(e => e.id)).toEqual(['e-next'])
    // Newest first: the report he wants is from the last call, not the first.
    expect(g.earlier.map(e => e.id)).toEqual(['e-yesterday', 'e-friday'])
  })

  it('puts a late-Sunday-UTC call in NEXT week, because in Warsaw it is Monday', () => {
    const g = groupEvents([evt({ id: 'e-edge', start_time: '2026-09-13T22:30:00.000Z' })], now)
    expect(g.later).toHaveLength(0)
    expect(g.next.map(e => e.id)).toEqual(['e-edge'])
  })
})

describe('matchPack', () => {
  it('takes the stated event id over everything else', () => {
    const e = evt({
      id: 'evt-1',
      title: 'Lovelace and Ivan Manfredi',
      attendees: ['ada@analytical-engines.example.com'],
    })
    // The title and the address both point at Lovelace; the id says otherwise,
    // and being told beats being inferred.
    expect(matchPack(e, SLUGS, {}, { 'hopper-navalordnance': 'evt-1' })).toBe('hopper-navalordnance')
  })

  it('matches through a title the booking tool truncated', () => {
    // The real shape: a display name cut one character short, so no slug token
    // is in the title at all. The address is what is left to read.
    const e = evt({
      id: 'evt-2',
      title: 'lovelac  and Ivan Manfredi',
      attendees: ['lovelace@analytical-engines.example.com'],
    })
    expect(matchPack(e, SLUGS, {})).toBe('lovelace-analyticalengines')
  })

  it('sees through a hyphen in the company domain', () => {
    // Slug says `navalordnance`; the domain says `naval-ordnance`. Stripping to
    // letters and digits is what makes those the same word.
    const e = evt({
      id: 'evt-3',
      title: 'Intro chat',
      attendees: ['assistant@naval-ordnance.example.com'],
    })
    expect(matchPack(e, SLUGS, {})).toBe('hopper-navalordnance')
  })

  it('matches a two-word slug on the domain alone when neither word is anywhere else', () => {
    const e = evt({
      id: 'evt-4',
      title: '30 min',
      attendees: ['bookings@analytical-engines.example.com'],
    })
    expect(matchPack(e, SLUGS, {})).toBe('lovelace-analyticalengines')
  })

  it('leaves a client call unmatched rather than guessing a prospect', () => {
    const e = evt({
      id: 'evt-5',
      title: 'Steady x Ivan weekly',
      attendees: ['ivy@steadyclient.example.com'],
    })
    expect(matchPack(e, SLUGS, {})).toBeNull()
  })

  it('breaks a two-slug tie on the domain the pack itself states', () => {
    const slugs = ['grace-navalordnance', 'grace-tabulating']
    const e = evt({
      id: 'evt-6',
      title: 'Grace and Ivan Manfredi',
      attendees: ['grace@naval-ordnance.example.com'],
    })
    const meta = {
      'grace-navalordnance': { domain: 'naval-ordnance.example.com' },
      'grace-tabulating': { domain: 'tabulating.example.com' },
    }
    expect(matchPack(e, slugs, meta)).toBe('grace-navalordnance')
  })

  it('falls back to the longer token when no pack states a domain', () => {
    const slugs = ['grace-tabulating', 'hopper-navalordnance']
    const e = evt({
      id: 'evt-7',
      title: 'Intro',
      attendees: ['gracehopper@somewhere.example.com'],
    })
    // 'grace' and 'hopper' both sit in the local part; the longer one wins.
    expect(matchPack(e, slugs, {})).toBe('hopper-navalordnance')
  })

  it('never lets a three-letter token match an address', () => {
    // `ada` is a substring of half the addresses in the world.
    const e = evt({ id: 'evt-8', title: 'Sync', attendees: ['adaptive@nowhere.example.com'] })
    expect(matchPack(e, ['ada-analyticalengines'], {})).toBeNull()
  })
})

describe('describeTimes', () => {
  it('states both clocks and the countdown', () => {
    const t = describeTimes('2026-09-08T18:30:00.000Z', new Date('2026-09-07T07:00:00.000Z'))
    expect(t.warsaw).toBe('Tue 20:30')
    expect(t.utc).toBe('18:30 UTC')
    expect(t.rel).toBe('in 1d 11h')
    expect(t.soon).toBe(false)
    expect(t.past).toBe(false)
  })

  it('agrees with nextCall about what "about to start" means', () => {
    const t = describeTimes('2026-09-08T18:30:00.000Z', new Date('2026-09-08T16:30:00.000Z'))
    expect(t.rel).toBe('in 2h')
    expect(t.soon).toBe(false)
    const s = describeTimes('2026-09-08T18:30:00.000Z', new Date('2026-09-08T18:00:00.000Z'))
    expect(s.rel).toBe('in 30m')
    expect(s.soon).toBe(true)
  })

  it('says now at the minute it starts, and counts up afterwards', () => {
    expect(describeTimes('2026-09-08T18:30:00.000Z', new Date('2026-09-08T18:30:20.000Z')).rel).toBe('now')
    const past = describeTimes('2026-09-08T18:30:00.000Z', new Date('2026-09-10T18:30:00.000Z'))
    expect(past.rel).toBe('2d ago')
    expect(past.past).toBe(true)
  })

  it('reads the Warsaw wall clock, not the machine the page is open on', () => {
    // Winter: Warsaw is UTC+1, so 23:30 UTC has already turned the page on the
    // weekday a reader elsewhere would see.
    const t = describeTimes('2026-12-08T23:30:00.000Z', new Date('2026-12-08T00:00:00.000Z'))
    expect(t.warsaw).toBe('Wed 00:30')
    expect(t.utc).toBe('23:30 UTC')
  })
})
