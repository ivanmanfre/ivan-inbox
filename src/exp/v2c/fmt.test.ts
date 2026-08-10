import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { postTime, relOrAhead, relTime } from './fmt'

// `postTime` is the answer to "i cant really see post time" (2026-08-10): every
// surface that carried a scheduled row printed `relTime(updated_at)`, which is
// how old the ROW is. These pin the two things it has to get right — the clock
// is always there, and the DATE only appears once the weekday stops locating
// the slot.
//
// The clock face is the runner's locale, so nothing here asserts a literal
// string like "Tue 03:00 PM": that would pass on this laptop and fail in CI
// under a different ICU default. What is asserted is what the function
// PROMISES — which fields it includes — and that is locale-independent.

const NOW = Date.parse('2026-08-10T12:00:00.000Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => { vi.useRealTimers() })

/** The parts `toLocaleString` was asked for, read back off the output. */
function partsOf(iso: string, opts: Intl.DateTimeFormatOptions) {
  return new Date(iso).toLocaleString(undefined, opts)
}

describe('postTime', () => {
  it('is empty, not "Invalid Date", on an unparseable stamp', () => {
    expect(postTime('not a date')).toBe('')
  })

  it('inside a week: weekday and clock, no date', () => {
    const iso = '2026-08-12T15:00:00.000Z'
    expect(postTime(iso)).toBe(
      partsOf(iso, { weekday: 'short', hour: '2-digit', minute: '2-digit' }),
    )
    // The month/day pair is what it deliberately leaves out at this range.
    expect(postTime(iso)).not.toContain(
      partsOf(iso, { month: 'short' }),
    )
  })

  it('past a week: the date comes back, because a weekday no longer locates it', () => {
    const iso = '2026-08-21T14:00:00.000Z'
    expect(postTime(iso)).toBe(
      partsOf(iso, {
        weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      }),
    )
  })

  it('reads the same on either side of now — the 7d window is absolute', () => {
    // A slot 8 days BEHIND is as hard to place from a weekday as one 8 days
    // ahead: `Sun` alone would name three different Sundays in a fortnight.
    const behind = '2026-08-01T14:00:00.000Z'
    expect(postTime(behind)).toContain(partsOf(behind, { month: 'short' }))
  })

  it('carries the clock at every range — that is the whole point of it', () => {
    for (const iso of ['2026-08-10T13:00:00.000Z', '2026-08-12T15:00:00.000Z', '2026-09-30T09:30:00.000Z']) {
      expect(postTime(iso)).toContain(partsOf(iso, { hour: '2-digit', minute: '2-digit' }))
    }
  })
})

// The two it sits beside in the chip. `relOrAhead` is what tells the reader
// which side of now the slot is on, and the draft window's chip switches its
// LABEL on the same comparison — so a regression here would print "Posts" over
// a slot that has already passed.
describe('relOrAhead beside postTime', () => {
  it('counts forward for a slot still ahead', () => {
    expect(relOrAhead('2026-08-12T12:00:00.000Z')).toBe('in 2d')
  })

  it('falls back to the ago form once the slot has passed', () => {
    expect(relOrAhead('2026-08-09T12:00:00.000Z')).toBe('1d ago')
    expect(relTime('2026-08-09T12:00:00.000Z')).toBe('1d ago')
  })
})
