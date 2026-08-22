# p4b - the triage capability, and what it cost to tell the truth

Branch `polish/p4b`. Items #2 and #3 of `phase4-workflow.md`.

Every number below was measured against the live database or the rendered app through
Ivan's own session. Attempted writes across the whole run: **0**.

---

## 1. The headline: 49 of 55 errored rows went from wrong to right

`draftFailureReason` (`src/lib/content.ts`) preferred `taxonomy.error_message` and fell back to
the QA verdict. That order is the defect. `error_message` is stamped once by whichever agent
routed the row and is never revised, while the pipeline keeps running. So the card printed a
sentence that was true for about twenty minutes in July.

The fix reads the **terminal `agent_log` entry** first, because the last thing that happened
cannot be stale, and keeps the old order only for a row that has no log at all.

Proof: `evidence/p4b-tools/reasons.test.ts`, run over `err55.json`, a snapshot of all 55 live
`status='error'` rows taken 2026-08-22. It prints BEFORE and AFTER for every row and asserts that
no row can claim a stall the log denies.

```
npx vitest run --config goal-runs/workbench-polish-2026-08-22-out/evidence/p4b-tools/vitest.proof.ts
```

| | rows |
|---|---|
| errored rows read | **55** |
| reason text changed | **55** |
| claimed a watchdog stall the terminal log denies | **28** |
| carried no `taxonomy.error_message`, so the line only echoed the QA chip | **21** |
| **wrong or absent, now right** | **49** |
| already correct (the genuine stalls) | 6 |

The 21 are the rows the brief described as printing "No reason recorded". They did not. Measured:
zero rows printed that string. What they actually did was fall through to the `qa_verdict` branch
and print `Blocked by QA (score 62)`, which is the same verdict the QA chip two elements to the
left was already printing. Not a lie, but not a reason either: it answers "what is the verdict"
and never "why did it fail". Corrected here so a later run does not go looking for a string that
is not there.

### What the card says now, verbatim from the live rows

| before | after |
|---|---|
| `Generation stuck — no completion within 25 minutes. Likely a silent workflow chain break.` | `QA scored it 63 of 130, under the floor. Final verdict Rewrite ok, regeneration budget spent.` |
| `Generation stuck — no completion within 22 minutes. …` | `Lint Gate passed this. It finished, and it is filed as an error anyway.` |
| `Generation stuck — no completion within 25 minutes. …` | `Lint gate refused it on nobody_reveal_family, and the rewrite did not clear it.` |
| `Generation stuck — no completion within 23 minutes. …` | `Generation never returned. 1 attempt(s), none of which produced a draft.` |
| `Generation stuck — no completion within 141 minutes. …` | `Generation stalled. The watchdog fired after 141 minutes and nothing has run since.` |
| `Needs regenerate (score 0)` | `Hook Agent saved a model refusal instead of content. Nothing was written that is worth reviewing.` |
| `Failed the language check` | `Lint Gate passed this after fixing contrast_closer. It finished, and it is filed as an error anyway.` |

The 20,205-minute stall claim disappears without being special-cased. It was never a duration; it
was a stamp on a row whose pipeline had gone on working for fourteen days.

### The named failing thing, where the log carries it

`kind` is derived alongside the sentence from the same terminal entry, so the two cannot disagree.

| kind | n | what the card names |
|---|---|---|
| `qa` | 24 | the score against **its own denominator** (63/130, 74/120, 71/90), the final verdict, and how many retries died on lint instead of scoring |
| `completed` | 13 | that the last gate PASSED, and the rule it had to fix first when the log carries one |
| `generation_failed` | 6 | that the model never came back, and across how many attempts |
| `stalled` | 6 | the real watchdog age, only when the sentinel is genuinely terminal |
| `lint` | 4 | the rule that fired (`nobody_reveal_family`, `em_dash`, `contrast_closer`) |
| `refusal` | 1 | that a model refusal was saved as content, without reading the refusal out |
| `other` | 1 | the agent's own name plus its first line, unsmoothed |

`(0/?)` never renders as a score. A denominator of `?` is not a floor, and a row showing "0 of ?"
would read as the worst draft in the pile when it is actually a draft that does not exist.

### The cost of reading the log, measured before paying it

`COLS` does **not** select `agent_log`. The brief said the derivation was achievable with columns
`COLS` already selects; it is not, and that is the one claim in the evidence that did not survive
checking. What is true is that it needs no new **fetch**: PostgREST resolves a negative jsonb array
index server-side, so the terminal element comes back as three scalars on the same query.

