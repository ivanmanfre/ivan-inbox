import { useCallback, useState } from 'react'
import {
  LANE_LABEL, LANE_POSSESSIVE, boardGroupOf, canPromote, deleteClientDraft, deleteDraft,
  reviewActionable, setBoardVisible, type ContentDraft,
} from '../../lib/content'
import type { RowCap } from '../../exp/v2c/commandStore'
import { useDConfirm } from '../ui/confirm'
import { useToast } from '../ui/toast'
import type { Lane } from './model'
import { HOLD_MS, holdDecision, undoDecision } from './decisions'

// TODAY'S ROW WRITES on a D list row (wb/content/actions.tsx: ReviewActions,
// PromoteRow, RowDelete): same lib writes. Approve and Skip are one tap with an
// Undo receipt (decisions.ts, 29 Sep); To board keeps its confirm (it reaches the
// client) and Delete keeps the red one (nothing undoes it). And what a bulk
// action may do to the row (today's Card caps), for the command layer's mark.
export type RowVerb = 'approve' | 'skip' | 'board' | 'delete'

export function rowCaps(d: ContentDraft, lane: Lane): RowCap[] {
  return [
    ...(reviewActionable(d.status, lane) ? (['approve', 'skip'] as RowCap[]) : []),
    ...(canPromote(d.status, lane) && boardGroupOf(d) !== 'board' ? (['promote'] as RowCap[]) : []),
    ...(lane === 'ivan' || boardGroupOf(d) !== 'board' ? (['delete'] as RowCap[]) : []),
  ]
}

export function rowVerbsFor(d: ContentDraft, lane: Lane): RowVerb[] {
  const caps = rowCaps(d, lane)
  return [
    ...(caps.includes('skip') ? ['skip' as const] : []),
    ...(caps.includes('approve') ? ['approve' as const] : []),
    ...(caps.includes('promote') ? ['board' as const] : []),
    ...(caps.includes('delete') ? ['delete' as const] : []),
  ]
}

export function useRowVerbs(onDone: () => void) {
  const confirm = useDConfirm()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const run = useCallback(async (d: ContentDraft, lane: Lane, v: RowVerb) => {
    if (busy) return
    if (v === 'approve' || v === 'skip') {
      holdDecision(d.id, v, {
        onCommitted: onDone,
        onFailed: e => toast.show({ message: e instanceof Error ? e.message : 'That did not go through.', sub: 'It is back in review.', tone: 'failed' }),
      })
      toast.show({
        id: `decide-${d.id}`, ms: HOLD_MS, message: v === 'approve' ? 'Approved.' : 'Skipped.',
        sub: v === 'approve' ? 'Nothing publishes until it is scheduled.' : 'It leaves the queue for good.',
        action: { label: 'Undo', verb: 'undo-decision', run: () => { if (!undoDecision(d.id)) toast.show({ message: 'Too late to undo: it was already written.' }) } },
      })
      return
    }
    const ok = await confirm(v === 'board' ? {
      title: `Put this on ${LANE_POSSESSIVE[lane]} board?`,
      message: `${LANE_LABEL[lane]} sees it. This is the one action here that reaches a client, and it fires his board’s own `
        + 'sync, so it lands within moments and not at some later batch. From there the decisions are his: '
        + 'approve, edit, veto, schedule. Nothing publishes: this writes board visibility and never touches the publisher.',
      confirmText: 'Put it on his board', verb: 'confirm',
    } : {
      title: 'Delete this draft?',
      message: lane !== 'ivan' ? `${LANE_LABEL[lane]} has never seen it, and this removes it permanently.` : 'This removes it permanently.',
      confirmText: 'Delete', verb: 'confirm', danger: true,
    })
    if (!ok) return
    setBusy(d.id)
    try {
      if (v === 'board') await setBoardVisible(d.id, true)
      else await (lane !== 'ivan' ? deleteClientDraft(d.id, d.taxonomy) : deleteDraft(d.id, d.taxonomy))
      toast.show({ message: v === 'board' ? `On ${LANE_POSSESSIVE[lane]} board.` : 'Deleted.' })
      onDone(); window.dispatchEvent(new Event('wb-rows-changed'))
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : 'That did not go through.', tone: 'failed' })
    } finally { setBusy(null) }
  }, [busy, confirm, onDone, toast])
  return { run, busy }
}

export const VERB_LABEL: Record<RowVerb, string> = { approve: 'Approve', skip: 'Skip', board: 'To board', delete: 'Delete' }
