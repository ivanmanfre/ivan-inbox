import { supabase } from '../../lib/supabase'

export type ConversationAgentOwner = 'agent' | 'human' | 'booking' | 'legacy'
export type ConversationAgentMode = 'shadow' | 'review' | 'auto'
export type ConversationAgentState = 'active' | 'paused' | 'stopped' | 'closed' | string
export type ConversationAgentActionKind = 'reply' | 'react_message' | 'react_post' | 'wait' | 'handoff' | 'close'
export type ConversationAgentActionStatus = 'draft' | 'approved' | 'claimed' | 'sending' | 'sent' | 'held' | 'cancelled' | 'delivery_unknown'

export type ConversationAgentPayload =
  | { kind: 'reply'; text: string; quote_id: string | null }
  | { kind: 'react_message' | 'react_post'; target_id: string; reaction: string }
  | { kind: 'wait' | 'handoff' | 'close'; reason: string }

export type ConversationAgentAction = {
  id: string
  turn_id: string
  sequence_no: number
  kind: ConversationAgentActionKind
  status: ConversationAgentActionStatus
  payload: ConversationAgentPayload
  payload_hash: string
  expected_revision: number
  policy_version: string
  due_at: string | null
  expires_at: string | null
  approval_source: string | null
  approved_at: string | null
  blocked_reason: string | null
  evidence_ids: string[]
  source_snippets: { id: string; label: string; snippet: string }[]
}

export type ConversationAgentNextAction = Pick<ConversationAgentAction,
  'id' | 'kind' | 'status' | 'due_at' | 'expires_at' | 'payload_hash' | 'expected_revision' | 'blocked_reason'>

export type ConversationAgentCard = {
  thread_id: string
  prospect_id: string
  account_id: string
  client_id: string
  person_key: string
  prospect_name: string
  linkedin_url: string | null
  owner: ConversationAgentOwner
  mode: ConversationAgentMode
  state: ConversationAgentState
  revision: number
  policy_version: string
  pause_reason: string | null
  enrolled_at: string
  last_inbound_id: string | null
  last_outbound_id: string | null
  latest_inbound: { id: string; text: string; at: string } | null
  next_action: ConversationAgentNextAction | null
  actions: ConversationAgentAction[]
}

export type ConversationAgentFeed =
  | { kind: 'ready'; cards: ConversationAgentCard[] }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'error'; reason: string }

type RpcErrorLike = { code?: unknown; message?: unknown; status?: unknown }
type RpcResult = { ok?: boolean; reason?: string; [key: string]: unknown }
export type ConversationAgentEnrollmentMode = 'shadow' | 'review'
export const CONVERSATION_AGENT_POLICY_VERSION = 'conversation-agent-ivan-v1'

export function isConversationAgentRpcMissing(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as RpcErrorLike
  return e.code === 'PGRST202' || (e.status === 404 && typeof e.message === 'string' && e.message.includes('conversation_agent_'))
}

export async function fetchConversationAgentCards(): Promise<ConversationAgentFeed> {
  const { data, error } = await supabase.rpc('conversation_agent_cards')
  if (error) {
    if (isConversationAgentRpcMissing(error)) {
      return { kind: 'unavailable', reason: 'Agent controls are not installed yet. Existing warm review still works.' }
    }
    throw error
  }
  return { kind: 'ready', cards: (data ?? []) as unknown as ConversationAgentCard[] }
}

async function checkedRpc(name: 'conversation_agent_control' | 'conversation_agent_approve' | 'conversation_agent_edit' | 'conversation_agent_enroll', args: Record<string, unknown>): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(name, args)
  if (error) {
    if (isConversationAgentRpcMissing(error)) throw new Error('Conversation agent controls are not installed for this inbox.')
    throw error
  }
  const result = (data ?? {}) as RpcResult
  if (!result.ok) throw new Error(plainHoldReason(result.reason ?? 'operation_failed'))
  return result
}

export type ConversationAgentCommand = 'pause' | 'resume' | 'takeover' | 'handback' | 'stop'

export function controlConversationAgent(threadId: string, command: ConversationAgentCommand, expectedRevision: number): Promise<RpcResult> {
  return checkedRpc('conversation_agent_control', {
    p_thread_id: threadId, p_command: command, p_expected_revision: expectedRevision,
  })
}

export function approveConversationAgentAction(actionId: string, expectedRevision: number, payloadHash: string): Promise<RpcResult> {
  return checkedRpc('conversation_agent_approve', {
    p_action_id: actionId, p_expected_revision: expectedRevision, p_payload_hash: payloadHash,
  })
}

export function editConversationAgentAction(actionId: string, expectedRevision: number, text: string): Promise<RpcResult> {
  return checkedRpc('conversation_agent_edit', {
    p_action_id: actionId, p_expected_revision: expectedRevision, p_text: text,
  })
}

export function enrollConversationAgent(prospectId: string, mode: ConversationAgentEnrollmentMode): Promise<RpcResult> {
  return checkedRpc('conversation_agent_enroll', {
    p_prospect_id: prospectId, p_mode: mode, p_policy_version: CONVERSATION_AGENT_POLICY_VERSION,
  })
}

export function actionForCard(card: ConversationAgentCard): ConversationAgentAction | null {
  const uncertain = card.actions.find(action => ['sending', 'delivery_unknown'].includes(action.status))
  if (uncertain) return uncertain
  const current = card.actions.filter(action =>
    action.expected_revision === card.revision
    && action.policy_version === card.policy_version
    && ['draft', 'approved', 'claimed', 'sending', 'delivery_unknown'].includes(action.status),
  )
  const next = current.find(action => action.id === card.next_action?.id)
  if (next) return next
  current.sort((a, b) => a.turn_id === b.turn_id
    ? a.sequence_no - b.sequence_no
    : (a.due_at ?? '').localeCompare(b.due_at ?? '') || a.turn_id.localeCompare(b.turn_id))
  if (current.length) return current[0]
  if (!card.next_action) return card.actions[0] ?? null
  return card.actions.find(action => action.id === card.next_action?.id) ?? card.actions[0] ?? null
}

