// LinkPreviewCard.tsx - the one preview component rendered in two places:
// under the composer while a link is being typed, and inside a sent turn's
// bubble. Same component, same data, so what you preview is what you sent.
import { useEffect, useState } from 'react'
import { unfurl, classifyLink, type UnfurlResult } from '../../../lib/unfurl'
import { mapLinkPreview, type LinkCard } from './linkPreview'

export function LinkPreviewCard({ url }: { url: string }) {
  const [result, setResult] = useState<UnfurlResult | null>(null)
  useEffect(() => {
    let alive = true
    setResult(null)
    void unfurl(url).then(r => { if (alive) setResult(r) })
    return () => { alive = false }
  }, [url])

  const guessKind = classifyLink(url)

  // While the fetch is out there is no picture and no title to show, so the
  // loading state is ONE line. Reserving a 16:9 rectangle for a thumbnail that
  // has not arrived reads as a broken card rather than a pending one.
  if (!result) {
    return (
      <div className="ba-link loading" data-link-card data-kind={guessKind} data-state="loading">
        <div className="ba-link-body">
          <div className="ba-link-title muted">Reading the link</div>
          <div className="ba-link-sub">{url}</div>
        </div>
      </div>
    )
  }

  const card: LinkCard = mapLinkPreview(result)
  if (!card.ok) {
    return (
      <div className="ba-link blocked" data-link-card data-kind={card.kind} data-state="blocked">
        <div className="ba-link-body">
          {/* The honest state, never the URL dressed up as a title. */}
          <div className="ba-link-title muted">{card.message}</div>
          <div className="ba-link-sub">{url}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="ba-link" data-link-card data-kind={card.kind} data-state="card">
      {card.image && (
        <div
          className="ba-link-img" data-thumb
          role="img" aria-label={card.title}
          style={{ backgroundImage: `url(${card.image})` }}
        />
      )}
      <div className="ba-link-body">
        <div className="ba-link-title">{card.title}</div>
        {card.sub && <div className="ba-link-sub">{card.sub}</div>}
      </div>
    </div>
  )
}
