/* ==========================================================================
   The row's four writes, each one the SAME call the old row made, behind the
   same confirm, in the same words.

   Copied from `src/exp/v2c/ReviewActions.tsx`, `src/exp/v2c/RetryDraft.tsx`
   and the `RowDelete` / `PromoteRow` pieces private to
   `src/exp/v2c/ContentList.tsx`. Nothing here decides anything new: the "may
   this row be actioned at all" rules stay in `lib/content.ts`, which is where
   they are unit-tested.
   ========================================================================== */
import { useRef, useState } from 'react'
import { useConfirm } from '../chrome/ConfirmSheet'
import {
  approveDraft, boardGroupOf, canPromote, deleteClientDraft, deleteDraft, draftFailure,
  LANE_LABEL, LANE_POSSESSIVE, setBoardVisible, skipDraft,
  type ContentDraft, type ContentLane,
} from '../../lib/content'
import {
  canRetryLane, isHumanEdited, planRegen, regenerateClientDraft, regenerateDraft,
} from '../../lib/studioActions'
import { Button } from '../../ds'
import './content.css'

// §10.5 — the app's ONE choreographed beat. The row lifts and fades over
// --ds-dur, the refetch fires when the movement ENDS (the list never jumps
// under a hand), and the count above lands on its new value as it does. Under
// prefers-reduced-motion the animation is collapsed by CSS, so the delay is
// skipped and the refetch is immediate.
const BEAT_MS = 200

function reducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

function playBeat(from: HTMLElement | null, then: () => void): void {
  const row = from?.closest('.a-ct-row') as HTMLElement | null
  if (!row || reducedMotion()) { then(); return }
  row.setAttribute('data-beat', '')
  window.setTimeout(then, BEAT_MS)
}

/** Approve and Skip. The only two status writes the Content tab makes, and
    neither one publishes anything. */
