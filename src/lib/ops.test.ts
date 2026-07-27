import { describe, it, expect } from 'vitest'
import { pendingOps, sentOps, blockedOps, engineLabel, expiresIn, DISCARDED_REASON, type OpsDraft } from './ops'

const base: OpsDraft = {
  id: '1', client_id: 'risedtc', kind: 'escalation', slack_channel: '#rise-ops',
  body: 'hey', context: null, created_at: '2026-07-24T10:00:00Z',
  approved_at: null, sent_at: null, send_blocked_reason: null,
}

describe('pendingOps', () => {
  it('keeps only rows with no approve/send/block stamp', () => {
    const rows: OpsDraft[] = [
      { ...base, id: 'a' },
      { ...base, id: 'b', approved_at: '2026-07-24T11:00:00Z' },
      { ...base, id: 'c', sent_at: '2026-07-24T11:00:00Z' },
      { ...base, id: 'd', send_blocked_reason: 'rate_limited' },
    ]
    expect(pendingOps(rows).map(r => r.id)).toEqual(['a'])
  })
})

describe('sentOps', () => {
  it('returns sent rows newest-first, capped to the limit', () => {
    const rows: OpsDraft[] = [
      { ...base, id: 'a', sent_at: '2026-07-24T09:00:00Z' },
      { ...base, id: 'b', sent_at: '2026-07-24T11:00:00Z' },
      { ...base, id: 'c', sent_at: null },
    ]
    expect(sentOps(rows).map(r => r.id)).toEqual(['b', 'a'])
    expect(sentOps(rows, 1).map(r => r.id)).toEqual(['b'])
  })
})

describe('blockedOps', () => {
  it('excludes operator discards but keeps every other block reason', () => {
    const rows: OpsDraft[] = [
      { ...base, id: 'a', send_blocked_reason: DISCARDED_REASON },
      { ...base, id: 'b', send_blocked_reason: 'rate_limited', created_at: '2026-07-24T08:00:00Z' },
      { ...base, id: 'c', send_blocked_reason: 'invalid_channel', created_at: '2026-07-24T12:00:00Z' },
    ]
    expect(blockedOps(rows).map(r => r.id)).toEqual(['c', 'b'])
  })
})

describe('expiresIn', () => {
  const now = new Date('2026-07-27T12:00:00Z').getTime()
  it('counts down in hours, then minutes, then reports expired', () => {
    expect(expiresIn('2026-07-28T12:00:00Z', now)).toBe('24h left')
    expect(expiresIn('2026-07-27T13:30:00Z', now)).toBe('1h left')
    expect(expiresIn('2026-07-27T12:20:00Z', now)).toBe('20m left')
    expect(expiresIn('2026-07-27T11:00:00Z', now)).toBe('expired')
  })
  it('renders nothing without an expiry', () => {
    expect(expiresIn(undefined, now)).toBeNull()
  })
})

describe('engineLabel', () => {
  it('names both engines and falls back to the raw id', () => {
    expect(engineLabel('ivan')).toBe('your feed')
    expect(engineLabel('risedtc')).toBe('Rise')
    expect(engineLabel('someone-else')).toBe('someone-else')
  })
})
