// completion.ts — the pure decision behind a turn's completion webhook: whether
// to notify and whether to fold a bot turn's grouped feed rows. Split out so a
// unit test can pin the exact object inbox-turn-run hands to notify() without
// a database, and so an operator turn's notify object stays provably
// byte-identical before and after the bot-thread change.
//
// A bot-origin turn used to be unconditionally silent (design spec,
// double-notification rule 1); on a successful finish it folds the feed rows it
// read (rule 2), keyed by group_key so the bell drops by exactly those rows.
//
// Changed 2026-09-12 (inbox-agent-drawer, mission 2.3, decision D4): a bot turn
// whose answer carries an ACTIONABLE pill - one of kind open, task or reply -
// writes one row in family `bot` and pushes ONCE. Quiet bundles (fold-only, an
// empty array, no block at all, a block the model got wrong) stay silent, which
// is still rule 1 for every bundle that does not need him. The pills are the
// whole decision; there is no keyword list on the prose.
import type { NotifyInput } from '../_shared/notify.ts'
import { isActionable, parseActions, pushBodyFrom, pushTitleFrom } from '../_shared/bot-actions.ts'

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
  /**
   * True exactly when `notify` is the bot's row. The caller dismisses every open
   * `bot` row younger than 14 days BEFORE inserting this one, so the bell and
   * the phone hold at most one bot notification at a time (decision D5). The
   * operator path never sets it: `claude_turn` rows dedupe per turn instead.
   */
  supersede: boolean
}

export function planCompletion(args: {
  row: CompletionRow
  status: 'done' | 'error' | 'aborted'
  patch: Record<string, unknown>
  turnId: string
  nowMs: number
  /** `inbox_threads.bot_push_muted` for this turn's thread (db/065). Read from
   *  the thread row, so a thread the webhook could not read counts as unmuted -
   *  the same posture as every other missing-thread field here. */
  botPushMuted: boolean
}): CompletionResult {
  const { row, status, patch, turnId, nowMs, botPushMuted } = args

  // Fold only on a bot turn's clean finish. An error leaves the rows unread so
  // the next tick re-selects them; their group_key already points at a
  // finished turn, so the tick's "still running" exclusion does not hold them.
  const foldGroupKey = row.origin === 'bot' && status === 'done' ? `bot:${turnId}` : null

  if (row.origin === 'bot') {
    // A bot turn that failed, was aborted, or whose family Ivan muted says
    // nothing: an error message is the tick's problem, not his.
    if (status !== 'done' || botPushMuted) return { notify: null, foldGroupKey, supersede: false }

    const answer = typeof patch.answer === 'string' ? patch.answer : ''
    const { body, actions } = parseActions(answer)
    // Rule 1 still holds for every quiet bundle: no row, no push. The bot thread
    // is its own record, and a feed row every 30 minutes is the bell Ivan
    // cleared on 2026-09-09.
    if (!isActionable(actions)) return { notify: null, foldGroupKey, supersede: false }

    const notifyInput: NotifyInput = {
      family: 'bot',
      source: 'inbox-turn-run',
      // No dedupe_key: the 14-day supersede in index.ts is what keeps this to
      // one open row, and a dedupe key would instead FOLD a new message into an
      // old row's title and skip the push (notify.ts returns pushed:false on a
      // dedupe hit). Each actionable message is its own telling.
      dedupe_key: null,
      // Always 'attention': a pill exists only for his money, a send to a person
      // outside the company, new copy to approve or a taste call.
      severity: 'attention',
      // Explicit, because family 'bot' is deliberately absent from
      // notify.ts PUSH_DEFAULT and the fall-through there would wait for 'error'.
      push: true,
      title: pushTitleFrom(body) || 'Claude needs you',
      body: pushBodyFrom(body),
      url: `./#exp/brain-b/ask?thread=${row.thread_id}&turn=${turnId}`,
      // One tag on the device, so a second message replaces the first rather
      // than stacking (notify.ts passes group_key through as the push tag).
      group_key: 'bot',
    }
    return { notify: notifyInput, foldGroupKey, supersede: true }
  }

  // ---- everything below is byte-identical to the original operator path ----
  const startedMs = row.started_at ? Date.parse(row.started_at) : Date.parse(row.created_at)
  const elapsed = nowMs - startedMs
  const worthTelling = (status === 'done' || status === 'error') &&
    (row.client_gone_at != null || elapsed > PUSH_IF_SLOWER_THAN_MS)

  if (!worthTelling) return { notify: null, foldGroupKey, supersede: false }

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
  return { notify: notifyInput, foldGroupKey, supersede: false }
}
