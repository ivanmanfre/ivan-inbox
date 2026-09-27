import { useCallback, useState } from 'react'
import {
  LANE_LABEL, LANE_POSSESSIVE, approveDraft, boardGroupOf, canPromote, deleteClientDraft, deleteDraft,
  reviewActionable, setBoardVisible, skipDraft, type ContentDraft,
} from '../../lib/content'
import type { RowCap } from '../../exp/v2c/commandStore'
import { useDConfirm } from '../ui/confirm'
import { useToast } from '../ui/toast'
import type { Lane } from './model'

// TODAY'S ROW WRITES on a D list row (wb/content/actions.tsx: ReviewActions,
// PromoteRow, RowDelete): same lib writes, same confirms in the same words,
// Skip and Delete behind the red danger confirm. And what a bulk action may do
// to the row (today's Card caps), for the command layer's selection mark.
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
    ...(lane !== 'ivan' && caps.includes('delete') ? ['delete' as const] : []),
  ]
}

export function useRowVerbs(onDone: () => void) {
  const confirm = useDConfirm()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const run = useCallback(async (d: ContentDraft, lane: Lane, v: RowVerb) => {
    if (busy) return
    const ok = await confirm(v === 'approve' ? {
      title: 'Approve this draft?', message: 'Marks approved. Nothing publishes, scheduling stays on the board.', confirmText: 'Approve', verb: 'confirm',
    } : v === 'skip' ? {
      title: 'Skip this draft?', message: 'Marks it disqualified, it drops out of the queue for good.', confirmText: 'Skip', verb: 'confirm', danger: true,
    } : v === 'board' ? {
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
      if (v === 'approve') await approveDraft(d.id)
      else if (v === 'skip') await skipDraft(d.id)
      else if (v === 'board') await setBoardVisible(d.id, true)
      else await (lane !== 'ivan' ? deleteClientDraft(d.id, d.taxonomy) : deleteDraft(d.id, d.taxonomy))
      toast.show({ message: v === 'approve' ? 'Approved. Nothing publishes until it is scheduled.' : v === 'skip' ? 'Skipped. It left the queue.' : v === 'board' ? `On ${LANE_POSSESSIVE[lane]} board.` : 'Deleted.' })
      onDone()
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : 'That did not go through.', tone: 'failed' })
    } finally { setBusy(null) }
  }, [busy, confirm, onDone, toast])
  return { run, busy }
}

export const VERB_LABEL: Record<RowVerb, string> = { approve: 'Approve', skip: 'Skip', board: 'To board', delete: 'Delete' }
