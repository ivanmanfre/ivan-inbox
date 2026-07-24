import { describe, it, expect } from 'vitest'
import { acceptRate, runwayDays, governorHeadroomPct, laneLabel, governorEnforcementGap } from './kpis'

describe('acceptRate', () => {
  it('rounds accepted/sent to a whole percent', () => {
    expect(acceptRate(100, 31)).toBe(31)
    expect(acceptRate(3, 1)).toBe(33)
  })
  it('returns 0 when nothing was sent (no divide-by-zero)', () => {
    expect(acceptRate(0, 0)).toBe(0)
  })
})

describe('runwayDays', () => {
  it('floors sendable / daily rate', () => {
    expect(runwayDays(40, 4)).toBe(10)
    expect(runwayDays(9, 4)).toBe(2)
  })
  it('returns Infinity-safe 999 when send rate is 0', () => {
    expect(runwayDays(40, 0)).toBe(999)
  })
})

describe('governorHeadroomPct', () => {
  it('percent of cap used, clamped 0..100', () => {
    expect(governorHeadroomPct(42, 84)).toBe(50)
    expect(governorHeadroomPct(90, 84)).toBe(100)
    expect(governorHeadroomPct(0, 0)).toBe(0)
  })
})

describe('laneLabel', () => {
  it('maps lane keys to display labels', () => {
    expect(laneLabel('cold')).toBe('Cold')
    expect(laneLabel('warm')).toBe('Warm / Orbit')
    expect(laneLabel('engager')).toBe('Engager')
    expect(laneLabel('harvest')).toBe('Harvested')
    expect(laneLabel('other')).toBe('Other')
  })
})

describe('governorEnforcementGap', () => {
  it('true when the shared enforcement counter is maxed but this client is under it', () => {
    // ivan sent 41, but the shared sender_health counter reads 98/50 → gated by Rise
    expect(governorEnforcementGap(41, 50, 98, 50)).toBe(true)
  })
  it('false when the enforcement counter has not hit its cap', () => {
    expect(governorEnforcementGap(41, 50, 41, 50)).toBe(false)
  })
  it('false when this client already accounts for the whole enforcement count', () => {
    expect(governorEnforcementGap(98, 50, 98, 50)).toBe(false)
  })
  it('false on legacy RPC where enforcement fields are absent (null)', () => {
    expect(governorEnforcementGap(41, 50, null, null)).toBe(false)
    expect(governorEnforcementGap(41, 50, 98, null)).toBe(false)
    expect(governorEnforcementGap(41, 50, null, 50)).toBe(false)
  })
})
