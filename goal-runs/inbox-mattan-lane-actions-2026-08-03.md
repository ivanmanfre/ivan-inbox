# inbox-mattan-lane-actions — the client lane gets its real workflow

Authored 2026-08-03 ~16:00 from Ivan's live use.

## What Ivan said

1. "there is no delete or approve option... like on interface previously.... and make sure they work
   the same,... so check carefully"
2. "also i dont see edit option"
3. "i see the needs review and on mattan's board are different but they are on the same category...
   in mattan's case, after i approve needs review it goes to the board... and on mattan's board
   category leaving needs review category"

## What was already fixed in the main loop (do not redo)

Commit `44c84c7`, deployed: `reviewActionable` now returns true for `status==='error'` as well as
`'review'` (live counts: 3 review rows vs **13 errored** — the QA_BLOCKED rows at the top of his
queue had no Approve and no Skip, so the only backlog he had was the one the app refused to act on),
the approve confirm names the override, and Delete moved out of the "More actions" drawer onto the
main action bar. That closes items 1 and 2 **for the Ivan lane only**.

## The actual remaining problem: the Mattan (risedtc) lane is entirely read-only

`editable = lane === 'ivan'`, the delete block is `lane === 'ivan'`, and `reviewActionable` requires
`lane === 'ivan'`. So on Mattan's lane the window shows NO approve, NO edit, NO delete — which is
exactly what Ivan is reporting, and it is why item 3 reads as a category confusion rather than a
missing action.

The original reason is in `lib/content.ts`: `approveDraft`/`skipDraft` are scoped
`.is('client_id', null)`, so those buttons on a client row would silently do nothing. That reasoning
is sound and must NOT be defeated by pointing the same functions at client rows.

## The real mechanism (found, verified in source — use it)

The personal-site dashboard promotes a Rise draft to the client board with a Postgres RPC, in
`~/Desktop/personal-site/components/dashboard-v2/sections/clientops2/shared.tsx:446`:

```
supabase.rpc('operator_set_board_visible', { p_gate: GATE, p_draft_id: d.id, p_visible: next })
```
with `export const GATE = 'clientops'` (shared.tsx:21 — a plain gate string, NOT a secret) and the
sibling `operator_schedule_draft({ p_gate, p_draft_id, p_publish_at })` for scheduling. Read that
whole file plus the RLS migration `supabase/migrations/20260719_rls_closure_waves.sql` before writing
anything. personal-site is READ ONLY — it deploys from `main`, never modify it.

So on Mattan's lane: **approve means promote to the client board** (`board_visible=true`), which is
the lifecycle Ivan describes — the row leaves NEEDS REVIEW and appears on the board.

## Build

1. **Mattan-lane approve = promote.** Wire it through `operator_set_board_visible` (gate
   `'clientops'`), never through `approveDraft`. Optimistic update with rollback on
   `error || data.ok === false`, exactly like the reference. Also handle the reverse (un-promote), and
   `operator_schedule_draft` if it fits the same window.
2. 🔴 **Promotion is CLIENT-FACING.** The confirm must say plainly that this becomes visible to
   Mattan. Standing rules that bind: never auto-post a client; a client reschedule goes only through
   the gated `operator_schedule_draft`; nothing here may publish. Read the memory file
   `~/.claude/projects/-Users-ivanmanfredi-Desktop-Ivan---Content-System/memory/MEMORY.md` client
   traps section before designing the copy.
3. **Sections follow the lifecycle (item 3).** On Mattan's lane, a promoted row LEAVES the
   needs-review section and renders under the board section. `board_visible` is already selected in
   `lib/content.ts` (NULL counts as not visible). Make the two categories visibly distinct and make
   the transition happen without a manual refresh.
4. **Edit on Mattan's lane**: decide from the data whether `saveDraftBody` can legally write a
   `client_id != null` row (check RLS and the db/025 guard). If it can, enable it with the same
   compare-and-swap and conflict surface as the Ivan lane. If it cannot, say so on the surface
   ("Mattan's copy is edited on the board") rather than rendering nothing — an absent affordance with
   no explanation is what produced this whole message.
5. **Delete on Mattan's lane**: same test. `deleteDraft` carries a hard-delete-then-fallback
   contract; verify what it does to a client row before exposing it. If deleting a client row is
   wrong, do not ship the button.
6. **Verify every action end to end** on a real row and restore it, the way the draft-window run
   proved its edit round-trip (write, read back, restore byte-identical including taxonomy). An
   action Ivan cannot trust is worse than one he does not have. Anything you cannot safely fire, name
   in the report as verified-to-dispatch-only.

## Non-negotiables

Branch off `main`, deploy at the gate, live-verify authenticated at 1440 + 390. Nixtio skin is law;
no new dependency. `npm run build` is the real gate. Tests green (531 now). Never `git add -A`.
CSS must sit at `.wb.wb.wb` or `faithful.css:171`'s `.wb.wb *` flattens its type silently. The service
worker's `skipWaiting` (commit `13844f7`) stays. Never ask Ivan questions mid-run.

## Gate

A table: action × lane × what it calls × verified-how. Before/after screenshots of both lanes at both
widths. The needs-review → board transition demonstrated on a real row. REPORT.md in
`goal-runs/inbox-mattan-lane-actions-2026-08-03-out/`, memory writeback.
