import { useState } from 'react'
import { normalizeImageUrls } from '../../../lib/content'
import { AUTHOR } from '../Preview'
import { imgOf, type Lane } from '../model'
import { foldText } from '../weekModel'

// THE LINKEDIN PREVIEW (SPEC-content §2.1). The post as the feed shows it:
// author row, the first three lines then "…see more", the media at LinkedIn's
// crop (a single image between 1.91:1 and 4:5, a carousel's first slide at
// 4:5 with its count, a video's poster), and an inert reaction bar. 552 at its
// own measure, full-bleed on the phone. Presentational: no writes.
const clampRatio = (w: number, h: number) => Math.min(1.91, Math.max(0.8, w / h))

export function LinkedInCard({ lane, body, images, type, expandable = true, compact = false, bare = false, open, onToggle }: {
  lane: Lane
  body: string
  /** What will post (the optimistic picture while a change is being written). */
  images: unknown
  type: string | null
  expandable?: boolean
  compact?: boolean
  /** No inert reaction bar (the review desk). */
  bare?: boolean
  /** Controlled "see more" (the review desk's `o` key); uncontrolled when absent. */
  open?: boolean
  onToggle?: (open: boolean) => void
}) {
  const [name, line, ini] = AUTHOR[lane]
  const [own, setOwn] = useState(false)
  const more = open ?? own
  const setMore = (v: boolean) => { if (onToggle) onToggle(v); else setOwn(v) }
  const [ratio, setRatio] = useState<number | null>(null)
  const text = body.replace(/\s+$/, '')
  const fold = foldText(text, 3, compact ? 44 : 52)
  const shown = more || !fold.folded ? text : fold.head
  const all = normalizeImageUrls(images)
  const carousel = type === 'carousel' && all.length > 0
  const video = type === 'video'
  const single = !carousel ? imgOf(all) : null
  return (
    <div className={`cv2-li${compact ? ' cv2-li-c' : ''}`}>
      <div className="cv2-li-h">
        <i aria-hidden="true">{ini}</i>
        <div><b>{name}</b> <span>· 1st</span><small>{line}</small><small>now · <span aria-label="public">🌐</span></small></div>
      </div>
      <div className="cv2-li-b">
        {text ? shown.split(/\n\s*\n/).map((para, i, list) => (
          <p key={i}>{para}{i === list.length - 1 && fold.folded && !more && expandable && (
            <>{' '}<button type="button" className="cv2-li-see" data-verb="see-more" onClick={e => { e.stopPropagation(); setMore(true) }}>…see more</button></>
          )}{i === list.length - 1 && fold.folded && !more && !expandable && <span className="cv2-li-see">…see more</span>}</p>
        )) : <p className="cv2-li-none">No post text yet.</p>}
      </div>
      {single && (
        <div className="cv2-li-m" style={{ aspectRatio: String(ratio ?? 1.91) }}>
          <img src={single} alt="" loading="lazy" draggable={false}
            onLoad={e => { const im = e.currentTarget; if (im.naturalWidth && im.naturalHeight) setRatio(clampRatio(im.naturalWidth, im.naturalHeight)) }} />
          {video && <span className="cv2-li-play" aria-label="Video">▶</span>}
        </div>
      )}
      {carousel && (
        <div className="cv2-li-car" aria-label={`Carousel, ${all.length} slides`}>
          <div className="cv2-li-m" style={{ aspectRatio: '0.8' }}>
            <img src={imgOf([all[0]], 800) ?? all[0]} alt="" loading="lazy" draggable={false} />
            <span className="cv2-li-count">1 / {all.length}</span>
          </div>
          {all.length > 1 && <div className="cv2-li-strip">{all.slice(1, 4).map((u, i) => <img key={`${u}-${i}`} src={imgOf([u], 200) ?? u} alt="" loading="lazy" draggable={false} />)}</div>}
        </div>
      )}
      {!bare && <div className="cv2-li-r" aria-hidden="true"><span>Like</span><span>Comment</span><span>Repost</span><span>Send</span></div>}
    </div>
  )
}
