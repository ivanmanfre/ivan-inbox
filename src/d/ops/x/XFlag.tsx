import { useMemo } from 'react'
import { xFlagItems, type XFlagItem } from '../../../lib/xReview'
import { dHash } from '../../route'
import { XLogo } from './glyphs'
import { useXReview } from './useXReview'
import './x.css'

// THE X FLAG (Ivan 2026-10-11: "I don't want it to be just a task. It should be like a flag").
// A dark plate at the top of Home and Ops whenever an X article or quote post waits on him,
// one row per item with its title, and the count. Publishing / live / failed items show
// below it as quiet status lines for a while (live a day, failed three days).
// Renders nothing when there is nothing to say. Every hook runs before that return.

const xReviewHref = (id: string) => dHash('ops', 'x', { id })

const KIND: Record<XFlagItem['kind'], string> = { article: 'X article to review', quote: 'X quote post to review' }

function StatusLine({ i }: { i: XFlagItem }) {
  const what = i.kind === 'article' ? 'Article' : 'Quote post'
  if (i.state === 'live') {
    return (
      <div className="xf-st xf-st-live" data-x-status="live">
        <span className="xf-st-ico"><XLogo size={12} /></span>
        <span className="xf-st-t"><b>{what} live on X</b><span>{i.title}</span></span>
        {i.url && <a className="xf-st-go" href={i.url} target="_blank" rel="noreferrer">Open ↗</a>}
      </div>
    )
  }
  const moving = i.state === 'moving'
  return (
    <a className={`xf-st xf-st-${i.state}`} data-x-status={i.state} href={xReviewHref(i.id)}>
      <span className="xf-st-ico"><XLogo size={12} /></span>
      <span className="xf-st-t">
        <b>{moving ? (i.kind === 'article' ? 'Publishing on X…' : 'Posting on X…') : `${what} did not go out`}</b>
        <span>{!moving && i.error ? i.error : i.title}</span>
      </span>
      <span className="xf-chev" aria-hidden="true">›</span>
    </a>
  )
}

export function XFlag({ className }: { className?: string }) {
  const x = useXReview()
  const items = useMemo(() => xFlagItems(x.list), [x.list])
  const waiting = items.filter(i => i.state === 'waiting')
  const rest = items.filter(i => i.state !== 'waiting')
  if (items.length === 0) return null
  return (
    <section className={`xf${className ? ' ' + className : ''}`} aria-label="X review" data-x-flag>
      {waiting.length > 0 && (
        <div className="xf-flag" data-x-waiting={waiting.length}>
          <div className="xf-head">
            <span className="xf-mark"><XLogo size={14} /></span>
            <span className="xf-h">To review on X</span>
            <b className="xf-n" aria-label={`${waiting.length} waiting`}>{waiting.length}</b>
          </div>
          {waiting.map(i => (
            <a key={i.id} className="xf-row" href={xReviewHref(i.id)} data-x-item={i.id}>
              <span className="xf-row-t"><small>{KIND[i.kind]}</small><b>{i.title}</b></span>
              <span className="xf-chev" aria-hidden="true">›</span>
            </a>
          ))}
        </div>
      )}
      {rest.map(i => <StatusLine key={i.id} i={i} />)}
    </section>
  )
}
