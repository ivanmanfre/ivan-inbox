/* ==========================================================================
   WINNERS — two separated sections, Market examples and Our results.

   The separation is structural, not a heading: `market` and `own` are two
   arrays on the read, and this file never merges them into one list. An
   own-account post carries no baseline/lift fields at all (the read's own
   type says so), so there is nothing here that COULD render a source's lift
   beside a client post as if it were achieved locally.

   PURE. `view` in, markup out.
   ========================================================================== */
import { Badge } from '../../../ds'
import { Group } from '../../kit'
import { CalmEmpty, Failed } from '../parts'
import {
  isLowSample, laneDisplayName, objectiveLabel,
  type ContentEvidenceMarketWinner, type ContentEvidenceOwnResult, type WinnersRead,
} from '../../../lib/contentEvidence'
// The `.a-mk-*` row shapes are the Markets/Outliers block's own vocabulary
// (markets.css) — reused here rather than duplicated, since a winner row here
// and a winner row under Markets are the same kind of fact on screen.
import '../content.css'
import '../markets/markets.css'
import '../proposals-evidence.css'
import { FAILED_MESSAGE, FailedDetails, ReaderStateTag } from './readerState'

function comparisonLabel(w: ContentEvidenceMarketWinner): string {
  if (w.observed_value === null || w.baseline_value === null) return 'Comparison not recorded.'
  const liftText = w.lift !== null ? `${w.lift}x` : 'no finite multiple'
  const n = w.baseline_n !== null ? `n=${w.baseline_n}` : 'sample size not recorded'
  return `${w.observed_value.toLocaleString('en-US')} observed vs ${w.baseline_value.toLocaleString('en-US')} usual (${liftText}, ${n})`
}

function MarketRow({ w }: { w: ContentEvidenceMarketWinner }) {
  const low = isLowSample(w.baseline_n)
  return (
    <li className="a-cev-wrow">
      <div className="a-mk-row">
        <p className="a-mk-t">
          {w.source_url
            ? <a className="a-mk-t-a" href={w.source_url} target="_blank" rel="noreferrer">{w.first_line || 'Source post'}</a>
            : <span>{w.first_line || 'Source post, no link recorded.'}</span>}
        </p>
        <p className="a-mk-figs">
          <span className="a-mk-f">{w.author || 'Author not recorded'}</span>
          <span className="a-mk-f">{w.published_at || 'Date not recorded'}</span>
          <span className="a-mk-f">{comparisonLabel(w)}</span>
        </p>
        <p className="a-ct-sub">
          {w.limitation || 'No limitation note recorded.'}
          {w.legacy ? <Badge tone="neutral" variant="ring" className="a-cev-badge">Legacy method</Badge> : null}
          {low ? <Badge tone="attention" variant="ring" className="a-cev-badge">Small sample</Badge> : null}
        </p>
      </div>
    </li>
  )
}

function OwnRow({ o }: { o: ContentEvidenceOwnResult }) {
  return (
    <li className="a-cev-wrow">
      <div className="a-mk-row">
        <p className="a-mk-t">{o.metric_label} on {o.published_at || 'date not recorded'}</p>
        <p className="a-mk-figs">
          <span className="a-mk-f">{objectiveLabel(o.objective)}</span>
          <span className="a-mk-f">
            {o.observed_value !== null ? o.observed_value.toLocaleString('en-US') : 'not recorded'} {o.metric_label}
          </span>
          <span className="a-mk-f">{o.comparison_label}</span>
          {o.sample_note ? <span className="a-mk-f">{o.sample_note}</span> : null}
        </p>
        <p className="a-ct-sub">{o.limitation || 'No limitation note recorded.'}</p>
      </div>
    </li>
  )
}

export function WinnersPanel({ view, onRetry }: { view: WinnersRead; onRetry?: () => void }) {
  const stamp = <span className="a-dim a-mono">{laneDisplayName(view.clientId)}</span>

  if (view.state === 'failed') {
    return (
      <Group className="a-cev-g" label="Winners" tail={<span className="a-prop-tail"><ReaderStateTag state="failed" />{stamp}</span>} pad>
        <Failed what="The winners read" message={FAILED_MESSAGE} onRetry={onRetry} loadedAt={null}>
          <FailedDetails message={view.message} />
        </Failed>
      </Group>
    )
  }

  if (view.state === 'empty') {
    return (
      <Group className="a-cev-g" label="Winners" tail={<span className="a-prop-tail"><ReaderStateTag state="empty" />{stamp}</span>} pad>
        <CalmEmpty
          line={`No market or own-account winners recorded for ${laneDisplayName(view.clientId)} yet.`}
          sub="A verified market study or a measured own post has not produced a qualifying row yet."
          loadedAt={view.asOf}
        />
      </Group>
    )
  }

  return (
    <Group
      className="a-cev-g"
      label="Winners"
      tail={
        <span className="a-prop-tail">
          <ReaderStateTag state={view.state} />
          {view.state === 'partial' ? <Badge tone="neutral" variant="ring">Thin coverage</Badge> : null}
          {stamp}
        </span>
      }
      pad
    >
      {view.state === 'partial' ? (
        <div className="a-ct-sub">
          Fewer market findings than the coverage floor. Individual examples are shown; a pattern claim
          is not yet supported.
        </div>
      ) : null}

      <section className="a-cev-sec">
        <h3 className="a-eyebrow">Market examples</h3>
        {view.market.length
          ? <ul className="a-mk-tbl">{view.market.map(w => <MarketRow key={w.finding_id} w={w} />)}</ul>
          : <div className="a-ct-sub">No qualifying market examples for this client yet.</div>}
      </section>

      <section className="a-cev-sec">
        <h3 className="a-eyebrow">Our results</h3>
        {view.own.length
          ? <ul className="a-mk-tbl">{view.own.map(o => <OwnRow key={o.post_id} o={o} />)}</ul>
          : <div className="a-ct-sub">No measured own-account result for this client yet.</div>}
      </section>
    </Group>
  )
}
