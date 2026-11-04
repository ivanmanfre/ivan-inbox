import { describe, expect, it } from 'vitest'
import type { PlanRead } from '../../../lib/contentPlan'
import ivanFx from './fixtures/ivan.json'
import { itemsOf, type PlanItem } from './planBrain'
import { dropLabel, dropPlan, refuseWhy, weekOf } from './planDrag'

const items = itemsOf(structuredClone(ivanFx) as unknown as PlanRead)
const tz = { name: 'Europe/Warsaw', label: 'Warsaw' }
const at = (day: string, st = 'scheduled') => items.find(i => i.kind === 'post' && i.day === day && i.st === st)!
const slot = items.find(i => i.kind === 'planned')!
const NOW = Date.parse('2026-10-12T09:00:00Z')

describe('planDrag', () => {
  it('weekOf is the Monday of the week', () => {
    expect(weekOf('2026-10-12')).toBe('2026-10-12')
    expect(weekOf('2026-10-18')).toBe('2026-10-12')
    expect(weekOf('2026-10-21')).toBe('2026-10-19')
  })
  it('a dated post keeps its Warsaw time on the new day', () => {
    const p = dropPlan(at('2026-10-14'), 'ivan', tz, '2026-10-20', '2026-10-12', NOW)
    expect(p).toMatchObject({ kind: 'post', when: '2026-10-20T08:45:00.000Z', prev: '2026-10-14T08:45:00+00:00' })
    expect(dropLabel(at('2026-10-14'), 'ivan', tz, '2026-10-20', '2026-10-12', NOW)).toBe('Tue 20 Oct · 10:45 Warsaw')
  })
  it('a time already gone by today lands in an hour', () => {
    const p = dropPlan(at('2026-10-14'), 'ivan', tz, '2026-10-12', '2026-10-12', NOW)
    expect(p).toMatchObject({ kind: 'post', when: '2026-10-12T10:00:00.000Z' })
  })
  it('its own day, a past day, a published post do nothing', () => {
    expect(dropPlan(at('2026-10-14'), 'ivan', tz, '2026-10-14', '2026-10-12', NOW)).toEqual({ kind: 'none', why: null })
    expect(dropPlan(at('2026-10-14'), 'ivan', tz, '2026-10-11', '2026-10-12', NOW)).toEqual({ kind: 'none', why: 'That day has passed.' })
    expect(refuseWhy(at('2026-10-12', 'published'), 'ivan')).toMatch(/Already published/)
  })
  it('a planned slot moves to the dropped week; inside its own week it says why it stays', () => {
    expect(dropPlan(slot, 'ivan', tz, '2026-10-21', '2026-10-12', NOW)).toEqual({ kind: 'slot', slotId: slot.slotId, from: '2026-10-26', week: '2026-10-19' })
    expect(dropLabel(slot, 'ivan', tz, '2026-10-21', '2026-10-12', NOW)).toBe('Week of 19 Oct')
    expect(dropPlan(slot, 'ivan', tz, '2026-10-28', '2026-10-12', NOW)).toMatchObject({ kind: 'none', why: expect.stringMatching(/already in that week/) })
  })
  it('a Rise draft waiting for OK and a queue row without a draft refuse, like the panel', () => {
    const review = { ...at('2026-10-14'), st: 'review' } as PlanItem
    expect(refuseWhy(review, 'risedtc')).toMatch(/Rise draft/)
    expect(refuseWhy(review, 'ivan')).toBeNull()
    expect(refuseWhy(items.find(i => i.day === '2026-10-17')!, 'ivan')).toMatch(/no draft/)
  })
})
