import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConversationAgentControls, ConversationAgentEnrollment } from './ConversationAgentControls'
import type { ConversationAgentCard } from './conversationAgentData'

const HASH = 'a'.repeat(64)
const NOW = Date.parse('2026-09-15T12:00:00Z')
const base: ConversationAgentCard = {
  thread_id: 'thread-1', prospect_id: 'prospect-1', account_id: 'ivan-linkedin', client_id: 'ivan',
  person_key: 'linkedin_profile_id:member-1', prospect_name: 'Ada Lovelace', linkedin_url: null,
  owner: 'agent', mode: 'review', state: 'active', revision: 7, policy_version: 'conversation-v1',
  pause_reason: null, enrolled_at: '2026-09-15T11:00:00Z', last_inbound_id: 'inbound-7', last_outbound_id: null,
  latest_inbound: { id: 'inbound-7', text: 'Can this work with our CRM?', at: '2026-09-15T11:58:00Z' },
  next_action: { id: 'action-1', kind: 'reply', status: 'draft', due_at: '2026-09-15T12:03:00Z',
    expires_at: '2026-09-15T12:33:00Z', payload_hash: HASH, expected_revision: 7, blocked_reason: null },
  actions: [{
    id: 'action-1', turn_id: 'turn-1', sequence_no: 0, kind: 'reply', status: 'draft',
    payload: { kind: 'reply', text: 'Good question. The short answer is yes.', quote_id: 'inbound-7' },
    payload_hash: HASH, expected_revision: 7, policy_version: 'conversation-v1',
    due_at: '2026-09-15T12:03:00Z', expires_at: '2026-09-15T12:33:00Z', approval_source: null,
    approved_at: null, blocked_reason: null, evidence_ids: ['fact-2'],
    source_snippets: [{ id: 'fact-2', label: 'Offer facts', snippet: 'Approved delivery fact.' }],
  }],
}

const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ')

describe('ConversationAgentControls', () => {
  it('shows owner, mode, latest inbound, exact proposal, quote target, evidence and due time', () => {
    const t = text(renderToStaticMarkup(<ConversationAgentControls card={base} now={NOW} onChanged={() => {}} />))
    expect(t).toContain('Agent owns this')
    expect(t).toContain('Review mode')
    expect(t).toContain('Can this work with our CRM?')
    expect(t).toContain('Good question. The short answer is yes.')
    expect(t).toContain('Quoted reply to inbound-7')
    expect(t).toContain('Offer facts')
    expect(t).toContain('Approved delivery fact.')
    expect(t).toContain('Due')
    expect(t).toContain('Approve this action')
  })

  it('renders a reaction target and the proposed reaction exactly', () => {
    const action = { ...base.actions[0], id: 'action-2', kind: 'react_post' as const,
      payload: { kind: 'react_post' as const, target_id: 'urn:li:activity:123', reaction: 'LIKE' } }
    const c = { ...base, next_action: { ...base.next_action!, id: action.id, kind: action.kind }, actions: [action] }
    const t = text(renderToStaticMarkup(<ConversationAgentControls card={c} now={NOW} onChanged={() => {}} />))
    expect(t).toContain('Post urn:li:activity:123')
    expect(t).toContain('LIKE')
  })

  it('shows no-action decisions without offering approval', () => {
    const action = { ...base.actions[0], id: 'action-3', kind: 'wait' as const,
      payload: { kind: 'wait' as const, reason: 'The exchange ended naturally.' } }
    const c = { ...base, next_action: { ...base.next_action!, id: action.id, kind: action.kind }, actions: [action] }
    const t = text(renderToStaticMarkup(<ConversationAgentControls card={c} now={NOW} onChanged={() => {}} />))
    expect(t).toContain('Wait')
    expect(t).toContain('The exchange ended naturally.')
    expect(t).not.toContain('Approve this action')
  })

  it('shows an in-flight warning and disables ordinary approval for unknown delivery', () => {
    const action = { ...base.actions[0], status: 'delivery_unknown' as const, blocked_reason: 'delivery_unknown' }
    const c = { ...base, next_action: { ...base.next_action!, status: action.status, blocked_reason: action.blocked_reason }, actions: [action] }
    const html = renderToStaticMarkup(<ConversationAgentControls card={c} now={NOW} onChanged={() => {}} />)
    const t = text(html)
    expect(t).toContain('Delivery is uncertain')
    expect(t).toContain('Do not retry')
    expect(t).not.toContain('Approve this action')
  })

  it('shows an older hold separately while the current proposal remains primary', () => {
    const held = { ...base.actions[0], id: 'older-hold', status: 'held' as const, expected_revision: 6, blocked_reason: 'stale_revision' }
    const c = { ...base, next_action: { ...base.next_action!, id: held.id, status: held.status }, actions: [base.actions[0], held] }
    const t = text(renderToStaticMarkup(<ConversationAgentControls card={c} now={NOW} onChanged={() => {}} />))
    expect(t).toContain('Good question. The short answer is yes.')
    expect(t).toContain('Earlier holds · 1')
    expect(t).toContain('The conversation changed. Reload before approving.')
  })

  it('offers pause, takeover, stop and the matching resume or handback controls', () => {
    const active = text(renderToStaticMarkup(<ConversationAgentControls card={base} now={NOW} onChanged={() => {}} />))
    expect(active).toContain('Pause agent')
    expect(active).toContain('Take over')
    expect(active).toContain('Stop contact')

    const paused = text(renderToStaticMarkup(<ConversationAgentControls card={{ ...base, state: 'paused' }} now={NOW} onChanged={() => {}} />))
    expect(paused).toContain('Resume agent')

    const human = text(renderToStaticMarkup(<ConversationAgentControls card={{ ...base, owner: 'human' }} now={NOW} onChanged={() => {}} />))
    expect(human).toContain('Hand back to agent')
  })

  it('keeps auto enrollment unavailable until the server exposes release readiness', () => {
    const html = renderToStaticMarkup(<ConversationAgentControls card={base} now={NOW} onChanged={() => {}} />)
    expect(text(html)).toContain('Auto enrollment')
    expect(html).toMatch(/disabled=""[^>]*>.*Auto enrollment|>.*Auto enrollment.*<\/button>/)
  })
})

describe('ConversationAgentEnrollment', () => {
  it('routes enrollment through Ops approval and exposes no enrollment mutation', () => {
    const html = renderToStaticMarkup(<ConversationAgentEnrollment />)
    const t = text(html)
    expect(t).toContain('Open Ops')
    expect(t).toContain('Approve takeover')
    expect(t).toContain('Sending stays held')
    expect(t).not.toContain('Start shadow')
    expect(t).not.toContain('Enroll in review')
    expect(t).not.toContain('Auto enrollment')
    expect(html).toContain('href="#exp/v2/ops"')
  })
})
