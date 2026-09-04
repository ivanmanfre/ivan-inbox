import { useEffect, useState } from 'react'
import { classifyLink, unfurl, type LinkKind } from '../../../../../lib/unfurl'
import { linkCardFromResult, pendingLinkCard, type LinkCardModel } from '../../linkcards'

// GRAFTED FROM SKIN A (cycle 1, DECISIONS D11). A's link card won that state in
// all six pairs it appeared in, against both plain B and this skin: a 96x54
// thumbnail beside one ellipsised line is a list row wearing a picture. Here
// the thumbnail IS the card — full width of the composer plate, cropped to a
// 16:9 well with `object-fit:cover` so nothing letterboxes, a drawn play mark
// sitting ON the image where a video's does, and the whole title on up to two
// lines at prose size with the source under it.
//
// What is NOT grafted: the honest blocked state. A logged-out Instagram fetch
// gives nothing back, and this card says so in words rather than drawing an
// empty well (linkcards.ts owns that copy).

function PlayMark() {
  return (
    <svg className="bbf-play-g" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path d="M7.6 5.4l7.4 4.6-7.4 4.6z" fill="currentColor" />
    </svg>
  )
}

export function LinkPreview({ url }: { url: string }) {
  const kind: LinkKind = classifyLink(url)
  const [model, setModel] = useState<LinkCardModel>(pendingLinkCard(kind))

  useEffect(() => {
    let alive = true
    setModel(pendingLinkCard(kind))
    void unfurl(url).then(r => { if (alive) setModel(linkCardFromResult(kind, r)) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  // The gate's vocabulary, not this module's internal state names.
  const domState = model.state === 'ready' ? 'card' : model.state === 'failed' ? 'blocked' : 'loading'
  const hasImage = model.state === 'ready' && !!model.image

  return (
    <div
      className={`bb-link bbf-link${model.state === 'failed' ? ' failed' : ''}${hasImage ? ' has-img' : ''}`}
      data-link-card data-kind={kind} data-state={domState}
    >
      {hasImage && (
        <div className={`bbf-link-well${model.aspect === 'square' ? ' sq' : ''}`}>
          <img className="bb-link-img bbf-link-img" src={model.image ?? undefined} alt="" />
          {kind === 'youtube' && <span className="bbf-link-play"><PlayMark /></span>}
        </div>
      )}
      <div className="bb-link-body bbf-link-body">
        <span className="bb-link-title bbf-link-title">
          {model.state === 'loading' ? 'Loading preview' : model.title}
        </span>
        {model.state === 'ready' && model.sub && (
          <span className="bb-link-sub bbf-link-sub">{model.sub}</span>
        )}
      </div>
    </div>
  )
}
