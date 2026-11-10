import { describe, expect, it } from 'vitest'
import { readCheckWait } from './checkWait'

const NOW = Date.parse('2026-11-10T16:22:00Z')
const note = { direction: 'outbound' as const, message_type: 'connection_note', sent_at: '2026-11-09T09:10:08Z', created_at: '2026-11-07T16:28:59Z' }
const dm1Stopped = { direction: 'outbound' as const, message_type: 'dm', sent_at: null, created_at: '2026-11-07T16:28:59Z' }
const hello = { direction: 'inbound' as const, message_type: 'dm', sent_at: '2026-11-10T15:52:18Z', created_at: '2026-11-10T16:02:26Z' }
const pending = { state: 'pending', started_at: '2026-11-10T16:06:07.923Z' }

describe('readCheckWait', () => {
  it('a reply before the first message waits while the search check is running (Stacey Wilhelm, 11-10)', () => {
    expect(readCheckWait(pending, [note, dm1Stopped, hello], NOW)).toEqual({ startedAt: '2026-11-10T16:06:07.923Z' })
  })
  it('a check that has not started yet still counts as running', () => {
    expect(readCheckWait({ state: 'pending' }, [note, dm1Stopped, hello], NOW)).toEqual({ startedAt: null })
  })
  it('a finished or held check is not a wait', () => {
    expect(readCheckWait({ state: 'ready' }, [note, dm1Stopped, hello], NOW)).toBeNull()
    expect(readCheckWait({ state: 'hold', reason: 'search_no_fair_finding' }, [note, dm1Stopped, hello], NOW)).toBeNull()
    expect(readCheckWait(null, [note, dm1Stopped, hello], NOW)).toBeNull()
  })
  it('the drafter stops waiting a day after the reply, so the banner does too', () => {
    expect(readCheckWait(pending, [note, dm1Stopped, hello], Date.parse('2026-11-11T15:52:19Z'))).toBeNull()
  })
  it('no wait once a first message or InMail has gone out', () => {
    const sentDm = { ...dm1Stopped, sent_at: '2026-11-10T16:10:00Z' }
    expect(readCheckWait(pending, [note, sentDm, hello], NOW)).toBeNull()
    expect(readCheckWait(pending, [{ ...sentDm, message_type: 'inmail' }, hello], NOW)).toBeNull()
  })
  it('no wait with no reply on the thread', () => {
    expect(readCheckWait(pending, [note, dm1Stopped], NOW)).toBeNull()
  })
})
