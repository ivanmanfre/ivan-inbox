// The conversation agent, in D. Every control today's ConversationAgentControls carries, on the
// same RPCs (wb/dms/conversationAgentData): Pause, Resume, Take over, Hand back, Stop contact
// (danger confirm), Approve the proposed action (confirm), edit the proposed reply + Save edit,
// evidence, the in-flight / delivery-unknown / hold lines, earlier holds, and the enrollment
// pointer (Ops). Nothing here writes outside those four RPCs.
import { useEffect, useState } from 'react'
import {
  actionForCard, approvalGate, approveConversationAgentAction, controlConversationAgent,
  CONVERSATION_AGENT_POLICY_VERSION, describeAction, editConversationAgentAction,
  historicalHeldActions, modeCopy, ownerCopy, plainHoldReason,
  type ConversationAgentCard, type ConversationAgentCommand,
} from '../../wb/dms/conversationAgentData'
import { dHash } from '../route'
import { useDConfirm } from '../ui/confirm'
import { Btn } from '../ui/Key'

function actionLabel(kind: string): string {
  if (kind === 'reply') return 'Proposed response'
  if (kind === 'react_message') return 'Proposed message reaction'
  if (kind === 'react_post') return 'Proposed post reaction'
  if (kind === 'handoff') return 'Human handoff'
  if (kind === 'close') return 'Close'
  return 'Wait'
}

