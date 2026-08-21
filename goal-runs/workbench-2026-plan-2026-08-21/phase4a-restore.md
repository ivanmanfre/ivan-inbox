# Phase 4a: discard-restore data layer, and the discardDraft fail-open

Branch `wb/2026-readability`. Files touched: `src/lib/inbox.ts`, `src/lib/inbox.test.ts`. No UI.

No live write was made. Nothing was run against the production database. Everything below is
proven by reading the code and by tests.

---

## 1. The two functions, with their exact final guards

### `restoreDraft(id): Promise<boolean>` (`src/lib/inbox.ts:783`)

```
UPDATE outreach_messages
   SET send_blocked_reason = NULL, send_blocked_at = NULL
 WHERE id = :id
   AND sent_at IS NULL
   AND approved_at IS NULL
   AND send_blocked_reason = 'discarded_in_inbox'
RETURNING id
```

Built by `applyDraftGuard(q, id, RESTORE_GUARD)` (`inbox.ts:752`, `inbox.ts:741`). The write sets
those two columns and nothing else. It never writes `approved_at`, `sent_at`, `message_text` or
`snoozed_*`.

The guard is deliberately NOT `send_blocked_at IS NOT NULL`. That wider form would also match
`send_failed_verified:*` rows (which may have landed on the platform already) and `geo_gate_v2:*`
rows (still queued upstream). Clearing either would be a live defect, so restore matches only the
reason this app itself writes.

### `discardDraft(id): Promise<boolean>` (`src/lib/inbox.ts:764`)

```
UPDATE outreach_messages
   SET send_blocked_reason = 'discarded_in_inbox', send_blocked_at = now()
 WHERE id = :id
   AND sent_at IS NULL
   AND approved_at IS NULL
RETURNING id
```

`approved_at IS NULL` is new. `DISCARD_GUARD` is at `inbox.ts:731`.

### Why both return a boolean

PostgREST reports no error for a zero-row update. Without a returned representation a stale view
asking to discard an already-approved row is indistinguishable from a successful discard, and the
user would be told a send was stopped when it was not. Both writes end in `.select('id')` and
resolve to `data.length > 0`.

Residual, named so 4b handles it: if RLS ever stopped the authed role SELECTing
`outreach_messages`, both functions would report `false` on a write that succeeded. That direction
is safe for restore (it under-reports a restore) and merely annoying for discard (it under-reports
a stop). The app already reads that table directly under the same role
(`fetchDraftEvidence` `inbox.ts:542`, `fetchDraftEmailStamps` `inbox.ts:596`), so the read is
established, not assumed.

### `canRestore(thread, message)` (`src/lib/inbox.ts:827`) and `isDiscarded(message)` (`:795`)

`isDiscarded` is the row-level state test that mirrors `RESTORE_GUARD` in TypeScript: outbound,
unsent, unapproved, `send_blocked_reason === 'discarded_in_inbox'`, `send_blocked_at` set.

`canRestore` adds the thread-level eligibility rule in section 4.

---

## 2. The safety trace: a restore cannot cause a send

The claim: **restore never sets `approved_at`, and it only ever touches rows where `approved_at`
is already NULL, so the dispatcher cannot pick a restored row. Sending still requires a separate,
explicit human approve.**

Link by link, each with its evidence.

**Link 1. There is exactly one process that sends from this queue.**
`docs/send-path-verification.md:21-33` and `:143-151`. `Outreach - Send Messages`
(`kFYlfnWd98YaiErH`, every 2 min) is the only workflow that reads `outreach_messages` looking for
work. The other four senders are prospect-driven: they SELECT from `outreach_prospects`, write
their own copy, and only insert into `outreach_messages` as send logs with `sent_at` already
stamped (`docs/send-path-verification.md:110-124`). None of them reads `approved_at`.

**Link 2. That dispatcher's pickup predicate is `approved_at IS NOT NULL AND sent_at IS NULL`,
with no filter on the block columns.**
`docs/send-path-verification.md:40-46`, quoting the "Poll + Send" node verbatim:
`...outreach_messages?approved_at=not.is.null&sent_at=is.null&select=...&limit=5`. No
`message_type`, `channel`, `campaign`, `client`, `stage`, `send_blocked_at` or
`send_blocked_reason` term appears in it.

**Link 3. Therefore a row with `approved_at IS NULL` is invisible to the dispatcher.**
Direct consequence of link 2. This is also why the block columns are not a send guard at all,
which is the whole subject of section 3 below.

**Link 4. Restore only matches rows that already have `approved_at IS NULL`.**
`RESTORE_GUARD` (`inbox.ts:741`) carries `{ op: 'is', column: 'approved_at' }`, applied by
`applyDraftGuard` (`inbox.ts:752`) as `.is('approved_at', null)`. Asserted in
`inbox.test.ts` "restore matches one row: this id, unsent, unapproved, discarded by us".

