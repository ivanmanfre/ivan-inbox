import type { ContentDraft, ContentDraftDetail, ContentLane } from '../../lib/content'
import { canRestartToIdea } from '../../lib/content'
import { ConfirmProvider } from '../../wb/chrome/ConfirmSheet'
import { DeleteDraft, RegenDraft, RestartDraft } from '../../wb/draft/actions'
import { RetryDraft } from '../../wb/content/actions'
import { canRetryLane } from '../../lib/studioActions'

// FIX OR REMOVE, as real keys in the open post (29 Sep: they were one line of
// footer link text that opened a sheet). Rewrite the copy (today's Regenerate,
// named for what it does: it re-runs the pipeline over the copy and keeps a
// pinned image unless asked) · Back to idea · Delete draft. These are TODAY'S
// components, mounted unchanged (every guard, confirm and string is theirs),
// with today's confirm provider around them. Ivan's lane only, like their
// writes. Delete draft then walks to the next row (or closes).
export function FixRow({ d, onDone, onDeleted, disabled }: { d: ContentDraftDetail; onDone: () => void; onDeleted: () => void; disabled?: boolean }) {
  return (
    <section className="cn-fix2" aria-label="Fix or remove">
      <small className="cn-cap">Fix or remove</small>
      <ConfirmProvider>
        <div className="cn-fix2-row a-dw">
          {/* A scheduled post's queue row takes the new body at once (propagate trigger), so a rewrite
              there would publish unreviewed copy: unschedule first (audit 2026-10-08). */}
          <RegenDraft d={d} onDone={onDone} disabled={disabled || d.status === 'scheduled'} label="Rewrite the copy" />
          {canRestartToIdea(d.status, 'ivan') && <RestartDraft d={d} onDone={onDone} disabled={disabled} />}
          <DeleteDraft d={d} disabled={disabled} onDone={onDeleted} />
        </div>
      </ConfirmProvider>
      {d.status === 'scheduled' && <p className="cn-dim">Rewriting is off while it is scheduled: the new copy would go out unreviewed. Unschedule it first.</p>}
    </section>
  )
}

/** Existing client generator, with a deliberate replacement decision for protected internal copy. */
export function ClientFixRow({ d, lane, onDone, disabled }: { d: ContentDraftDetail; lane: ContentLane; onDone: () => void; disabled?: boolean }) {
  if (!canRetryLane(lane)) return <p className="cn-dim">This client has no available retry generator. Keep this draft for inspection; no retry has been started.</p>
  return <section className="cn-fix2" aria-label="Recover this draft">
    <small className="cn-cap">Recover this draft</small>
    <ConfirmProvider><div className="cn-fix2-row a-dw">
      <RetryDraft d={d as unknown as ContentDraft} lane={lane} onDone={onDone} disabled={disabled} allowProtectedCopy label="Regenerate copy" />
    </div></ConfirmProvider>
    <p className="cn-dim">Runs this client's generator after confirmation. The result stays internal for review.</p>
  </section>
}
