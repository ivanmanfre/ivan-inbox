/* ==========================================================================
   The one state marker every evidence view carries, in every one of its five
   states. A checker (or a person) can find `[data-testid="reader-state"]`
   and read `data-state` off it without parsing prose — and `failed` renders
   visibly differently from `empty` (a distinct label and a distinct tone),
   because a read that never happened and a read that came back with nothing
   are different facts and must never look the same on screen.
   ========================================================================== */
import type { ViewState } from '../../../lib/contentEvidence'

const STATE_LABEL: Record<ViewState, string> = {
  ready: 'Ready',
  partial: 'Partial coverage',
  empty: 'Empty',
  stale: 'Stale',
  failed: 'Failed to load',
}

export function ReaderStateTag({ state }: { state: ViewState }) {
  return (
    <span data-testid="reader-state" data-state={state} className="a-cev-state-tag">
      {STATE_LABEL[state]}
    </span>
  )
}

/** Audit fix pass (PRELEASE-AUDIT.md, "raw PostgREST messages ... must not
    reach the failed banner"): the VISIBLE line on a failed read is always
    this plain sentence, never the raw message a PostgREST/RPC error carries
    ("unknown seat", a constraint name, a stack fragment). The technical text
    sits behind a collapsed "Details" control instead — present for whoever
    is debugging the read, never the first thing a person sees. */
export const FAILED_MESSAGE = 'The evidence read failed.'

export function FailedDetails({ message }: { message?: string | null }) {
  if (!message) return null
  return (
    <details className="a-prop-history">
      <summary>Details</summary>
      <div className="a-prop-v a-mono">{message}</div>
    </details>
  )
}
