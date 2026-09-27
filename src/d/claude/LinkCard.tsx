import { useEffect, useState } from 'react'
import { classifyLink, unfurl } from '../../lib/unfurl'
import { linkCardFromResult, pendingLinkCard, type LinkCardModel } from '../../exp/brain/b/linkcards'

// Today's link preview (wb/ask/LinkPreview.tsx): the first link in an answer or
// in the field is unfurled by today's `unfurl()` (the inbox-claude unfurl) and
// shaped by today's `linkcards` rules; a blocked link says so in one line.

function domainOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, '') } catch { return null }
}

export function LinkCard({ url }: { url: string }) {
  const kind = classifyLink(url)
  const [m, setM] = useState<LinkCardModel>(() => pendingLinkCard(kind))
  useEffect(() => {
    let live = true
    setM(pendingLinkCard(kind))
    void unfurl(url).then(r => { if (live) setM(linkCardFromResult(kind, r)) })
    return () => { live = false }
  }, [url, kind])
  const dom = domainOf(url)
  return (
    <a className={`dcl-link-card dcl-lc-${m.state}`} href={url} target="_blank" rel="noreferrer" data-link-card>
      {m.state === 'ready' && m.image && <img src={m.image} alt="" />}
      <span>
        {dom && <small>{dom}</small>}
        <b>{m.state === 'loading' ? 'Loading preview' : m.title}</b>
        {m.state === 'ready' && m.sub && <em>{m.sub}</em>}
      </span>
    </a>
  )
}
