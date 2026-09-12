import { describe, expect, it } from 'vitest'
import { dayLabel, daySeparators } from './days'

// Both the fixture and `dayLabel`/`daySeparators` read a Date with the LOCAL
// getters (getFullYear/getMonth/getDate), so building fixtures from local wall-
// clock components (rather than a UTC 'Z' string picked by eye) is what keeps
// this suite honest regardless of which timezone it runs in — a UTC midnight
// boundary is not this runtime's midnight boundary.
const local = (y: number, m: number, d: number, h = 12, mi = 0): string =>
  new Date(y, m - 1, d, h, mi).toISOString()

const NOW = new Date(2026, 8, 12, 15, 0)

describe('dayLabel', () => {
  it('says Today for the same calendar day as now', () => {
    expect(dayLabel(local(2026, 9, 12, 9), NOW)).toBe('Today')
  })

  it('says Yesterday for one calendar day back', () => {
    expect(dayLabel(local(2026, 9, 11, 9), NOW)).toBe('Yesterday')
  })

  it('gives a bare day and month within the same year', () => {
    expect(dayLabel(local(2026, 1, 3), NOW)).toBe('3 Jan')
  })

  it('adds the year once the turn is from a different one', () => {
    expect(dayLabel(local(2025, 9, 12), NOW)).toBe('12 Sep 2025')
  })
})

describe('daySeparators', () => {
  const t = (id: string, at?: string) => ({ id, at })

  it('never marks the first turn, however old it is', () => {
    const marks = daySeparators([t('a', local(2026, 1, 1))], NOW)
    expect(marks.size).toBe(0)
  })

  it('marks the first turn of each new calendar day, and no other', () => {
    const turns = [
      t('a', local(2026, 9, 10, 9)),
      t('b', local(2026, 9, 10, 10)),
      t('c', local(2026, 9, 11, 9)),
      t('d', local(2026, 9, 12, 9)),
      t('e', local(2026, 9, 12, 10)),
    ]
    const marks = daySeparators(turns, NOW)
    expect([...marks.keys()]).toEqual(['c', 'd'])
    expect(marks.get('c')).toBe('Yesterday')
    expect(marks.get('d')).toBe('Today')
  })

  it('counts a bot bundle or answer as a turn like any other', () => {
    // Nothing in this function branches on role/origin — the walk is over the
    // list as given, exactly the point: a bot turn crossing midnight opens a
    // new day the same as an operator's would.
    const turns = [
      t('bot-bundle', local(2026, 9, 11, 23, 59)),
      t('bot-answer', local(2026, 9, 12, 0, 1)),
    ]
    const marks = daySeparators(turns, NOW)
    expect(marks.get('bot-answer')).toBe('Today')
  })

  it('a turn with no `at` neither opens nor closes a running day', () => {
    const turns = [
      t('a', local(2026, 9, 11, 9)),
      t('undated'),
      t('b', local(2026, 9, 11, 10)),
      t('c', local(2026, 9, 12, 9)),
    ]
    const marks = daySeparators(turns, NOW)
    expect([...marks.keys()]).toEqual(['c'])
  })

  it('is empty for no turns or all-undated turns', () => {
    expect(daySeparators([], NOW).size).toBe(0)
    expect(daySeparators([t('a'), t('b')], NOW).size).toBe(0)
  })
})