All 465 rows, live, 2026-08-22:

| select | payload |
|---|---|
| current `COLS` | 974.3 KB |
| `+ log_agent, log_body, log_ts` (`agent_log->-1->>key`) | **+315 KB** |
| `agent_log` as a column | 5923.4 KB, 6x the entire payload |

The last element is the terminal event: checked on all 55 rows, **zero** where the final element
was not also the maximum `ts`.

---

## 2. Retry, moved onto the row

Before: regeneration lived one takeover deep, behind a disclosure, on Ivan's lane only
(`DraftPane.tsx:1249`). Three to four interactions and one full-screen takeover per row. Forty
eight errored rows on that lane is roughly **168 interactions and 48 takeovers**.

After: one button on the card, one confirm. **2 interactions, 0 takeovers.** Same
`regenerateDraft` write; no second write path exists to drift from it.

Three things it does not do, each deliberate:

- **No bulk.** `retry` is not a `RowCap`, so the bulk bar has no way to reach it. That absence is
  the enforcement, not a disabled button. A generation is a real model bill per row.
- **No image fork.** The card's confirm is copy-only, which is the branch that KEEPS a hand-pinned
  photo. Asking for a new image destroys one, so it stays a takeover decision.
- **No guard override.** On a human-edited row the card refuses and says why: db/025 would let that
  run for minutes and land nothing. The documented escape hatch stays in the takeover.

Live: 48 Retry buttons rendered on the Errors tab, at 1440 and at 390.

---

## 3. The 93-row client review pile

`reviewActionable(status, lane)` is `(status === 'review' || status === 'error') && lane === 'ivan'`
(`content.ts:1435`). On a client lane it is always false, so `caps` at `ContentList.tsx:186`
evaluated to `['delete']` and nothing else. Selecting all of Mattan's review rows offered exactly
one bulk button and it was the destructive one. The single action that scaled was the one that
removes work.

| clearing the pile | interactions | takeovers |
|---|---|---|
| **before** (93 rows x 4, per T4b) | **372** | **93** |
| after, row action (To board + confirm, per row) | 186 | 0 |
| after, bulk (select all, one button, one confirm, per tab) | **about 15** | **0** |

The bulk figure is measured, not modelled: the live Mattan "Waiting on you" tab holds **29**
promotable rows and the bar offers `Select all 29`, so those 29 clear in three interactions from
that tab. The remaining rows sit behind two more lane or tab switches, which is where the rest of
the count goes.

Promote is `setBoardVisible` / `operator_set_board_visible`, the write the takeover already makes.
`canPromote` is the RPC's own predicate, so the row, the bar and the database cannot disagree about
which rows are eligible. Rows already on the board are excluded: promoting one is a no-op sync.

### The bindings, and how each was held

**The confirm names the client and the count, and there is no silent path.** Read live:

> Put 5 drafts on Mattan Danino's board? Mattan Danino sees all 5 of them. Each one fires his
> board's own sync, so they land within moments and not at some later batch. Nothing publishes:
> this writes board visibility and never touches the publisher. Taking one back off is one click
> per post.

The audience is read off the rows, not assumed. A mixed selection names both lanes; a selection
carrying no lane says "a client" rather than inventing a name.

**Delete does not become easier to hit, and the new button does not sit where Delete's muscle
memory is.** This one failed on the first attempt and the browser caught it.

`.wb-bulk` is `left:50%` plus `translateX(-50%)`. It is centered, and its width is its content's
width. Appending promote inside the action group, on the reasoning that appending never moves what
is already there, widened the bar by 126.8px and slid Delete **63.4px left**. The coordinate a hand
had learned as Delete landed **inside the client-facing button**. Promoting 54 drafts to a paying
client's live board while reaching for Delete is precisely the accident the bar exists to prevent.

Promote now takes a row of its own above the actions. Two further measurements were needed: a
wrapped flex container still computes max-content as if every item sat on one line, so
`flex-basis:100%` alone left the 119px button on the bill, and the 12px column gap another 5.8px.
`width:0` plus `min-width:100%` plus a negated column gap zeroes both.

Re-measured on the same five-row selection, hiding the new row to reproduce the pre-p4b bar exactly:

| | left | right |
|---|---|---|
| Delete, before | 649.8 | 728.6 |
| Delete, after | **649.8** | **728.6** |

