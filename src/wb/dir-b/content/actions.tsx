import { useRef, useState } from 'react'
import { useConfirm } from '../../../components/ConfirmSheet'
import {
  approveDraft, boardGroupOf, canPromote, deleteClientDraft, deleteDraft,
  draftFailure, LANE_LABEL, LANE_POSSESSIVE, setBoardVisible, skipDraft,
  type ContentDraft, type ContentLane,
} from '../../../lib/content'
import {
  canRetryLane, isHumanEdited, planRegen, regenerateClientDraft, regenerateDraft,
} from '../../../lib/studioActions'
import { Button } from '../../../ds'

// The row's four write controls, copied out of ReviewActions.tsx, RetryDraft.tsx
// and ContentList.tsx. Every confirm title, every confirm message, every busy
// word and every guard is the one that shipped; only the button primitive
// changed (`.btn p` / `.btn s` became `Button variant`).

// §10.5 — the app's ONE choreographed beat. The row lifts and fades over
// --dur-beat, the refetch fires when the movement ENDS (the list never jumps
// under a hand), and the section count above ticks as it lands on its new
// value. Under prefers-reduced-motion the animation is disabled, so the delay is
// skipped and the refetch is immediate.
const BEAT_MS = 200

function reducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

function playBeat(from: HTMLElement | null, then: () => void): void {
  const card = from?.closest('.dirb-card') as HTMLElement | null
  if (!card || reducedMotion()) { then(); return }
  card.classList.add('dirb-approving')
  const count = card.closest('section, div')?.querySelector('.dirb-block-tail')
  window.setTimeout(() => {
    count?.classList.add('dirb-ticked')
    window.setTimeout(() => count?.classList.remove('dirb-ticked'), BEAT_MS + 50)
    then()
  }, BEAT_MS)
}

// The ONLY mutating affordance in the Content tab that writes a status: approve
// is a status write that does NOT publish, skip persists as 'disqualified', and
// a client lane never shows either (client-facing decisions stay on the client
// board behind its own gates).
export function ReviewActions({ id, onDone, compact, demoteApprove }: {
  id: string
  onDone: () => void
  compact?: boolean
  // Approve on a row that already failed is not the recommended action. It stays
  // available (Skip is not the only way out, and a false error does happen) but
  // it stops wearing the primary weight that tells the eye "do this one".
  demoteApprove?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const confirm = useConfirm()
  const rootRef = useRef<HTMLDivElement>(null)

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
      // The beat plays only on APPROVE — intensity in proportion to rarity;
      // a skip just leaves.
      if (kind === 'approve') playBeat(rootRef.current, onDone)
      else onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not ${kind}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {error && <div className="dirb-err">{error}</div>}
      {/* A tap on a card opens the draft window; the buttons must not also fire that. */}
      <div ref={rootRef} className="dirb-row-wrap" onClick={e => e.stopPropagation()}>
        <Button size={compact ? 'sm' : 'md'} variant="outline" disabled={busy} onClick={() => run('skip')}>Skip</Button>
        <Button
          size={compact ? 'sm' : 'md'}
          variant={demoteApprove ? 'outline' : 'primary'}
          busy={busy} disabled={busy} onClick={() => run('approve')}
        >
          {busy ? 'Working…' : 'Approve'}
        </Button>
      </div>
    </>
  )
}

// RETRY, ON THE ROW. The same write the takeover makes, behind ONE confirm.
// No bulk (RowCap has no 'retry' member), no image fork (copy only, which is the
// option that KEEPS a hand-pinned photo), no guard override.
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
      {/* A tap on the card opens the takeover; this button must not also do that. */}
      <Button
        size="sm" variant="outline" busy={busy} disabled={busy}
        title={guarded
          ? 'This draft carries your own edit, which the database protects from the pipeline.'
          : 'Runs the pipeline again on this one draft. Costs a generation.'}
        onClick={e => { e.stopPropagation(); void run() }}
      >
        {busy ? 'Firing…' : 'Retry'}
      </Button>
      {note && <div className="dirb-note dirb-dim">{note}</div>}
      {err && <div className="dirb-note dirb-err">{err}</div>}
    </>
  )
}

// PROMOTE, ON THE ROW. The SAME `setBoardVisible` write the takeover makes, with
// the same consequence stated in the same words, reached from the row.
//
// 🔴 It is not a status write and it is not an approve. `approveDraft` is scoped
// to Ivan's lane, and pointing it at a client row would set status='approved',
// which is the one value operator_set_board_visible refuses (`not_in_review`).
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
      {err && <div className="dirb-err">{err}</div>}
      <div className="dirb-row-wrap" onClick={e => e.stopPropagation()}>
        <Button size="sm" variant="primary" busy={busy} disabled={busy} onClick={run}>
          {busy ? 'Putting it up…' : 'To board'}
        </Button>
      </div>
    </>
  )
}

// Removing a row WITHOUT opening it. Same writes the draft window uses, same
// confirm wording. The board rows keep their guard: deleting a promoted draft
// leaves a ghost copy on the client's live board, so the control renders only
// where the delete is legal.
export function RowDelete({ d, lane, onDone }: { d: ContentDraft; lane: ContentLane; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const confirm = useConfirm()
  if (lane !== 'ivan' && boardGroupOf(d) === 'board') return null
  const run = async (e: React.MouseEvent) => {
    // A tap on the card opens the window; delete must not also fire that.
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
      {err && <span className="dirb-err">{err}</span>}
      <Button
        size="sm" variant="quiet" disabled={busy}
        title="Delete draft" aria-label="Delete draft"
        onClick={run}
      >{busy ? '…' : 'Delete'}</Button>
    </>
  )
}
