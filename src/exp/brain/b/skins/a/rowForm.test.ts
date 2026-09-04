import { describe, expect, it } from 'vitest'
import { breakDashes, quoteOf, rowForm, stripShout, subjectOf, trimEcho } from './rowForm'
import type { Notification } from '../../../../../lib/turns'

const row = (p: Partial<Notification>): Notification => ({
  id: 'x', source: null, media: null, group_key: null, count: 1,
  first_seen_at: '2026-09-04T09:00:00Z', last_seen_at: '2026-09-04T09:00:00Z',
  created_at: '2026-09-04T09:00:00Z', read_at: null, dismissed_at: null,
  family: 'system_infra_alarm', severity: 'error', title: null, body: null,
  url: null, tenant: null, ...p,
} as Notification)

describe('breakDashes', () => {
  it('breaks the ASCII clause dash the copy rule bans', () => {
    expect(breakDashes('Alec -- Want to get some time')).toBe('Alec. Want to get some time')
  })
  it('leaves ordinary text alone', () => {
    expect(breakDashes('rise-dtc lane')).toBe('rise-dtc lane')
  })
})

describe('subjectOf', () => {
  it('slices the lead out of the title, never invents one', () => {
    expect(subjectOf({ title: 'Send FAILED to Sarah Francis', family: 'send_failed_alert' }, 'Send failed'))
      .toBe('Sarah Francis')
  })
  it('drops a subject that only repeats the state word', () => {
    expect(subjectOf({ title: 'Booking', family: 'booking_notice' }, 'Booked')).toBeNull()
  })
  it('drops a title too long to sit on a line', () => {
    expect(subjectOf({ title: 'x'.repeat(40), family: 'system_infra_alarm' }, 'Broke')).toBeNull()
  })
})

describe('trimEcho', () => {
  it('drops an opening sentence that only restates the head', () => {
    expect(trimEcho('Send FAILED to Sarah Francis. Row reset and blocked.', 'Send failed', 'Sarah Francis'))
      .toBe('Row reset and blocked.')
  })
  it('never returns nothing', () => {
    expect(trimEcho('Send failed for Sarah Francis.', 'Send failed', 'Sarah Francis'))
      .toBe('Send failed for Sarah Francis.')
  })
})

describe('stripShout', () => {
  it('drops a shouted pipeline label when something follows it', () => {
    expect(stripShout('SEAT HEALTH Seat Mattan Danino went to connecting'))
      .toBe('Seat Mattan Danino went to connecting')
  })
  it('keeps it when it is all the line has', () => {
    expect(stripShout('SEAT HEALTH')).toBe('SEAT HEALTH')
  })
})

describe('quoteOf', () => {
  it('prefers the words someone actually said', () => {
    expect(quoteOf('New reply:\n\n• Chris Harwood: "Sure"')).toBe('“Sure”')
  })
})

describe('rowForm', () => {
  it('gives a booking the figure form, and the figure is the count', () => {
    const f = rowForm(row({ family: 'booking_notice', severity: 'attention', count: 2, title: 'RISE booking attribution', body: '2 bookings attributed' }))
    expect(f.kind).toBe('figure')
    expect(f.figure).toEqual({ n: '2', noun: 'bookings attributed' })
  })
  it('gives a claude turn the answer form, with the state word outside the detail', () => {
    const f = rowForm(row({ family: 'claude_turn', severity: 'info', title: 'What is waiting on me?', body: 'Three reply drafts are waiting on you.' }))
    expect(f.kind).toBe('answer')
    expect(f.word).toBe('Answered')
    expect(f.detail).toContain('Three reply drafts')
  })
  it('gives an error the line form and never an empty detail', () => {
    const f = rowForm(row({ family: 'send_failed_alert', title: 'Send FAILED to Sarah Francis', body: 'Send FAILED to Sarah Francis. Row reset + blocked. Reason: hard error: 422' }))
    expect(f.kind).toBe('line')
    expect(f.subject).toBe('Sarah Francis')
    expect(f.detail).toBe('Row reset + blocked. Reason: hard error: 422')
  })
})