Shift **0**. `oldPointStillHitsDelete: true`, `oldPointLandsOnPromote: false`.

**Partial batches report per row and never claim a refusal as a success.** The existing refusal path
(`BulkBar.tsx`) is used unchanged: the button is disabled unless every selected row can take the
action, and the bar says the number. `okCount` is `n` minus the rows that threw, and each refusal
keeps its own message carrying the row's label. `ClientRpcError` carries the database's own code,
so a row that moved out of review under the selection reports `not_in_review` and not "something
went wrong".

**Batching respects the live constraints.** Promote is one RPC per row in a loop, because the RPC
fires the board's sync webhook inline and N calls are N syncs, which is what the board already
depends on. No `in()` filter is built and no select is widened, so neither the 16KB URL limit nor
the 1000-row select clamp is approached.

---

## 4. The 13 rows whose pipeline finished, and what I refused to invent

Thirteen rows end on `Lint Gate: VERDICT: PASS` and sit at `error`. They are a different object
from the six that stalled, and the brief is right that regenerating one spends a model bill to redo
work that is already sitting on the row.

**What they got:** the sentence says so in words, and `data-kind="completed"` colours it clear
rather than amber, so the distinction is scannable and not only readable. Retry is still reachable
on them, demoted, and its confirm says up front: *"the last thing this row logged was a pass, so
the copy sitting on it may already be finished."*

**What they did not get, and why: there is no error-to-review write in the data layer.**

- `approveDraft` writes `approved`, not `review`, and is Ivan-lane scoped.
- `restartDraftToIdea` writes `idea` and refires the pipeline, which overwrites the copy. That is
  regeneration wearing a different label, and on these rows the copy is the thing worth keeping.
- No `operator_*` RPC writes `status`.

The brief said to offer nothing rather than invent a write. **Nothing is offered.** A direct
`update({ status: 'review' })` would have been three lines and it is not here.

### Client-lane skip: refused, and shipped as an unapplied file

Item #3 asked for `skip` and promote. **Promote shipped. Skip did not.** There is no client-lane
skip path in the data layer:

- `skipDraft` is scoped `.is('client_id', null)`. Pointed at a client row it matches nothing, and
  PostgREST answers a silent 204 to an UPDATE that RLS filtered away. That is a button that lies.
- Of the four `operator_*` RPCs (`set_board_visible`, `edit_draft_body`, `schedule_draft`,
  `set_schedule_date`), not one writes `status`.
- `deleteClientDraft` does reach `status='disqualified'`, but only as the **fallback of a hard
  delete**. Routing "skip" through the delete path would make the destructive action easier to
  reach, which is the one thing this phase forbids.

So the choice was between inventing a direct status write against a paying client's rows or
shipping nothing and saying so. **`db/039_operator_skip_client_draft.sql` is shipped UNAPPLIED and
wired to nothing.** It mirrors db/032's gate, grant shape and refusal codes, and it carries one rule
that is not copied from an existing function: it refuses a row with `board_visible = true`, because
the client board's queue is a denormalised copy that only `operator_set_board_visible` rebuilds, so
disqualifying a promoted row would leave a full copy of it on a live client board with nothing
scheduled to clean it up. Same trap the delete path already refuses.

**A button pointed at a function that does not exist is a button that 404s in front of a client's
backlog, so no UI was wired to it.**

### Also refused

- **The QA dimension below floor.** The log does not carry it. The nine-dimension rubric exists
  only as prose inside `qa.feedback`, and projecting that column costs **677.7 KB on 465 rows, a
  70% increase on the whole list payload**, to name a dimension on 12% of rows. The card names the
  score, its own denominator and the verdict instead, all of which the log does carry.
- **Bulk retry.** Not built, and structurally unreachable rather than merely absent.
- **Any change to bulk delete.** Its wording, its danger styling, its confirm and its position are
  untouched, and the position is proven untouched to a tenth of a pixel.

---

## 5. Attempted writes: 0

`evidence/p4b-tools/probe-ui.mjs`, run authed against the worktree's own build on port 4182, at
1440 and 390.

**The standard interceptor was not sufficient and that is the point.**
`chip-probe.mjs` lets a POST to `/rest/v1/rpc/` through
(`m === 'POST' && !q.url().includes('/rpc/')` falls to `r.continue()`). Both features built here
write through RPCs. Promote is `operator_set_board_visible`, an RPC POST, and under the standard
interceptor it would have landed on Mattan's live board.

