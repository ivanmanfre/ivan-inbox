import { describe, expect, it } from 'vitest'
import { computeStats, defaultFilters, matchesFilters, pickableLanes, presetRange, shortLaneLabel, sortedLaneChips } from './filters'
import type { OrbitLane, OrbitPerson } from './types'

// Every name below is invented — this repo is public and a fixture is not a
// place to keep a real prospect's identity.

function person(o: Partial<OrbitPerson> & { id: string }): OrbitPerson {
  return {
    n: 'Someone', c: '', ti: '', i: null, url: 'https://linkedin.com/in/x', mid: null,
    pid: null, camp: null, lane: 'content', pstage: null, skip: null,
    st: 0, sd: [null, null, null, null, null], t0: '2026-08-01T00:00:00Z', t1: '2026-08-01T00:00:00Z',
    fresh: 0, inb: false, reached: false, v: false, pg: false, dmi: 0, dmo: 0, ev: [],
    ...o,
  }
}

describe('matchesFilters', () => {
  it('lane selection restricts to the chosen campaigns only', () => {
    const f = { ...defaultFilters(), lanes: new Set(['camp-a']) }
    expect(matchesFilters(person({ id: '1', camp: 'camp-a' }), f)).toBe(true)
    expect(matchesFilters(person({ id: '2', camp: 'camp-b' }), f)).toBe(false)
    expect(matchesFilters(person({ id: '3', camp: null }), f)).toBe(false)
  })

  it('contentOnly keeps only people with no prospect row', () => {
    const f = { ...defaultFilters(), contentOnly: true }
    expect(matchesFilters(person({ id: '1', pid: null }), f)).toBe(true)
    expect(matchesFilters(person({ id: '2', pid: 'p-1' }), f)).toBe(false)
  })

  it('movedFirst, neverReached and icpMin compose (AND, not OR)', () => {
    const f = { ...defaultFilters(), movedFirst: true, icpMin: 7 }
    // moved first AND icp>=7: passes
    expect(matchesFilters(person({ id: '1', inb: true, i: 8 }), f)).toBe(true)
    // moved first but icp under the floor: fails
    expect(matchesFilters(person({ id: '2', inb: true, i: 5 }), f)).toBe(false)
    // icp clears but did not move first: fails
    expect(matchesFilters(person({ id: '3', inb: false, i: 9 }), f)).toBe(false)
    // icp null never clears a floor
    expect(matchesFilters(person({ id: '4', inb: true, i: null }), f)).toBe(false)
  })

  it('search matches name, company or headline, case-insensitively', () => {
    const f = { ...defaultFilters(), q: 'acme' }
    expect(matchesFilters(person({ id: '1', c: 'Acme Corp' }), f)).toBe(true)
    expect(matchesFilters(person({ id: '2', n: 'Wile E. ACME' }), f)).toBe(true)
    expect(matchesFilters(person({ id: '3', c: 'Other Co' }), f)).toBe(false)
  })
})

describe('computeStats', () => {
  it('reached/replied/booked counts and the moved-first vs cold-first reply rate', () => {
    const people: OrbitPerson[] = [
      person({ id: '1', reached: true, inb: true, st: 3 }),  // moved-first, replied
      person({ id: '2', reached: true, inb: true, st: 1 }),  // moved-first, not replied
      person({ id: '3', reached: true, inb: false, st: 4 }), // cold-first, replied+booked
      person({ id: '4', reached: false, inb: false, st: 0 }),// never reached at all
    ]
    const s = computeStats(people)
    expect(s.people).toBe(4)
    expect(s.reached).toBe(3)
    expect(s.replied).toBe(2)
    expect(s.booked).toBe(1)
    expect(s.movedFirstRate).toBeCloseTo(1 / 2) // 1 of 2 moved-first-and-reached replied
    expect(s.coldFirstRate).toBeCloseTo(1 / 1)  // 1 of 1 cold-first-and-reached replied
  })

  it('a rate is null (not 0 or NaN) when its population is empty', () => {
    const s = computeStats([person({ id: '1', reached: false })])
    expect(s.movedFirstRate).toBeNull()
    expect(s.coldFirstRate).toBeNull()
  })
})

describe('presetRange', () => {
  it('30d spans the trailing 30 days inclusive of today', () => {
    const r = presetRange('30d', new Date('2026-09-11T12:00:00Z'))
    expect(r.to).toBe('2026-09-11')
    expect(r.from).toBe('2026-08-13')
  })

  it('all uses a fixed far-past floor rather than the person\'s own history', () => {
    const r = presetRange('all', new Date('2026-09-11T12:00:00Z'))
    expect(r.from < '2026-01-01').toBe(true)
    expect(r.to).toBe('2026-09-11')
  })
})

describe('sortedLaneChips / pickableLanes', () => {
  const lanes: OrbitLane[] = [
    { id: 'c1', name: 'Zeta Cold', lane: 'cold', active: true, n: 5 },
    { id: 'c2', name: 'Alpha Warm', lane: 'warm', active: true, n: 3 },
    { id: 'c3', name: 'Beta Cold', lane: 'cold', active: false, n: 1 },
  ]

  it('groups chips by lane, alphabetical within the group', () => {
    const sorted = sortedLaneChips(lanes)
    expect(sorted.map(l => l.id)).toEqual(['c3', 'c1', 'c2']) // cold(Beta,Zeta) then warm(Alpha)
  })

  it('pickableLanes excludes the cold lane and inactive campaigns — add-to-lane must never target cold', () => {
    const pick = pickableLanes(lanes)
    expect(pick.map(l => l.id)).toEqual(['c2'])
  })
})

describe('shortLaneLabel', () => {
  it('cuts at the last whole word inside the limit, never mid-word', () => {
    expect(shortLaneLabel('Accounting & Tax Advisory Firms')).toBe('Accounting & Tax')
  })

  it('leaves a name already inside the limit untouched', () => {
    expect(shortLaneLabel('Agency Owners')).toBe('Agency Owners')
  })

  it('never appends an ellipsis or drops below a sane floor', () => {
    const r = shortLaneLabel('Supercalifragilisticexpialidocious', 18)
    expect(r).toBe('Supercalifragilist') // no natural word break inside 18 chars: hard-cut, no "…"
    expect(r.includes('…')).toBe(false)
  })
})
