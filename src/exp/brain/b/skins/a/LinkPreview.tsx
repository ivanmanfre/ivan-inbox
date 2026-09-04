import { useEffect, useState } from 'react'
import { classifyLink, unfurl, type LinkKind } from '../../../../../lib/unfurl'
import { linkCardFromResult, pendingLinkCard, type LinkCardModel } from '../../linkcards'
import { Glyph } from './icons'

// The same component and the same cache as plain B; what changes is the FORM.
// A 64x36 thumbnail beside two truncated lines is a list row wearing a picture.
// Here the thumbnail is the card: cropped to a 16:9 well with `object-fit:cover`
// so nothing letterboxes, the play mark sits ON the image where a video's does,
// and the title gets prose size and two lines instead of one ellipsis.
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

  const domState = model.state === 'ready' ? 'card' : model.state === 'failed' ? 'blocked' : 'loading'
  const playable = kind === 'youtube'

  return (
    <div
      className={`bb-link bb-a-link${model.state === 'failed' ? ' failed' : ''}${model.state === 'ready' && model.image ? ' has-img' : ''}`}
      data-link-card data-kind={kind} data-state={domState}
    >
      {model.state === 'ready' && model.image && (
        <div className={`bb-a-link-well${model.aspect === 'square' ? ' sq' : ''}`}>
          <img className="bb-link-img bb-a-link-img" src={model.image} alt="" />
          {playable && <span className="bb-a-link-play"><Glyph name="play" size={18} /></span>}
        </div>
      )}
      <div className="bb-link-body bb-a-link-body">
        <span className="bb-link-title bb-a-link-title">
          {model.state === 'loading' ? 'Loading preview' : model.title}
        </span>
        {model.state === 'ready' && model.sub && <span className="bb-link-sub bb-a-link-sub">{model.sub}</span>}
      </div>
    </div>
  )
}
