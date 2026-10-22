import { describe, expect, it } from 'vitest'
import { addDays, hm12, isoDow, monthGrid, parseHm, quickDays, slots, stepHm } from './when'

describe('when: typed times', () => {
  it.each([
    ['9', '09:00'], ['09', '09:00'], ['930', '09:30'], ['0930', '09:30'], ['9:30', '09:30'], ['9.30', '09:30'], ['9h30', '09:30'],
    ['3pm', '15:00'], ['3:15 pm', '15:15'], ['12am', '00:00'], ['12pm', '12:00'], ['15', '15:00'], ['1530', '15:30'], ['noon', '12:00'], [' 7:05 ', '07:05'],
  ])('%s → %s', (a, b) => expect(parseHm(a)).toBe(b))
  it.each(['', 'abc', '25', '9:75', '13pm', '0pm', '12345'])('%s is not a time', a => expect(parseHm(a)).toBeNull())
  it('steps by 15 and wraps the day', () => {
    expect(stepHm('09:50', 15)).toBe('10:05')
    expect(stepHm('23:50', 15)).toBe('00:05')
    expect(stepHm('00:10', -15)).toBe('23:55')
  })
  it('slots carry the extras in order, and 12-hour reads right', () => {
    expect(slots(['16:45'], 16, 17)).toEqual(['16:00', '16:30', '16:45', '17:00'])
    expect(hm12('16:00')).toBe('4:00 PM')
    expect(hm12('00:30')).toBe('12:30 AM')
  })
})

describe('when: days', () => {
  it('adds days across a month and a DST weekend', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26')
    expect(isoDow('2026-10-12')).toBe(0)
    expect(isoDow('2026-10-18')).toBe(6)
  })
  it('a month is whole Monday-first weeks', () => {
    const g = monthGrid(2026, 9)
    expect(g[0][0]).toBe('2026-09-28')
    expect(g.at(-1)!.at(-1)).toBe('2026-11-01')
    expect(g.every(w => w.length === 7)).toBe(true)
  })
  it('quick days never go to the past', () => {
    expect(quickDays({ from: '2026-10-15', today: '2026-10-09', gap: '2026-10-14' }).map(q => [q.label, q.day]))
      .toEqual([['+1 day', '2026-10-16'], ['+1 week', '2026-10-22'], ['Next gap', '2026-10-14']])
    expect(quickDays({ from: '2026-10-01', today: '2026-10-09', gap: null }).map(q => q.day)).toEqual(['2026-10-10', '2026-10-16'])
    expect(quickDays({ from: null, today: '2026-10-09', gap: null }).map(q => [q.label, q.day])).toEqual([['Tomorrow', '2026-10-10'], ['Next week', '2026-10-12']])
  })
})
