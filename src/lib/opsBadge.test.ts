import { describe, expect, it } from 'vitest'
import { opsBadge, splitCommentIdeas, type OpsDraft } from './ops'

const NOW = Date.parse('2026-09-26T10:00:00Z')
let i = 0
const row = (kind: OpsDraft['kind'], extra: Partial<OpsDraft> = {}): OpsDraft => ({
  id: String(i++), client_id: 'ivan', kind, slack_channel: '', body: 'x',
  context: null, created_at: '2026-09-26T08:00:00Z', approved_at: null, sent_at: null,
  send_blocked_reason: null, ...extra,
})

describe('opsBadge', () => {
  it('counts approvals and tasks, and comment ideas only up to 3 a day', () => {
    const rows = [
      row('newsjack'), row('comment_reply'), row('task'),
      ...Array.from({ length: 25 }, () => row('comment_outbound')),
    ]
    expect(opsBadge(rows, NOW)).toEqual({ n: 6, ideasFolded: 22 })
  })
  it('ideas already posted today use up the day', () => {
    const rows = [
      row('comment_outbound', { approved_at: '2026-09-26T07:00:00Z', sent_at: '2026-09-26T07:05:00Z' }),
      row('comment_outbound', { approved_at: '2026-09-26T08:00:00Z', sent_at: '2026-09-26T08:05:00Z' }),
      row('comment_outbound'), row('comment_outbound'),
    ]
    expect(opsBadge(rows, NOW)).toEqual({ n: 1, ideasFolded: 1 })
  })
  it('yesterday\'s posts do not count against today', () => {
    const rows = [
      ...Array.from({ length: 3 }, () => row('comment_outbound', { approved_at: '2026-09-25T09:00:00Z', sent_at: '2026-09-25T09:00:00Z' })),
      row('comment_outbound'),
    ]
    expect(opsBadge(rows, NOW).n).toBe(1)
  })
  it('an expired newsjack is not counted', () => {
    expect(opsBadge([row('newsjack', { context: { expires_at: '2026-09-26T09:00:00Z' } as OpsDraft['context'] })], NOW).n).toBe(0)
  })
})

describe('splitCommentIdeas', () => {
  it('today = the first ideas that fit the day, later = the rest, same count as the badge', () => {
    const rows = [row('comment_reply'), ...Array.from({ length: 5 }, () => row('comment_outbound'))]
    const s = splitCommentIdeas(rows, NOW)
    expect(s.today).toHaveLength(3)
    expect(s.later).toHaveLength(2)
    expect(s.today[0].id).toBe(rows[1].id)
    expect(opsBadge(rows, NOW).ideasFolded).toBe(s.later.length)
  })
})
