/* ==========================================================================
   src/wb/ask/LinkPreview.tsx: S31, the link card.

   03-DIRECTION move 16, in its three shapes:

   - a page WITH an image is a nested inset card: the prose stays first and the
     card sits inside the bubble, indented behind its own rule, so it reads as
     something the message contains rather than something that replaced it;
   - a page WITHOUT one takes the citation shape: a drawn domain mark, the
     domain in mono, then the title in bold. No date, because no date reaches
     this card — `unfurl()` returns title, description, image, site and author
     and nothing else, and a publication date invented from the fetch time
     would be a fact about our request, not about the page;
   - a blocked link is a compact tinted card SIZED LIKE A BUBBLE, not a well
     with a message in it: it says the honest sentence `linkcards.ts` owns
     ("Instagram gave nothing back" is Instagram's own doing, said plainly)
     with an error mark, and takes one line.

   The mark on the citation shape is DRAWN from the domain's own first letter,
   never fetched. A favicon would be a third-party request per link from a
   phone on cellular, and the reference's own point is the shape, not the
   picture.
   ========================================================================== */
import { useEffect, useState } from 'react'
import { Icon } from '../../ds'
import { classifyLink, unfurl, type LinkKind } from '../../lib/unfurl'
import { linkCardFromResult, pendingLinkCard, type LinkCardModel } from '../../exp/brain/b/linkcards'
import './ask.css'

/** The host, without the `www.`, or null if this is not a URL after all. */
function domainOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, '') } catch { return null }
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
  const domain = domainOf(url)

  // The blocked shape: one tinted line the height of a bubble, never an empty
  // well with an apology in it.
  if (model.state === 'failed') {
    return (
      <div className="a-brain-link" data-link-card data-kind={kind} data-state={domState} data-shape="blocked">
        <Icon name="error" size={16} />
        <span className="a-brain-link-t a-clamp">{model.title}</span>
        {domain && <span className="a-brain-link-dom a-mono a-nowrap">{domain}</span>}
      </div>
    )
  }

  // The citation shape: a page that came back with words but no picture.
  // The mark is drawn, the domain is read off the URL, the title is the page's.
  if (model.state === 'ready' && !hasImage) {
    return (
      <div className="a-brain-link" data-link-card data-kind={kind} data-state={domState} data-shape="cite">
        <span className="a-brain-link-fav" aria-hidden="true">{(domain ?? '?').charAt(0).toUpperCase()}</span>
        <span className="a-brain-link-body">
          {domain && <span className="a-brain-link-dom a-mono a-nowrap">{domain}</span>}
          <span className="a-brain-link-t a-clamp">{model.title}</span>
          {model.sub && <span className="a-brain-link-s a-nowrap">{model.sub}</span>}
        </span>
      </div>
    )
  }

  // The nested inset card: an image well drawn from the FIRST frame, so the
  // card cannot grow by its own image height under a thumb that is already on
  // the send control.
  return (
    <div className="a-brain-link" data-link-card data-kind={kind} data-state={domState} data-shape="inset">
      <div className="a-brain-link-well" data-square={model.aspect === 'square' ? '' : undefined}>
        {hasImage && <img className="a-brain-link-img" src={model.image ?? undefined} alt="" />}
        {hasImage && kind === 'youtube' && (
          <span className="a-brain-link-play"><Icon name="play" size={24} /></span>
        )}
      </div>
      <div className="a-brain-link-body">
        {domain && <span className="a-brain-link-dom a-mono a-nowrap">{domain}</span>}
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
