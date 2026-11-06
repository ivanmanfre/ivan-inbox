import { describe, expect, it } from 'vitest'
import { nextSpacedSlot, seatSlotOf, spacedFrom } from './model'
import { warsawDay, warsawDow, warsawHm } from '../ui/time'

// THE SEAT'S REAL SLOT (review 2026-11-06 #15, cross-review r1): Warsaw time whatever the browser zone, and the
// database's 24 h spacing rule checked against every dated post at the slot's own hour.
const NOW = Date.parse('2026-11-06T10:00:00Z') // Fri 6 Nov, 11:00 Warsaw
const pub = (iso: string) => ({ scheduled_at: iso, published_at: iso, status: 'published' })

describe('seatSlotOf', () => {
  it('the most common Warsaw time of the last 90 days; fewer than 3 posts keep 10:45', () => {
    expect(seatSlotOf([pub('2026-10-01T08:45:00Z'), pub('2026-10-02T08:45:00Z'), pub('2026-10-03T12:00:00Z')], NOW)).toEqual({ h: 10, m: 45 })
    expect(seatSlotOf([pub('2026-10-01T11:00:00Z'), pub('2026-10-02T11:00:00Z'), pub('2026-10-03T07:00:00Z')], NOW)).toEqual({ h: 13, m: 0 })
    expect(seatSlotOf([pub('2026-10-01T11:00:00Z')], NOW)).toEqual({ h: 10, m: 45 })
    // a draft still in review with a date is not a posting time
    expect(seatSlotOf([{ scheduled_at: '2026-10-01T05:00:00Z', published_at: null, status: 'review' }, pub('2026-10-02T08:45:00Z')], NOW)).toEqual({ h: 10, m: 45 })
  })
})

describe('nextSpacedSlot', () => {
  it('lands on a Warsaw weekday three days out at the slot time, in Warsaw (not the browser zone)', () => {
    const s = nextSpacedSlot([], NOW, { h: 10, m: 45 })
    expect(warsawDay(s.at)).toBe('2026-11-09')
    expect(warsawDow(s.at)).toBe('Mon')
    expect(warsawHm(s.at)).toBe('10:45')
    expect(s.at.toISOString()).toBe('2026-11-09T09:45:00.000Z')
  })
  it('skips a day that would sit within 24 h of a dated post at another hour', () => {
    // Sun 8 Nov 18:30 Warsaw is 16 h before Mon 10:45: Tue is the first free day
    expect(warsawDay(nextSpacedSlot(['2026-11-08T17:30:00Z'], NOW, { h: 10, m: 45 }).at)).toBe('2026-11-10')
    // a 09:00 slot the day after a 10:45 post is only 22 h 15 m away
    expect(warsawDay(nextSpacedSlot(['2026-11-09T09:45:00Z'], NOW, { h: 9, m: 0 }).at)).toBe('2026-11-11')
  })
  it('spacedFrom: 24 h or more and never the same Warsaw day', () => {
    const at = Date.parse('2026-11-10T09:45:00Z')
    expect(spacedFrom(['2026-11-09T09:45:00Z'], at)).toBe(true)
    expect(spacedFrom(['2026-11-09T10:00:00Z'], at)).toBe(false)
    expect(spacedFrom(['2026-11-10T20:00:00Z'], at)).toBe(false)
  })
})
