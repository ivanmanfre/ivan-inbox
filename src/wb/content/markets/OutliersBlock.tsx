/* ==========================================================================
   OUTLIERS — the reach outlier study, as its own block under Markets.

   One number and its sentence, three cards, three winners as lines, and the
   whole study behind one fold. The market only: the study's control rows (the
   lane's own posts) are never stored, so nothing here can mix them in.

   A lane with no stored study renders nothing. A failed read renders nothing
   too: the block is an addition to the screen, never a reason for it to break.
   ========================================================================== */
import { useEffect, useState } from 'react'
import { Group } from '../../kit'
import {
  SHOWN_CARDS, SHOWN_LINES, SHOWN_WINNERS, bandBase, bandRange, fetchOutliers, outlierPct, winnerFigures,
  type OutlierRead, type OutlierStudy, type OutlierWinner,
} from '../../../lib/outliers'

function WinnerRow({ w }: { w: OutlierWinner }) {
  return (
    <li>
      <div className="a-mk-row">
        <p className="a-mk-t">
          <a className="a-mk-t-a" href={w.url} target="_blank" rel="noreferrer">{w.first_line}</a>
        </p>
        <p className="a-mk-figs">
          <span className="a-mk-f">{w.author}</span>
          {winnerFigures(w).map(f => <span className="a-mk-f" key={f}>{f}</span>)}
          <span className="a-mk-f">{w.type_label}</span>
        </p>
      </div>
    </li>
  )
}

/** Pure: the study goes in, nothing is fetched. The tests render this one. */
export function OutliersPanel({ study }: { study: OutlierStudy }) {
  const s = study
  const shown = s.winners.slice(0, SHOWN_WINNERS)
  const rest = s.winners.slice(SHOWN_WINNERS)
  return (
    <div className="a-mk" data-mk-outliers={s.run_id}>
      <Group className="a-mk-g" label="Outliers, what travels past an author's own baseline" pad>
        <div className="a-mk-body">

          <section className="a-mk-fold">
            <p className="a-mk-fig">
              <b className="a-mk-n">{s.answer.figure}</b>
              <span className="a-mk-u">{s.answer.unit}</span>
            </p>
            <p className="a-mk-lede">{s.answer.line}</p>
          </section>

          <section className="a-mk-sec">
            <ul className="a-mk-cards">
              {s.cards.slice(0, SHOWN_CARDS).map(c => (
                <li className="a-mk-card" key={c.headline}>
                  <h4 className="a-mk-ch">{c.headline}</h4>
                  <p className="a-mk-cf">
                    {c.figure}
                    {c.base ? <span className="a-mk-cb">{c.base}</span> : null}
                  </p>
                  {c.change ? <p className="a-mk-cd"><b>we do:</b> {c.change}</p> : null}
                </li>
              ))}
            </ul>
          </section>

          {s.lines.length ? (
            <section className="a-mk-sec">
              <ul className="a-mk-lines">
                {s.lines.slice(0, SHOWN_LINES).map(l => <li className="a-mk-line" key={l}>{l}</li>)}
              </ul>
            </section>
          ) : null}

          <section className="a-mk-sec">
            <h3 className="a-mk-h">
              Winners to mirror
              <span className="a-mk-tag">{s.base.per_post} reactors read on each, brand share is a floor</span>
            </h3>
            <ul className="a-mk-tbl">{shown.map(w => <WinnerRow key={w.url} w={w} />)}</ul>
          </section>

          <details className="a-mk-work">
            <summary>The study</summary>
            <div className="a-mk-dd">

              {rest.length ? (
                <section className="a-mk-sec">
                  <h3 className="a-mk-h">
                    Every audited winner
                    <span className="a-mk-tag">{rest.length} more, brand side first</span>
                  </h3>
                  <ul className="a-mk-tbl">{rest.map(w => <WinnerRow key={w.url} w={w} />)}</ul>
                </section>
              ) : null}

              {s.bands.length ? (
                <section className="a-mk-sec">
                  <h3 className="a-mk-h">
                    Who reacted, by post type
                    <span className="a-mk-tag">n={s.base.per_post} a post, floors read as bands</span>
                  </h3>
                  <ul className="a-mk-tbl">
                    {s.bands.map(b => (
                      <li key={b.type}>
                        <div className="a-mk-row">
                          <p className="a-mk-t">{b.label}<span className="a-mk-tag">{bandRange(b)} brand side</span></p>
                          <p className="a-mk-figs">
                            <span className="a-mk-f">{bandBase(b)}</span>
                            <span className="a-mk-f">pooled {outlierPct(b.brand)} brand side</span>
                            <span className="a-mk-f">{outlierPct(b.peer)} service sellers</span>
                            <span className="a-mk-f">{outlierPct(b.vendor)} vendors</span>
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {s.travels.length ? (
                <section className="a-mk-sec">
                  <h3 className="a-mk-h">
                    What travelled
                    <span className="a-mk-tag">top {s.base.top_n} of {s.base.outliers} outliers</span>
                  </h3>
                  <ul className="a-mk-asklist">
                    {s.travels.map(t => (
                      <li className="a-mk-ask" key={t.type}>
                        <b className="a-mk-askv">{t.n}</b>
                        <span className="a-mk-askl">{t.label}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {s.method.length ? (
                <section className="a-mk-sec">
                  <h3 className="a-mk-h">How it was read</h3>
                  {s.method.map(line => <p className="a-mk-sub" key={line}>{line}</p>)}
                </section>
              ) : null}

            </div>
          </details>
        </div>
      </Group>
    </div>
  )
}

export function OutliersBlock({ lane }: { lane: string }) {
  const [read, setRead] = useState<OutlierRead | null>(null)
  useEffect(() => {
    let live = true
    setRead(null)
    void fetchOutliers(lane).then(r => { if (live) setRead(r) })
    return () => { live = false }
  }, [lane])
  if (!read || read.kind !== 'ready') return null
  return <OutliersPanel study={read.data} />
}
