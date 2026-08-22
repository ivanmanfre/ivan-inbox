import { useState } from 'react'
import { useConfirm } from '../../components/ConfirmSheet'
import { type ContentDraft, type ContentLane, draftFailure } from '../../lib/content'
import { isHumanEdited, planRegen, regenerateDraft } from '../../lib/studioActions'

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
// Ivan lane only, exactly as `RegenDraft` is: `regenerateDraft` fires post-gen
// with `author: 'Ivan'`, so pointing it at a client row would run the wrong
// pipeline over a client's draft.
export function RetryDraft({ d, lane, onDone }: {
  d: ContentDraft
  lane: ContentLane
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const confirm = useConfirm()

  if (lane !== 'ivan') return null

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
      const p = await regenerateDraft(d, false)
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
