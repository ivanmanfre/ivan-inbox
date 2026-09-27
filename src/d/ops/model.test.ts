import { describe, expect, it } from 'vitest'
import type { OpsDraft } from '../../lib/ops'
import { readBoard, rowLine, seatBatches, timeLeft } from './model'

const NOW = Date.parse('2026-09-27T10:00:00Z')
let n = 0
const d = (kind: OpsDraft['kind'], client_id: string, extra: Partial<OpsDraft> = {}, context: Record<string, unknown> = {}): OpsDraft => ({
  id: `r${++n}`, client_id, kind, slack_channel: '', body: 'b', context: { posted_at: '2026-09-27T09:00:00Z', ...context },
  created_at: `2026-09-27T09:${String(59 - n).padStart(2, '0')}:00Z`, approved_at: null, sent_at: null, send_blocked_reason: null, ...extra,
})

describe('readBoard', () => {
  it("puts the legacy client 'rise' in Rise's lane and never makes a fourth lane", () => {
    const b = readBoard([d('escalation', 'rise'), d('booking', 'risedtc'), d('update', 'arch'), d('newsjack', '')], new Set(), NOW)
    expect(b.lanes.risedtc.map(x => x.kind)).toEqual(['escalation', 'booking'])
    expect(b.lanes.arch).toHaveLength(1)
    expect(b.lanes.ivan).toHaveLength(1)
    expect(b.waiting).toEqual({ ivan: 1, risedtc: 2, arch: 1 })
  })

  it('folds comment ideas past the 3 a day into later, and keeps them out of the Ops number', () => {
    const ideas = Array.from({ length: 5 }, () => d('comment_outbound', 'ivan', {}, { approve_url: 'https://x/approve' }))
    const b = readBoard(ideas, new Set(), NOW)
    expect(b.lanes.ivan).toHaveLength(3)
    expect(b.later).toHaveLength(2)
    expect(b.waiting.ivan).toBe(3)
  })

  it('counts tasks in the seat number but never draws them as lane cards', () => {
    const b = readBoard([d('task', 'ivan'), d('task', 'arch'), d('escalation', 'arch')], new Set(), NOW)
    expect(b.lanes.arch).toHaveLength(1)
    expect(b.waiting).toEqual({ ivan: 1, risedtc: 0, arch: 2 })
    expect(b.tasks).toEqual({ ivan: 1, risedtc: 0, arch: 1 })
  })

  it('keeps a held card on the board after its stamp', () => {
    const held = d('comment_outbound', 'ivan', { approved_at: '2026-09-27T09:30:00Z', sent_at: '2026-09-27T09:30:00Z' })
    expect(readBoard([held], new Set([held.id]), NOW).lanes.ivan).toHaveLength(1)
    expect(readBoard([held], new Set(), NOW).lanes.ivan).toHaveLength(0)
  })

  it('walks j / k in lane order: Ivan, Rise, Arch', () => {
    const b = readBoard([d('update', 'arch'), d('escalation', 'rise'), d('precall_email', 'ivan')], new Set(), NOW)
    expect(b.flat.map(x => x.client_id)).toEqual(['ivan', 'rise', 'arch'])
  })
})

describe('rows and batches', () => {
  it('a newsjack row shows its time left, an escalation reads hot', () => {
    expect(rowLine(d('newsjack', 'risedtc', {}, { headline: 'H', expires_at: '2026-09-27T23:00:00Z' }), NOW)).toMatchObject({ who: 'H', time: '13h left', hot: true })
    expect(timeLeft('2026-09-27T09:00:00Z', NOW)).toBe('expired')
  })
  it('a quick batch needs two batchable cards of one kind in the seat', () => {
    const one = d('manual_invite', 'rise'), two = d('manual_invite', 'rise')
    expect(seatBatches('risedtc', [one])).toHaveLength(0)
    expect(seatBatches('risedtc', [one, two])[0]).toMatchObject({ kind: 'manual_invite', label: '2 invites' })
    expect(seatBatches('risedtc', [d('comment_outbound', 'risedtc'), d('comment_outbound', 'risedtc')])).toHaveLength(0)
  })
})
