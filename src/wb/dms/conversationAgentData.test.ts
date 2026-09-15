import { describe, expect, it } from 'vitest'
import {
  actionForCard, agentCardsWithoutWarmCards, approvalGate, describeAction, historicalHeldActions,
  isConversationAgentRpcMissing,
  type ConversationAgentAction, type ConversationAgentCard,
} from './conversationAgentData'

const NOW = Date.parse('2026-09-15T12:00:00Z')
const HASH = 'a'.repeat(64)

const reply: ConversationAgentAction = {
  id: 'action-1', turn_id: 'turn-1', sequence_no: 0, kind: 'reply', status: 'draft',
  payload: { kind: 'reply', text: 'Good question. The short answer is yes.', quote_id: 'inbound-7' },
  payload_hash: HASH, expected_revision: 7, policy_version: 'conversation-v1',
  due_at: '2026-09-15T12:03:00Z', expires_at: '2026-09-15T12:33:00Z',
  approval_source: null, approved_at: null, blocked_reason: null,
  evidence_ids: ['fact-2'], source_snippets: [{ id: 'fact-2', label: 'Offer facts', snippet: 'Approved delivery fact.' }],
}

const card: ConversationAgentCard = {
  thread_id: 'thread-1', prospect_id: 'prospect-1', account_id: 'ivan-linkedin', client_id: 'ivan',
  person_key: 'linkedin_profile_id:member-1', prospect_name: 'Ada Lovelace', linkedin_url: null,
  owner: 'agent', mode: 'review', state: 'active', revision: 7, policy_version: 'conversation-v1',
  pause_reason: null, enrolled_at: '2026-09-15T11:00:00Z', last_inbound_id: 'inbound-7',
  last_outbound_id: null, latest_inbound: { id: 'inbound-7', text: 'Can this work with our CRM?', at: '2026-09-15T11:58:00Z' },
  next_action: { id: reply.id, kind: reply.kind, status: reply.status, due_at: reply.due_at,
    expires_at: reply.expires_at, payload_hash: reply.payload_hash, expected_revision: reply.expected_revision,
    blocked_reason: null },
  actions: [reply],
}
const replyText = reply.payload.kind === 'reply' ? reply.payload.text : ''

describe('conversation agent card guards', () => {
  it('binds approval to the action selected by next_action', () => {
    expect(actionForCard(card)).toEqual(reply)
    expect(approvalGate(card, reply, replyText, NOW)).toEqual({ allowed: true })
  })

  it('prefers the newest current-revision work over an older held next_action', () => {
    const held = { ...reply, id: 'old-hold', status: 'held' as const, expected_revision: 6, blocked_reason: 'stale_revision' }
    const current = { ...reply, id: 'current-draft' }
    const mixed = {
      ...card,
      next_action: { ...card.next_action!, id: held.id, status: held.status, expected_revision: held.expected_revision },
      actions: [current, held],
    }
    expect(actionForCard(mixed)?.id).toBe('current-draft')
    expect(historicalHeldActions(mixed, current.id)).toEqual([held])
  })

  it('makes a local text edit unapprovable until the edit is saved and rehashed', () => {
    expect(approvalGate(card, reply, 'Different copy', NOW)).toEqual({
      allowed: false, reason: 'Save the edit to create a new approval hash.',
    })
  })

  it('shows the first bubble when database actions arrive in reverse sequence order', () => {
    const second = { ...reply, id: 'bubble-2', sequence_no: 1 }
    const reversed = { ...card, actions: [second, reply] }
    expect(actionForCard(reversed)?.id).toBe(reply.id)
    expect(actionForCard({ ...reversed, next_action: null })?.id).toBe(reply.id)
    expect(actionForCard({ ...reversed, actions: [second, { ...reply, status: 'approved' }] })?.id).toBe(reply.id)
  })

  it('keeps an uncertain older delivery visible before current review work', () => {
    const unknown = { ...reply, id: 'uncertain', status: 'delivery_unknown' as const, expected_revision: 6 }
    expect(actionForCard({ ...card, actions: [reply, unknown] })?.id).toBe(unknown.id)
  })

  it('blocks a stale card and an expired action', () => {
    expect(approvalGate({ ...card, revision: 8 }, reply, replyText, NOW).reason).toBe('The conversation changed. Reload before approving.')
    expect(approvalGate(card, { ...reply, expires_at: '2026-09-15T11:59:59Z' }, replyText, NOW).reason).toBe('This proposal expired. Wait for a fresh proposal.')
  })

  it('blocks pending invites, unsupported targets, closed threads and account denial in plain words', () => {
    const cases: Array<[ConversationAgentCard, ConversationAgentAction, string]> = [
      [card, { ...reply, status: 'held', blocked_reason: 'connection_required' }, 'Waiting for the connection before a DM can be approved.'],
      [card, { ...reply, status: 'held', blocked_reason: 'quote_unsupported' }, 'Quoted replies are unavailable for this conversation.'],
      [card, { ...reply, kind: 'react_post', payload: { kind: 'react_post', target_id: 'post-1', reaction: 'LIKE' }, status: 'held', blocked_reason: 'reaction_unsupported' }, 'This reaction is unsupported and cannot be approved.'],
      [{ ...card, state: 'closed' }, reply, 'This conversation is closed.'],
      [card, { ...reply, status: 'held', blocked_reason: 'operator_denied' }, 'This LinkedIn account is not available to the signed-in operator.'],
    ]
    for (const [c, a, reason] of cases) expect(approvalGate(c, a, a.payload.kind === 'reply' ? a.payload.text : '', NOW).reason).toBe(reason)
  })

  it('keeps unknown delivery visible and non-retryable', () => {
    const unknown = { ...reply, status: 'delivery_unknown' as const, blocked_reason: 'delivery_unknown' }
    expect(describeAction(unknown, NOW)).toContain('Delivery is uncertain')
    expect(approvalGate(card, unknown, replyText, NOW).allowed).toBe(false)
  })
})

describe('migration readiness', () => {
  it('recognises only PostgREST missing-function errors as an absent migration', () => {
    expect(isConversationAgentRpcMissing({ code: 'PGRST202', message: 'Could not find the function public.conversation_agent_cards' })).toBe(true)
    expect(isConversationAgentRpcMissing({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(isConversationAgentRpcMissing(new Error('network failed'))).toBe(false)
  })

  it('keeps agent cards whose prospects are absent from the warm RPC', () => {
    const outsideWarm = { ...card, prospect_id: 'replied-prospect', thread_id: 'replied-thread' }
    const duplicate = { ...outsideWarm, thread_id: 'duplicate-thread' }
    expect(agentCardsWithoutWarmCards([card, outsideWarm, duplicate], new Set([card.prospect_id]))).toEqual([outsideWarm])
  })
})
