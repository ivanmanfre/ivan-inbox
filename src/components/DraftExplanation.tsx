import { draftExplanationFreshness, normalizeDraftExplanation } from '../lib/draftExplanation'
import './DraftExplanation.css'

export function DraftExplanation({ messageId, messageText, editedText = messageText, evidence, unavailable, onRetry }: {
  messageId: string; messageText: string; editedText?: string; evidence?: unknown
  unavailable?: boolean; onRetry?: () => void
}) {
  const explanation = normalizeDraftExplanation(evidence)
  const { theyMean, move, limits, unresolved, facts, sources, generatedText } = explanation
  const hasBrief = Boolean(theyMean || move || limits || unresolved.length)
  const freshness = draftExplanationFreshness(generatedText, messageText, editedText)
  if (unavailable) return (
    <section className="draft-explanation" data-draft-explanation={messageId} aria-label="AI assessment of the generated draft">
      <p className="draft-explanation-note">Explanation could not be loaded.</p>
      {onRetry && <button type="button" className="draft-explanation-retry" onPointerDown={e => e.stopPropagation()} onClick={onRetry}>Try again</button>}
    </section>
  )
  return (
    <section className="draft-explanation" data-draft-explanation={messageId} aria-label="AI assessment of the generated draft">
      <span className="draft-explanation-title">AI assessment of the generated draft</span>
      {hasBrief ? <>
        {theyMean && <p><b>Their message:</b> {theyMean}</p>}
        {move && <p><b>Suggested reply:</b> {move}</p>}
        {limits && <p><b>Limits:</b> {limits}</p>}
        {unresolved.length > 0 && <p><b>Still unclear:</b> {unresolved.join(' ')}</p>}
        {freshness === 'edited'
          ? <p className="draft-explanation-note" role="status">The text has changed. This explanation describes the generated version.</p>
          : freshness === 'unknown'
            ? <p className="draft-explanation-note">Original text was not saved, so later edits cannot be checked.</p>
            : null}
      </> : <p className="draft-explanation-note">No explanation was saved for this draft.</p>}
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
