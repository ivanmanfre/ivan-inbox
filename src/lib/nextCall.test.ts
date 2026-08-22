import { describe, it, expect } from 'vitest'
import { describeWhen, isRealBooking, isStartingSoon, resolveMeetingType, type CalendarEvent } from './nextCall'

const NOW = new Date('2026-08-22T12:00:00Z')

const ev = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'e1', title: 'Call with a prospect', start_time: '2026-08-22T13:00:00Z',
  end_time: '2026-08-22T13:30:00Z', attendees: [], meeting_url: null,
  is_all_day: false, is_test: null, meeting_type: null, source: null,
  referral_token: null, booking_source_path: null, ...over,
})

describe('resolveMeetingType', () => {
  it('trusts a stored value that IS one of the five real keys', () => {
    expect(resolveMeetingType(ev({ meeting_type: 'technical_audit' }))).toBe('technical_audit')
  })
  it('does not trust Calendly free text as a key (bug 1), falls back to the title', () => {
    expect(resolveMeetingType(ev({ meeting_type: '30 Minute Meeting', title: 'Discovery call with Acme' })))
      .toBe('discovery_sales')
  })
  it('returns null, not "unknown", when nothing resolves: no chip to render', () => {
    expect(resolveMeetingType(ev({ meeting_type: '30 Minute Meeting', title: 'Untitled event' }))).toBeNull()
  })
  it('classifies straight from the title when meeting_type is absent', () => {
    expect(resolveMeetingType(ev({ meeting_type: null, title: 'Client kickoff, Acme' }))).toBe('client_kickoff')
  })
})

describe('describeWhen', () => {
  it('labels a same-day event Today', () => {
    const w = describeWhen(ev({ start_time: '2026-08-22T18:00:00Z' }), NOW)
    expect(w.day).toBe('Today')
    expect(w.today).toBe(true)
  })
  it('labels the next calendar day Tomorrow', () => {
    const w = describeWhen(ev({ start_time: '2026-08-23T13:00:00Z' }), NOW)
    expect(w.day).toBe('Tomorrow')
  })
  it('falls back to a weekday/month/day label further out', () => {
    const w = describeWhen(ev({ start_time: '2026-08-27T13:00:00Z' }), NOW)
    expect(w.day).not.toBe('Today')
    expect(w.day).not.toBe('Tomorrow')
  })
})

describe('isRealBooking', () => {
  // Bug 2 in the source: `is_test` is flagged by the webhook but never
  // filtered on read. The fix must not introduce the sibling NULL-drop trap:
  // `.eq('is_test', false)` server-side would exclude every row where the
  // column is NULL (any non-Calendly, e.g. Google-Calendar-sourced row never
  // writes it at all), which is why the filter runs client-side against
  // `=== true` specifically.
  it('excludes a row explicitly flagged is_test', () => {
    expect(isRealBooking({ is_test: true })).toBe(false)
  })
  it('keeps a row where is_test is NULL, most rows never write the column', () => {
    expect(isRealBooking({ is_test: null })).toBe(true)
  })
  it('keeps a row explicitly flagged false', () => {
    expect(isRealBooking({ is_test: false })).toBe(true)
  })
})

describe('isStartingSoon', () => {
  it('true inside the 60-minute window', () => {
    const w = describeWhen(ev({ start_time: '2026-08-22T12:30:00Z' }), NOW)
    expect(isStartingSoon(w)).toBe(true)
  })
  it('false once the event has already started', () => {
    const w = describeWhen(ev({ start_time: '2026-08-22T11:30:00Z' }), NOW)
    expect(isStartingSoon(w)).toBe(false)
  })
  it('false more than 60 minutes out', () => {
    const w = describeWhen(ev({ start_time: '2026-08-22T15:00:00Z' }), NOW)
    expect(isStartingSoon(w)).toBe(false)
  })
})
