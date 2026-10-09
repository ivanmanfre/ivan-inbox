import type { ContentDraft } from '../../lib/content'
import { Sheet } from '../ui/Sheet'
import { FEED, LANE_NAME, splitTitleTag, titleOf, type Lane } from './model'
import { WhenEditor } from './WhenEditor'

// MOVE TO ANOTHER DAY, in a sheet (phone, the Review desk, the week stack). The editor is the
// calendar's WhenEditor: time you type into, a month you page, quick days, Undo on the receipt.
// `quickCommit`: a tap on a day saves at once at the time shown.
export function MovePanel({ r, lane, seatRows, onClose, onDone, initialPick, quickCommit = false, gap = null }: {
  quickCommit?: boolean
  r: ContentDraft; lane: Lane; first?: string; seatRows: ContentDraft[]; phone?: boolean
  onClose: () => void; onDone: () => void; onLand?: (key: string | null) => void
  /** A day dropped on (drag) or asked for; any date. */
  initialPick?: string | null
  gap?: string | null
}) {
  return (
    <Sheet open onClose={onClose} title={r.scheduled_at ? 'Change date or time' : 'Give it a date'} sub={`${splitTitleTag(titleOf(r)).text} · ${LANE_NAME[lane]} · ${FEED[lane]}`} className="cn-movesheet">
      <WhenEditor r={r} lane={lane} seatRows={seatRows} initialDay={initialPick} gap={gap} onClose={onClose} onDone={onDone} commitOnPick={quickCommit} />
    </Sheet>
  )
}