export function historicalHeldActions(card: ConversationAgentCard, selectedActionId?: string): ConversationAgentAction[] {
  return card.actions.filter(action => action.status === 'held' && action.id !== selectedActionId)
}

export function agentCardsWithoutWarmCards(cards: ConversationAgentCard[], warmProspectIds: Set<string>): ConversationAgentCard[] {
  const seen = new Set(warmProspectIds)
  return cards.filter(card => {
    if (seen.has(card.prospect_id)) return false
    seen.add(card.prospect_id)
    return true
  })
}

const HOLD_COPY: Record<string, string> = {
  connection_required: 'Waiting for the connection before a DM can be approved.',
  invite_pending: 'Waiting for the connection before a DM can be approved.',
  quote_unsupported: 'Quoted replies are unavailable for this conversation.',
  reaction_unsupported: 'This reaction is unsupported and cannot be approved.',
  operator_denied: 'This LinkedIn account is not available to the signed-in operator.',
  account_denied: 'This LinkedIn account is not available to the signed-in operator.',
  stale_revision: 'The conversation changed. Reload before approving.',
  stale_policy: 'The reviewed policy changed. Wait for a fresh proposal.',
  delivery_unknown: 'Delivery is uncertain. Do not retry until provider history is reconciled.',
  identity_unverified: 'The recipient identity could not be verified.',
  account_unmapped: 'The LinkedIn account mapping could not be verified.',
  capacity_unconfigured: 'Sending capacity could not be verified.',
  campaign_missing: 'This person is not attached to an eligible campaign.',
  enrollment_disabled: 'Review enrollment is not enabled for this account.',
  shadow_disabled: 'Shadow enrollment is not enabled for this account.',
  auto_disabled: 'Auto enrollment is not enabled for this account.',
  identity_conflict: 'This person matches more than one identity. Resolve the identity before enrollment.',
  not_found: 'This person could not be found.',
}

export function plainHoldReason(reason: string): string {
  return HOLD_COPY[reason] ?? reason.replaceAll('_', ' ')
}

export function approvalGate(card: ConversationAgentCard, action: ConversationAgentAction, editedText: string, now = Date.now()): { allowed: boolean; reason?: string } {
  if (card.state === 'closed') return { allowed: false, reason: 'This conversation is closed.' }
  if (card.state === 'stopped') return { allowed: false, reason: 'This contact is stopped.' }
  if (card.state === 'paused') return { allowed: false, reason: 'The agent is paused for this person.' }
  if (card.owner !== 'agent') return { allowed: false, reason: 'The agent does not own this conversation.' }
  if (card.mode !== 'review') return { allowed: false, reason: card.mode === 'shadow' ? 'Shadow mode records proposals but cannot approve them.' : 'This action is not awaiting manual review.' }
  if (action.blocked_reason) return { allowed: false, reason: plainHoldReason(action.blocked_reason) }
  if (action.status !== 'draft') return { allowed: false, reason: describeAction(action, now) }
  if (!['reply', 'react_message', 'react_post'].includes(action.kind)) return { allowed: false, reason: 'This decision has no outbound action to approve.' }
  if (action.expected_revision !== card.revision) return { allowed: false, reason: 'The conversation changed. Reload before approving.' }
  if (action.policy_version !== card.policy_version) return { allowed: false, reason: 'The reviewed policy changed. Wait for a fresh proposal.' }
  if (action.expires_at) {
    const expires = Date.parse(action.expires_at)
    if (Number.isNaN(expires) || expires <= now) return { allowed: false, reason: 'This proposal expired. Wait for a fresh proposal.' }
  }
  if (action.payload.kind === 'reply' && editedText !== action.payload.text) {
    return { allowed: false, reason: 'Save the edit to create a new approval hash.' }
  }
  return { allowed: true }
}

function when(iso: string | null): string {
  if (!iso) return 'No send time scheduled'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Send time unavailable'
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function describeAction(action: ConversationAgentAction, now = Date.now()): string {
  if (action.status === 'delivery_unknown') return 'Delivery is uncertain. Do not retry until provider history is reconciled.'
  if (action.status === 'sending') return 'A provider request is in flight. Pausing cannot recall it.'
  if (action.status === 'claimed') return 'Claimed for sending. No provider request is recorded yet.'
  if (action.status === 'sent') return 'Sent and confirmed by the provider.'
  if (action.status === 'cancelled') return 'Cancelled. It cannot be approved.'
  if (action.status === 'held') return plainHoldReason(action.blocked_reason ?? 'held for review')
  if (action.status === 'approved') return `Approved · due ${when(action.due_at)}`
  if (action.expires_at && Date.parse(action.expires_at) <= now) return 'Expired. Wait for a fresh proposal.'
  return `Due ${when(action.due_at)}`
}

export function ownerCopy(owner: ConversationAgentOwner): string {
  if (owner === 'agent') return 'Agent owns this'
  if (owner === 'human') return 'You own this'
  if (owner === 'booking') return 'Booking lane owns this'
  return 'Existing lane owns this'
}

export function modeCopy(mode: ConversationAgentMode): string {
  if (mode === 'review') return 'Review mode'
  if (mode === 'shadow') return 'Shadow mode'
  return 'Auto mode'
}
