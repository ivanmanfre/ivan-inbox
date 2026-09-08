import { draftExplanationFreshness, normalizeDraftExplanation } from '../lib/draftExplanation'
import './DraftExplanation.css'

export function DraftExplanation({ messageId, messageText, editedText = messageText, evidence, unavailable, onRetry, pendingConfirmation = false, retryPending = false }: {
  messageId: string; messageText: string; editedText?: string; evidence?: unknown
  retryPending?: boolean; pendingConfirmation?: boolean; unavailable?: boolean; onRetry?: () => void
}) {
  const title = retryPending ? 'AI assessment · retry pending' : pendingConfirmation ? 'AI assessment · confirmation pending' : 'AI assessment of the generated draft'
  const explanation = normalizeDraftExplanation(evidence)
  const { theyMean, move, limits, unresolved, facts, sources, generatedText } = explanation
  const hasBrief = Boolean(theyMean || move || limits || unresolved.length)
  const freshness = draftExplanationFreshness(generatedText, messageText, editedText)
  if (unavailable) return (
    <section className="draft-explanation" data-draft-explanation={messageId} aria-label={title}>
      <p className="draft-explanation-note">Explanation could not be loaded.</p>
      {onRetry && <button type="button" className="draft-explanation-retry" onPointerDown={e => e.stopPropagation()} onClick={onRetry}>Try again</button>}
    </section>
  )
  return (
    <section className="draft-explanation" data-draft-explanation={messageId} aria-label={title}>
      <span className="draft-explanation-title">{title}</span>
      {hasBrief ? <>
        {theyMean && <p><b>Their message:</b> {theyMean}</p>}
        {move && <p><b>{(pendingConfirmation || retryPending) ? 'Next step:' : 'Suggested reply:'}</b> {move}</p>}
        {limits && <p><b>Limits:</b> {limits}</p>}
        {unresolved.length > 0 && <p><b>Still unclear:</b> {unresolved.join(' ')}</p>}
        {!pendingConfirmation && !retryPending && (freshness === 'edited'
          ? <p className="draft-explanation-note" role="status">The text has changed. This explanation describes the generated version.</p>
          : freshness === 'unknown'
            ? <p className="draft-explanation-note">Original text was not saved, so later edits cannot be checked.</p>
            : null)}
      </> : <p className="draft-explanation-note">{(pendingConfirmation || retryPending) ? 'No assessment was saved for this question.' : 'No explanation was saved for this draft.'}</p>}
      {(facts.length > 0 || sources.length > 0) && (
        <details className="draft-explanation-sources" onPointerDown={e => e.stopPropagation()}>
          <summary>Facts and sources</summary>
          {facts.map((fact, index) => <p key={index}>{fact}</p>)}
          {sources.length > 0 && <ul>{sources.map(source => (
            <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></li>
          ))}</ul>}
        </details>
      )}
    </section>
  )
}
