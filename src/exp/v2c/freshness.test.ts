import { describe, expect, it } from 'vitest'
import { FRESHNESS_COPY, freshnessOf, freshnessSeverity } from './freshness'

const NOW = Date.parse('2026-08-01T12:00:00.000Z')
const agoMs = (ms: number) => new Date(NOW - ms).toISOString()

describe('freshnessOf', () => {
  it('never, when nothing has loaded', () => {
    expect(freshnessOf(null, NOW)).toBe('never')
  })

  it('never, not a crash, on an unparseable stamp', () => {
    expect(freshnessOf('not a date', NOW)).toBe('never')
  })

  it('live inside two minutes', () => {
    expect(freshnessOf(agoMs(0), NOW)).toBe('live')
    expect(freshnessOf(agoMs(119_000), NOW)).toBe('live')
  })

  it('quiet between two and ten minutes', () => {
    expect(freshnessOf(agoMs(120_000), NOW)).toBe('quiet')
    expect(freshnessOf(agoMs(9 * 60_000), NOW)).toBe('quiet')
  })

  it('stalled past ten minutes', () => {
    expect(freshnessOf(agoMs(10 * 60_000), NOW)).toBe('stalled')
    expect(freshnessOf(agoMs(3 * 3600_000), NOW)).toBe('stalled')
  })
})

describe('freshnessSeverity', () => {
  it('stays inside the locked 3-tier vocabulary', () => {
    expect(freshnessSeverity('live')).toBe('clear')
    expect(freshnessSeverity('quiet')).toBe('attention')
    expect(freshnessSeverity('stalled')).toBe('urgent')
    expect(freshnessSeverity('never')).toBe('urgent')
  })

  it('never calls a live read a warning', () => {
    // The audit's point 8: amber must mean something is wrong, not "not done yet".
    expect(freshnessSeverity('live')).not.toBe('attention')
  })
})

describe('freshness copy', () => {
  it('says stalled-feed out loud, because that is finding A5', () => {
    expect(FRESHNESS_COPY.stalled).toMatch(/stalled feed/i)
  })

  it('has copy for every tier', () => {
    for (const [k, v] of Object.entries(FRESHNESS_COPY)) {
      expect(v, k).toBeTruthy()
    }
  })
})
