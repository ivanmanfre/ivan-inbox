import { describe, expect, it } from 'vitest'
import { dayIn, hmIn, laneTimeWord, zonedToUtc } from './laneTime'

describe('laneTime', () => {
  it('keeps a RISE post at 7:00 AM PT across the weeks the EU and US clocks differ', () => {
    // EU ends summer time on 25 Oct 2026, the US on 1 Nov: 7:00 PT is 14:00Z before, still 14:00Z between, 15:00Z after.
    expect(zonedToUtc('2026-10-20', '07:00', 'America/Los_Angeles')).toBe('2026-10-20T14:00:00.000Z')
    expect(zonedToUtc('2026-10-28', '07:00', 'America/Los_Angeles')).toBe('2026-10-28T14:00:00.000Z')
    expect(zonedToUtc('2026-11-03', '07:00', 'America/Los_Angeles')).toBe('2026-11-03T15:00:00.000Z')
  })
  it('reads Warsaw wall clock both ways', () => {
    expect(zonedToUtc('2026-10-23', '11:00', 'Europe/Warsaw')).toBe('2026-10-23T09:00:00.000Z')
    expect(hmIn('2026-10-23T09:00:00Z', 'Europe/Warsaw')).toBe('11:00')
    expect(dayIn('2026-10-23T23:30:00Z', 'Europe/Warsaw')).toBe('2026-10-24')
  })
  it('says the time the way the owner reads it', () => {
    expect(laneTimeWord('2026-10-09T14:00:00Z', 'risedtc')).toBe('7:00 AM PT')
    expect(laneTimeWord('2026-10-10T17:00:00Z', 'risedtc')).toBe('10:00 AM PT')
    expect(laneTimeWord('2026-10-23T09:00:00Z', 'arch')).toBe('11:00 Warsaw')
  })
})
