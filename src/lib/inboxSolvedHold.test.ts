import { beforeEach, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => {
  const q = { update: vi.fn(), eq: vi.fn(), is: vi.fn(), select: vi.fn() }
  q.update.mockReturnValue(q)
  q.eq.mockReturnValue(q)
  q.is.mockReturnValue(q)
  q.select.mockResolvedValue({ data: [{ id: 'hold' }], error: null })
  return { q, from: vi.fn(() => q) }
})
vi.mock('./supabase', () => ({ supabase: { from: db.from } }))

import { restoreConfirmation } from './inbox'

beforeEach(() => vi.clearAllMocks())

it('restores only the hold retired at this solve timestamp and puts its old timestamp back', async () => {
  const retiredAt = '2026-09-28T17:10:00.000Z'
  const previousAt = '2026-09-28T17:02:15.000Z'
  expect(await restoreConfirmation('hold', 'reply_retry_pending', retiredAt, previousAt)).toBe(true)
  expect(db.from).toHaveBeenCalledWith('outreach_messages')
  expect(db.q.update).toHaveBeenCalledWith({ send_blocked_reason: 'reply_retry_pending', send_blocked_at: previousAt })
  expect(db.q.eq).toHaveBeenCalledWith('id', 'hold')
  expect(db.q.eq).toHaveBeenCalledWith('send_blocked_reason', 'owner_confirmation_superseded')
  expect(db.q.eq).toHaveBeenCalledWith('send_blocked_at', retiredAt)
  expect(db.q.is).toHaveBeenCalledWith('sent_at', null)
  expect(db.q.is).toHaveBeenCalledWith('approved_at', null)
})
