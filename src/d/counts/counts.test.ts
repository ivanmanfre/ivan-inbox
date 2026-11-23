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
      op({ client_id: 'arch', kind: 'update' }),
      op({ client_id: 'arch', approved_at: '2026-09-27T08:30:00Z' }),
      op({ client_id: 'ivan', send_blocked_reason: 'discarded_by_operator' }),
    ]
    expect(opsWaitingBySeat(rows, NOW)).toEqual({ ivan: 2, risedtc: 2, arch: 1 , swishdm: 0, anna: 0, leah: 0 })
  })
  it('counts replies but excludes comment ideas and newsjacks', () => {
    const ideas = Array.from({ length: 5 }, () => op({ kind: 'comment_outbound', context: { posted_at: '2026-09-26T20:00:00Z' } as OpsDraft['context'] }))
    const rows = [...ideas, op({ kind: 'comment_reply', context: { posted_at: '2026-09-26T20:00:00Z' } as OpsDraft['context'] }), op({ kind: 'newsjack' }), op({ kind: 'task' })]
    expect(opsWaitingBySeat(rows, NOW).ivan).toBe(2)
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
    expect(nextCallLine([], new Date(NOW)).label).toBe('none booked')
  })
})

describe('the Ops number from the slim count read (2026-11-15 speed review)', () => {
  it('rebuilt rows count the same as the full rows', async () => {
    const { opsCountRow } = await import('./ops')
    const NOW2 = Date.parse('2026-11-15T12:00:00Z')
    const base = { slack_channel: 'c', body: 'long body', approved_at: null, sent_at: null, send_blocked_reason: null, created_at: '2026-11-15T10:00:00Z' }
    const full = [
      { ...base, id: '1', client_id: 'ivan', kind: 'task', context: { presentation: 'reference', other: 'x'.repeat(500) } },
      { ...base, id: '2', client_id: 'ivan', kind: 'task', context: { other: 1 } },
      { ...base, id: '3', client_id: 'rise', kind: 'reply', context: { dry_run: true } },
      { ...base, id: '4', client_id: 'arch', kind: 'newsjack', context: { expires_at: '2026-11-15T11:00:00Z' } },
      { ...base, id: '5', client_id: 'arch', kind: 'reply', context: null },
      { ...base, id: '6', client_id: 'ivan', kind: 'comment_reply', context: { posted_at: '2026-11-14T10:00:00Z' } },
    ] as unknown as OpsDraft[]
    const slim = full.map(d => opsCountRow({ id: d.id, client_id: d.client_id, kind: d.kind, created_at: d.created_at, approved_at: d.approved_at, sent_at: d.sent_at, send_blocked_reason: d.send_blocked_reason,
      dry_run: (d.context as Record<string, unknown> | null)?.dry_run ?? null, presentation: ((d.context as Record<string, unknown> | null)?.presentation as string) ?? null,
      posted_at: ((d.context as Record<string, unknown> | null)?.posted_at as string) ?? null, expires_at: ((d.context as Record<string, unknown> | null)?.expires_at as string) ?? null }))
    expect(opsWaitingBySeat(slim, NOW2)).toEqual(opsWaitingBySeat(full, NOW2))
  })
})
