import { describe, expect, it, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))
import { buildVerdict, verdictParts, type VerdictDraft, type VerdictQueue } from './contentVerdict'

const NOW = Date.parse('2026-09-26T12:00:00Z')
const d = (over: Partial<VerdictDraft>): VerdictDraft => ({
  client_id: null, status: 'scheduled', board_visible: false,
  scheduled_at: '2026-10-07T08:53:00Z', published_at: null, ...over,
})
const q = (over: Partial<VerdictQueue>): VerdictQueue => ({
  status: 'pending', scheduled_at: '2026-10-08T07:00:00Z', posted_at: null, error_message: null, ...over,
})

describe('buildVerdict: the publishers’ own rules', () => {
  const live = buildVerdict([
    d({}),
    d({ client_id: 'risedtc', board_visible: true, scheduled_at: '2026-09-28T14:00:00Z' }),
    d({ client_id: 'risedtc', board_visible: true, status: 'review', scheduled_at: '2026-11-13T14:00:00Z' }),
    d({ client_id: 'risedtc', board_visible: true, scheduled_at: '2026-10-02T14:00:00Z' }),
    // dated but not on the board: the publisher never takes it
    d({ client_id: 'arch', board_visible: false, status: 'review', scheduled_at: '2026-09-29T07:00:00Z' }),
    d({ client_id: 'arch', board_visible: true, status: 'review', scheduled_at: '2026-10-01T07:00:00Z' }),
    // Ivan's own review row with a date is not a schedule
    d({ status: 'review', scheduled_at: '2026-09-27T09:00:00Z' }),
  ], [q({}), q({ status: 'blocked', scheduled_at: '2026-09-08T08:45:00Z', error_message: 'publish_lint_fail: stacked_declarations' })],
  undefined, NOW)

  it('reads Ivan’s next post from drafts and the queue', () => {
    expect(live.ivan.next).toBe('2026-10-07T08:53:00Z')
    expect(live.ivan.days).toBe(2)
  })
  it('covers a client board with dated on-board rows at review or scheduled', () => {
    const rise = live.clients.find(c => c.lane === 'risedtc')!
    expect(rise.days).toBe(3)
    expect(rise.last).toBe('2026-11-13T14:00:00Z')
    expect(rise.low).toBe(false)
    const arch = live.clients.find(c => c.lane === 'arch')!
    expect(arch.days).toBe(1)
    expect(arch.low).toBe(true)
  })
  it('counts the lint-blocked post with its date', () => {
    expect(live.blocked).toEqual({ n: 1, since: '2026-09-08T08:45:00Z', lint: true })
  })

  it('says it in sentences, Arch red, blocked red', () => {
    const parts = verdictParts(live, 46, NOW)
    expect(parts[0].text).toBe('Nothing of yours is scheduled until Oct 7.')
    expect(parts.find(p => p.key === 'risedtc')!.text).toBe('Rise has 3 days on the board, to Nov 13.')
    const arch = parts.find(p => p.key === 'arch')!
    expect(arch.text).toBe('Arch has 1 day on the board, to Oct 1.')
    expect(arch.tone).toBe('urgent')
    const b = parts.find(p => p.key === 'blocked')!
    expect(b.text).toBe('One post has been blocked by the lint since Sep 8.')
    expect(b.tone).toBe('urgent')
    expect(parts.find(p => p.key === 'waiting')!.text).toBe('46 wait on your decision.')
  })

  it('an empty board and an empty lane say nothing is scheduled', () => {
    const v = buildVerdict([], [], undefined, NOW)
    const parts = verdictParts(v, 0, NOW)
    expect(parts.map(p => p.text)).toEqual([
      'Nothing of yours is scheduled.',
      'Rise has nothing scheduled on the board.',
      'Arch has nothing scheduled on the board.',
    ])
  })

  it('a post tomorrow is said as tomorrow', () => {
    const v = buildVerdict([d({ scheduled_at: '2026-09-27T08:45:00Z' })], [], undefined, NOW)
    expect(verdictParts(v, undefined, NOW)[0].text).toMatch(/^Your next post goes out tomorrow at /)
  })

  it('a past-due queue row is not the next post', () => {
    const v = buildVerdict([], [q({ scheduled_at: '2026-09-20T08:00:00Z' })], undefined, NOW)
    expect(v.ivan.next).toBeNull()
  })
})
