import { describe, expect, it } from 'vitest'
import { eventTime, type InboxMessage } from './inbox'

const m = (o: Partial<InboxMessage>) => ({ direction: 'outbound', created_at: '2026-09-27T14:11:59Z', sent_at: null, approved_at: null, ...o }) as InboxMessage

describe('eventTime', () => {
  it('uses sent_at when the message went out', () => {
    expect(eventTime(m({ approved_at: '2026-09-27T22:37:53Z', sent_at: '2026-09-27T22:38:42Z' }))).toBe('2026-09-27T22:38:42Z')
  })
  it('times a queued reply at its approval, not when the draft was written', () => {
    expect(eventTime(m({ approved_at: '2026-09-27T22:37:53Z' }))).toBe('2026-09-27T22:37:53Z')
  })
  it('keeps created_at for an unapproved draft and for inbound rows', () => {
    expect(eventTime(m({}))).toBe('2026-09-27T14:11:59Z')
    expect(eventTime(m({ direction: 'inbound', approved_at: '2026-09-27T22:37:53Z' }))).toBe('2026-09-27T14:11:59Z')
  })
})
