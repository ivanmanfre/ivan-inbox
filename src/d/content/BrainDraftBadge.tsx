import { brainDraftSource, isBrainPost, type DraftSource } from '../../lib/brainDraft'
import './brain-draft.css'

export function BrainDraftBadge({ draft }: { draft: DraftSource }) {
  if (!isBrainPost(draft)) return null
  const source = brainDraftSource(draft)
  return <section className="cn-brain-draft" aria-label="Content brain source" data-brain-draft={true}>
    <div><b>Brain</b>{source.sourceUrl ? <a href={source.sourceUrl} target="_blank" rel="noreferrer" data-verb="open-brain-source" onClick={e => e.stopPropagation()}>Source post ↗</a> : <span>{source.sourceRef?.startsWith('pattern:') ? 'Pattern source' : 'Source link not recorded'}</span>}</div>
    <p><strong>Why this post:</strong> {source.why ?? 'Reason not recorded.'}</p>
    <p>{source.pattern ?? 'Pattern evidence not recorded.'}</p>
  </section>
}
