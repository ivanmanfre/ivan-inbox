// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { canDraftAgain, REDRAFT_REASON, sendFailed } from '../../lib/inbox'
import { historyRows } from './History'
import { RedraftStatus } from './Redraft'
import { msg, threads } from './fixtures'

vi.mock('../../lib/inbox', async () => {
  const real = await vi.importActual<typeof import('../../lib/inbox')>('../../lib/inbox')
  return { ...real, fetchRedraftRequest: vi.fn(async () => null) }
})

afterEach(cleanup)

const sent = msg({ prospect_id: 'dana', client_id: 'risedtc', sent_at: '2026-10-22T22:47:00Z', message_text: 'Worth a conversation?' })

it('offers Draft again on a stall-bump follow-up only', () => {
  const bump = msg({ prospect_id: 'dana', client_id: 'risedtc', ai_model: 'rise_stall_bump_ctx_v1', message_text: 'Hey Dana' })
  const reply = msg({ prospect_id: 'dana', client_id: 'risedtc', ai_model: 'rise_reply_draft_v1', message_text: 'Hey Dana' })
  expect(canDraftAgain(threads([sent, bump])[0])).toBe(true)
  expect(canDraftAgain(threads([sent, reply])[0])).toBe(false)
})

it('a Draft-again row is never a failed send and never history', () => {
  const asked = msg({ prospect_id: 'dana', client_id: 'risedtc', ai_model: 'rise_stall_bump_ctx_v1', message_text: 'Old draft', send_blocked_at: '2026-10-25T12:00:00Z', send_blocked_reason: REDRAFT_REASON })
  expect(sendFailed(asked)).toBe(false)
  expect(historyRows(threads([sent, asked])[0]).map(m => m.id)).toEqual([sent.id])
})

it('says the follow-up is being rewritten until a newer draft lands', () => {
  const asked = msg({ prospect_id: 'dana', client_id: 'risedtc', ai_model: 'rise_stall_bump_ctx_v1', message_text: 'Old draft', created_at: '2026-10-24T23:20:00Z', send_blocked_at: '2026-10-25T12:00:00Z', send_blocked_reason: REDRAFT_REASON })
  const [t] = threads([sent, asked])
  const { unmount } = render(<RedraftStatus t={t} now={Date.parse('2026-10-25T12:05:00Z')} reload={() => {}} />)
  expect(screen.getByText(/Rewriting/)).toBeTruthy()
  unmount()
  const fresh = msg({ prospect_id: 'dana', client_id: 'risedtc', ai_model: 'rise_stall_bump_ctx_v1', message_text: 'New draft', created_at: '2026-10-25T12:15:00Z' })
  render(<RedraftStatus t={threads([sent, asked, fresh])[0]} now={Date.parse('2026-10-25T12:16:00Z')} reload={() => {}} />)
  expect(screen.queryByText(/Rewriting/)).toBeNull()
})
