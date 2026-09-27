import { describe, expect, it, vi } from 'vitest'
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
import { scheduleZone } from './scheduleZone'
import type { CalendarItem } from '../../lib/calendarItems'

const it0 = (over: Partial<CalendarItem>): CalendarItem => ({
  id: 'x', source: 'draft', title: 't', day: '2026-09-26', at: '2026-09-26T14:00:00Z',
  plannedAt: null, postedAt: null, stage: 'scheduled', type: 'text', movable: true,
  arming: 'armed', armable: false, ...over,
} as CalendarItem)

describe('scheduleZone: Today’s three facts, read off the calendar', () => {
  const now = Date.parse('2026-09-26T12:00:00Z')
  it('out today holds armed and posted, never stuck or planned', () => {
    const z = scheduleZone([
      it0({ id: 'a' }),
      it0({ id: 'b', arming: 'out', stage: 'published', at: '2026-09-26T08:00:00Z' }),
      it0({ id: 'c', stage: 'stuck', at: '2026-09-26T07:00:00Z' }),
      it0({ id: 'd', arming: 'planned', stage: 'review' }),
    ], '2026-09-26', now)
    expect(z.outToday.map(i => i.id)).toEqual(['a', 'b'])
  })
  it('next is the first armed post after now', () => {
    const z = scheduleZone([
      it0({ id: 'late', day: '2026-10-08', at: '2026-10-08T07:00:00Z' }),
      it0({ id: 'soon', day: '2026-10-07', at: '2026-10-07T08:53:00Z' }),
      it0({ id: 'past', at: '2026-09-26T09:00:00Z' }),
    ], '2026-09-26', now)
    expect(z.next?.id).toBe('soon')
  })
})
