import { beforeEach, expect, it, vi } from 'vitest'
import { composeReply, groupThreads } from './inbox'
import { msg, NOW } from '../d/dms/fixtures'

const insert = vi.hoisted(() => vi.fn(async () => ({ error: null })))
const rpc = vi.hoisted(() => vi.fn(async () => ({ data: { ok: true, allow_send: true, revision: 4 }, error: null })))
vi.mock('./supabase', () => ({ supabase: { rpc, from: vi.fn(() => ({ insert })) } }))
beforeEach(() => { insert.mockClear(); rpc.mockClear() })

it('queues owner-typed Anna replies with no false sent timestamp', async () => {
  const [t] = groupThreads([msg({ prospect_id: 'anna-prospect', client_id: 'anna', direction: 'inbound', sent_at: '2026-09-27T08:00:00Z' })], new Set(), NOW)
  await expect(composeReply(t, 'Happy to explain.')).resolves.toEqual([])
  expect(rpc).not.toHaveBeenCalled()
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ prospect_id: 'anna-prospect', message_type: 'manual_reply', channel: 'linkedin', message_text: 'Happy to explain.', sent_at: null, approved_at: expect.any(String) }))
  expect(insert).not.toHaveBeenCalledWith(expect.objectContaining({ draft_evidence: expect.anything() }))
})

it('still takes conversation ownership for Ivan’s existing manual replies', async () => {
  const [t] = groupThreads([msg({ prospect_id: 'ivan-prospect', client_id: 'ivan', direction: 'inbound' })], new Set(), NOW)
  await composeReply(t, 'Hello')
  expect(rpc).toHaveBeenCalledWith('conversation_agent_before_manual_send', { p_prospect_id: 'ivan-prospect' })
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ draft_evidence: { conversation_agent_manual_revision: 4 } }))
})

it('refuses unknown sender identities before queueing a reply', async () => {
  const [t] = groupThreads([msg({ prospect_id: 'unknown-prospect', client_id: 'not-a-seat', direction: 'inbound' })], new Set(), NOW)
  await expect(composeReply(t, 'Hello')).rejects.toThrow('sender for this conversation is unknown')
  expect(rpc).not.toHaveBeenCalled()
  expect(insert).not.toHaveBeenCalled()
})
