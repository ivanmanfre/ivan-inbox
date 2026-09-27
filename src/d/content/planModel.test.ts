import { describe, expect, it } from 'vitest'
import type { ContentDraft, ScheduledQueueRow } from '../../lib/content'
import { badgeOf, byDay, monthCounts, seatItems, undated, weekendAfter } from './planModel'

const NOW = Date.parse('2026-09-27T12:00:00Z')
const row = (o: Partial<ContentDraft>): ContentDraft => ({
  id: 'x', client_id: null, status: 'scheduled', type: 'text', title: 't', topic: null, post_body: 'b', scheduled_at: null, published_at: null,
  created_at: '2026-09-20T10:00:00Z', updated_at: '2026-09-20T10:00:00Z', image_urls: null, taxonomy: null, board_visible: null, ...o,
} as ContentDraft)

describe('planner: every kind of post', () => {
  it('two posts on one day, a weekend post and published history all land on their Warsaw day', () => {
    const rows = [
      row({ id: 'a', scheduled_at: '2026-09-29T08:45:00Z' }), row({ id: 'b', scheduled_at: '2026-09-29T15:00:00Z' }),
      row({ id: 'c', scheduled_at: '2026-10-03T08:00:00Z' }),
      row({ id: 'd', status: 'published', scheduled_at: '2026-09-22T08:00:00Z', published_at: '2026-09-22T08:01:10Z' }),
    ]
    const m = byDay(seatItems(rows, 'ivan', [], NOW))
    expect(m.get('2026-09-29')!.map(i => i.id)).toEqual(['a', 'b'])
    expect(m.get('2026-10-03')!.map(i => i.id)).toEqual(['c'])
    const pub = m.get('2026-09-22')![0]
    expect(badgeOf(pub)!.text).toBe('✓ POSTED 10:01')
    expect(weekendAfter('2026-10-02')).toEqual(['2026-10-03', '2026-10-04'])
  })
  it('a publish-queue-only post is drawn inert on Ivan’s seat, never on a client’s', () => {
    const q = [{ id: 'q1', clickup_task_id: null, post_text: 'Queue only text', scheduled_at: '2026-09-30T08:00:00Z', posted_at: null, status: 'pending', platform: 'linkedin', is_repost: null, error_message: null, created_at: '2026-09-20T00:00:00Z', post_kind: null, unipile_share_url: null } as unknown as ScheduledQueueRow]
    const ivan = seatItems([], 'ivan', q, NOW)
    expect(ivan.length).toBe(1)
    expect(ivan[0].source).toBe('queue')
    expect(badgeOf(ivan[0])!.text).toBe('QUEUE ONLY')
    expect(seatItems([], 'risedtc', q, NOW).length).toBe(0)
  })
  it('a client row dated but not on his board is Planned; month counts say set / posted / not set', () => {
    const items = seatItems([row({ id: 'p', client_id: 'risedtc', status: 'review', board_visible: false, scheduled_at: '2026-10-01T14:00:00Z' })], 'risedtc', null, NOW)
    expect(badgeOf(items[0])!.text).toBe('PLANNED')
    expect(monthCounts(items, new Set(['2026-10-01']))).toEqual({ scheduled: 0, posted: 0, planned: 1 })
  })
  it('the undated rail: review/scheduled rows with no date, oldest first', () => {
    const r = undated([row({ id: 'n', status: 'review', created_at: '2026-09-25T00:00:00Z' }), row({ id: 'o', status: 'review', created_at: '2026-09-01T00:00:00Z' }), row({ id: 'z', status: 'published' })])
    expect(r.map(x => x.id)).toEqual(['o', 'n'])
  })
})
