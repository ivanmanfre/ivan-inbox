/* ==========================================================================
   INPUTS — collected / connected / current / sufficient, as four distinct
   answers, never folded into one "is it ready" verdict.

   `state` (the reader's read health) and `studyState` (what the study itself
   is) are separate facts on purpose (plan line 291: "Study state and reader
   state are separate"). A client can have a perfectly healthy READ that
   reports a MISSING study — ARCH, 439 stored posts, no validated study yet —
   and that is a coverage gap worth naming plainly, never "ready to recommend"
   and never collapsed into a blank/empty screen just because the study is
   thin.

   PURE. `data` in, markup out, matching the plan's fixture test exactly:
   `<InputsPanel data={{ clientId, state, storedPosts, eligiblePosts,
   studyState, gaps }} />`.
   ========================================================================== */
import { Badge } from '../../../ds'
import { Group } from '../../kit'
import { Failed, relAge } from '../parts'
import { laneDisplayName, type InputsView } from '../../../lib/contentEvidence'
import '../content.css'
import '../proposals-evidence.css'
import { FAILED_MESSAGE, FailedDetails, ReaderStateTag } from './readerState'

// Audit F5 (PRELEASE-AUDIT.md): "validated" is honest only as a claim about
// arithmetic (contracts.mjs grants it when both hashes verify), never as a
// claim that the study supports a recommendation. A bare "Validated" beside
// "Sufficient for this question: Yes" reads as one verdict; they are two
// independent fields (`sufficientForThisQuestion` is never derived from
// `studyState` anywhere in this file) and the label must not blur that.
const STUDY_STATE_LABEL: Record<InputsView['studyState'], string> = {
  missing: 'No study imported yet',
  imported: 'Imported, not yet validated',
  needs_reconciliation: 'Imported, unresolved discrepancy',
  validated: 'Arithmetic verified, descriptive only',
  stale: 'Arithmetic verified, descriptive only, past the freshness window',
  failed: 'The last study read failed',
}

function studyStateLabel(s: InputsView['studyState']): string {
  return STUDY_STATE_LABEL[s] ?? 'Unrecognized item'
}

function count(n: number | null | undefined): string {
  return n === null || n === undefined ? 'not recorded' : n.toLocaleString('en-US')
}

export function InputsPanel({ data, onRetry }: { data: InputsView; onRetry?: () => void }) {
  const stamp = <span className="a-dim a-mono">{laneDisplayName(data.clientId)}</span>

  if (data.state === 'failed') {
    return (
      <Group className="a-cev-g" label="Inputs" tail={<span className="a-prop-tail"><ReaderStateTag state="failed" />{stamp}</span>} pad>
        <Failed what="The inputs read" message={FAILED_MESSAGE} onRetry={onRetry} loadedAt={null}>
          <FailedDetails message={data.message} />
        </Failed>
      </Group>
    )
  }

  return (
    <Group
      className="a-cev-g"
      label="Inputs"
      tail={
        <span className="a-prop-tail">
          <ReaderStateTag state={data.state} />
          {data.state === 'partial' ? <Badge tone="neutral" variant="ring">Coverage gap</Badge> : null}
          {data.state === 'empty' ? <Badge tone="neutral" variant="ring">Nothing collected</Badge> : null}
          {stamp}
        </span>
      }
      pad
    >
      {data.studyState === 'missing' ? (
        <div className="a-ct-sub">
          No verified market study for {laneDisplayName(data.clientId)} yet.
          {data.storedPosts !== null
            ? ' Existing source posts are available; author baselines and full-post labels still need review.'
            : ''}
        </div>
      ) : null}

      <div className="a-cev-inputs-grid">
        <div className="a-cev-f">
          <span className="a-eyebrow">Collected</span>
          <span className="a-prop-v">{count(data.storedPosts)} stored posts</span>
          {data.publicationWindow?.from || data.publicationWindow?.to ? (
            <span className="a-ct-sub">
              {data.publicationWindow?.from ?? 'window start not recorded'} to {data.publicationWindow?.to ?? 'window end not recorded'}
            </span>
          ) : <span className="a-ct-sub">Publication window not recorded.</span>}
        </div>

        <div className="a-cev-f">
          <span className="a-eyebrow">Connected</span>
          {data.connectedConsumers?.length ? (
            data.connectedConsumers.map(cn => <span className="a-prop-v" key={cn}>{cn}</span>)
          ) : <span className="a-prop-v">No connected surface recorded.</span>}
        </div>

        <div className="a-cev-f">
          <span className="a-eyebrow">Current</span>
          <span className="a-prop-v">
            {data.lastSuccessfulCollection ? `Last successful collection ${relAge(data.lastSuccessfulCollection)}` : 'No successful collection recorded.'}
          </span>
          <span className="a-ct-sub">{studyStateLabel(data.studyState)}</span>
        </div>

        <div className="a-cev-f">
          <span className="a-eyebrow">Sufficient for this question</span>
          <span className="a-prop-v">{data.sufficientForThisQuestion ? 'Yes' : 'Not yet'}</span>
          {data.sufficiencyReason ? <span className="a-ct-sub">{data.sufficiencyReason}</span> : null}
        </div>
      </div>

      <div className="a-cev-f">
        <span className="a-eyebrow">Eligible</span>
        <span className="a-prop-v">{count(data.eligiblePosts)} eligible posts, {count(data.eligibleAuthors)} eligible authors</span>
      </div>

      {data.gaps.length ? (
        <div className="a-cev-f">
          <span className="a-eyebrow">Exact gaps</span>
          {data.gaps.map(g => <span className="a-prop-v" key={g}>{g}</span>)}
        </div>
      ) : (
        <div className="a-ct-sub">No gap is recorded against this study.</div>
      )}
    </Group>
  )
}