**Link 5. Restore does not write `approved_at`.**
The patch is literally `{ send_blocked_reason: null, send_blocked_at: null }` (`inbox.ts:785-786`).
Two columns, both to NULL.

**Link 6. So a row that has been restored still has `approved_at IS NULL`.**
It had it before the write (link 4) and the write does not touch it (link 5).

**Link 7. A restored row lands back in exactly the pending-draft state.**
`isDraft` (`inbox.ts:86`) is `direction === 'outbound' && !sent_at && !approved_at && (!send_blocked_at || isRaceHold(...))`.
After restore all four hold, so the row is a draft again and `groupThreads` (`inbox.ts:168-173`)
surfaces it as `thread.draft`. Asserted in "clearing the discard block makes the row a pending
draft again".

**Link 8. The only way that row can ever be sent is a fresh, explicit approve.**
`approveDraft` (`inbox.ts:632`) is the sole place in this app that writes `approved_at`, and it
runs from a human tap in `ThreadScreen.tsx:130` / `DraftsScreen.tsx:173`. `composeReply`
(`inbox.ts:840`) also stamps `approved_at`, but on a NEW row it inserts, never on an existing one.
No other write path in `src/` sets that column.

**Conclusion: restore cannot cause a send.** It moves a row from "blocked, invisible" to "pending,
visible", both of which are states the dispatcher's predicate excludes. The send decision stays
where it was: one human tap on approve, made after the copy is back on screen and readable.

Two consequences worth stating rather than discovering later:

- **Restore reverses a ruling on purpose.** `needsAnswer` (`inbox.ts:351`) suppresses a thread when
  a discard is newer than the last inbound (`inbox.ts:370-373`): "a human already ruled on this
  thread; re-listing it is the app overruling him." Restoring puts the thread back in the answer
  bucket. That is correct and it is precisely why restore has to be an explicit act rather than
  anything automatic. Asserted in the round-trip test.
- **Restore does not unblock the row for anything upstream.** Clearing `send_blocked_reason` removes
  the row from the Sends failed list (`src/lib/sends.ts:104`, `:168`), which is the intended
  effect: it is no longer a failure, it is a draft.

---

## 3. The `discardDraft` fail-open, and the spec's correction

### The defect

Before this phase, `discardDraft` guarded only on `.eq('id', id).is('sent_at', null)`. Its three
siblings all carry the full guard: `saveDraftText` (`inbox.ts:675`), `snoozeDraft` (`:687`),
`unsnoozeDraft` (`:696`) each add `.is('approved_at', null)` plus the race-hold `.or(...)`.

Consequence, following link 2 above: discarding an already-approved row wrote `send_blocked_reason`
and `send_blocked_at`, two columns the dispatcher does not read. The row disappeared from the inbox
(because `isDraft` excludes blocked rows) and the message still went out on the next 2-minute tick.
The user saw a successful discard and a real person got the message. That is a fail-open, and it is
the exact class of hazard `approveDraft`'s own U1 comment (`inbox.ts:619-631`) was written about.

### The correction, verified against the code

The spec (`specs/phase4a-spec.md:52-63`) says: do NOT use the plain `.is('approved_at', null)`,
because "a race-held row has `approved_at NOT NULL` plus a `post_approval_race:*` block", and
mirror `approveDraft` with
`.or('approved_at.is.null,send_blocked_reason.like.post_approval_race:*')` instead. The spec also
says to verify that claim against the code and trust the code.

**The claim does not survive contact with the code. A race-held row has `approved_at NULL`.**
Three independent pieces of evidence:

1. `isDraft` (`inbox.ts:86-89`) requires `!m.approved_at` AND `(!send_blocked_at || isRaceHold(...))`.
   If a race-held row kept `approved_at` set, the `isRaceHold` branch could never be reached and it
   would be dead code. The whole point of that branch, per the comment at `inbox.ts:67-72`, is that
   a race-held row "comes back as a pending draft", which requires `isDraft` to be true, which
   requires `approved_at` to be NULL.
2. The existing tests at `inbox.test.ts:47-48` assert `isDraft` true for `post_approval_race:outbound`
   and `post_approval_race:inbound` rows built from a fixture whose `approved_at` is `null`.
3. The dispatcher's own bounce writes it. `docs/send-path-verification.md:54-56` shows the block
   body as `{ sent_at: null, approved_at: null, send_blocked_reason: ..., send_blocked_at: now }`,
   and the race-guard memory note (`dispatcher-post-approval-race-guard-2026-08-20`) states the
   bounce verbatim as `sent_at=null, approved_at=null, send_blocked_reason="post_approval_race:outbound|inbound"`,
   adding "the bounce un-approves the row, so it structurally can't re-alert."

