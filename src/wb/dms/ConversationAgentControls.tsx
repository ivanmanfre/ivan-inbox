import { useEffect, useState } from 'react'
import { Banner, Button, Chip, Icon, Textarea } from '../../ds'
import { useConfirm } from '../chrome/ConfirmSheet'
import {
  actionForCard, approvalGate, approveConversationAgentAction, controlConversationAgent,
  CONVERSATION_AGENT_POLICY_VERSION, describeAction, editConversationAgentAction,
  historicalHeldActions, modeCopy, ownerCopy, plainHoldReason,
  type ConversationAgentCard, type ConversationAgentCommand,
} from './conversationAgentData'
import { wbHash } from '../../exp/v2c/route'

export function ConversationAgentControls({ card, onChanged, now = Date.now() }: {
  card: ConversationAgentCard
  onChanged: () => void | Promise<void>
  now?: number
}) {
  const confirm = useConfirm()
  const action = actionForCard(card)
  const earlierHolds = historicalHeldActions(card, action?.id)
  const originalText = action?.payload.kind === 'reply' ? action.payload.text : ''
  const [text, setText] = useState(originalText)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => { setText(originalText) }, [action?.id, originalText])

  async function run(name: string, fn: () => Promise<unknown>, success: string) {
    if (busy) return
    setBusy(name); setError(null); setDone(null)
    try {
      await fn()
      setDone(success)
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That change could not be verified.')
    } finally {
      setBusy(null)
    }
  }

  async function control(command: ConversationAgentCommand, label: string) {
    if (command === 'stop') {
      const ok = await confirm({
        title: `Stop contact with ${card.prospect_name}?`,
        message: 'Future agent and existing-lane work stays suppressed until an explicit handback. A provider request already in flight cannot be recalled.',
        confirmText: 'Stop contact', danger: true,
      })
      if (!ok) return
    }
    await run(command, () => controlConversationAgent(card.thread_id, command, card.revision), label)
  }

  const gate = action ? approvalGate(card, action, text, now) : { allowed: false, reason: 'No action is waiting.' }
  const inFlight = action?.status === 'sending'
  const unknown = action?.status === 'delivery_unknown'
  const stopped = card.state === 'stopped' || card.state === 'closed'

  return (
    <section className="a-agent" aria-label={`Conversation agent for ${card.prospect_name}`} data-state={card.state}>
      <div className="a-agent-head">
        <div className="a-agent-title"><Icon name="wand" size={16} />Conversation agent</div>
        <div className="a-agent-chips">
          <Chip tone={card.owner === 'agent' ? 'accent' : 'quiet'}>{ownerCopy(card.owner)}</Chip>
          <Chip tone="quiet">{modeCopy(card.mode)}</Chip>
        </div>
      </div>

      {card.latest_inbound && (
        <div className="a-agent-inbound">
          <div className="a-agent-label">Latest inbound</div>
          <blockquote>{card.latest_inbound.text}</blockquote>
        </div>
      )}

      {action ? (
        <div className="a-agent-action" data-kind={action.kind} data-status={action.status}>
          <div className="a-agent-actionhead">
            <span className="a-agent-label">{actionLabel(action.kind)}</span>
            <span className="a-meta">{describeAction(action, now)}</span>
          </div>

          {action.payload.kind === 'reply' && (
            <>
              {action.payload.quote_id && (
                <div className="a-agent-target"><Icon name="reply" size={16} />Quoted reply to <span className="a-mono">{action.payload.quote_id}</span></div>
              )}
              <Textarea
                label="Proposed reply"
                value={text}
                maxLength={400}
                rows={4}
                disabled={action.status !== 'draft'}
                onChange={e => setText(e.target.value)}
                hint={text !== originalText ? 'Unsaved edit. Save it before approval.' : `${text.length}/400 characters`}
              />
            </>
          )}

          {(action.payload.kind === 'react_message' || action.payload.kind === 'react_post') && (
            <div className="a-agent-reaction">
              <div className="a-agent-target">
                <Icon name="like" size={16} />
                {action.payload.kind === 'react_post' ? 'Post' : 'Message'} <span className="a-mono">{action.payload.target_id}</span>
              </div>
              <div><span className="a-agent-label">Reaction</span> <strong>{action.payload.reaction}</strong></div>
            </div>
          )}

          {(action.payload.kind === 'wait' || action.payload.kind === 'handoff' || action.payload.kind === 'close') && (
            <p className="a-agent-decision">{action.payload.reason}</p>
          )}

          {action.source_snippets.length > 0 && (
            <details className="a-agent-evidence">
              <summary>Evidence · {action.source_snippets.length}</summary>
              {action.source_snippets.map(source => (
                <div key={`${action.id}-${source.id}`} className="a-agent-source">
                  <span className="a-agent-label">{source.label}</span>
                  <p>{source.snippet}</p>
                </div>
              ))}
            </details>
          )}

          {action.blocked_reason && action.status !== 'delivery_unknown' && (
            <Banner tone="attention" icon="guard">{plainHoldReason(action.blocked_reason)}</Banner>
          )}
          {inFlight && <Banner tone="urgent" icon="alert">A provider request is in flight. A pause cannot recall it.</Banner>}
          {unknown && <Banner tone="urgent" icon="alert">Delivery is uncertain. Do not retry until provider history is reconciled.</Banner>}

          {action.payload.kind === 'reply' && text !== originalText && action.status === 'draft' && (
            <div className="a-agent-editrow">
              <Button
                variant="outline" size="sm" icon="edit" busy={busy === 'edit'}
                disabled={!text.trim() || text.length > 400}
                onClick={() => void run('edit', () => editConversationAgentAction(action.id, card.revision, text), 'Edit saved. Approval reset.')}
              >Save edit</Button>
            </div>
          )}

          {gate.allowed && (
            <div className="a-agent-primary">
              <Button
                variant="primary" size="sm" icon="approve" busy={busy === 'approve'}
                onClick={() => void run('approve', () => approveConversationAgentAction(action.id, card.revision, action.payload_hash), 'Action approved for dispatch.')}
              >Approve this action</Button>
            </div>
          )}
          {!gate.allowed && gate.reason && !action.blocked_reason && !unknown && !inFlight && (
            <div className="a-meta a-agent-gate">{gate.reason}</div>
          )}
        </div>
      ) : (
        <div className="a-meta a-agent-empty">No agent action is waiting.</div>
      )}

      {earlierHolds.length > 0 && (
        <details className="a-agent-history">
          <summary>Earlier holds · {earlierHolds.length}</summary>
          <div className="a-agent-historylist">
            {earlierHolds.map(held => (
              <div className="a-agent-hold" key={held.id}>
                <span className="a-agent-label">{actionLabel(held.kind)}</span>
                <span className="a-meta">{describeAction(held, now)}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {card.pause_reason && <Banner tone="attention" icon="pause">{plainHoldReason(card.pause_reason)}</Banner>}
      {error && <Banner tone="urgent" icon="error">{error}</Banner>}
      {done && !error && <div className="a-meta a-agent-done" aria-live="polite"><Icon name="check" size={16} />{done}</div>}

      <details className="a-agent-operators">
        <summary>Agent controls</summary>
        <div className="a-agent-controls">
          {card.owner === 'agent' && card.state === 'active' && (
            <Button variant="outline" size="sm" icon="pause" busy={busy === 'pause'} onClick={() => void control('pause', 'Agent paused.')}>Pause agent</Button>
          )}
          {card.owner === 'agent' && card.state === 'paused' && (
            <Button variant="outline" size="sm" icon="play" busy={busy === 'resume'} onClick={() => void control('resume', 'Agent resumed under the current policy.')}>Resume agent</Button>
          )}
          {card.owner === 'agent' && !stopped && (
            <Button variant="outline" size="sm" icon="person" busy={busy === 'takeover'} onClick={() => void control('takeover', 'You now own this conversation.')}>Take over</Button>
          )}
          {card.owner === 'human' && !stopped && (
            <Button variant="outline" size="sm" icon="swap" busy={busy === 'handback'} onClick={() => void control('handback', 'Handed back under the current policy.')}>Hand back to agent</Button>
          )}
          {!stopped && (
            <Button variant="danger" size="sm" icon="stop" busy={busy === 'stop'} onClick={() => void control('stop', 'Contact stopped.')}>Stop contact</Button>
          )}
          <Button variant="quiet" size="sm" icon="lock" disabled title="Requires server-confirmed release gates">Auto enrollment</Button>
          <span className="a-meta">Auto remains unavailable until the server confirms the reviewed release gates.</span>
        </div>
      </details>
    </section>
  )
}

export function ConversationAgentEnrollment() {
  return (
    <section className="a-agent-enroll" aria-label="Conversation agent enrollment">
      <div className="a-agent-enrollhead">
        <div>
          <div className="a-agent-title"><Icon name="wand" size={16} />Conversation agent</div>
          <div className="a-meta">Reviewed policy · {CONVERSATION_AGENT_POLICY_VERSION}</div>
        </div>
        <Chip tone="quiet">Not enrolled</Chip>
      </div>
      <div className="a-agent-enrollcopy a-meta">
        Qualified viewer openers are reviewed in Ops. If a proposal is present, use Approve takeover. Sending stays held until approval.
      </div>
      <div className="a-agent-enrollactions">
        <a className="a-link" href={wbHash('ops', null)}>Open Ops</a>
      </div>
    </section>
  )
}

function actionLabel(kind: string): string {
  if (kind === 'reply') return 'Proposed response'
  if (kind === 'react_message') return 'Proposed message reaction'
  if (kind === 'react_post') return 'Proposed post reaction'
  if (kind === 'handoff') return 'Human handoff'
  if (kind === 'close') return 'Close'
  return 'Wait'
}
