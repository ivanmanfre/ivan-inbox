import { useEffect, useState } from 'react'
import { unfurl } from '../../../lib/unfurl'
import { mapLinkPreview, type LinkCardModel } from './linkpreview'

// One card, three states: loading (asked the broker, waiting), blocked (the
// broker answered ok:false — an honest miss, never the raw URL standing in for
// a title) and a real card. Used both live in the composer, while a link is
// being typed, and frozen inside a sent turn.
export function LinkPreviewCard({ url }: { url: string }) {
  const [model, setModel] = useState<LinkCardModel | null>(null)

  useEffect(() => {
    let alive = true
    setModel(null)
    void unfurl(url).then(r => { if (alive) setModel(mapLinkPreview(r)) })
    return () => { alive = false }
  }, [url])

  if (!model) {
    return (
      <div className="brc-link" data-link-card data-kind="og" data-state="loading">
        <div className="brc-link-sk" />
        <div className="brc-link-b">
          <div className="brc-link-t">Looking up the link…</div>
        </div>
      </div>
    )
  }

  if (model.kind === 'blocked') {
    return (
      <div className="brc-link brc-link-blocked" data-link-card data-kind="og" data-state="blocked">
        <div className="brc-link-b">
          <div className="brc-link-t">{model.title}</div>
        </div>
      </div>
    )
  }

  return (
    <div className={`brc-link brc-link-${model.kind}`} data-link-card data-kind={model.kind} data-state="card">
      {model.image && (
        <div className={`brc-link-img${model.ratio === '16:9' ? ' r169' : model.ratio === 'square' ? ' rsq' : ''}`}>
          <img src={model.image} alt="" loading="lazy" />
        </div>
      )}
      <div className="brc-link-b">
        <div className="brc-link-t">{model.title}</div>
        {model.subtitle && <div className="brc-link-s">{model.subtitle}</div>}
      </div>
    </div>
  )
}
