# inbox-mattan-lane-actions — the client lane gets its real workflow

Run closed 2026-08-03. Deployed on `main`, live at https://ivanmanfre.github.io/ivan-inbox/.
Commits: `e682bfe` (probe) · `f18b033` (write layer) · `7df36de` (UI) · `632da47` (before-shots) ·
`486769b` (label de-dup) — merged with the coordinator's `e1db6b6` (DMs), no file overlap.

558 tests (was 531), `npm run build` clean, `tsc --noEmit` clean, 0 page errors at either width.

---

## 1 · What Ivan said, and what the before-shots measured

His three complaints are all one defect — the client lane had no write path — and the
before-shots caught each of them verbatim on the live app (`before/`, captured off `44c84c7`):

| # | Ivan | Measured on the live app, before |
|---|---|---|
| 1 | "there is no delete or approve option… make sure they work the same" | `mattan-window` action bar = `["s Next"]`. That was the whole surface. |
| 2 | "also i dont see edit option" | same — no Edit at any width. |
| 3 | "i see the needs review and on mattan's board are different but they are on the same category" | `mattan-list` sections = `ON MATTAN'S BOARD / NEEDS REVIEW / PUBLISHED / INTERNAL / **NEEDS REVIEW** / ERRORS / ARCHIVED`. "NEEDS REVIEW" rendered **twice**, once inside each category — 13 rows his, 59 rows ours, one label. |

The Ivan lane was already correct after `44c84c7` and is byte-for-byte untouched by this run:
`ivan-window` actions are `Delete draft / a Approve / r Skip / e Edit / s Next / o More actions`
in both the before- and after-shots.

---

## 2 · The gate table — action × lane × what it calls × verified how

Every "verified" cell is a step in `verify/verify-actions.json`: Playwright clicking the real
button on the deployed app, then a separate PostgREST read of what landed. **15/15 PASS.**

| Action | Lane | Calls | Rule that gates it | Verified how |
|---|---|---|---|---|
| **Approve** | Ivan | `approveDraft` → `UPDATE status='approved' … is('client_id',null)` | `reviewActionable` (review \| error) | unchanged from `44c84c7`; after-shot proves the bar is intact |
| **Approve** | Mattan | deliberately absent | — | §4 — approving a client row would lock it off his board permanently |
| **Put on Mattan's board** | Mattan | `setBoardVisible` → `operator_set_board_visible(p_gate:'clientops')` | `canPromote` = status `review` (the RPC's own `not_in_review`) | UI click + sheet, then DB read: `board_visible` true (re-promote leg) |
| **Take off his board** | Mattan | same RPC, `p_visible:false` | `canUnpromote` = `board_visible === true` | UI click + sheet, then DB read: `board_visible` false |
| **Edit** | Ivan | `saveDraftBody` → direct `UPDATE … is('client_id',null)`, pre-flight + CAS | `lane === 'ivan'` | unchanged |
| **Edit** | Mattan | `saveClientDraftBody` → pre-flight, `human_edited` stamp w/ CAS, then `operator_edit_draft_body` | `clientEditable` = status in (`review`,`scheduled`) — the RPC's own predicate | UI edit + save on a real row: body landed, `human_edited:true` stamped, Operator audit line appended, then **restored byte-identically** |
| **Delete** | Ivan | `deleteDraft` → hard DELETE then archive fallback | `lane === 'ivan'` | unchanged |
| **Delete** | Mattan | `deleteClientDraft` → re-reads `board_visible`, then hard DELETE / archive | `clientDeletable` = **not** on the board | UI two-step confirm on a purpose-made throwaway row → row gone from the DB; refusal path checked on a real promoted row (button absent, explanation rendered) |
| **Skip** | Mattan | deliberately absent | — | §4 |
| **Schedule** | Mattan | **verified-to-dispatch-only** | — | `operator_schedule_draft` probed callable (`not_found` on a bogus id, `awaiting_media` on a media-less draft). **Never fired.** §4 |

### Mattan's board is exactly as it was

The last check re-reads the client-facing `get_client_board` and the `board_visible` row count:
queue 23 before → 23 after, the un-promoted row back in it, 23 rows at `board_visible=true`.
Nothing new was ever shown to Mattan at any point (§5).

