import { useState } from 'react'
import { useConfirm } from '../../components/ConfirmSheet'
import {
  draftFailure, LANE_POSSESSIVE, type ContentDraft, type ContentLane,
} from '../../lib/content'
import {
  canRetryLane, isHumanEdited, planRegen, regenerateClientDraft, regenerateDraft,
} from '../../lib/studioActions'

// RETRY, ON THE ROW.
//
// Regeneration already existed and it lived one takeover deep, behind a
// disclosure, on Ivan's lane only (DraftPane.tsx, `RegenDraft`): open the row,
// click Regenerate, then pick "Copy only" or "Copy + new image", plus a fourth
// click to clear the edit guard when it applies. Measured at 3-4 interactions
// and one full-screen takeover per row, with 48 errored rows on that lane
// waiting, which is roughly 168 interactions to work the pile.
//
// This is the same write, reached from the card, behind ONE confirm.
//
// 🔴 THREE THINGS IT DELIBERATELY DOES NOT DO
//
//  1. NO BULK. A regeneration is a real model bill per row, so it is never a
//     capability the bulk bar can see: `RowCap` has no 'retry' member, and that
//     is the enforcement, not a disabled button. Fifty-five rows retried by one
//     click is a bill nobody chose to pay.
//  2. NO IMAGE FORK. The card's confirm is copy-only, always, which is the
//     option that KEEPS a hand-pinned photo (post-gen only writes image_urls
//     when include_image='Yes', the "regen wipes image_urls" trap). Asking for
//     a new image stays a takeover decision, because it destroys something.
//  3. NO GUARD OVERRIDE. db/025 refuses a service_role write over a
//     human-edited body, so a regen on an edited row runs for minutes and lands
//     nothing. The card says so and refuses rather than spending the bill; the
//     documented escape hatch stays where it already is, in the takeover, as
//     its own deliberate act.
//
// 🔴 EVERY LANE THAT HAS A LIVE GENERATOR, since 2026-08-24. Ivan: "in the
// errors section there is no regen option, so I can only delete it. It's kind
// of weird."
//
// It was Ivan-only because `regenerateDraft` fires post-gen with
// `author: 'Ivan'` and pointing that at a client row would write Ivan's voice
// onto Mattan's post. That reasoning holds and the conclusion did not: the
// client lane has its OWN generator taking the same call
// (`regenerateClientDraft`, studioActions.ts), so the fix is to fire the right
// one rather than to refuse. `canRetryLane` is the gate, and a lane whose
// generator is inactive — ARCH's is born-dead — still gets no button, because a
// retry that flips a row to `generating` with nothing listening is a silent
// stall and worse than no button at all.
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

  // A Fragment: these are children of the reason row itself, so the button sits
  // beside the sentence that explains why it is there, and any message claims a
  // line of its own under both (`.ct-retry-msg` is `flex-basis:100%`).
  return (
    <>
      {/* A tap on the card opens the takeover; this button must not also do that. */}
      <button
        type="button"
        className="btn s ct-retry"
        disabled={busy}
        title={guarded
          ? 'This draft carries your own edit, which the database protects from the pipeline.'
          : 'Runs the pipeline again on this one draft. Costs a generation.'}
        onClick={e => { e.stopPropagation(); void run() }}
      >
        {busy ? 'Firing…' : 'Retry'}
      </button>
      {note && <div className="ct-retry-msg ct-subtle">{note}</div>}
      {err && <div className="ct-retry-msg ops-err">{err}</div>}
    </>
  )
}
