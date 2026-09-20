/* ==========================================================================
   THIS WEEK — up to three compact cards, a coverage line, and one Evidence
   control per card that opens the calculation the card's sentence came from.

   PURE. `view` in, markup out — no fetch, no lane. The block below this one
   owns the read; this file owns only what a `ThisWeekRead` looks like on
   screen, so a test can render every state (ready/partial/empty/stale/failed)
   from a literal without a network.
   ========================================================================== */
import { useEffect, useRef, useState } from 'react'
import { Badge, Button } from '../../../ds'
import { Group } from '../../kit'
import { CalmEmpty, Failed, relAge } from '../parts'
import { laneDisplayName, objectiveLabel, type ContentEvidenceCandidate, type ThisWeekRead } from '../../../lib/contentEvidence'
import { ReaderStateTag } from './readerState'
// `.a-prop-*` / `.a-ct-sub` / `.a-eyebrow` (content.css) and the `.a-prop-history`
// disclosure (proposals-evidence.css) are reused rather than reinvented — the
// same visual language the Recommendations tab already uses for a "review
// evidence" disclosure.
import '../content.css'
import '../proposals-evidence.css'

function EvidenceDetail({ c, id }: { c: ContentEvidenceCandidate; id: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  return (
    <div
      id={id}
      ref={ref}
      data-testid="evidence-detail"
      className="a-cev-detail"
      tabIndex={-1}
      role="region"
      aria-label="Calculation detail"
    >
      <div className="a-cev-f">
        <span className="a-eyebrow">Calculation</span>
        <span className="a-prop-v">{c.detail.calculation}</span>
      </div>
      {c.detail.formula ? (
        <div className="a-cev-f">
          <span className="a-eyebrow">Formula</span>
          <span className="a-prop-v a-mono">{c.detail.formula}</span>
        </div>
      ) : null}
      <div className="a-cev-f">
        <span className="a-eyebrow">Dates</span>
        <span className="a-prop-v">
          {c.detail.published_at ? `Published ${c.detail.published_at}` : 'Publish date not recorded.'}
          {c.detail.captured_at ? `, captured ${c.detail.captured_at}` : ''}
        </span>
      </div>
      {c.detail.limitations.length ? (
        <div className="a-cev-f">
          <span className="a-eyebrow">Limitations</span>
          {c.detail.limitations.map(l => <span className="a-ct-sub" key={l}>{l}</span>)}
        </div>
      ) : null}
      {c.detail.method_version ? (
        <div className="a-cev-f">
          <span className="a-eyebrow">Method</span>
          <span className="a-prop-v a-mono">{c.detail.method_version}</span>
        </div>
      ) : null}
      {c.detail.full_source_text ? (
        <details className="a-prop-history">
          <summary>Full source text</summary>
          <div className="a-prop-v">{c.detail.full_source_text}</div>
        </details>
      ) : null}
    </div>
  )
}

function CandidateCard({ c }: { c: ContentEvidenceCandidate }) {
  const [open, setOpen] = useState(false)
  // The DS `Button` is a plain function component with no forwarded ref, so
  // focus-return is tracked by capturing WHATEVER had focus at the moment of
  // opening (the trigger, whatever element it turns out to be) rather than by
  // holding a ref to the button itself.
  const triggerRef = useRef<HTMLElement | null>(null)
  const detailId = `a-cev-detail-${c.id}`

  const openDetail = () => {
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setOpen(true)
  }
  const closeDetail = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <li className="a-cev-card" data-experiment={c.is_experiment ? '' : undefined}>
      <div className="a-cev-card-head">
        <span className="a-cev-topic">{c.topic}</span>
        {c.is_experiment ? <Badge tone="accent" variant="ring">Experiment</Badge> : null}
      </div>
      <p className="a-cev-sentence">{c.evidence_sentence || 'Evidence sentence not stated.'}</p>
      <div className="a-cev-f">
        <span className="a-eyebrow">Client material</span>
        <span className="a-prop-v">
          {c.needs_material
            ? 'Needs material.'
            : (c.client_material?.trim() || 'Not stated.')}
        </span>
      </div>
      <div className="a-cev-f">
        <span className="a-eyebrow">Objective</span>
        <span className="a-prop-v">{objectiveLabel(c.objective)}</span>
      </div>
      {c.is_experiment ? (
        <div className="a-cev-f">
          <span className="a-eyebrow">Why an experiment</span>
          <span className="a-prop-v">{c.experiment_reason?.trim() || 'Reason not stated.'}</span>
          {c.test_metric ? <span className="a-ct-sub">Test metric: {c.test_metric}</span> : null}
        </div>
      ) : null}
      <div className="a-cev-card-foot">
        {c.source_url ? (
          <a className="a-prop-src" href={c.source_url} target="_blank" rel="noreferrer">
            {c.source_label?.trim() || 'Source post'}
          </a>
        ) : (
          <span className="a-prop-src a-dim">{c.source_label?.trim() || 'No source link recorded.'}</span>
        )}
        <Button
          data-testid="evidence-detail-toggle"
          variant="quiet"
          size="sm"
          aria-expanded={open}
          aria-controls={detailId}
          onClick={() => (open ? closeDetail() : openDetail())}
        >
          {open ? 'Hide evidence' : 'Evidence'}
        </Button>
      </div>
      {open ? (
        <div onKeyDown={e => { if (e.key === 'Escape') closeDetail() }}>
          <EvidenceDetail c={c} id={detailId} />
        </div>
      ) : null}
    </li>
  )
}

export function ThisWeekPanel({ view, onRetry }: { view: ThisWeekRead; onRetry?: () => void }) {
  const stamp = <span className="a-dim a-mono">{laneDisplayName(view.clientId)}</span>

  if (view.state === 'failed') {
    return (
      <div data-testid="strategy-this-week">
        <Group className="a-cev-g" label="This week" tail={<span className="a-prop-tail"><ReaderStateTag state="failed" />{stamp}</span>} pad>
          <Failed what="This week's evidence" message={view.message ?? 'The read failed.'} onRetry={onRetry} loadedAt={null} />
        </Group>
      </div>
    )
  }

  if (view.state === 'empty') {
    return (
      <div data-testid="strategy-this-week">
        <Group className="a-cev-g" label="This week" tail={<span className="a-prop-tail"><ReaderStateTag state="empty" />{stamp}</span>} pad>
          <CalmEmpty
            line={`No evidence-backed picks for ${laneDisplayName(view.clientId)} yet.`}
            sub={view.missingInputs[0] ?? 'Source posts may exist without a validated study behind them yet.'}
            loadedAt={view.asOf}
          />
        </Group>
      </div>
    )
  }

  return (
    <div data-testid="strategy-this-week">
      <Group
        className="a-cev-g"
        label="This week"
        tail={
          <span className="a-prop-tail">
            <ReaderStateTag state={view.state} />
            {view.state === 'partial' ? <Badge tone="neutral" variant="ring">Coverage gap</Badge> : null}
            {stamp}
          </span>
        }
        pad
      >
        <div className="a-ct-sub">{view.coverageLine}</div>
        {view.state === 'stale' ? (
          <div className="a-ct-sub a-sev-attention">
            This read is older than the freshness window. Showing what last computed, {relAge(view.asOf)}.
          </div>
        ) : null}
        {view.missingInputs.length ? (
          <div className="a-ct-sub">{view.missingInputs.join(' ')}</div>
        ) : null}
        <ul className="a-cev-cards">
          {view.candidates.slice(0, 3).map(c => <CandidateCard key={c.id} c={c} />)}
        </ul>
      </Group>
    </div>
  )
}
