/* =========================================================================
   Direction B, MOVE 16 (refs: Social Card, kokonutd; Citation, tool-ui;
   Error Message, serafimcloud).

   Copied from `src/exp/brain/b/skins/b/LinkPreview.tsx`. The fetch, the
   pending model, the "draw the well from the first frame" rule and the gate's
   DOM vocabulary (`data-link-card`, `data-kind`, `data-state`) are the
   source's, unchanged. Three things are new and all three are view only:

   1. The card is a NESTED INSET (`dirb-inset`) so it reads as something the
      bubble contains rather than a second bubble.
   2. An imageless page gets a mark, its source or its domain, and a bold
      title. There is no date on the model, so no date is drawn: a stamp we
      would have to invent is worse than a stamp that is missing.
   3. A blocked link is a compact tinted card sized like a bubble, carrying
      linkcards.ts's own sentence. It is tinted with the interaction wash, not
      with a severity colour: this system spends severity on live signals.
   ========================================================================= */
import { useEffect, useState } from 'react'
import { Icon, cx } from '../../../ds'
import { classifyLink, unfurl, type LinkKind } from '../../../lib/unfurl'
import { linkCardFromResult, pendingLinkCard, type LinkCardModel } from '../../../exp/brain/b/linkcards'

/** The host, for a page whose own metadata never named its source. */
function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
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
  // The well is drawn from the FIRST frame, empty, so the card cannot grow by
  // its own image height under his thumb in a tray that sits on the send
  // button. Only a card that came back with nothing to show has no well.
  const showWell = hasImage || model.state === 'loading'

  if (model.state === 'failed') {
    return (
      <div className="dirb-ask-blocked" data-link-card data-kind={kind} data-state={domState}>
        <Icon name="blocked" size={16} />
        <span className="ds-t-body dirb-truncate">{model.title}</span>
      </div>
    )
  }

  return (
    <div
      className={cx('dirb-inset', 'dirb-ask-link-card', hasImage && 'has-img')}
      data-link-card data-kind={kind} data-state={domState}
    >
      {showWell && (
        <div className="dirb-ask-well" data-aspect={model.aspect === 'square' ? 'square' : 'wide'}>
          {hasImage && <img className="dirb-ask-img" src={model.image ?? undefined} alt="" />}
          {hasImage && kind === 'youtube' && (
            <span className="dirb-ask-play"><Icon name="play" size={20} /></span>
          )}
        </div>
      )}
      <div className="dirb-ask-link-body dirb-col">
        {!showWell && (
          <span className="dirb-ask-link-src dirb-row ds-t-meta dirb-dim">
            <Icon name="link" size={16} />
            <span className="dirb-truncate">{model.sub ?? hostOf(url)}</span>
          </span>
        )}
        <span className="ds-t-title dirb-clamp2">
          {model.state === 'loading' ? 'Loading preview' : model.title}
        </span>
        {model.state === 'ready' && model.sub && showWell && (
          <span className="ds-t-meta dirb-dim dirb-truncate">{model.sub}</span>
        )}
      </div>
    </div>
  )
}
