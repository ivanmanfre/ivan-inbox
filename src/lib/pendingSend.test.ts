import { describe, expect, it } from 'vitest'
import { isPendingSend, pendingSendLabel, pendingSendTime, sentThenPending, shownTime } from './inbox'
import { msg } from '../d/dms/fixtures'

const dm1 = (extra = {}) => msg({ prospect_id: 'p', client_id: 'swishdm', prospect_stage: 'connection_sent', created_at: '2026-10-19T13:55:44Z', approved_at: '2026-10-19T14:07:12Z', sent_at: null, draft_evidence: { lane: 'swishdm_first_list' }, ...extra })

describe('pending sends', () => {
  it('is approved, unsent, unblocked, outbound and not a deliberate stop', () => {
    expect(isPendingSend(dm1())).toBe(true)
    expect(isPendingSend(dm1({ sent_at: '2026-10-19T14:20:00Z' }))).toBe(false)
    expect(isPendingSend(dm1({ approved_at: null }))).toBe(false) // an unapproved draft is not history
    expect(isPendingSend(dm1({ direction: 'inbound' }))).toBe(false)
    expect(isPendingSend(dm1({ send_blocked_at: '2026-10-19T14:08:00Z', send_blocked_reason: 'send_failed_429' }))).toBe(false)
    expect(isPendingSend(dm1({ send_blocked_reason: 'routed_to_invite: x' }))).toBe(false)
  })

  it('a row whose sent_at is a real timestamp is sent whatever else it says', () => {
    // The now() default case: sent_at stamped, approved_at null -> never pending (an old, separate problem).
    expect(isPendingSend(msg({ prospect_id: 'p', sent_at: '2026-10-19T14:00:00Z', approved_at: null }))).toBe(false)
  })

  it('carries no clock unless it is scheduled', () => {
    expect(shownTime(dm1())).toBeNull()
    const sched = dm1({ draft_evidence: { scheduled_send: { at: '2026-10-19T17:30:00Z', timezone: 'Europe/Warsaw' } } })
    expect(pendingSendTime(sched)).toBe('2026-10-19T17:30:00Z')
    expect(shownTime(sched)).toBe('2026-10-19T17:30:00Z')
    expect(shownTime(dm1({ sent_at: '2026-10-19T14:20:00Z' }))).toBe('2026-10-19T14:20:00Z')
  })

  it('says what it waits for', () => {
    expect(pendingSendLabel(dm1())).toBe('Sends after they accept')
    expect(pendingSendLabel(dm1({ prospect_stage: 'swishdm_staged_hold' }))).toBe('Sends after the invite is accepted')
    expect(pendingSendLabel(dm1({ prospect_stage: 'swishdm_connected' }))).toBe('Queued, not sent yet')
    expect(pendingSendLabel(msg({ prospect_id: 'p', client_id: 'arch', approved_at: '2026-10-19T14:00:00Z' }))).toBe('Queued, not sent yet')
  })

  it('keeps sent order and moves pending rows to the end, oldest approval first', () => {
    const a = msg({ prospect_id: 'p', message_text: 'a', sent_at: '2026-10-19T10:00:00Z' })
    const p1 = msg({ prospect_id: 'p', message_text: 'p1', approved_at: '2026-10-19T10:30:00Z' })
    const b = msg({ prospect_id: 'p', message_text: 'b', direction: 'inbound', sent_at: '2026-10-19T11:00:00Z' })
    const p0 = msg({ prospect_id: 'p', message_text: 'p0', approved_at: '2026-10-19T10:10:00Z' })
    expect(sentThenPending([a, p1, b, p0]).map(m => m.message_text)).toEqual(['a', 'b', 'p0', 'p1'])
  })
})
