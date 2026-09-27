import { describe, expect, it } from 'vitest'
import type { OpsDraft } from '../../lib/ops'
import type { CalendarEvent } from '../../lib/nextCall'
import { unreadGroups } from './bell'
import { nextCallLine } from './nextCall'
import { opsWaitingBySeat } from './ops'

const NOW = Date.parse('2026-09-27T09:00:00Z')
let i = 0
const op = (p: Partial<OpsDraft>): OpsDraft => ({
  id: `o${++i}`, client_id: 'ivan', kind: 'task', slack_channel: null, body: 'x', context: {},
  created_at: '2026-09-27T08:00:00Z', approved_at: null, sent_at: null, send_blocked_reason: null, ...p,
} as OpsDraft)

describe('opsWaitingBySeat (the Ops number, split by seat)', () => {
  it('counts pending cards per seat, legacy rise is Rise, handled cards drop', () => {
    const rows = [
      op({ client_id: 'ivan' }), op({ client_id: null as unknown as string }),
      op({ client_id: 'rise', kind: 'booking' }), op({ client_id: 'risedtc', kind: 'update' }),
      op({ client_id: 'arch', kind: 'escalation' }),
      op({ client_id: 'arch', approved_at: '2026-09-27T08:30:00Z' }),
      op({ client_id: 'ivan', send_blocked_reason: 'discarded_by_operator' }),
    ]
    expect(opsWaitingBySeat(rows, NOW)).toEqual({ ivan: 2, risedtc: 2, arch: 1 })
  })
  it('comment ideas past the 3 a day fold out, as on the Ops page', () => {
    const ideas = Array.from({ length: 5 }, () => op({ kind: 'comment_outbound', context: { posted_at: '2026-09-26T20:00:00Z' } as OpsDraft['context'] }))
    expect(opsWaitingBySeat(ideas, NOW).ivan).toBe(3)
  })
})

describe('unreadGroups (bell count, coordinator rule)', () => {
  it('distinct coalesce(group_key, id)', () => {
    expect(unreadGroups([
      { id: '1', group_key: 'g' }, { id: '2', group_key: 'g' }, { id: '3', group_key: null }, { id: '4', group_key: '' },
    ])).toBe(3)
  })
})

describe('nextCallLine', () => {
  const ev = (start: string, end: string | null, title = 'Call'): CalendarEvent => ({
    id: start, title, start_time: start, end_time: end, attendees: [], meeting_url: null, is_all_day: false,
    is_test: null, meeting_type: null, source: null, referral_token: null, booking_source_path: null,
  })
  it('names the first call not over yet, in Warsaw time', () => {
    const r = nextCallLine([ev('2026-09-27T06:00:00Z', '2026-09-27T06:30:00Z'), ev('2026-09-29T15:00:00Z', '2026-09-29T15:30:00Z', 'Dom')], new Date(NOW))
    expect(r).toEqual({ label: 'Tue 29 Sep, 17:00', title: 'Dom', start: '2026-09-29T15:00:00Z' })
  })
  it('says none booked when the week is empty', () => {
    expect(nextCallLine([], new Date(NOW)).label).toBe('none booked this week')
  })
})
