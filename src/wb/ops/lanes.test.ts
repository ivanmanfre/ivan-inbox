import { describe, expect, it } from 'vitest'
import type { OpsDraft } from '../../lib/ops'
import { groupOpsByLane, kindsLine, laneKeyOf } from './lanes'

let seq = 0
const card = (o: Partial<OpsDraft> = {}): OpsDraft => ({
  id: `c${++seq}`, client_id: 'ivan', kind: 'escalation', slack_channel: '',
  body: 'x', context: null, created_at: '2026-09-26T10:00:00Z',
  approved_at: null, sent_at: null, send_blocked_reason: null, ...o,
})

describe('groupOpsByLane', () => {
  it('orders Ivan, Rise, Arch, then any other client by id, and skips empty lanes', () => {
    const cards = [
      card({ client_id: 'arch' }), card({ client_id: 'zeta' }), card({ client_id: 'risedtc' }),
      card({ client_id: 'ivan' }), card({ client_id: 'alpha' }),
    ]
    expect(groupOpsByLane(cards).map(l => [l.key, l.label])).toEqual([
      ['ivan', 'Ivan'], ['risedtc', 'Rise'], ['arch', 'Arch'], ['alpha', 'alpha'], ['zeta', 'zeta'],
    ])
    expect(groupOpsByLane([card({ client_id: 'arch' })]).map(l => l.key)).toEqual(['arch'])
    expect(groupOpsByLane([])).toEqual([])
  })

  it('an empty client id is Ivan', () => {
    expect(laneKeyOf(null)).toBe('ivan')
    expect(laneKeyOf('')).toBe('ivan')
    const lanes = groupOpsByLane([card({ client_id: '' }), card({ client_id: 'ivan' })])
    expect(lanes).toHaveLength(1)
    expect(lanes[0].cards).toHaveLength(2)
  })

  it('keeps each lane in arrival order and counts every card once', () => {
    const a = card({ client_id: 'risedtc' }), b = card({ client_id: 'ivan' }), c = card({ client_id: 'risedtc' })
    const lanes = groupOpsByLane([a, b, c])
    expect(lanes.find(l => l.key === 'risedtc')!.cards.map(d => d.id)).toEqual([a.id, c.id])
    expect(lanes.reduce((n, l) => n + l.cards.length, 0)).toBe(3)
  })
})

describe('kindsLine', () => {
  it('says the kinds in plain words, biggest first', () => {
    const cards = [
      card({ kind: 'newsjack' }),
      card({ kind: 'comment_reply' }), card({ kind: 'comment_reply' }), card({ kind: 'comment_reply' }),
    ]
    expect(kindsLine(cards)).toBe('3 comment replies, 1 newsjack')
  })
  it('stays short past three kinds', () => {
    const cards = (['escalation', 'update', 'booking', 'newsjack', 'manual_invite'] as const).map(kind => card({ kind }))
    expect(kindsLine(cards)).toBe('1 escalation, 1 update, 1 booking, and 2 more kinds')
  })
})
