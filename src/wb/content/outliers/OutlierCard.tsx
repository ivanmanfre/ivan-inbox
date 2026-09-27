/* One outlier as one card. The lift over the author's own median is the
   headline (it is the reason the post is here); the post's first line is the
   title because that is how it read in the feed; traits are small tokens,
   who commented is one bar with its n. */
import { useState } from 'react'
import {
  boardFailText, buyerLabel, dayText, liftText, needsClamp, numText, splitText,
  type OutlierRow,
} from '../../../lib/outliers'

export type UseState = 'off' | 'busy' | 'on' | 'failed'

const SHOWN_TRAITS = 5

const plural = (n: number | null, one: string, many = `${one}s`) =>
  `${numText(n)} ${Math.round(Number(n) || 0) === 1 ? one : many}`

export function OutlierCard({ row, use, fail, onUse }: { row: OutlierRow; use: UseState; fail?: string; onUse: () => void }) {
  const [open, setOpen] = useState(false)
  const [head, body] = splitText(row.text)
  const clamp = needsClamp(body)
  const b = buyerLabel(row)
  const traits = open ? row.traits : row.traits.slice(0, SHOWN_TRAITS)
  const hidden = row.traits.length - traits.length
  const figs = [
    plural(row.likes, 'like'),
    plural(row.comments, row.platform === 'x' ? 'reply' : 'comment', row.platform === 'x' ? 'replies' : undefined),
    plural(row.reposts, 'repost'),
    ...(row.views ? [plural(row.views, 'view')] : []),
  ]
  const onBoard = use === 'on'

  return (
    <li className="ol-card" data-outlier-card data-platform={row.platform} data-post-id={row.post_id} data-open={open || undefined}>
      <div className="ol-lift" data-lift={row.lift}>
        <b>{liftText(row.lift)}<small>x</small></b>
        <span>own median {numText(row.baseline)}</span>
        <span>over {numText(row.baseline_n)} posts</span>
      </div>

      <div className="ol-who">
        <p className="ol-author" data-author>{row.author}</p>
        <p className="ol-meta">
          <span>{row.platform === 'x' ? 'X' : 'LinkedIn'}</span>
          <span>{dayText(row.published_at)}</span>
          {row.personal ? <span className="ol-chip">Personal</span> : null}
        </p>
      </div>

      <div className="ol-post">
        <div data-text>
          <p className="ol-head">{head || 'No text on this post'}</p>
          {body ? <p className="ol-body" data-clamped={clamp && !open ? true : undefined}>{body}</p> : null}
        </div>
        {clamp ? (
          <button type="button" className="ol-more" aria-expanded={open} onClick={() => setOpen(o => !o)}>
            {open ? 'Show less' : 'Show the whole post'}
          </button>
        ) : null}
        {row.traits.length ? (
          <ul className="ol-traits" aria-label="Recipe traits on this post">
            {traits.map(t => {
              const pos = Number(t.weight) > 0
              return (
                <li key={t.key} className="ol-t" data-sign={pos ? 'pos' : 'neg'}
                  title={pos ? 'The recipe reads this as leaning outlier' : 'The recipe reads this as leaning against'}>
                  <b aria-hidden="true">{pos ? '+' : '−'}</b>
                  <span className="ol-sr">{pos ? 'Leans outlier: ' : 'Leans against: '}</span>
                  {t.words}
                </li>
              )
            })}
            {hidden > 0 ? (
              <li><button type="button" className="ol-t ol-t-more" onClick={() => setOpen(true)}>{hidden} more</button></li>
            ) : null}
          </ul>
        ) : null}
        {row.traits_note ? <p className="ol-tnote">{row.traits_note}</p> : null}
      </div>

      <div className="ol-aside">
        <div className="ol-buyer">
          <p className="ol-bl">
            <span>Who commented</span>
            {b.kind === 'read'
              ? <span><b>{b.line}</b> · {b.icp} of {b.n}</span>
              : b.kind === 'few'
                ? <span>too few to read · n {b.n}</span>
                : <span>{b.line}</span>}
          </p>
          {b.kind === 'read' ? (
            <div className="ol-meter" role="img" aria-label={`${b.line}, ${b.icp} of ${b.n} commenters`}>
              <i style={{ width: `${Math.max(2, Math.round(b.share * 100))}%` }} />
            </div>
          ) : null}
        </div>
        <div className="ol-foot">
          <p className="ol-figs">{figs.map(f => <span key={f}>{f}</span>)}</p>
          <div className="ol-acts">
            {row.url ? (
              <a className="ol-link" data-post-link href={row.url} target="_blank" rel="noopener">Open post</a>
            ) : null}
            <button type="button" className="ol-use" data-use-this data-state={use}
              disabled={onBoard || use === 'busy'} aria-live="polite" onClick={onUse}>
              {onBoard ? 'On the board' : use === 'busy' ? 'Adding' : 'Use this'}
            </button>
          </div>
        </div>
        {use === 'failed' ? <p className="ol-usefail" role="alert">{boardFailText(fail)}</p> : null}
      </div>
    </li>
  )
}
