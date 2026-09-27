import { describe, expect, it, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))
import { stageOfLane, type ContentDraft } from './content'
import { buildCalendarItems } from './calendarItems'

// check2-content: the calendar graded client posts by status alone, and the tab
// bar read an idea reference in source_post_id as a publisher writeback. Both
// must say what the publisher does: a dated, unpublished board row at review
// or scheduled goes out on its date.
const NOW = Date.parse('2026-09-26T12:00:00Z')
const row = (over: Partial<ContentDraft>): ContentDraft => ({
  id: 'a1', client_id: 'arch', status: 'review', board_visible: true,
  scheduled_at: '2026-10-01T07:00:00Z', published_at: null, source_post_id: 'ir-a2750773',
  title: 'Delta Force', post_body: 'x', ...over,
} as ContentDraft)

describe('a dated on-board client post', () => {
  it('is scheduled on the tab bar even with an idea id in source_post_id', () => {
    expect(stageOfLane(row({}), 'arch', NOW)).toBe('scheduled')
  })
  it('is scheduled on the calendar too', () => {
    const [it0] = buildCalendarItems([row({})], [], NOW)
    expect(it0.stage).toBe('scheduled')
  })
  it('past due with nothing back is stuck', () => {
    expect(stageOfLane(row({ scheduled_at: '2026-09-20T07:00:00Z', source_post_id: null }), 'arch', NOW)).toBe('stuck')
  })
  it('off the board it keeps its status stage', () => {
    expect(stageOfLane(row({ board_visible: false }), 'arch', NOW)).toBe('review')
  })
})
