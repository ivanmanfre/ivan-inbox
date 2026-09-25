import { describe, expect, it } from 'vitest'
import { INBOX_QUERY as HANDOFF_QUERY, pickClaudeHandoff, type ClaudeHandoff } from './handoff'
import { INBOX_QUERY } from './inboxCache'
import type { TurnRow } from './turns'

describe('handoff constants', () => {
  it('names the same DMs query as inboxCache', () => {
    expect(HANDOFF_QUERY).toBe(INBOX_QUERY)
  })
})

describe('pickClaudeHandoff: which copy of a Claude thread the page keeps', () => {
  const w = (over: Partial<ClaudeHandoff> = {}): ClaudeHandoff => ({
    user: 'u1', threadId: 't1', savedAt: '2026-09-25T10:00:00Z', rows: [{ id: 'r1' } as unknown as TurnRow], ...over,
  })
  it('adopts a newer copy for the same user', () => {
    expect(pickClaudeHandoff(w(), 'u1', '2026-09-25T09:00:00Z')).toBe(true)
    expect(pickClaudeHandoff(w(), 'u1', null)).toBe(true)
  })
  it('keeps the page copy when it is newer or equal', () => {
    expect(pickClaudeHandoff(w(), 'u1', '2026-09-25T10:00:00Z')).toBe(false)
    expect(pickClaudeHandoff(w(), 'u1', '2026-09-25T11:00:00Z')).toBe(false)
  })
  it('never adopts another user or an empty read', () => {
    expect(pickClaudeHandoff(w(), 'u2', null)).toBe(false)
    expect(pickClaudeHandoff(w(), null, null)).toBe(false)
    expect(pickClaudeHandoff(w({ rows: [] }), 'u1', null)).toBe(false)
  })
})
