import { describe, expect, it } from 'vitest'
import { dayLabel } from './InboxList'

// Ivan, 2026-09-15: "today... yesterday... one day less.. and then all the rest".
describe('dayLabel', () => {
  const now = new Date(2026, 8, 15, 14, 0) // Tue 15 Sep 2026, local
  const at = (daysAgo: number, h = 9) => new Date(2026, 8, 15 - daysAgo, h).toISOString()
  it('names today and yesterday in words', () => {
    expect(dayLabel(at(0), now)).toBe('TODAY')
    expect(dayLabel(at(0, 23), now)).toBe('TODAY')
    expect(dayLabel(at(1), now)).toBe('YESTERDAY')
  })
  it('dates the rest of the week', () => {
    expect(dayLabel(at(2), now)).toBe('SUN, SEP 13')
    expect(dayLabel(at(6), now)).toBe('WED, SEP 9')
  })
  it('folds everything a week or older into one group', () => {
    expect(dayLabel(at(7), now)).toBe('EARLIER')
    expect(dayLabel(at(40), now)).toBe('EARLIER')
  })
  it('never dates the future as earlier', () => {
    expect(dayLabel(at(-1), now)).toBe('TODAY')
  })
})
