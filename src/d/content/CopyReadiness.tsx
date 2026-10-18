import type { QaCopyState } from '../../lib/contentReadiness'
import type { useDraftReadiness } from './useDraftReadiness'

export function CopyReadiness({ qa, source, loading, dirty = false }: ReturnType<typeof useDraftReadiness> & { dirty?: boolean }) {
  if (dirty) return <div className="cn-above" aria-label="Current copy checks">
    <p className="cn-dim"><strong>Unsaved copy needs recheck.</strong> Save the edit to read checks for these words.</p>
  </div>
  const note: Record<QaCopyState['state'], string> = {
    none: 'An editorial review has not been recorded.',
    unbound: 'The stored QA score is historical. It does not identify the exact words reviewed.',
    stale: 'The copy has changed since its editorial review. Recheck these words before publishing.',
    current: 'The editorial review matches this saved copy. Source and author approval are separate checks.',
    failed: 'The editorial reviewer requested changes to this copy.',
  }
  return <div className="cn-above" aria-label="Current copy checks">
    <p className={source.state === 'fail' ? 'cn-banner' : 'cn-dim'} role={source.state === 'fail' ? 'alert' : undefined}>
      <strong>{loading ? 'Reading current source checks…' : source.label}</strong>
      {!loading && source.reasons.length > 0 && <span> · {source.reasons.slice(0, 3).join(' ')}</span>}
    </p>
    <p className="cn-dim"><strong>{qa.label}.</strong> {note[qa.state]}</p>
  </div>
}