---

## 3 · The mechanism, read off the live database rather than assumed

The three RPC bodies are **not** checked into personal-site — a full search of the repo and its
git history found call sites and grants only. They were pulled with `pg_get_functiondef` from the
live database (`rpc-defs.json`). Everything the build does follows from these:

```sql
operator_set_board_visible(p_gate text, p_draft_id uuid, p_visible boolean)
  gate                                  -> 'bad_gate'
  client_id IS NULL                     -> 'draft_not_found'     -- refuses an IVAN row
  p_visible AND status <> 'review'      -> 'not_in_review'
  update carousel_drafts set board_visible, updated_at
  net.http_post( …/webhook/client-board-queue-sync )              -- fires INLINE
  returns {ok, id, board_visible, client_id, sync_request_id}
```

```sql
operator_edit_draft_body(p_gate text, p_draft_id uuid, p_body text)
  gate / empty body                     -> 'bad_gate' / 'empty_body'
  where client_id IS NOT NULL and status in ('review','scheduled')
  0 rows                                -> 'not_editable'
  appends an {agent:'Operator'} agent_log entry
```

Five findings that changed the design:

1. **Promotion writes `board_visible` and nothing else.** It never touches `status`, never sets
   `scheduled_at`, and cannot publish. The confirm copy can say that truthfully.
2. **It fires the queue-sync webhook inline.** This settles a contradiction: commit `b970939`
   said the sync fires, memory (`idea-engine-upgrades-07-26`) said it was a separate step. The
   function body fires it. So promotion really does put the post on his board, and the confirm
   says "within moments", not "at some later batch".
3. 🔴 **A published client row cannot be re-promoted.** The `not_in_review` branch means
   un-promoting one of the 10 published board rows is **irreversible** through this path. The
   verification harness picks a `review` row for exactly this reason — a trap worth carrying.
4. 🔴 **`operator_edit_draft_body` does not stamp `taxonomy.human_edited`.** A client edit made
   through the sanctioned RPC would have been the only edit in the app that db/025's regen guard
   does not protect. `saveClientDraftBody` stamps it **first**, which also closes the read/write
   window the RPC exposes no compare-and-swap for — and once the flag is set, db/025 refuses
   every service_role `post_body` write on that row for the rest of the save.
5. **`updated_at` is trigger-maintained on `carousel_drafts`** — a no-op PATCH moved it from
   `2026-07-27` to now. The Ivan lane's comment allowed for the CAS being inert; it is not.

### RLS is not the boundary anyone assumes

`carousel_drafts` policy is `authenticated … FOR ALL using(true) with check(true)` with **no
client_id restriction** (`20260719_rls_closure_waves.sql:115-118`), and a direct client-row
UPDATE from the app's own session landed 1 row. The `operator_*` RPCs are a convention, not a
security boundary, on this table. That is *why* the build routes through them anyway: they carry
guards (status filters, the audit line) that a direct write would silently drop.

---

## 4 · What was deliberately NOT shipped

- **Approve / Skip on Mattan's lane.** Not an omission — a refusal. `approveDraft` writes
  `status='approved'`, and `operator_set_board_visible` only promotes from `'review'`. An
  "approve" on a client row would lock that draft off Mattan's board **for good**. Skip
  (`disqualified`) is worse on a promoted row: the queue-sync is only fired by
  `set_board_visible`, so the post would keep sitting on his board at stage `review` while our
  side called it dead.
- **Schedule on Mattan's lane** — verified callable, never fired. Scheduling a client post is a
  publish decision on Mattan's seat, and the brief's own line is "nothing here may publish". It
  stays on the dashboard's gated flow / his own board.
- **Delete on a promoted row.** The board's `queue` is a denormalised copy — each entry carries
  the draft's id, title, `post_body` and images inline — and its id set is *exactly* the
  `board_visible=true` set (23/23, zero either way). Only `set_board_visible` rebuilds it. So a
  delete there removes the row from our side and leaves a full copy of the post on a paying
  client's live board with nothing scheduled to clean it up. The button is absent **and the
  surface says why**: take it off the board first, then delete.