export function AgentPanel({ card, onChanged, now = Date.now() }: { card: ConversationAgentCard; onChanged: () => void | Promise<void>; now?: number }) {
  const confirm = useDConfirm()
  const action = actionForCard(card)
  const earlier = historicalHeldActions(card, action?.id)
  const original = action?.payload.kind === 'reply' ? action.payload.text : ''
  const [text, setText] = useState(original)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  useEffect(() => { setText(original) }, [action?.id, original])

  async function run(name: string, fn: () => Promise<unknown>, success: string) {
    if (busy) return
    setBusy(name); setError(null); setDone(null)
    try { await fn(); setDone(success); await onChanged() }
    catch (e) { setError(e instanceof Error ? e.message : 'That change could not be verified.') }
    finally { setBusy(null) }
  }

  async function control(command: ConversationAgentCommand, label: string) {
    if (command === 'stop') {
      const ok = await confirm({
        title: `Stop contact with ${card.prospect_name}?`,
        message: 'Future agent and existing-lane work stays suppressed until an explicit handback. A provider request already in flight cannot be recalled.',
        confirmText: 'Stop contact', verb: 'confirm-agent-stop', danger: true,
      })
      if (!ok) return
    }
    await run(command, () => controlConversationAgent(card.thread_id, command, card.revision), label)
  }

  async function approve() {
    if (!action) return
    const what = action.payload.kind === 'reply' ? 'This reply goes out to them'
      : action.payload.kind === 'react_message' || action.payload.kind === 'react_post' ? `This reaction (${action.payload.reaction}) goes out`
        : 'This action runs'
    const ok = await confirm({
      title: `Approve for ${card.prospect_name}?`,
      message: `${what} from the seat within a few minutes. It cannot be recalled once it is sent.`,
      confirmText: 'Approve and send', verb: 'confirm-agent-approve',
    })
    if (!ok) return
    await run('approve', () => approveConversationAgentAction(action.id, card.revision, action.payload_hash), 'Action approved for dispatch.')
  }

  const gate = action ? approvalGate(card, action, text, now) : { allowed: false, reason: 'No action is waiting.' }
  const inFlight = action?.status === 'sending'
  const unknown = action?.status === 'delivery_unknown'
  const stopped = card.state === 'stopped' || card.state === 'closed'

  return (
    <section className="dm-agent" aria-label={`Conversation agent for ${card.prospect_name}`} data-state={card.state}>
      <div className="dm-agent-h"><b>Conversation agent</b><span>{ownerCopy(card.owner)} · {modeCopy(card.mode)} · {card.state}</span></div>
      {card.latest_inbound && <><small className="dm-lbl">Latest inbound</small><blockquote className="dm-quote">{card.latest_inbound.text}</blockquote></>}
      {action ? (
        <div className="dm-agent-a" data-kind={action.kind} data-status={action.status}>
          <div className="dm-agent-h"><small className="dm-lbl">{actionLabel(action.kind)}</small><span>{describeAction(action, now)}</span></div>
          {action.payload.kind === 'reply' && <>
            {action.payload.quote_id && <p className="dm-meta">Quoted reply to {action.payload.quote_id}</p>}
            <label className="dm-field"><span>Proposed reply</span>
              <textarea value={text} maxLength={400} rows={4} disabled={action.status !== 'draft'} onChange={e => setText(e.target.value)} />
              <small>{text !== original ? 'Unsaved edit. Save it before approval.' : `${text.length}/400 characters`}</small>
            </label>
          </>}
          {(action.payload.kind === 'react_message' || action.payload.kind === 'react_post') && (
            <p>{action.payload.kind === 'react_post' ? 'Post' : 'Message'} {action.payload.target_id} · reaction <b>{action.payload.reaction}</b></p>
          )}
          {(action.payload.kind === 'wait' || action.payload.kind === 'handoff' || action.payload.kind === 'close') && <p>{action.payload.reason}</p>}
          {action.source_snippets.length > 0 && (
            <details className="dm-agent-ev"><summary>Evidence · {action.source_snippets.length}</summary>
              {action.source_snippets.map(s => <p key={`${action.id}-${s.id}`}><small className="dm-lbl">{s.label}</small> {s.snippet}</p>)}
            </details>
          )}
          {action.blocked_reason && !unknown && <p className="dm-warn">{plainHoldReason(action.blocked_reason)}</p>}
          {inFlight && <p className="dm-warn">A provider request is in flight. A pause cannot recall it.</p>}
          {unknown && <p className="dm-warn">Delivery is uncertain. Do not retry until provider history is reconciled.</p>}
          <div className="dm-ban-row">
            {action.payload.kind === 'reply' && text !== original && action.status === 'draft' && (
              <Btn verb="agent-edit" disabled={Boolean(busy) || !text.trim() || text.length > 400}
                onClick={() => void run('edit', () => editConversationAgentAction(action.id, card.revision, text), 'Edit saved. Approval reset.')}>{busy === 'edit' ? 'Saving…' : 'Save edit'}</Btn>
            )}
            {gate.allowed && <Btn primary verb="agent-approve" disabled={Boolean(busy)} onClick={() => void approve()}>{busy === 'approve' ? 'Approving…' : 'Approve this action'}</Btn>}
          </div>
          {!gate.allowed && gate.reason && !action.blocked_reason && !unknown && !inFlight && <p className="dm-meta">{gate.reason}</p>}
        </div>
      ) : <p className="dm-meta">No agent action is waiting.</p>}
      {earlier.length > 0 && (
        <details className="dm-agent-ev"><summary>Earlier holds · {earlier.length}</summary>
          {earlier.map(h => <p key={h.id}><small className="dm-lbl">{actionLabel(h.kind)}</small> {describeAction(h, now)}</p>)}
        </details>
      )}
      {card.pause_reason && <p className="dm-warn">{plainHoldReason(card.pause_reason)}</p>}
      {error && <p className="dm-warn" role="alert">{error}</p>}
      {done && !error && <p className="dm-meta" aria-live="polite">{done}</p>}
      <div className="dm-ban-row dm-agent-k">
        {card.owner === 'agent' && card.state === 'active' && <Btn verb="agent-pause" disabled={Boolean(busy)} onClick={() => void control('pause', 'Agent paused.')}>Pause agent</Btn>}
        {card.owner === 'agent' && card.state === 'paused' && <Btn verb="agent-resume" disabled={Boolean(busy)} onClick={() => void control('resume', 'Agent resumed under the current policy.')}>Resume agent</Btn>}
        {card.owner === 'agent' && !stopped && <Btn verb="agent-takeover" disabled={Boolean(busy)} onClick={() => void control('takeover', 'You now own this conversation.')}>Take over</Btn>}
        {card.owner === 'human' && !stopped && <Btn verb="agent-handback" disabled={Boolean(busy)} onClick={() => void control('handback', 'Handed back under the current policy.')}>Hand back to agent</Btn>}
        {!stopped && <Btn danger verb="agent-stop" disabled={Boolean(busy)} onClick={() => void control('stop', 'Contact stopped.')}>Stop contact</Btn>}
      </div>
      <p className="dm-meta">Auto enrollment stays unavailable until the server confirms the reviewed release gates.</p>
    </section>
  )
}

/** Today's enrollment pointer: viewers without an agent card are enrolled from Ops. */
export function AgentEnrollment() {
  return (
    <section className="dm-agent" aria-label="Conversation agent enrollment">
      <div className="dm-agent-h"><b>Conversation agent</b><span>Not enrolled · {CONVERSATION_AGENT_POLICY_VERSION}</span></div>
      <p className="dm-meta">Qualified viewer openers are reviewed in Ops. If a proposal is present, use Approve takeover. Sending stays held until approval.</p>
      <a className="d-link" href={dHash('ops')}>Open Ops</a>
    </section>
  )
}
