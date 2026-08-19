import { describe, expect, it } from 'vitest'
import { canApprove, nextFreeSlot, toEvidence, REACTION_SLOT_HOUR_UTC } from './reactions'

describe('nextFreeSlot', () => {
  const now = new Date('2026-08-19T13:00:00Z')

  it('starts at tomorrow, never today', () => {
    // Today's slot hour may already be behind us; a past scheduled_at is a
    // publish-now with extra steps.
    expect(nextFreeSlot([], now)).toBe('2026-08-20T14:00:00.000Z')
  })

  it('takes the EARLIEST free day, not the end of the queue', () => {
    // 20th and 21st are taken, the 22nd is free, and days beyond it are taken
    // too. A queue-position rule would land on the 25th; a reaction posted six
    // days late is an answer nobody is still waiting for.
    const occupied = ['2026-08-20', '2026-08-21', '2026-08-23', '2026-08-24']
    expect(nextFreeSlot(occupied, now)).toBe('2026-08-22T14:00:00.000Z')
  })

  it('crosses a month boundary', () => {
    const late = new Date('2026-08-30T09:00:00Z')
    expect(nextFreeSlot(['2026-08-31'], late)).toBe('2026-09-01T14:00:00.000Z')
  })

  it('honours a caller-supplied hour', () => {
    expect(nextFreeSlot([], now, 9)).toBe('2026-08-20T09:00:00.000Z')
    expect(REACTION_SLOT_HOUR_UTC).toBe(14)
  })

  it('still returns a usable timestamp when the calendar is implausibly full', () => {
    const full = Array.from({ length: 61 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 7, 20 + i))
      return d.toISOString().slice(0, 10)
    })
    // Never an empty string — the caller writes whatever this returns.
    expect(nextFreeSlot(full, now)).toMatch(/^2026-\d\d-\d\dT14:00:00\.000Z$/)
  })
})

describe('canApprove', () => {
  it('refuses a blank or whitespace-only body', () => {
    // There is no generator behind this desk to fill a blank, so an empty body
    // would schedule a post whose text is ''.
    expect(canApprove('')).toBe(false)
    expect(canApprove('   \n  ')).toBe(false)
  })

  it('accepts any real text', () => {
    expect(canApprove('No.')).toBe(true)
  })
})

describe('toEvidence', () => {
  it('reads the first element of the evidence array', () => {
    const e = toEvidence([{ author: 'levie', quotes: 18, thread_url: 'https://x.com/levie/status/1' }])
    expect(e?.author).toBe('levie')
    expect(e?.quotes).toBe(18)
  })

  it('coerces a malformed blob to nulls rather than throwing', () => {
    // One bad row costs that row its numbers; it must not blank the desk.
    const e = toEvidence([{ author: 42, quotes: 'lots', excerpt: '' }])
    expect(e).not.toBeNull()
    expect(e?.author).toBeNull()
    expect(e?.quotes).toBeNull()
    expect(e?.excerpt).toBeNull()
  })

  it('answers null for a missing or non-array evidence column', () => {
    expect(toEvidence(null)).toBeNull()
    expect(toEvidence([])).toBeNull()
    expect(toEvidence({ author: 'levie' })).toBeNull()
  })
})
