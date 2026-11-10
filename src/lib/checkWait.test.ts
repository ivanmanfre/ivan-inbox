import { describe, expect, it } from 'vitest'
import { readCheckWait } from './checkWait'

const NOW = Date.parse('2026-11-10T16:22:00Z')
const note = { direction: 'outbound' as const, message_type: 'connection_note', sent_at: '2026-11-09T09:10:08Z' }
const dm1Stopped = { direction: 'outbound' as const, message_type: 'dm', sent_at: null }
const hello = { direction: 'inbound' as const, message_type: 'dm', sent_at: '2026-11-10T15:52:18Z' }
const pending = { state: 'pending', startedAt: '2026-11-10T16:06:07.923Z', replyAt: '2026-11-10T15:52:18Z' }

describe('readCheckWait', () => {
  it('a reply before the first message waits while the search check is running (Stacey Wilhelm, 11-10)', () => {
    expect(readCheckWait(pending, [note, dm1Stopped, hello], NOW)).toEqual({ startedAt: '2026-11-10T16:06:07.923Z' })
  })
  it('a check that has not started yet still counts as running', () => {
    expect(readCheckWait({ ...pending, startedAt: null }, [note, dm1Stopped, hello], NOW)).toEqual({ startedAt: null })
  })
  it('a finished or held check is not a wait', () => {
    expect(readCheckWait({ ...pending, state: 'ready' }, [note, dm1Stopped, hello], NOW)).toBeNull()
    expect(readCheckWait({ ...pending, state: 'hold' }, [note, dm1Stopped, hello], NOW)).toBeNull()
    expect(readCheckWait(null, [note, dm1Stopped, hello], NOW)).toBeNull()
  })
  it('the drafter stops waiting a day after the reply, so the banner does too', () => {
    expect(readCheckWait(pending, [note, dm1Stopped, hello], Date.parse('2026-11-11T15:52:18Z'))).toBeNull()
    expect(readCheckWait(pending, [note, dm1Stopped, hello], Date.parse('2026-11-11T15:52:17Z'))).not.toBeNull()
  })
  it('no wait once a first message or InMail has gone out', () => {
    const sentDm = { ...dm1Stopped, sent_at: '2026-11-10T16:10:00Z' }
    expect(readCheckWait(pending, [note, sentDm, hello], NOW)).toBeNull()
    expect(readCheckWait(pending, [{ ...sentDm, message_type: 'inmail' }, hello], NOW)).toBeNull()
  })
  it('a thread with only a reaction (no written reply) promises nothing', () => {
    const reaction = { ...hello, sent_at: '2026-11-10T16:10:00Z' }
    expect(readCheckWait({ ...pending, replyAt: null }, [note, dm1Stopped, reaction], NOW)).toBeNull()
  })
  it('a reaction after the hello does not restart the day: the clock runs from the written reply', () => {
    const lateReaction = { ...hello, sent_at: '2026-11-11T15:00:00Z' }
    expect(readCheckWait(pending, [note, dm1Stopped, hello, lateReaction], Date.parse('2026-11-11T16:00:00Z'))).toBeNull()
  })
})
