import { describe, expect, it } from 'vitest'
import type { ContentDraft } from '../../../lib/content'
import type { PlanItem } from '../planModel'
import type { Lane } from '../model'
import { coverageOf, nextWeekDays, thisWeekDays } from './coverage'
import { normUrl, picRepeats } from './picRepeat'
import { splitTitleTag } from '../model'

// Thu 8 Oct 2026, 12:00 Warsaw.
const NOW = Date.parse('2026-10-08T10:00:00Z')
const pi = (o: Partial<PlanItem> & { day: string; lane: Lane }): PlanItem => ({
  id: `${o.lane}-${o.day}-${Math.random()}`, source: 'draft', title: 'T', at: `${o.day}T08:45:00Z`, plannedAt: null, postedAt: null,
  stage: 'scheduled', arming: 'armed', movable: true, ...o,
} as unknown as PlanItem)
const items = (list: PlanItem[]) => {
  const out = { ivan: new Map(), risedtc: new Map(), arch: new Map() } as Record<Lane, Map<string, PlanItem[]>>
  for (const x of list) { const m = out[x.lane]; m.set(x.day, [...(m.get(x.day) ?? []), x]) }
  return out
}

describe('coverage: set posts next Mon-Fri per seat, target 3', () => {
  it('next week is the Monday after today, five weekdays', () => {
    expect(nextWeekDays(NOW)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'])
    expect(thisWeekDays(NOW)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'])
    // On a Monday, "next week" is the following Monday, never today.
    expect(nextWeekDays(Date.parse('2026-10-12T10:00:00Z'))[0]).toBe('2026-10-19')
    // On a Sunday it is the coming Monday.
    expect(nextWeekDays(Date.parse('2026-10-11T10:00:00Z'))[0]).toBe('2026-10-12')
  })
  it('counts only set posts; posted, planned, review and queue rows are not coverage', () => {
    const c = coverageOf(items([
      pi({ lane: 'ivan', day: '2026-10-12' }), pi({ lane: 'ivan', day: '2026-10-13' }), pi({ lane: 'ivan', day: '2026-10-14' }),
      pi({ lane: 'risedtc', day: '2026-10-12' }), pi({ lane: 'risedtc', day: '2026-10-13', arming: 'planned' } as Partial<PlanItem> & { day: string; lane: Lane }),
      pi({ lane: 'risedtc', day: '2026-10-14', stage: 'review', arming: null } as unknown as Partial<PlanItem> & { day: string; lane: Lane }),
      pi({ lane: 'risedtc', day: '2026-10-15', source: 'queue' } as Partial<PlanItem> & { day: string; lane: Lane }),
      pi({ lane: 'arch', day: '2026-10-09', stage: 'published', postedAt: '2026-10-09T08:00:00Z' } as Partial<PlanItem> & { day: string; lane: Lane }),
    ]), NOW)
    expect(c.seats.ivan).toMatchObject({ set: 3, short: 0, gaps: [] })
    expect(c.seats.risedtc).toMatchObject({ set: 1, short: 2 })
    expect(c.seats.risedtc.gaps).toEqual(['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'])
    expect(c.seats.arch).toMatchObject({ set: 0, short: 3 })
    expect(c.thisWeek.posted).toBe(1)
  })
  it('a Rise post at 7:00 PT stays on its Warsaw day key', () => {
    // 16:00 Warsaw Mon 12 = 07:00 PT; the item's day key is already Warsaw.
    const c = coverageOf(items([pi({ lane: 'risedtc', day: '2026-10-12', at: '2026-10-12T14:00:00Z' })]), NOW)
    expect(c.seats.risedtc.set).toBe(1)
    expect(c.seats.risedtc.gaps).not.toContain('2026-10-12')
  })
})

const row = (o: Partial<ContentDraft>): ContentDraft => ({
  id: 'x', client_id: null, status: 'review', type: 'single_image', title: 'T', topic: null, post_body: 'B',
  scheduled_at: null, published_at: null, source_post_id: null, image_urls: null, taxonomy: null,
  created_at: '2026-10-07T08:00:00Z', updated_at: '2026-10-07T08:00:00Z', board_visible: null, ...o,
} as ContentDraft)

describe('picture repeats: the same picture on two posts of a seat', () => {
  it('normalizes the query string and case away', () => {
    expect(normUrl('https://X.co/a/Selfie.jpg?token=1')).toBe('https://x.co/a/selfie.jpg')
  })
  it('flags both posts within 14 days', () => {
    const m = picRepeats([
      row({ id: 'a', status: 'scheduled', scheduled_at: '2026-10-09T08:45:00Z', image_urls: ['https://s/selfie-1.jpg?x=1'] }),
      row({ id: 'b', status: 'scheduled', scheduled_at: '2026-10-15T08:45:00Z', image_urls: ['https://s/selfie-1.jpg'] }),
    ])
    expect(m.get('a')).toEqual({ otherId: 'b', label: 'also on Thu 15' })
    expect(m.get('b')).toEqual({ otherId: 'a', label: 'also on Fri 9' })
  })
  it('does not flag far apart, other seats, or carousel slides', () => {
    const m = picRepeats([
      row({ id: 'a', status: 'scheduled', scheduled_at: '2026-10-01T08:45:00Z', image_urls: ['https://s/p.jpg'] }),
      row({ id: 'b', status: 'scheduled', scheduled_at: '2026-11-01T08:45:00Z', image_urls: ['https://s/p.jpg'] }),
      row({ id: 'c', client_id: 'risedtc', status: 'scheduled', scheduled_at: '2026-10-02T08:45:00Z', image_urls: ['https://s/p.jpg'] }),
      row({ id: 'd', type: 'carousel', image_urls: ['https://s/q.jpg', 'https://s/r.jpg'] }),
      row({ id: 'e', type: 'carousel', image_urls: ['https://s/q.jpg'] }),
    ])
    expect(m.size).toBe(0)
  })
  it('a draft in review sharing the picture flags', () => {
    const m = picRepeats([row({ id: 'a', image_urls: ['https://s/p.jpg'] }), row({ id: 'b', status: 'scheduled', scheduled_at: '2026-12-20T08:00:00Z', image_urls: ['https://s/p.jpg'] })])
    expect(m.get('a')?.otherId).toBe('b')
  })
})

describe('titles lose their internal tag', () => {
  it('[X outlier @thekevinjon] Warsaw in… → Warsaw in…', () => {
    expect(splitTitleTag('[X outlier @thekevinjon] Warsaw in…').text).toBe('Warsaw in…')
  })
})
