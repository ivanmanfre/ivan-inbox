// turnAugment.ts, Turn (chat/events.ts) carries no wall-clock time and no raw
// error_code, only the already-resolved message CLAUDE_ERROR_COPY produced. Two
// things this stream needs are missing from that:
//
//   1. A timestamp to interleave a turn against a notification's created_at.
//   2. The broker's `thread_busy` code, which useChat's own copy table does not
//      know (it predates that error) and falls through to "Claude failed for
//      an unrecognised reason.", wrong words for a turn that is not broken,
//      just queued behind another one on the same thread.
//
// Both are read straight off `inbox_turns` (via listTurns, a read this file's
// caller already has the grant for) and merged onto the Turn objects useChat
// already produced, by turnId. Pure merge, so it is testable without a network.
import type { Turn } from '../../v2c/chat/events'

export type AugmentedTurn = Turn & { at: string; errorCode?: string | null }

export type TurnRowMeta = { at: string; errorCode?: string | null }

export const THREAD_BUSY_CODE = 'thread_busy'
export const THREAD_BUSY_COPY = 'Still working on the last one. Wait for it or start a new thread.'

export function isThreadBusy(t: Pick<AugmentedTurn, 'errorCode'>): boolean {
  return t.errorCode === THREAD_BUSY_CODE
}

/**
 * Attach a wall-clock time and an error code to every turn. A turn already
 * backed by a row (turnId present in `rowMeta`) gets the row's own `at` and
 * `errorCode`. A turn with no row yet, the one currently streaming client-side
 *, falls back to `fallbackAt`, which the caller drives off Date.now() at the
 * moment it first sees that turn id, so the merge into the notification feed
 * still lands in roughly the right place without inventing a database fact.
 */
export function augmentTurns(
  turns: Turn[],
  rowMeta: Record<string, TurnRowMeta>,
  fallbackAt: (turn: Turn) => string,
): AugmentedTurn[] {
  return turns.map(t => {
    const meta = t.turnId ? rowMeta[t.turnId] : undefined
    return { ...t, at: meta?.at ?? fallbackAt(t), errorCode: meta?.errorCode ?? null }
  })
}
