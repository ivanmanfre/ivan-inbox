import { describe, expect, it } from 'vitest'
import { coverageOf, thisWeekFor } from './coverage'
import type { Lane } from '../model'
import type { PlanItem } from '../planModel'

// Audit 2026-10-15: with Ivan picked, the coverage bar read "This week: 9 posted, 2 to go" (every
// seat summed) when his own week was 3 posted, 1 to go.

const NOW = Date.parse('2026-10-15T10:00:00Z') // Thu; this week is Mon 12 - Fri 16 Oct
const posted = (id: string) => ({ id, stage: 'published', source: 'draft' }) as unknown as PlanItem
const set = (id: string) => ({ id, stage: 'scheduled', source: 'draft', arming: 'armed' }) as unknown as PlanItem
function items(by: Partial<Record<Lane, Record<string, PlanItem[]>>>): Record<Lane, Map<string, PlanItem[]>> {
  const m = (o?: Record<string, PlanItem[]>) => new Map(Object.entries(o ?? {}))
  return { ivan: m(by.ivan), risedtc: m(by.risedtc), arch: m(by.arch), swishdm: m(by.swishdm) }
}

describe('this week on the coverage bar', () => {
  const cov = coverageOf(items({
    ivan: { '2026-10-12': [posted('i1')], '2026-10-13': [posted('i2')], '2026-10-14': [posted('i3')], '2026-10-16': [set('i4')] },
    risedtc: { '2026-10-13': [posted('r1'), posted('r2')], '2026-10-16': [set('r3')] },
    arch: { '2026-10-14': [posted('a1')], '2026-10-19': [set('a-next')] },
  }), NOW)
  it('counts only the seats picked', () => {
    expect(thisWeekFor(cov, ['ivan'])).toEqual({ posted: 3, set: 1 })
    expect(thisWeekFor(cov, ['risedtc'])).toEqual({ posted: 2, set: 1 })
    expect(thisWeekFor(cov, ['arch'])).toEqual({ posted: 1, set: 0 })
  })
  it('"All" still sums every seat, and next week never counts as this week', () => {
    expect(thisWeekFor(cov, ['ivan', 'risedtc', 'arch', 'swishdm'])).toEqual({ posted: 6, set: 2 })
    expect(cov.thisWeek).toEqual({ posted: 6, set: 2 })
  })
})

// 2026-10-15: the Brain read "Next week 3 of 3 scheduled" for Ivan while his direction says 4 a week.
describe('the coverage target is the seat’s own', () => {
  const cov = coverageOf(items({ ivan: { '2026-10-19': [set('i1')], '2026-10-20': [set('i2')], '2026-10-21': [set('i3')] }, arch: { '2026-10-19': [set('a1')] } }), NOW, { ivan: 4, arch: null })
  it('reads the passed target, and keeps 3 where none is passed', () => {
    expect(cov.seats.ivan).toMatchObject({ set: 3, target: 4, short: 1 })
    expect(cov.seats.arch).toMatchObject({ set: 1, target: 3, short: 2 })
    expect(cov.seats.risedtc.target).toBe(3)
  })
})
