import { outlierSource, type OutlierSource } from '../../lib/cb22'
import type { IdeaItem } from './ideaModel'
import './inputs/inputs.css'

// "Content brain · Outlier" (CB-22): shown on every idea that came from an outlier, i.e. a "Use this" tap
// (source_ref outlier:<platform>:<id>) or the weekly promotion (cb22:<platform>:<id>). Drawn from source_ref
// only, so no other source can get it. Platform + author + lift + a link to the original post.
export function ideaOutlierSource(it: IdeaItem): OutlierSource | null {
  if (it.ivan) return outlierSource(it.ivan.source_ref, { evidence: it.ivan.evidence })
  if (it.client) return outlierSource(it.client.source_ref, { breakdown: it.client.score_breakdown })
  return null
}

export function SourceBadge({ src }: { src: OutlierSource | null }) {
  if (!src) return null
  const plat = src.platform === 'x' ? 'X' : 'LinkedIn'
  return (
    <a className="cb-badge" href={src.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
      data-source-badge="cb-outlier" data-badge-kind={src.kind} data-badge-platform={src.platform}
      data-badge-author={src.author ?? ''} data-badge-lift={src.lift ?? ''} data-verb="open-source-post"
      title={src.kind === 'promoted' ? 'Promoted by the weekly outlier run' : 'Picked with Use this'}>
      <b>Content brain · Outlier</b>
      <span>{plat}{src.author ? ` · ${src.author}` : ''}{src.lift != null ? ` · ${Math.round(src.lift * 10) / 10}×` : ''} ↗</span>
    </a>
  )
}
