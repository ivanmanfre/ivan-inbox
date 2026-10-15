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
  it('counts approvals and tasks; comments and newsjacks never count (Ivan 2026-10-15)', () => {
    const rows = [
      row('newsjack'), row('comment_reply'), row('task'), row('escalation'),
      ...Array.from({ length: 25 }, () => row('comment_outbound')),
    ]
    expect(opsBadge(rows, NOW)).toEqual({ n: 2, ideasFolded: 22 })
  })
  it('ideas already posted today use up the day (the fold)', () => {
    const rows = [
      row('comment_outbound', { approved_at: '2026-09-26T07:00:00Z', sent_at: '2026-09-26T07:05:00Z' }),
      row('comment_outbound', { approved_at: '2026-09-26T08:00:00Z', sent_at: '2026-09-26T08:05:00Z' }),
      row('comment_outbound'), row('comment_outbound'),
    ]
    expect(opsBadge(rows, NOW)).toEqual({ n: 0, ideasFolded: 1 })
  })
  it('yesterday\'s posts do not use up today\'s room', () => {
    const rows = [
      ...Array.from({ length: 3 }, () => row('comment_outbound', { approved_at: '2026-09-25T09:00:00Z', sent_at: '2026-09-25T09:00:00Z' })),
      row('comment_outbound'),
    ]
    expect(opsBadge(rows, NOW).ideasFolded).toBe(0)
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
