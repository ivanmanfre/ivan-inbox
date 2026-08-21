# Phase 4a spec — discard-restore data layer, and the discardDraft guard

Repo `/Users/ivanmanfredi/Desktop/ivan-inbox`, branch `wb/2026-readability`. Read `phase0-scope.md` first.

**This phase writes no UI.** It lands the data layer plus its tests and a written safety trace. The restore control ships in 4b. The reason for the split: this is the only work in the run that touches the send path, and it gets verified on its own before anything can call it.

## File ownership (other passes are live on this branch)

- You own: `src/lib/inbox.ts`, `src/lib/inbox.test.ts`.
- Touch nothing else. No `.tsx`, no CSS. `git add` those two paths explicitly, never `git add -A`.

## The verified facts you are building on (do not re-derive, do confirm)

From `docs/send-path-verification.md` and the code:

1. One dispatcher reads the queue (`Outreach - Send Messages`, every 2 min). Its pickup predicate is **`approved_at IS NOT NULL AND sent_at IS NULL`**, with **no filter on the block columns**.
2. The dispatcher's preSendGate, when it blocks copy, **nulls `approved_at`** and writes `send_blocked_reason`.
3. `isDraft()` (`inbox.ts:78`) counts a row as a pending draft when it is outbound, unsent, unapproved, and either unblocked or race-held. So clearing a discard's block columns returns the row to the pending-draft state with no other write.
4. `RACE_HOLD_PREFIX = 'post_approval_race:'` is the one recoverable block state; discards are `'discarded_in_inbox'`.

**The safety argument you must state and defend in your report:** restore never sets `approved_at`, and it only ever touches rows where `approved_at IS NULL`. The dispatcher cannot pick a row whose `approved_at` is NULL. Therefore a restore cannot cause a send; sending still requires a separate, explicit human approve. If any step of that chain turns out to be false, STOP and report it rather than shipping.

## 1. `restoreDraft(id)`

```ts
export async function restoreDraft(id: string): Promise<boolean>
```

Guard exactly, and match the reason string literally:

```
.eq('id', id).is('sent_at', null).is('approved_at', null)
.eq('send_blocked_reason', 'discarded_in_inbox')
```

Never `send_blocked_at IS NOT NULL` as the guard: that also holds `send_failed_verified:*` rows (which may have actually landed on the platform) and `geo_gate_v2:*` rows (still queued). Restoring either would be a live defect.

The update clears `send_blocked_reason` and `send_blocked_at` to null and writes nothing else.

Return whether a row was actually affected. PostgREST reports no error for a zero-row update, so a stale view calling restore must be distinguishable from a successful one: use a representation/count return and resolve to `false` when nothing matched. A silent no-op is its own bug, and the caller in 4b will surface it.

## 2. `canRestore(thread, message)` — eligibility

Restore is offered ONLY when the discard is the newest outbound event on the thread.

Why this is load-bearing: `composeReply` (`inbox.ts:709`) discards the pending AI draft immediately after Ivan hand-types his own reply. That discarded draft answers a message a human has already answered. Restoring and approving it would send a **second reply to a real person**.

Rule: no restore if any outbound row on the same thread is newer than the discarded row's `send_blocked_at`, whether that row was sent, is pending, or is itself approved. Use the same `eventTime` helper the file already uses for ordering.

Note the ruling already encoded at `inbox.ts:357-363`: a discard newer than the last inbound suppresses the thread from `needsAnswer`, because "a human already ruled on this thread; re-listing it is the app overruling him." Restoring a draft deliberately reverses that ruling and the thread will re-enter the answer bucket. That is correct, it is why restore must be an explicit act, and you should say so in your report.

## 3. The `discardDraft` guard fix, with a correction to the original plan

`discardDraft` (`inbox.ts:697`) is the only DM mutation missing an `approved_at` guard. Its siblings (`saveDraftText`, `snoozeDraft`, `unsnoozeDraft`) all carry the full guard. Today, discarding an already-approved row writes block columns the dispatcher never reads, so **the message still sends while the row disappears from the UI**. That is a fail-open.

**The plan called for adding `.is('approved_at', null)`. Do not do exactly that.** It would break a legitimate path: a race-held row has `approved_at NOT NULL` plus a `post_approval_race:*` block, and Ivan discarding it after re-reading the thread is a real, wanted action. Mirror the pattern `approveDraft` already uses instead:

```
.eq('id', id).is('sent_at', null)
.or(`approved_at.is.null,send_blocked_reason.like.${RACE_HOLD_PREFIX}*`)
```

Verify that claim before you implement it: confirm from the code that race-held rows keep `approved_at` set, and if they do not, say so and use the simpler guard. Trust the code over this spec.

`discardDraft` should also report whether it affected a row, for the same reason `restoreDraft` does.

Check every existing caller of `discardDraft` (including the one inside `composeReply`, which swallows errors with `.catch(() => {})`) and make sure a now-guarded call cannot break them. `composeReply`'s discard targets `t.draft`, which is by definition unapproved, so it should be unaffected. Prove it, do not assume it.

## 4. Tests (`src/lib/inbox.test.ts`)

The file passes 54/54 today. Add cases, break none:

- `canRestore` true for a plain discard that is the newest outbound event.
- `canRestore` false when a manual reply landed after the discard (the `composeReply` case, with real message shapes).
- `canRestore` false when a sent row is newer, false for `send_failed_verified:*`, false for `geo_gate_v2:*`, false for a race-hold, false for an approved row.
- `isDraft` returns true again for a row whose discard block has been cleared (the round trip).
- Guard-shape tests for `restoreDraft` and `discardDraft`: assert the exact filters sent to the client. Follow whatever mocking pattern the file already uses; if it has none, keep the guard construction in a small pure exported helper and test that, rather than inventing a mock framework.

## 5. Verification

- `npm run build` (the real gate: `tsc -b && vite build`) and `npm test`.
- Pass count grows by your tests; nothing existing breaks. One pre-existing failure in `calendarItems.test.ts` is known and stays.
- **No live writes.** Do not run restore against production. The guard is proven by tests and by the written trace, not by mutating Ivan's rows.

## 6. Deliverable

`goal-runs/workbench-2026-plan-2026-08-21/phase4a-restore.md`:

- the two functions with their exact final guards,
- the written trace proving restore cannot cause a send, walking the dispatcher predicate step by step and naming the file:line evidence for each link,
- the `discardDraft` fail-open explained, the corrected guard, and the evidence for the correction,
- the eligibility rule and the `composeReply` hazard it closes,
- every caller you checked,
- the test list and results.

Commit in 1-2 commits on `wb/2026-readability`. Never push. Zero em dashes in code, comments or report.
