// A draft's explanation, as today's DraftExplanation (src/components/DraftExplanation.tsx): their
// message, the suggested reply, Limits (always shown), still unclear, the "text has changed"
// freshness note, the explanation's own Facts and sources, and Try again when it could not load.
// Used for the main draft, the companion leg and the email mirror. Display projection only
// (normalizeDraftExplanation); never raw reasoning.
import { useState } from 'react'
import { draftExplanationFreshness, normalizeDraftExplanation } from '../../lib/draftExplanation'

export function Explain({ messageId, messageText, editedText = messageText, evidence, unavailable, onRetry, by, inset, v4 = false }: {
  messageId: string; messageText: string; editedText?: string; evidence?: unknown; unavailable?: boolean
  onRetry?: () => void; by?: string; inset?: boolean
  /** Brief 4: the rationale folds behind "Why this draft"; Limits, Still unclear and an edited-text warning stay visible. */
  v4?: boolean
}) {
  // Above every return (09-09 rule): the v4 disclosure (a port of Brief 3.0's injected toggle).
  const [open, setOpen] = useState(false)
  const title = `Why this draft${by ? ` · written by ${by}` : ''}`
  if (unavailable) {
    return (
      <section className={`dm-exp${inset ? ' dm-exp-in' : ''}`} data-draft-explanation={messageId} aria-label={title}>
        <small className="dm-lbl">{title}</small>
        <p>Explanation could not be loaded.</p>
        {onRetry && <span><button type="button" className="d-btn" data-verb="explain-retry" onClick={onRetry}>Try again</button></span>}
      </section>
    )
  }
  const x = normalizeDraftExplanation(evidence)
  const brief = Boolean(x.theyMean || x.move || x.limits || x.unresolved.length)
  const fresh = draftExplanationFreshness(x.generatedText, messageText, editedText)
  if (v4) {
    const rationale = Boolean(x.theyMean || x.move)
    const facts = x.facts.length > 0 || x.sources.length > 0
    const freshLine = !brief ? null : fresh === 'edited' ? <p className="dm-meta" role="status">The text has changed. This explanation describes the generated version.</p>
      : fresh === 'unknown' && open ? <p className="dm-meta">Original text was not saved, so later edits cannot be checked.</p> : null
    // "No explanation was saved" collapses to nothing (3.0's brief-empty-explanation); the node stays.
    if (!brief && !facts) return <section className={`dm-exp dx-exp${inset ? ' dm-exp-in' : ''}`} data-draft-explanation={messageId} aria-label={title} hidden><p>No explanation was saved for this draft.</p></section>
    return (
      <section className={`dm-exp dx-exp${inset ? ' dm-exp-in' : ''}${open ? ' dx-open' : ''}`} data-draft-explanation={messageId} aria-label={title}>
        {rationale || facts
          ? <button type="button" className="dx-disc" aria-expanded={open} data-verb="why-draft" onClick={() => setOpen(o => !o)}><span>{title}</span><i aria-hidden="true">⌄</i></button>
          : <small className="dm-lbl">{title}</small>}
        {open && x.theyMean && <p><b>Their message:</b> {x.theyMean}</p>}
        {open && x.move && <p><b>Suggested reply:</b> {x.move}</p>}
        {x.limits && <p><b>Limits:</b> {x.limits}</p>}
        {x.unresolved.length > 0 && <p><b>Still unclear:</b> {x.unresolved.join(' ')}</p>}
        {freshLine}
        {open && facts && (
          <details>
            <summary>Facts and sources</summary>
            {x.facts.map((f, i) => <p key={i}>{f}</p>)}
            {x.sources.map(s => <p key={s.url}><a className="d-link" href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a></p>)}
          </details>
        )}
      </section>
    )
  }
  return (
    <section className={`dm-exp${inset ? ' dm-exp-in' : ''}`} data-draft-explanation={messageId} aria-label={title}>
      <small className="dm-lbl">{title}</small>
      {brief ? <>
        {x.theyMean && <p><b>Their message:</b> {x.theyMean}</p>}
        {x.move && <p><b>Suggested reply:</b> {x.move}</p>}
        {x.limits && <p><b>Limits:</b> {x.limits}</p>}
        {x.unresolved.length > 0 && <p><b>Still unclear:</b> {x.unresolved.join(' ')}</p>}
        {fresh === 'edited' ? <p className="dm-meta" role="status">The text has changed. This explanation describes the generated version.</p>
          : fresh === 'unknown' ? <p className="dm-meta">Original text was not saved, so later edits cannot be checked.</p> : null}
      </> : <p>No explanation was saved for this draft.</p>}
      {(x.facts.length > 0 || x.sources.length > 0) && (
        <details>
          <summary>Facts and sources</summary>
          {x.facts.map((f, i) => <p key={i}>{f}</p>)}
          {x.sources.map(s => <p key={s.url}><a className="d-link" href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a></p>)}
        </details>
      )}
    </section>
  )
}