A second, smaller inaccuracy in the same spec paragraph: `approveDraft` does not use an
`approved_at` clause at all. Its `.or(...)` is entirely on `send_blocked_reason`
(`inbox.ts:641`). It is setting `approved_at`, so it has no reason to filter on it. The
suggested guard would have been a new construct, not a mirror of an existing one.

**Verdict: the spec's correction is unnecessary, and the plan's simpler guard is right.**
`.is('approved_at', null)` alone admits race-held rows (they are unapproved), so it does not break
the race-hold discard path the spec was protecting. It refuses exactly one thing: a row already
queued for send. Shipped guard is `DISCARD_GUARD` = `sent_at IS NULL AND approved_at IS NULL`.

The `.or(...)` clause is not just unnecessary here, it would be actively worse. Written as
`approved_at.is.null,send_blocked_reason.like.post_approval_race:*` it is a disjunction: any row
carrying a race-hold reason would pass the guard **even with `approved_at` set**. Since the
dispatcher's block-column-blind predicate is what makes an approved row dangerous in the first
place, that arm would have re-opened a narrow version of the very fail-open the phase exists to
close.

### What a blocked discard now does

Returns `false` instead of throwing. The row is untouched, and 4b can tell the truth: this one is
already in the send queue, the discard did not stop it. Silently claiming a stop would be the
fail-open in a different costume.

---

## 4. Eligibility, and the `composeReply` hazard it closes

`canRestore(thread, message)` offers a restore only when the discard is still the newest outbound
event on its thread. Three conditions, all of them refusals:

1. **Not our discard.** `isDiscarded` false for any other reason value, for a sent row, for an
   approved row, for a row with no `send_blocked_at`.
2. **A send is already queued on this thread.** Any outbound row with `approved_at` set and
   `sent_at` NULL holds the restore, regardless of timestamps.
3. **Somebody spoke after the ruling.** Any other outbound row on the thread whose `eventTime`
   (`inbox.ts:152`, `sent_at ?? created_at`) is later than the discard's `send_blocked_at` holds
   the restore, whether that row was sent or is a fresh pending draft.

An inbound row after the discard does NOT hold the restore. They wrote again, the thread owes an
answer, and the drafted reply is a reasonable candidate. Only our own side speaking after the
ruling makes the draft a duplicate.

### The hazard

`composeReply` (`inbox.ts:840-853`) discards the pending AI draft immediately after Ivan hand-types
his own reply (`inbox.ts:852`). That discarded draft answers a message a human has already
answered. Restoring and approving it would send a **second reply to a real person**. Condition 3
catches this once the manual reply has gone out: its `sent_at` is newer than the discard's
`send_blocked_at`.

### The hazard the plan and the spec both missed

Condition 3 alone is not enough, because of the order `composeReply` writes in. It INSERTS the
hand-typed reply first (`inbox.ts:841-849`, with `approved_at` stamped and `sent_at: null`) and
only then discards the draft (`:852`). For the two minutes before the dispatcher picks the reply
up, that human answer is **older** than the discard:

- manual reply `eventTime` = `created_at` (no `sent_at` yet) = T
- discard `send_blocked_at` = T plus a few hundred milliseconds

So the pure time test would have waved the restore through during exactly the window where the
send is in flight and unstoppable. Condition 2 exists for that window: an approved unsent outbound
row IS the dispatcher's queue, so its presence anywhere on the thread holds the restore no matter
what the clocks say. Test: "is refused while a hand-typed reply is still queued, even though it is
older", which asserts `eventTime(manual) < discard.send_blocked_at` and `canRestore === false` in
the same case.

### One more thing neither document anticipated

Timestamps in this row set come from two writers with two spellings: `send_blocked_at` is written
by this app as `new Date().toISOString()` (`...T10:00:00.000Z`), while `sent_at` comes back from
PostgREST as `...T10:00:00+00:00`. Lexicographic comparison of those two forms diverges at index 19
(`+` sorts before `.`), so a same-second pair can compare backwards. The rest of the file compares
these strings directly, which is fine for its 14-day and minute-scale questions; on a send-path
guard it is not. `canRestore` therefore parses both sides with `Date.parse` and treats any
unparseable value as "newer", so a junk timestamp holds the restore instead of allowing it. Test:
"an unparseable timestamp holds the restore rather than allowing it".

---

## 5. Every caller checked

`discardDraft` changed signature (`Promise<void>` to `Promise<boolean>`) and gained a filter, so
every call site was checked for both.

