import { useState } from 'react'
import type { ContentDraft } from '../../lib/content'
import { Failed, Skeleton } from '../ui/states'
import { RowSelect } from '../../wb/content/select'
import { draftExcerpt } from '../../lib/content'
import { sourceLabel } from '../../exp/v2c/fmt'
import { LANES, LANE_NAME, POSS, age, aimOf, imgOf, queueSourceOf, splitTitleTag, titleOf, type Lane } from './model'
import { VERB_LABEL, rowCaps, rowVerbsFor, useRowVerbs } from './rowVerbs'
import type { SeatRead } from './useContentData'

// The queue the draft window walks (j/k): what waits on Ivan per seat, newest
// first. Ivan: his drafts in review. Rise / Arch: in review and not on the
// client's board yet. Older than two weeks sits in its own fold with its real
// count (the frame's "Waiting on you" stops counting them at 14 days).
export function Queue({ lane, setLane, seat, fresh, older, counts, openId, onOpen, now }: {
  lane: Lane
  setLane: (l: Lane) => void
  seat: SeatRead
  fresh: ContentDraft[]
  older: ContentDraft[]
  counts: Record<Lane, number | null | undefined>
  openId: string | null
  onOpen: (id: string) => void
  now?: number
}) {
  const [showOld, setShowOld] = useState(false)
  const verbs = useRowVerbs(seat.refresh)
  const cap = lane === 'ivan' ? 'Your drafts in review, newest first' : `Not on ${POSS[lane]} board yet, newest first`
  const rows = showOld ? [...fresh, ...older] : fresh
  return (
    <section className="cn-q" aria-label="Waiting on you">
      <div className="cn-qh">
        <div className="cn-seg" role="tablist" aria-label="Seat">
          {LANES.map(l => (
            <button key={l} type="button" role="tab" aria-selected={l === lane} className={l === lane ? 'cn-on' : ''} onClick={() => setLane(l)}>
              {LANE_NAME[l]}<b>{counts[l] === undefined ? '…' : counts[l] ?? '?'}</b>
            </button>
          ))}
        </div>
        <span className="cn-kk" title={`${cap}. j and k walk the list.`} />
      </div>
      {seat.error ? <Failed what={`${LANE_NAME[lane]}'s drafts`} detail={seat.error} onRetry={seat.refresh} />
        : seat.loading && !seat.loadedAt ? <Skeleton lines={5} title={false} label="Reading the queue" />
          : fresh.length === 0 && older.length === 0 ? (
            <div className="cn-fold"><span>Nothing waiting.</span></div>
          ) : (
            <div role="list">
              {fresh.length === 0 && <div className="cn-fold"><span>Nothing from the last two weeks.</span></div>}
              {rows.map((r, i) => <QueueRow key={r.id} r={r} i={i} lane={lane} open={r.id === openId} onOpen={onOpen} verbs={verbs} now={now} />)}
              {older.length > 0 && (
                <div className="cn-fold">
                  <span>Older than two weeks</span>
                  <button type="button" onClick={() => setShowOld(o => !o)} aria-expanded={showOld}>{older.length} · {showOld ? 'Hide' : 'Show'}</button>
                </div>
              )}
            </div>
          )}
    </section>
  )
}

// ONE QUEUE ROW (Ivan 29 Sep: "no image preview, no source no nothing... review section is disaster").
// The row used to be one 34px line: number, age, title, aim, score. Every fact needed to decide was one
// click away. It now carries what the list fetch already loads: the post image, the opening of the
// body, and where the draft came from (linked to the source post when the row has its URL). A
// "[tag]" stamped on the title moves into that source line. Six children, same order as before, so
// the phone rule that hides the 4th and 5th still hides aim and score.
function QueueRow({ r, i, lane, open, onOpen, verbs, now }: {
  r: ContentDraft; i: number; lane: Lane; open: boolean; onOpen: (id: string) => void
  verbs: ReturnType<typeof useRowVerbs>; now?: number
}) {
  const [broken, setBroken] = useState(false)
  const full = titleOf(r)
  const { tag, text } = splitTitleTag(full)
  const src = queueSourceOf(r, sourceLabel)
  // A tag the source line already says ("X outlier @x" on an X-outlier row) is not repeated.
  const extraTag = tag && !(src && /^x outlier/i.test(tag) && /^X outlier/.test(src.text)) ? tag : null
  // X-outlier drafts open on their own title line; the excerpt starts after it instead of repeating it.
  const norm = (x: string) => x.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase()
  const lines = (r.post_body ?? '').split('\n').map(l => l.trim()).filter(Boolean)
  const rest = lines.length && norm(lines[0]) === norm(text) ? lines.slice(1) : lines
  const excerpt = draftExcerpt(rest.join('\n'), 180)
  const thumb = imgOf(r.image_urls, 160)
  return (
    <div role="listitem" className={`cn-row cn-qrow${open ? ' cn-sel' : ''}`}
      aria-current={open ? 'true' : undefined} onClick={() => onOpen(r.id)}>
      <span className="cn-m cn-mark"><RowSelect id={r.id} kind="draft" label={full} caps={rowCaps(r, lane)} taxonomy={r.taxonomy} lane={lane} />{i + 1}</span>
      <span className="cn-qthumb" aria-hidden>
        {thumb && !broken ? <img src={thumb} alt="" loading="lazy" onError={() => setBroken(true)} /> : <i>{r.type === 'carousel' ? 'Carousel' : 'Text'}</i>}
      </span>
      <span className="cn-qmain">
        <button type="button" className="cn-t" data-verb="open" title={full} onClick={e => { e.stopPropagation(); onOpen(r.id) }}>{text}</button>
        {excerpt && <span className="cn-qex">{excerpt}</span>}
        <span className="cn-qsrc">
          <span>{age(r.created_at, now)}</span>
          {src && (src.href
            ? <a href={src.href} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} data-verb="open-source" title={r.source_label ?? src.text}>{src.text} ↗</a>
            : <span title={r.source_label ?? src.text}>{src.text}</span>)}
          {!src && <span className="cn-qnone">No source recorded</span>}
          {extraTag && <b>{extraTag}</b>}
        </span>
      </span>
      <span className="cn-m">{aimOf(r)}</span>
      <span className="cn-m">{r.qa_score ? Math.round(Number(r.qa_score)) || r.qa_score : ''}</span>
      <span className="cn-racts" onClick={e => e.stopPropagation()}>
        {rowVerbsFor(r, lane).map(v => (
          <button key={v} type="button" className="cn-mini" data-verb={`row-${v}`} disabled={verbs.busy === r.id} onClick={() => void verbs.run(r, lane, v)}>{VERB_LABEL[v]}</button>
        ))}
      </span>
    </div>
  )
}
