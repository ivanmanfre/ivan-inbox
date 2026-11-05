import { Fragment, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { spans, xArticleBlocks, type XBlock, type XImageRef } from '../../../lib/xArticleMd'
import { XCheck } from './glyphs'

// THE X SIMULATIONS. A white X page whatever the app's theme: the article reader (5:2 cover,
// big title, author row, the blocks the publisher sends) and the post with its quoted article.
// The blocks come from xArticleBlocks, the port of the publisher's converter, so what renders
// here is what X receives.

export const X_NAME = 'Iván'

function Avatar({ small }: { small?: boolean }) {
  return <span className={`xs-av${small ? ' xs-av-s' : ''}`} aria-hidden="true">I</span>
}

function Who({ handle, extra }: { handle: string; extra?: ReactNode }) {
  return (
    <span className="xs-who">
      <b>{X_NAME}</b><XCheck size={17} />
      <span className="xs-handle">@{handle}{extra}</span>
    </span>
  )
}

function Inline({ b }: { b: XBlock }) {
  return <>{spans(b).map((s, i) => {
    let n: ReactNode = s.text
    if (s.bold) n = <strong>{n}</strong>
    if (s.url) n = <a href={s.url} target="_blank" rel="noreferrer">{n}</a>
    return <Fragment key={i}>{n}</Fragment>
  })}</>
}

function Blocks({ blocks }: { blocks: XBlock[] }) {
  const out: ReactNode[] = []
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.type === 'unordered-list-item' || b.type === 'ordered-list-item') {
      const group: XBlock[] = []
      while (i < blocks.length && blocks[i].type === b.type) group.push(blocks[i++])
      i--
      const items = group.map(g => <li key={g.line} data-line={g.line}><Inline b={g} /></li>)
      out.push(b.type === 'ordered-list-item' ? <ol key={`l${b.line}`}>{items}</ol> : <ul key={`l${b.line}`}>{items}</ul>)
      continue
    }
    if (b.type === 'atomic' && b.image) {
      out.push(<figure key={b.line} data-line={b.line}><img src={b.image.url} alt={b.image.alt ?? ''} loading="lazy" /></figure>)
      continue
    }
    const k = b.line
    if (b.type === 'header-two') out.push(<h2 key={k} data-line={k}><Inline b={b} /></h2>)
    else if (b.type === 'header-three') out.push(<h3 key={k} data-line={k}><Inline b={b} /></h3>)
    else if (b.type === 'blockquote') out.push(<blockquote key={k} data-line={k}><Inline b={b} /></blockquote>)
    else out.push(<p key={k} data-line={k}><Inline b={b} /></p>)
  }
  return <>{out}</>
}

export function XArticlePreview({ title, body, cover, images, handle, onLine }: {
  title: string; body: string; cover: string | null; images: XImageRef[] | null; handle: string
  /** A tap on a block (not on a link): the source line to edit. */
  onLine?: (line: number | null) => void
}) {
  const blocks = xArticleBlocks(body, images)
  const tap = (e: MouseEvent<HTMLElement>) => {
    if (!onLine) return
    const t = e.target as HTMLElement
    if (t.closest('a')) return
    if (t.closest('.xs-title')) { onLine(null); return }
    const el = t.closest<HTMLElement>('[data-line]')
    if (el) onLine(Number(el.dataset.line))
  }
  return (
    <article className="xs xs-article" data-x-preview="article" onClick={tap}>
      {cover ? <div className="xs-cover"><img src={cover} alt="" /></div> : <div className="xs-cover xs-cover-none">No cover image</div>}
      <div className="xs-in">
        <h1 className="xs-title">{title.trim() || 'Untitled article'}</h1>
        <div className="xs-author"><Avatar /><Who handle={handle} /></div>
        <div className="xs-body">{blocks.length ? <Blocks blocks={blocks} /> : <p className="xs-empty">The article has no text yet.</p>}</div>
      </div>
    </article>
  )
}

