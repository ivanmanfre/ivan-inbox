import { isBrainPost } from './brainDraft'
import type { ContentDraft } from './content'

// RUN 39 GATE. A brain draft in review or error is judged with Keep or Drop and
// nothing else: Approve, Skip and Delete must not reach it from any surface (the
// one verdict call does the approve / delete itself). Pure, so the row, the
// bulk layer and the open post all read the same rule.
export function brainNeedsVerdict(d: Pick<ContentDraft, 'taxonomy' | 'cb34_p2_member' | 'status'> | null | undefined): boolean {
  return !!d && isBrainPost(d) && (d.status === 'review' || d.status === 'error')
}
