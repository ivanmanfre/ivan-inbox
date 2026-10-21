import { beforeEach, expect, it, vi } from 'vitest'
import { msg } from '../d/dms/fixtures'
const db = vi.hoisted(() => ({ rpc: vi.fn(), read: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { rpc: db.rpc, from: () => ({ select: () => ({ eq: () => ({ single: db.read }) }) }) } }))
import { canEditHeldDm, canSendRejectedDm, editHeldDm, sendRejectedDm } from './rejectedDm'
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
// Ivan 10-21 (Leighton Penrose): edit a held message, keep it held.
const leighton = () => msg({ prospect_id: 'lp', ai_model: 'inbox_scheduled_manual_v1', message_text: 'Hey man, me again haha', send_blocked_reason: 'duplicate_in_thread', send_blocked_at: '2026-10-12T12:48:04.077Z' })
it('offers an edit on a held row it could send anyway, never on SwishDM, a DM + email pair or a non-hold', () => {
  expect(canEditHeldDm(leighton())).toBe(true)
  expect(canEditHeldDm({ ...leighton(), client_id: 'swishdm', ai_model: 'swishdm_reply_writer_v1' })).toBe(false)
  expect(canEditHeldDm({ ...leighton(), draft_evidence: { client: 'swishdm' } })).toBe(false)
  expect(canEditHeldDm({ ...leighton(), recipient_email: 'a@b.co', email_mirror_text: 'email words' })).toBe(false)
  for (const reason of ['discarded_in_inbox', 'scheduled_in_inbox', 'reply_retry_pending', 'owner_confirmation']) expect(canEditHeldDm({ ...leighton(), send_blocked_reason: reason }), reason).toBe(false)
  expect(canEditHeldDm({ ...leighton(), sent_at: '2026-10-12T13:00:00Z' })).toBe(false)
})
it('saves the edit through the guarded RPC with the text, hold, approval and evidence on screen', async () => {
  const m = leighton(); await editHeldDm(m, 'Hey Leighton, quick one')
  expect(db.rpc).toHaveBeenCalledWith('edit_held_inbox_draft', { p_message_id: m.id, p_text: 'Hey Leighton, quick one', p_expected_text: 'Hey man, me again haha',
    p_expected_reason: 'duplicate_in_thread', p_expected_blocked_at: '2026-10-12T12:48:04.077Z', p_expected_approved_at: null, p_expected_evidence: { generated_text: 'hello' } })
  expect(db.rpc).not.toHaveBeenCalledWith('send_rejected_inbox_draft', expect.anything())
})
it('refuses an empty edit, a SwishDM row and a stale screen without writing', async () => {
  await expect(editHeldDm(leighton(), '  ')).rejects.toThrow(/empty/)
  await expect(editHeldDm({ ...leighton(), draft_evidence: { client: 'swishdm' } }, 'x')).rejects.toThrow(/SwishDM/)
  expect(db.rpc).not.toHaveBeenCalled()
  db.rpc.mockResolvedValue({ error: new Error('The held message changed. Refresh before editing.') })
  await expect(editHeldDm(leighton(), 'x')).rejects.toThrow(/changed/)
})
