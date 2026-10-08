import { describe, expect, it } from 'vitest'
import { sentIn, touchOf } from './sendLogModel'
import type { InboxMessage, Thread } from '../../lib/inbox'

const m = (o: Partial<InboxMessage>) => ({ message_type: 'dm', channel: 'linkedin', ai_model: null, ...o }) as InboxMessage
describe('touchOf (the reply-source rules)', () => {
  it('reads the message type first', () => {
    expect(touchOf(m({ message_type: 'connection_note' }), 0)).toBe('invite')
    expect(touchOf(m({ message_type: 'inmail', channel: 'linkedin_inmail' }), 1)).toBe('inmail')
    expect(touchOf(m({ channel: 'email', message_type: 'email' }), null)).toBe('email')
    expect(touchOf(m({ ai_model: 'manual_mirror' }), null)).toBe('hand')
  })
  it('numbers a DM by its recorded step; step 4 on a recycle template is Recycle', () => {
    expect(touchOf(m({ ai_model: 'rise_dm1_comp_engager_v3' }), 1)).toBe('dm1')
    expect(touchOf(m({ ai_model: 'arch_nudge' }), 2)).toBe('dm2')
    expect(touchOf(m({ ai_model: 'rise_dm3_final_v1' }), 3)).toBe('dm3')
    expect(touchOf(m({ ai_model: 'rise_dm4_v1' }), 4)).toBe('dm4')
    expect(touchOf(m({ ai_model: 'recycle_60d_v2' }), 4)).toBe('recycle')
    expect(touchOf(m({ ai_model: 'x' }), 5)).toBe('dm5')
  })
  it('places step-less sends by their template, else Other', () => {
    expect(touchOf(m({ ai_model: 'rise_stall_bump_time_ask_v1' }), null)).toBe('followup')
    expect(touchOf(m({ ai_model: 'ivan_reopen_v1' }), null)).toBe('followup')
    expect(touchOf(m({ ai_model: 'arch_reply_draft_v2' }), null)).toBe('reply')
    expect(touchOf(m({ ai_model: 'rise_dm2_scan_delivery_v1' }), null)).toBe('delivery')
    expect(touchOf(m({ ai_model: 'pre_dm1_intro_offer_v1' }), null)).toBe('intro')
    expect(touchOf(m({ ai_model: 'lm_gate_v1' }), null)).toBe('lm')
    expect(touchOf(m({ ai_model: 'manual_draft' }), null)).toBe('hand')
    expect(touchOf(m({ ai_model: 'something_new' }), null)).toBe('other')
  })
})
it('sentIn keeps only sent outbound messages in the window, newest first', () => {
  const now = Date.parse('2026-10-08T12:00:00Z')
  const t = { prospect_id: 'p', messages: [
    m({ id: 'a', direction: 'outbound', sent_at: '2026-10-07T10:00:00Z' }),
    m({ id: 'b', direction: 'outbound', sent_at: null }),
    m({ id: 'c', direction: 'inbound', sent_at: '2026-10-08T09:00:00Z' }),
    m({ id: 'd', direction: 'outbound', sent_at: '2026-10-08T08:00:00Z' }),
    m({ id: 'e', direction: 'outbound', sent_at: '2026-08-01T08:00:00Z' }),
  ] } as unknown as Thread
  expect(sentIn([t], now).map(r => r.m.id)).toEqual(['d', 'a'])
})
