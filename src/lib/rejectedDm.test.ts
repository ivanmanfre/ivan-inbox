import { beforeEach, expect, it, vi } from 'vitest'
import { msg } from '../d/dms/fixtures'
const db = vi.hoisted(() => ({ rpc: vi.fn(), read: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { rpc: db.rpc, from: () => ({ select: () => ({ eq: () => ({ single: db.read }) }) }) } }))
import { canSendRejectedDm, sendRejectedDm } from './rejectedDm'
const rejected = () => msg({ prospect_id: 'p', send_blocked_reason: 'arch_market_claim_unratified:Israel', send_blocked_at: '2026-10-01T10:22:00Z' })
beforeEach(() => { vi.clearAllMocks(); db.rpc.mockResolvedValue({ error: null }); db.read.mockResolvedValue({ data: { draft_evidence: { generated_text: 'hello' } }, error: null }) })
it('offers an override for copy and follow-up rejections, including recoverable lint holds', () => {
  expect(canSendRejectedDm(rejected())).toBe(true)
  expect(canSendRejectedDm({ ...rejected(), send_blocked_reason: 'lint_unbacked_commitment' })).toBe(true)
})
it.each(['discarded_in_inbox','superseded_by_followup_repair','owner_confirmation','reply_retry_pending','scheduled_in_inbox','scheduled_send_cancelled','native_email_send_failed: timeout'])('does not offer sending for %s', reason => {
  expect(canSendRejectedDm({ ...rejected(), send_blocked_reason: reason })).toBe(false)
})
it('does not offer already delivered, inbound or empty messages', () => {
  for (const change of [{ sent_at: '2026-10-01T10:25:00Z' }, { unipile_message_id: 'native-id' }, { direction: 'inbound' as const }, { message_text: '' }]) expect(canSendRejectedDm({ ...rejected(), ...change })).toBe(false)
})
it('queues the visible rejected text through an atomic RPC with its rejection snapshot', async () => {
  const m = rejected(); await sendRejectedDm(m, 'chat')
  expect(db.rpc).toHaveBeenCalledWith('send_rejected_inbox_draft', { p_message_id: m.id, p_text: m.message_text, p_expected_reason: m.send_blocked_reason, p_expected_blocked_at: m.send_blocked_at, p_expected_approved_at: null, p_expected_evidence: { generated_text: 'hello' }, p_chat_id: 'chat' })
})
it('surfaces a concurrent change and never falls back to a direct update', async () => {
  db.rpc.mockResolvedValue({ error: new Error('The rejected draft changed. Refresh before sending.') })
  await expect(sendRejectedDm(rejected())).rejects.toThrow(/changed/)
})
