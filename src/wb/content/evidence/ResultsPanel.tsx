/* ==========================================================================
   RESULTS — published choices, their evaluation age, observed outcomes,
   incomplete measurements and prior failures. An `awaiting_publication`
   choice is shown as PENDING, never as a success or a failure — the plan is
   explicit that a post awaiting publication or measurement "stays pending,
   rather than being counted as a failed result."

   PURE. `view` in, markup out.
   ========================================================================== */
import { Badge } from '../../../ds'
import { Group } from '../../kit'
import { CalmEmpty, Failed } from '../parts'
import { choiceStatusLabel, laneDisplayName, objectiveLabel, type ContentEvidenceChoice, type ResultsRead } from '../../../lib/contentEvidence'
import '../content.css'
import '../markets/markets.css'
import '../proposals-evidence.css'
import { FAILED_MESSAGE, FailedDetails, ReaderStateTag } from './readerState'

const PENDING_STATUSES = new Set(['awaiting_publication', 'measuring', 'ready_for_review', 'approved', 'candidate', 'needs_material'])

function ChoiceRow({ c }: { c: ContentEvidenceChoice }) {
  const pending = PENDING_STATUSES.has(c.status)
  return (
    <li className="a-cev-wrow">
      <div className="a-mk-row">
        <p className="a-mk-t">{c.topic}</p>
        <p className="a-mk-figs">
          <span className="a-mk-f">{choiceStatusLabel(c.status)}</span>
          <span className="a-mk-f">{objectiveLabel(c.objective)}</span>
          <span className="a-mk-f">{c.published_at ? `Published ${c.published_at}` : 'Not published yet'}</span>
          {c.evaluation_age_days !== null ? <span className="a-mk-f">{c.evaluation_age_days}d since evaluation started</span> : null}
        </p>
        {pending ? (
          <p className="a-ct-sub">Pending. Not counted as a success or a failure while it waits.</p>
        ) : c.outcome ? (
          <p className="a-ct-sub">
            {c.outcome.metric_label}: {c.outcome.observed_value !== null ? c.outcome.observed_value.toLocaleString('en-US') : 'not recorded'}, {c.outcome.comparison_label}
          </p>
        ) : (
          <p className="a-ct-sub">No outcome recorded for this choice.</p>
        )}
        {c.incomplete_measurement ? <p className="a-ct-sub a-sev-attention">Measurement is incomplete.</p> : null}
        {c.denominator_note ? <p className="a-ct-sub">{c.denominator_note}</p> : null}
      </div>
    </li>
  )
}

export function ResultsPanel({ view, onRetry }: { view: ResultsRead; onRetry?: () => void }) {
  const stamp = <span className="a-dim a-mono">{laneDisplayName(view.clientId)}</span>

  if (view.state === 'failed') {
    return (
      <Group className="a-cev-g" label="Results" tail={<span className="a-prop-tail"><ReaderStateTag state="failed" />{stamp}</span>} pad>
        <Failed what="The results read" message={FAILED_MESSAGE} onRetry={onRetry} loadedAt={null}>
          <FailedDetails message={view.message} />
        </Failed>
      </Group>
    )
  }

  if (view.state === 'empty') {
    return (
      <Group className="a-cev-g" label="Results" tail={<span className="a-prop-tail"><ReaderStateTag state="empty" />{stamp}</span>} pad>
        <CalmEmpty
          line={`No published choice recorded for ${laneDisplayName(view.clientId)} yet.`}
          sub="Nothing has been published from the evidence-backed picks yet, so there is nothing to evaluate."
          loadedAt={view.asOf}
        />
      </Group>
    )
  }

  const shown = view.choices.slice(0, 3)
  const rest = view.choices.slice(3)

  return (
    <Group
      className="a-cev-g"
      label="Results"
      tail={
        <span className="a-prop-tail">
          <ReaderStateTag state={view.state} />
          {view.state === 'partial' ? <Badge tone="neutral" variant="ring">Incomplete measurement</Badge> : null}
          {stamp}
        </span>
      }
      pad
    >
      <ul className="a-mk-tbl">{shown.map(c => <ChoiceRow key={c.id} c={c} />)}</ul>

      {rest.length ? (
        <details className="a-prop-history">
          <summary>Every published choice, {rest.length} more</summary>
          <ul className="a-mk-tbl">{rest.map(c => <ChoiceRow key={c.id} c={c} />)}</ul>
        </details>
      ) : null}

      {view.priorFailures.length ? (
        <section className="a-cev-sec">
          <h3 className="a-eyebrow">Prior failed tests</h3>
          {view.priorFailures.map(f => (
            <div className="a-cev-f" key={f.id}>
              <span className="a-prop-v">{f.topic}</span>
              <span className="a-ct-sub">{f.reason}</span>
            </div>
          ))}
        </section>
      ) : null}
    </Group>
  )
}
