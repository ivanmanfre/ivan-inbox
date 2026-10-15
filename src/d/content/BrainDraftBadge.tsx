import { brainDraftSource, isBrainPost, type DraftSource } from '../../lib/brainDraft'
import './brain-draft.css'

export function BrainDraftBadge({ draft }: { draft: DraftSource }) {
  if (!isBrainPost(draft)) return null
  const source = brainDraftSource(draft)
  return <section className="cn-brain-draft" aria-label="Content brain source" data-brain-draft={true}>
    <div><b>{source.isOutlier ? 'Repurposed outlier' : 'Brain'}</b>{source.isOutlier && <span>{source.sourceAuthor ? `From ${source.sourceAuthor}` : 'Author not recorded'}</span>}{source.sourceUrl ? <a href={source.sourceUrl} target="_blank" rel="noreferrer" data-verb="open-brain-source" onClick={e => e.stopPropagation()}>{source.isOutlier ? 'Original post ↗' : 'Source post ↗'}</a> : <span>{source.sourceRef?.startsWith('pattern:') ? 'Pattern source' : 'Source link not recorded'}</span>}</div>
    <p><strong>Why this post:</strong> {source.why ?? 'Reason not recorded.'}</p>
    {source.pattern && <p>{source.pattern}</p>}
  </section>
}
