/* ==========================================================================
   src/wb/ask/LinkPreview.tsx: S31, the link card.

   03-DIRECTION move 16: a pasted URL collapses into a nested inset card, the
   prose stays first, and an imageless page falls back to the title shape. The
   honest blocked state is kept: a logged-out Instagram fetch gives nothing
   back and this card says so in words (linkcards.ts owns that copy) rather
   than drawing an empty well.
   ========================================================================== */
import { useEffect, useState } from 'react'
import { Icon } from '../../ds'
import { classifyLink, unfurl, type LinkKind } from '../../lib/unfurl'
import { linkCardFromResult, pendingLinkCard, type LinkCardModel } from '../../exp/brain/b/linkcards'
import './ask.css'

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
  // The well is drawn from the FIRST frame, empty, so the card cannot grow by
  // its own image height under his thumb in a tray that sits on the send
  // control. Only a card that came back with nothing to show has no well.
  const showWell = hasImage || model.state === 'loading'

  return (
    <div className="a-brain-link" data-link-card data-kind={kind} data-state={domState}>
      {showWell && (
        <div className="a-brain-link-well" data-square={model.aspect === 'square' ? '' : undefined}>
          {hasImage && <img className="a-brain-link-img" src={model.image ?? undefined} alt="" />}
          {hasImage && kind === 'youtube' && (
            <span className="a-brain-link-play"><Icon name="play" size={24} /></span>
          )}
        </div>
      )}
      <div className="a-brain-link-body">
        <span className="a-brain-link-t a-clamp">
          {model.state === 'loading' ? 'Loading preview' : model.title}
        </span>
        {model.state === 'ready' && model.sub && (
          <span className="a-brain-link-s a-nowrap">{model.sub}</span>
        )}
      </div>
    </div>
  )
}