export function ReviewActions({ id, onDone, demoteApprove }: {
  id: string
  onDone: () => void
  /** Approve on a row that already failed is not the recommended action. It
      stays available and stops wearing the primary weight. */
  demoteApprove?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const confirm = useConfirm()
  const rootRef = useRef<HTMLSpanElement>(null)

  async function run(kind: 'approve' | 'skip') {
    const ok = await confirm(kind === 'approve' ? {
      title: 'Approve this draft?',
      message: 'Marks approved. Nothing publishes — scheduling stays on the board.',
      confirmText: 'Approve',
    } : {
      title: 'Skip this draft?',
      message: 'Marks it disqualified — it drops out of the queue for good.',
      confirmText: 'Skip',
      danger: true,
    })
    if (!ok) return
    setBusy(true); setError('')
    try {
      await (kind === 'approve' ? approveDraft(id) : skipDraft(id))
      // The beat plays only on APPROVE — intensity in proportion to rarity; a
      // skip just leaves.
      if (kind === 'approve') playBeat(rootRef.current, onDone)
      else onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not ${kind}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span ref={rootRef} className="a-ct-acts" onClick={e => e.stopPropagation()}>
      {error && <span className="a-ct-err">{error}</span>}
      <Button variant="quiet" size="sm" disabled={busy} onClick={() => run('skip')}>Skip</Button>
      <Button
        variant={demoteApprove ? 'quiet' : 'primary'} size="sm" busy={busy}
        onClick={() => run('approve')}
      >
        {busy ? 'Working…' : 'Approve'}
      </Button>
    </span>
  )
}

/** RETRY, ON THE ROW. The same regeneration the takeover fires, copy only,
    behind ONE confirm, on every lane whose generator is live. */
export function RetryDraft({ d, lane, onDone }: {
  d: ContentDraft
  lane: ContentLane
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const confirm = useConfirm()

  if (!canRetryLane(lane)) return null

  const guarded = isHumanEdited(d)
  const plan = planRegen(d)
  const failure = draftFailure(d)
  const kind = plan.postFormat.toLowerCase()

  async function run() {
    // The guard is the one case where firing costs money and lands nothing, so
    // it is refused here instead of confirmed and wasted.
    if (guarded) {
      await confirm({
        title: 'Your own edit is protecting this draft',
        message:
          'You edited this post by hand, so the database refuses to let the pipeline overwrite your words. '
          + 'A retry from here would run for minutes and change nothing. Open the draft and use Regenerate '
          + 'there, which can clear that protection as its own decision.',
        confirmText: 'Understood',
      })
      return
    }

    const ok = await confirm({
      title: `Run the pipeline again for this ${kind}?`,
      message:
        `This spends a real generation on one draft and replaces its copy. `
        + `${lane === 'ivan' ? '' : `It runs ${LANE_POSSESSIVE[lane]} generator, in his voice, and the draft stays internal. `}`
        + `${plan.keepsPinnedImage ? 'Your pinned image is kept. ' : ''}`
        + `The row leaves this list for Generating and comes back in minutes. `
        + `${failure.kind === 'completed'
          ? 'Worth knowing first: the last thing this row logged was a pass, so the copy sitting on it may already be finished.'
          : ''}`,
      confirmText: 'Run it again',
    })
    if (!ok) return

    setBusy(true); setErr(''); setNote('')
    try {
      const p = lane === 'ivan'
        ? await regenerateDraft(d, false)
        : await regenerateClientDraft(d, lane)
      setNote(`Firing ${p.postFormat} (copy only). It sits in Generating until it lands.`)
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start the regeneration')
    } finally { setBusy(false) }
  }

  return (
    <>
      <Button
        variant="quiet" size="sm" busy={busy}
        title={guarded
          ? 'This draft carries your own edit, which the database protects from the pipeline.'
          : 'Runs the pipeline again on this one draft. Costs a generation.'}
        onClick={e => { e.stopPropagation(); void run() }}
      >
        {busy ? 'Firing…' : 'Retry'}
      </Button>
      {note && <span className="a-ct-msg">{note}</span>}
      {err && <span className="a-ct-msg a-ct-err">{err}</span>}
    </>
  )
}

/** Removing a row WITHOUT opening it. The board rows keep their guard:
    deleting a promoted draft leaves a ghost copy on the client's live board,
    so the control renders only where the delete is legal. */
export function RowDelete({ d, lane, onDone }: { d: ContentDraft; lane: ContentLane; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const confirm = useConfirm()
  if (lane !== 'ivan' && boardGroupOf(d) === 'board') return null
  const run = async (e: React.MouseEvent) => {
    // A tap on the row opens the window; this must not also fire that.
    e.stopPropagation()
    const ok = await confirm({
      title: 'Delete this draft?',
      message: lane !== 'ivan'
        ? `${LANE_LABEL[lane]} has never seen it, and this removes it permanently.`
        : 'This removes it permanently.',
      confirmText: 'Delete',
      danger: true,
    })
    if (!ok) return
    setBusy(true); setErr('')
    try {
      await (lane !== 'ivan' ? deleteClientDraft(d.id, d.taxonomy) : deleteDraft(d.id, d.taxonomy))
      onDone()
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Could not delete')
      setBusy(false)
    }
  }
  return (
    <>
      {err && <span className="a-ct-err">{err}</span>}
      <Button
        variant="quiet" size="sm" busy={busy}
        title="Delete draft" aria-label="Delete draft"
        onClick={run}
      >{busy ? '…' : 'Delete'}</Button>
    </>
  )
}

/** PROMOTE, ON THE ROW. The same `setBoardVisible` write the takeover makes,
    with the same consequence stated in the same words. It is not a status
    write and it is not an approve. */
export function PromoteRow({ d, lane, onDone }: { d: ContentDraft; lane: ContentLane; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const confirm = useConfirm()
  if (!canPromote(d.status, lane)) return null
  const who = LANE_LABEL[lane]
  const run = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const ok = await confirm({
      title: `Put this on ${LANE_POSSESSIVE[lane]} board?`,
      message:
        `${who} sees it. This is the one action here that reaches a client, and it fires his board’s own `
        + `sync, so it lands within moments and not at some later batch. From there the decisions are his: `
        + `approve, edit, veto, schedule. Nothing publishes: this writes board visibility and never touches `
        + `the publisher.`,
      confirmText: 'Put it on his board',
    })
    if (!ok) return
    setBusy(true); setErr('')
    try {
      await setBoardVisible(d.id, true)
      onDone()
    } catch (er) {
      // ClientRpcError carries the database's own refusal code, so the row says
      // WHICH rule refused rather than "something went wrong".
      setErr(er instanceof Error ? er.message : 'Could not put it on the board')
      setBusy(false)
    }
  }
  return (
    <>
      {err && <span className="a-ct-err">{err}</span>}
      <span className="a-ct-acts" onClick={e => e.stopPropagation()}>
        <Button variant="primary" size="sm" busy={busy} onClick={run}>
          {busy ? 'Putting it up…' : 'To board'}
        </Button>
      </span>
    </>
  )
}
