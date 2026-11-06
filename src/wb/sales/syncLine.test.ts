import { describe, expect, it } from 'vitest'
import { syncLine } from './syncLine'

// 6 Nov 2026 13:20 UTC = 14:20 Warsaw (CET).
const now = new Date('2026-11-06T13:20:00Z')

describe('syncLine', () => {
  it('fresh check with an older booking reads quiet', () => {
    expect(syncLine({ checked_at: '2026-11-06T13:05:00Z', fetched: 0, last_new_booking_at: '2026-11-02T06:01:48Z' }, now))
      .toEqual({ text: 'Calendar checked 14:05 · last new booking Mon 2 Nov', stale: false })
  })

  it('booking today and yesterday use words', () => {
    expect(syncLine({ checked_at: '2026-11-06T13:05:00Z', fetched: 1, last_new_booking_at: '2026-11-06T08:00:00Z' }, now).text)
      .toBe('Calendar checked 14:05 · last new booking today')
    expect(syncLine({ checked_at: '2026-11-06T13:05:00Z', fetched: 1, last_new_booking_at: '2026-11-05T08:00:00Z' }, now).text)
      .toBe('Calendar checked 14:05 · last new booking yesterday')
  })

  it('a check older than 45 minutes is a failure', () => {
    expect(syncLine({ checked_at: '2026-11-06T12:00:00Z', fetched: 3, last_new_booking_at: null }, now))
      .toEqual({ text: 'Calendar not checked since 13:00. The sync may be down · no bookings on record', stale: true })
  })

  it('a check from another day names the day', () => {
    expect(syncLine({ checked_at: '2026-11-04T09:00:00Z', fetched: 3, last_new_booking_at: null }, now).text)
      .toBe('Calendar not checked since Wed 4 Nov 10:00. The sync may be down · no bookings on record')
  })

  it('no heartbeat and a failed read are failures', () => {
    expect(syncLine({ checked_at: null, fetched: null, last_new_booking_at: '2026-11-02T06:01:48Z' }, now).stale).toBe(true)
    expect(syncLine(null, now)).toEqual({ text: 'Could not read when the calendar was last checked.', stale: true })
  })
})