Where an action is missing on this lane, the window now states the database rule that closes it
(`.dw-clientnote`). An affordance that is merely absent is what produced Ivan's message.

---

## 5 · Client safety during verification

Memory's standing rule is *"verification never hits live channels"*, and Mattan's board is a live
channel. So:

- **Promotion was never tested by promoting something new.** It was tested on a row **already on
  his board** — un-promoted, then put straight back. Both directions exercised; at no point was
  Mattan shown anything he was not already being shown.
- The row for that had to be at `status='review'` (finding 3), or the restore would have been
  impossible.
- The edit test ran on a **never-promoted** row and was restored byte-identically.
- The delete test ran on a **throwaway row** inserted for the purpose (`board_visible=false`,
  `status='disqualified'` so no engine looks at it) and removed after.
- The final check re-reads the client-facing board and asserts it is back to 23, with a retry
  loop that re-fires the sync rather than leaving his board one post short.

**Two disclosures.** (a) The capability probe wrote a no-op `post_body` (the same value) to one
archived client row, `cb66ba17` "Case Study: LP rebuild" — content byte-identical, but its
trigger-maintained `updated_at` moved from 2026-07-27 to 2026-08-03. It is a disqualified row and
sits in Archived. (b) The edit test appended one `{agent:'Operator'}` line to `f0e7b915`'s
`agent_log` and left `taxonomy.human_edited` set on it — the body is restored exactly; the marker
is the honest record that a human touched the row, and it is the same marker any real edit leaves.

---

## 6 · Item 3: the two categories

`clientStageLabel(stage, group)` in `content.ts` — one status, two meanings, two labels.
`review` on a promoted row means *Mattan has not answered*; on an internal row it means *Ivan has
not decided*. Neither is "needs review" without saying whose, so neither says it.

| | before | after |
|---|---|---|
| sections | `ON MATTAN'S BOARD / NEEDS REVIEW / PUBLISHED / INTERNAL / NEEDS REVIEW / ERRORS / ARCHIVED` | `NOT ON HIS BOARD / WAITING ON YOU / ERRORS / ARCHIVED / ON MATTAN'S BOARD / WAITING ON MATTAN / PUBLISHED` |
| hero figure | `23` — "on Mattan's board" | `59` — "waiting on you" (board count kept as the second fact) |
| order | the work was **second**, under 23 rows already dealt with | the work is **first** |

The group header says *where the row is*; the stage header says *whose turn it is*; neither
repeats the other. The first live pass got this wrong — it stacked "WAITING ON YOU" directly
above "WAITING ON YOU — NOT ON HIS BOARD YET", a repeated label one level down — and the
after-shot is what caught it (`486769b`).

The transition needs no manual refresh: promoting updates the optimistic flag (chip, buttons and
delete zone flip on the spot), calls the list's `refresh()`, and the lane's existing
`postgres_changes` subscription re-groups the row into the other category.

🔴 **A trap this run hit:** the per-section collapse key is now `group_stage`, with an
**underscore**. `sectionState.ts:65` validates every persisted key against `/^[a-z][a-z0-9_]*$/`,
so a `group:stage` key would have been silently dropped on write and every section would have
re-opened on reload.

---

## 7 · Files

`src/lib/content.ts` (write layer + labels) · `src/lib/clientLane.test.ts` (27 new tests) ·
`src/exp/v2c/DraftPane.tsx` (the window) · `src/exp/v2c/ContentList.tsx` (the categories) ·
`src/exp/v2c/styles.css` (`.dw-clientnote`, at `.wb.wb.wb`).

Not touched: `inbox.ts`, `InboxHead.tsx`, `InboxScreen.tsx` — the coordinator's `flagged` bucket
on Mattan's seat is untouched by this run; nothing here reads or filters `inbox_messages_v`.
personal-site was read only, never written.

## 8 · Artifacts

`before/` and `after/` — both lanes, both widths, list + window, same script both times.
`verify/verify-actions.json` + `act-*.png` — the 15 end-to-end checks.
`probe-capability.txt`, `probe-board.txt`, `rpc-defs.json` — the measured mechanism.
`_probe-*.mjs`, `_shots.mjs`, `_verify-actions.mjs` — re-runnable.