| caller | argument | approved_at at call time | affected? |
|---|---|---|---|
| `ThreadScreen.tsx:145` (`onDiscard`) | `draft.id`, where `draft = thread.draft` (`:79`) | NULL | no |
| `DraftsScreen.tsx:215` (`handleDiscard`) | `draft.id`, where `draft = thread.draft!` (`:114`) | NULL | no |
| `DraftsScreen.tsx:287` (`StaleBar.discardAllStale`) | `t.draft!.id` for each stale thread | NULL | no |
| `inbox.ts:852` (`composeReply`) | `t.draft.id`, swallowed with `.catch(() => {})` | NULL | no |

The proof is one line, and it is the same line for all four. Every caller passes `thread.draft`.
`groupThreads` populates `thread.draft` exclusively from `messages.filter(isDraft)`
(`inbox.ts:168-173`), and `isDraft` (`inbox.ts:86-89`) requires `!m.approved_at`. There is no
other producer of `Thread.draft` in the codebase. So no existing caller can hand `discardDraft` a
row with `approved_at` set, and the new guard cannot turn any of today's discards into a no-op.
Asserted in "admits every row the callers actually pass, and refuses an approved one", which runs
both a plain pending draft and a race-held draft through `isDraft` and through `DISCARD_GUARD`.

Return-value compatibility: all four call sites use `await discardDraft(...)` as a statement and
ignore the result. `composeReply`'s `.catch(() => {})` widens to `Promise<boolean | void>`, which
is still valid as an awaited statement. `tsc -b` is clean.

No caller of `restoreDraft` or `canRestore` exists yet; they ship in 4b.

Also checked, not called: `src/lib/sends.ts:104` and `:168` read `'discarded_in_inbox'` to keep
discards out of the failed-send log and out of its denominator. A restored row correctly leaves
both, since it is no longer a discard.

---

## 6. Tests and results

`src/lib/inbox.test.ts` went from 54 to 68 cases. 14 added, none changed, none removed.

**`isDiscarded` + `canRestore` (10 cases)**

- reads a discard off the row, and nothing else (five row shapes)
- a plain discard that is the newest outbound event can come back: TRUE
- is refused while a hand-typed reply is still queued, even though it is older (the `composeReply`
  window, real message shapes)
- is refused once that reply has actually gone out (the `composeReply` case after dispatch)
- is refused when any send is newer than the discard, and an older send does not block it
- is refused when a fresh pending draft was written after the discard
- an inbound reply after the discard does NOT block it
- refuses every block reason that is not our own discard: `send_failed_verified:*`,
  `geo_gate_v2:*`, both race-hold spellings, `manual_reply_raced`, and NULL
- refuses an approved row and a sent row outright
- an unparseable timestamp holds the restore rather than allowing it (both sides)
- clearing the discard block makes the row a pending draft again: `isDraft` false then true,
  `thread.draft` picks it up, and `needsAnswer` flips from false to true (the reversed ruling)

**Guard shape and guard meaning (3 cases)**

The guards are declared as data (`DISCARD_GUARD`, `RESTORE_GUARD`) and applied to the live query by
`applyDraftGuard`, so a test that applies the same guard to a recording stub asserts the filters the
real write sends rather than a copy of them.

- restore matches one row: `eq id`, `is sent_at`, `is approved_at`, `eq send_blocked_reason
  discarded_in_inbox`, in that order, plus an explicit assertion that no `send_blocked_at` filter
  exists anywhere in the guard
- discard now carries the `approved_at` guard that closed the fail-open
- admits every row the callers actually pass, and refuses an approved one: evaluates the declared
  guards against real row shapes (pending draft, race-held draft, approved row, sent row, discarded
  row) so the semantics are pinned, not just the call order

**Gates**

| gate | result |
|---|---|
| `npm run build` (`tsc -b && vite build`) | green |
| `npm test` | 841 passed / 1 failed (42 files) |
| `npx oxlint src/lib/inbox.ts src/lib/inbox.test.ts` | clean |

Baseline before this phase was 827 passed / 1 failed. The 14 new cases are the whole delta from
this phase. The one failure is the documented pre-existing `calendarItems.test.ts > "passing no
queue is the old behaviour exactly"`, unchanged.

Whole-tree note: three other passes are live on this branch. `tsc -b` failed once mid-run on
`src/lib/systemAlerts.test.ts` (unused imports, another pass mid-edit) and was green again on
re-run without any change from this phase. Final measured state of the whole tree after that pass
landed: build green, 865 passed / 1 failed. `src/lib/inbox.ts` and `src/lib/inbox.test.ts` are the
only files this phase touched.

Live writes performed: **0**.
