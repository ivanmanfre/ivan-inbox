import { describe, expect, it } from 'vitest'
import type { OpsDraft } from '../../lib/ops'
import { answerLine, groupOpsByLane, kindsLine, laneKeyOf, laneLabel, orderLane, quickBatches } from './lanes'

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

describe('orderLane', () => {
  it('escalations first, newsjacks by time left, the rest in arrival order', () => {
    const r1 = card({ kind: 'comment_reply' })
    const nLate = card({ kind: 'newsjack', context: { expires_at: '2026-09-27T10:00:00Z' } as OpsDraft['context'] })
    const nNone = card({ kind: 'newsjack' })
    const nSoon = card({ kind: 'newsjack', context: { expires_at: '2026-09-26T12:00:00Z' } as OpsDraft['context'] })
    const esc = card({ kind: 'escalation' })
    const r2 = card({ kind: 'comment_reply' })
    expect(orderLane([r1, nLate, nNone, nSoon, esc, r2]).map(d => d.id))
      .toEqual([esc.id, nSoon.id, nLate.id, nNone.id, r1.id, r2.id])
  })
  it('groupOpsByLane applies it inside each lane', () => {
    const r = card({ kind: 'comment_reply', client_id: 'risedtc' })
    const n = card({ kind: 'newsjack', client_id: 'risedtc' })
    expect(groupOpsByLane([r, n])[0].cards.map(d => d.id)).toEqual([n.id, r.id])
  })
})

describe('answerLine', () => {
  it('says the count and the kinds, comment ideas as today\'s', () => {
    const items = [
      card({ kind: 'comment_reply' }), card({ kind: 'comment_reply' }), card({ kind: 'comment_reply' }),
      card({ kind: 'comment_outbound' }), card({ kind: 'comment_outbound' }), card({ kind: 'comment_outbound' }),
      card({ kind: 'newsjack' }),
    ]
    expect(answerLine(items)).toBe('7 waiting on you: 3 comment replies, 3 comments for today, 1 newsjack.')
    expect(answerLine([])).toBeNull()
  })
  it('names the lane in plain words', () => {
    expect(laneLabel('risedtc')).toBe('Rise')
    expect(laneLabel(null)).toBe('Ivan')
    expect(laneLabel('arch')).toBe('Arch')
  })
})

describe('quickBatches', () => {
  it('two or more batchable cards of one kind in one lane make a batch, labelled by lane', () => {
    const ok = () => true
    const cards = [
      card({ kind: 'comment_outbound' }), card({ kind: 'comment_outbound' }), card({ kind: 'comment_outbound' }),
      card({ kind: 'manual_invite', client_id: 'risedtc' }), card({ kind: 'manual_invite', client_id: 'risedtc' }),
      card({ kind: 'manual_invite', client_id: 'arch' }),
    ]
    expect(quickBatches(cards, ok).map(b => b.label)).toEqual(['3 comments · Ivan', '2 invites · Rise'])
  })
  it('skips what the predicate refuses', () => {
    const cards = [card({ kind: 'comment_outbound' }), card({ kind: 'comment_outbound' })]
    expect(quickBatches(cards, () => false)).toEqual([])
  })
})
