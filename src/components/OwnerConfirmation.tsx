import { confirmationOwner, isReplyRetryPending, type InboxMessage } from '../lib/inbox'
import { DraftExplanation } from './DraftExplanation'
import './OwnerConfirmation.css'

export function ConfirmationNoteGuidance({ clientId }: { clientId: string }) {
  return <p className="owner-confirmation-guidance">After checking with {confirmationOwner(clientId)}, add a new line beginning <b>Confirmed by {confirmationOwner(clientId)}:</b> followed by their confirmed answer. Keep existing notes. Save the note for reassessment on the next draft cycle, usually within 5 minutes. A new draft will still need approval.</p>
}

export function OwnerConfirmation({ message, onAddNote, onRetry }: {
  message: InboxMessage; onAddNote: () => void; onRetry?: () => void
}) {
  if (isReplyRetryPending(message)) {
    const retryAt = message.draft_evidence?.retry_after
    const validRetryAt = typeof retryAt === 'string' && Number.isFinite(Date.parse(retryAt))
    return <section className="owner-confirmation" aria-label="Automatic draft retry">
      <strong>Waiting for automatic retry</strong>
      <p>A temporary drafting problem paused this reply. The drafter will try again automatically; no owner confirmation is needed.</p>
      {validRetryAt && <p className="draft-explanation-note">Next attempt from <time dateTime={retryAt}>{new Date(retryAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>.</p>}
      <p className="draft-explanation-note">No reply is queued. A completed draft will still need approval.</p>
      <DraftExplanation retryPending messageId={message.id} messageText="" evidence={message.draft_evidence} unavailable={message.draft_evidence_unavailable} onRetry={onRetry} />
    </section>
  }
  return <section className="owner-confirmation" aria-label="Internal owner confirmation">
    <strong>Confirm with {confirmationOwner(message.client_id)}</strong>
    <p>{message.context_gap?.question || 'An answer needs confirmation before a reply can be drafted.'}</p>
    {message.context_gap?.why && <p className="draft-explanation-note">{message.context_gap.why}</p>}
    <p className="draft-explanation-note">Internal question · no reply is queued.</p>
    <DraftExplanation pendingConfirmation messageId={message.id} messageText="" evidence={message.draft_evidence} unavailable={message.draft_evidence_unavailable} onRetry={onRetry} />
    <button type="button" className="draft-explanation-retry" onClick={onAddNote}>Add confirmed answer in your note</button>
  </section>
}
