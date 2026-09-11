// completion.ts — the pure decision behind a turn's completion webhook: whether
// to notify and whether to fold a bot turn's grouped feed rows. Split out so a
// unit test can pin the exact object inbox-turn-run hands to notify() without
// a database, and so an operator turn's notify object stays provably
// byte-identical before and after the bot-thread change.
//
// A bot-origin turn never notifies (design spec, double-notification rule 1);
// on a successful finish it folds the feed rows it read (rule 2), keyed by
// group_key so the bell drops by exactly those rows.
import type { NotifyInput } from '../_shared/notify.ts'

/**
 * Below this, the operator was almost certainly still watching the stream when
 * the answer landed, so a push would only tell them what they just read.
 */
const PUSH_IF_SLOWER_THAN_MS = 20_000

export interface CompletionRow {
  origin?: string | null
  prompt?: unknown
  thread_id: string
  started_at?: string | null
  created_at: string
  client_gone_at?: string | null
}

export interface CompletionResult {
  notify: NotifyInput | null
  foldGroupKey: string | null
}

export function planCompletion(args: {
  row: CompletionRow
  status: 'done' | 'error' | 'aborted'
  patch: Record<string, unknown>
  turnId: string
  nowMs: number
}): CompletionResult {
  const { row, status, patch, turnId, nowMs } = args

  // Fold only on a bot turn's clean finish. An error leaves the rows unread so
  // the next tick re-selects them; their group_key already points at a
  // finished turn, so the tick's "still running" exclusion does not hold them.
  const foldGroupKey = row.origin === 'bot' && status === 'done' ? `bot:${turnId}` : null

  // Rule 1: a bot turn writes no inbox_notifications row and never pushes.
  if (row.origin === 'bot') return { notify: null, foldGroupKey }

  // ---- everything below is byte-identical to the original operator path ----
  const startedMs = row.started_at ? Date.parse(row.started_at) : Date.parse(row.created_at)
  const elapsed = nowMs - startedMs
  const worthTelling = (status === 'done' || status === 'error') &&
    (row.client_gone_at != null || elapsed > PUSH_IF_SLOWER_THAN_MS)

  if (!worthTelling) return { notify: null, foldGroupKey }

  const answer = typeof patch.answer === 'string' ? patch.answer : ''
  const notifyInput: NotifyInput = {
    family: 'claude_turn',
    source: 'inbox-turn-run',
    dedupe_key: `turn:${turnId}`,
    severity: status === 'error' ? 'attention' : 'info',
    push: true,
    title: String(row.prompt ?? 'Claude turn').slice(0, 60),
    body: (status === 'error' ? (patch.error_detail as string | null) ?? 'The turn failed.' : answer).slice(0, 140),
    url: `./#exp/brain-b/ask?thread=${row.thread_id}&turn=${turnId}`,
  }
  return { notify: notifyInput, foldGroupKey }
}
