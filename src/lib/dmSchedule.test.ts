import { describe, expect, it } from 'vitest'
import { localSendInstant, suggestTimezone } from './dmScheduleTime'

describe('recipient timezone scheduling', () => {
  it('converts LA 7am without using the browser timezone', () => {
    expect(localSendInstant('2026-10-01', '07:00', 'America/Los_Angeles')).toBe('2026-10-01T14:00:00.000Z')
    expect(localSendInstant('2026-12-01', '07:00', 'America/Los_Angeles')).toBe('2026-12-01T15:00:00.000Z')
  })
  it('rejects skipped and ambiguous daylight-saving wall times', () => {
    expect(() => localSendInstant('2026-03-08', '02:30', 'America/Los_Angeles')).toThrow()
    expect(() => localSendInstant('2026-11-01', '01:30', 'America/Los_Angeles')).toThrow()
    expect(() => localSendInstant('2026-02-30', '07:00', 'America/Los_Angeles')).toThrow()
  })
  it('suggests clear profile locations and leaves uncertain locations for selection', async () => {
    expect(await suggestTimezone('Los Angeles Metropolitan Area')).toBe('America/Los_Angeles')
    expect(await suggestTimezone('London, England, United Kingdom')).toBe('Europe/London')
    expect(await suggestTimezone('Warsaw, Mazowieckie, Poland')).toBe('Europe/Warsaw')
    expect(await suggestTimezone('United States')).toBeNull()
    expect(await suggestTimezone(null)).toBeNull()
  })
})

import { isDraft, sendFailed, type InboxMessage } from './inbox'
it.each(['scheduled_in_inbox','scheduled_send_cancelled','post_approval_race:scheduled_thread_changed'])('keeps %s outside generic draft approval and failure states', reason => {
  const m = { direction:'outbound', sent_at:null, approved_at:null, send_blocked_at:'2026-10-01T10:00:00Z', send_blocked_reason:reason } as InboxMessage
  expect(isDraft(m)).toBe(false)
  expect(sendFailed(m)).toBe(false)
})