/** Swipe/arrow controls for a quick post's photo: position among the ranked photos. */
export type PhotoNav = { index: number; count: number; onStep: (delta: -1 | 1) => void }

const SWIPE_PX = 40

// Phone: swipe the photo left/right (touch-action pan-y keeps the page scrolling vertically). Desktop: arrows.
function SwipePhoto({ photo, nav }: { photo: string; nav: PhotoNav }) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null)
  const [drag, setDrag] = useState(0)
  const end = (x: number, y: number) => {
    const s = start.current
    start.current = null
    setDrag(0)
    if (!s) return
    const dx = x - s.x, dy = y - s.y
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.2) nav.onStep(dx < 0 ? 1 : -1)
  }
  const atStart = nav.index <= 0, atEnd = nav.index >= nav.count - 1
  return (
    <div className="xs-media xs-photo xs-photo-swipe" data-x-photo
      onPointerDown={e => { if (e.isPrimary === false) return; start.current = { x: e.clientX, y: e.clientY, id: e.pointerId } }}
      onPointerMove={e => { const s = start.current; if (s && s.id === e.pointerId) setDrag(Math.max(-80, Math.min(80, e.clientX - s.x))) }}
      onPointerUp={e => { if (start.current && start.current.id === e.pointerId) end(e.clientX, e.clientY) }}
      onPointerCancel={() => { start.current = null; setDrag(0) }}>
      <img src={photo} alt="" draggable={false} style={drag ? { transform: `translateX(${drag}px)` } : undefined} />
      <button type="button" className="xs-pnav xs-pnav-l" data-verb="x-photo-prev" aria-label="Previous photo" disabled={atStart}
        onPointerDown={e => e.stopPropagation()} onClick={() => nav.onStep(-1)}>‹</button>
      <button type="button" className="xs-pnav xs-pnav-r" data-verb="x-photo-next" aria-label="Next photo" disabled={atEnd}
        onPointerDown={e => e.stopPropagation()} onClick={() => nav.onStep(1)}>›</button>
      <div className="xs-pdots" data-x-photo-dots aria-label={`Photo ${nav.index + 1} of ${nav.count}`}>
        {Array.from({ length: nav.count }, (_, i) => <span key={i} data-dot aria-current={i === nav.index ? 'true' : undefined} />)}
      </div>
    </div>
  )
}

export function XPostPreview({ text, media, handle, quoteTitle, quoteCover, photo = null, photoNav = null }: {
  text: string; media: string | null; handle: string; quoteTitle: string | null; quoteCover: string | null
  /** A still image attached to the post (quick posts carry one of Ivan's own photos). */
  photo?: string | null
  /** Other fitting photos to swipe to (only when there are 2+). */
  photoNav?: PhotoNav | null
}) {
  return (
    <article className="xs xs-post" data-x-preview="post">
      <Avatar />
      <div className="xs-main">
        <div className="xs-head"><Who handle={handle} extra={<> · now</>} /></div>
        <div className="xs-text">{text.trim() ? text : <span className="xs-empty">The line is empty.</span>}</div>
        {photo && photoNav && photoNav.count > 1 && <SwipePhoto photo={photo} nav={photoNav} />}
        {photo && !(photoNav && photoNav.count > 1) && (
          <div className="xs-media xs-photo" data-x-photo>
            <img src={photo} alt="" />
          </div>
        )}
        {media && (
          <div className="xs-media">
            <video src={media} autoPlay muted loop playsInline preload="auto" />
            <span className="xs-gif">GIF</span>
          </div>
        )}
        {(quoteTitle || quoteCover) && (
          <div className="xs-quote" data-x-quoted>
            <div className="xs-qhead"><Avatar small /><Who handle={handle} /></div>
            {quoteCover && <div className="xs-qcover"><img src={quoteCover} alt="" /></div>}
            <div className="xs-qbody"><small>Article</small><b>{quoteTitle ?? 'Article'}</b></div>
          </div>
        )}
      </div>
    </article>
  )
}
