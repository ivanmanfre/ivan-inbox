import type { ContentDraftDetail } from '../../lib/content'
import { canRestartToIdea } from '../../lib/content'
import { ConfirmProvider } from '../../wb/chrome/ConfirmSheet'
import { DeleteDraft, RegenDraft, RestartDraft, SwapImage } from '../../wb/draft/actions'
import { Sheet } from '../ui/Sheet'

// "Fix or remove": Regenerate · Swap image · Back to idea · Delete draft.
// These four are TODAY'S components, mounted unchanged inside a D sheet (every
// guard, confirm and string is theirs), with today's confirm provider around
// them so their own sheets answer. Ivan's lane only, like their writes.
// Delete draft then walks to the next row (or closes), as today's shelf does.
export function FixMenu({ d, open, onClose, onDone, onDeleted }: { d: ContentDraftDetail; open: boolean; onClose: () => void; onDone: () => void; onDeleted: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Fix or remove" sub="Today's controls, unchanged. Each one asks before it writes.">
      <ConfirmProvider>
        <div className="cn-fix a-dw">
          <div className="a-dw-shelf">
            <RegenDraft d={d} onDone={onDone} />
            <SwapImage d={d} onDone={onDone} />
            {canRestartToIdea(d.status, 'ivan') && <RestartDraft d={d} onDone={onDone} />}
            <DeleteDraft d={d} onDone={() => { onClose(); onDeleted() }} />
          </div>
        </div>
      </ConfirmProvider>
    </Sheet>
  )
}
