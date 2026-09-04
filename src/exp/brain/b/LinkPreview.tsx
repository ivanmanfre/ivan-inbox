import { useEffect, useState } from 'react'
import { classifyLink, unfurl, type LinkKind } from '../../../lib/unfurl'
import { linkCardFromResult, pendingLinkCard, type LinkCardModel } from './linkcards'

// One component, two call sites: the composer's live preview while Ivan is
// still typing a link, and the SAME card re-rendered inside the turn once it
// sends — brief item 5's "the same card renders inside the sent turn". They
// are literally the same component reading the same URL, and unfurl.ts caches
// per-URL, so the second mount resolves instantly rather than re-fetching.
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

  // The gate's vocabulary is not this module's internal state names: `ready`
  // reads as `card` (the honest render IS a card, just possibly a thin one)
  // and `failed` reads as `blocked` (the unfurl came back ok:false).
  const domState = model.state === 'ready' ? 'card' : model.state === 'failed' ? 'blocked' : 'loading'

  return (
    <div className={`bb-link${model.state === 'failed' ? ' failed' : ''}`} data-link-card data-kind={kind} data-state={domState}>
      {model.state === 'loading' ? (
        <>
          <div className={`bb-link-img${model.aspect === 'square' ? ' sq' : ''}`} />
          <div className="bb-link-body">
            <span className="bb-link-title">Loading preview…</span>
          </div>
        </>
      ) : model.state === 'ready' ? (
        <>
          {model.image && <img className={`bb-link-img${model.aspect === 'square' ? ' sq' : ''}`} src={model.image} alt="" />}
          <div className="bb-link-body">
            <span className="bb-link-title">{model.title}</span>
            {model.sub && <span className="bb-link-sub">{model.sub}</span>}
          </div>
        </>
      ) : (
        // Blocked: the honest state, never the raw URL standing in as a title.
        <div className="bb-link-body">
          <span className="bb-link-title">{model.title}</span>
        </div>
      )}
    </div>
  )
}
