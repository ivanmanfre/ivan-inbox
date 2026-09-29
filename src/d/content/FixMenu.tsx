import type { ContentDraftDetail } from '../../lib/content'
import { canRestartToIdea } from '../../lib/content'
import { ConfirmProvider } from '../../wb/chrome/ConfirmSheet'
import { DeleteDraft, RegenDraft, RestartDraft } from '../../wb/draft/actions'

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
          <RegenDraft d={d} onDone={onDone} disabled={disabled} label="Rewrite the copy" />
          {canRestartToIdea(d.status, 'ivan') && <RestartDraft d={d} onDone={onDone} disabled={disabled} />}
          <DeleteDraft d={d} disabled={disabled} onDone={onDeleted} />
        </div>
      </ConfirmProvider>
    </section>
  )
}