The interceptor used, installed on the context **before every navigation**:

- `**/rest/v1/**` catches `PATCH`, `PUT`, `DELETE`, any non-RPC `POST`, and any RPC `POST` whose
  function name matches `/^(operator_|append_agent_log|dashboard_action)/`. Each one is **recorded
  with its method, its function name and its payload, then answered with a 403** rather than
  continued. Read-only RPCs continue so the page still loads.
- A second route on `**/*` aborts anything matching `/webhook|n8n\./`, because `regenerateDraft`
  fires a post-gen webhook that is not a Supabase call at all.

Both confirms were **opened and cancelled**, which is what proves the wording without spending a
model bill or touching a client's board.

```
ATTEMPTED_WRITES : 0
attempted_detail : []
blocked_webhooks : []
```

Full result: `evidence/p4b-tools/probe-ui-result.json`.

### What the authed run showed

| | 1440 | 390 |
|---|---|---|
| error cards rendering a reason | 48 | 48 |
| still claiming "Generation stuck" | **0** | **0** |
| Retry buttons | 48 | 48 |
| client review rows carrying `To board` | 29 | 29 |
| `.ct-reason` computed font-size | 13px | 13px |
| `.wb` body tier (the flattener) | 16px | 16px |
| reason line height, all rows | 21px, one line | 21px, one line |
| horizontal page overflow | false | false |

The font-size row is the three-class check, read off the real element rather than the stylesheet.
`faithful.css:180` is `.wb.wb, .wb.wb *{ font-size:var(--fs-body); … }` and it flattens every
descendant; the first `.wb.wb.wb` re-assertion is at `faithful.css:123`. A two-class selector would
have rendered these lines at the 16px body tier and looked deliberate. Every rule added here carries
`.wb.wb.wb`, and the 13px reading is what confirms it.

### `#exp/stock` is untouched

`src/styles.css`: **zero diff** across the whole branch. `evidence/p4b-tools/probe-stock.mjs` loads
`#exp/stock` authed at both viewports and finds:

- `.wb` elements: **0** (so `wb2026.css`, which is entirely `.wb.wb.wb`-scoped, cannot match)
- `.ct-reason-row`, `.ct-retry`, `.ct-promote`, `.wb-bulk-client`, `.wb-bulk-b`: **0 each**
- `[data-kind]`: **0**

None of the eleven components `inventory.md` lists as shared with stock was edited. `ContentList`
is v2c-only with no JSX shared with stock; `BulkBar` is v2c-only chrome; `commandStore` is imported
by `RowSelect`, which does render in stock, but the change there is a type union member and a
comment, and `RowSelect` returns null when the command layer is not mounted.

---

## 6. Gates

| | |
|---|---|
| `npm run build` (`tsc -b && vite build`) | clean |
| `npm test` | see the re-verification note below |
| known pre-existing failure | `calendarItems.test.ts > passing no queue is the old behaviour exactly` |
| new tests | 10 in `content.test.ts` (`draftFailure`), 9 in `bulkPromote.test.ts` |

The baseline was established on a clean checkout first, so the one failure is demonstrably not
mine. It needed `.env.local` copied into the worktree: without it 20 test files fail at import with
`supabaseUrl is required`, which reads as breakage and is not.

Every fixture in the new `draftFailure` tests is a verbatim live body with its row id in the
comment. The end-to-end run over all 55 rows is deliberately kept OUT of `npm test` (its own config,
per the convention in `vitest.config.ts`), because it reads a snapshot and must never be able to
fail a deploy gate for being offline.

## Files

| | |
|---|---|
| `src/lib/content.ts` | `COLS` projections, `draftFailure`, `draftFailureKind`, `draftFinished` |
| `src/exp/v2c/RetryDraft.tsx` | new, the row-level retry |
| `src/exp/v2c/ContentList.tsx` | reason row, `data-kind`, `PromoteRow`, promote cap |
| `src/exp/v2c/BulkBar.tsx` | promote row, `CAP_ORDER` / `CAP_BUTTONS`, `promoteAudience` |
| `src/exp/v2c/commandStore.ts`, `commandSource.ts` | `RowCap` gains `promote`, palette parity |
| `src/exp/v2c/wb2026.css` | all rules `.wb.wb.wb`-scoped |
| `db/039_operator_skip_client_draft.sql` | **unapplied, wired to nothing** |
