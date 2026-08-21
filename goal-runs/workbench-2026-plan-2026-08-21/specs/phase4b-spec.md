# Phase 4b spec — the command layer, selection, and the restore control

Repo `/Users/ivanmanfredi/Desktop/ivan-inbox`, branch `wb/2026-readability`. Read `phase0-scope.md` and `phase4a-restore.md` (the data layer this builds on, already shipped and tested) first.

## File ownership

- Yours: `src/exp/v2c/Shell.tsx`, new components under `src/exp/v2c/`, `src/exp/v2c/ContentList.tsx`, the DM draft card / thread surface files, and section **C · COMMAND LAYER** of `src/exp/v2c/wb2026.css` (every selector at `.wb.wb.wb`).
- Do NOT edit `src/lib/inbox.ts` — Phase 4a owns it and its guards are proven. Call `restoreDraft` / `canRestore` as they exist. If you need a signature change, say so in your report rather than editing it.
- Never touch `src/styles.css`.
- `git status` before each commit; `git add` specific paths.

## Locked constraints (rulings, not preferences)

- **No bare-key action shortcuts.** `a` / `r` / `e` / `s` were deliberately removed from the draft window on 2026-08-09 as unneeded, and a reference implementation that bound bare `⌘A` to approve and `⌘R` to reject is explicitly not to be copied. You ship navigation and selection only: `j` / `k` move, `Enter` open, `x` select, `/` focus search, `?` shortcut sheet, `Escape` close, `⌘K` palette. `⌘Enter` to approve is permitted **only** where a confirm sheet still fires. Anything beyond that goes in your report as needing Ivan's word; do not add it.
- **Approve-undo does not exist and must not be built**, in any variant. The dispatcher claims rows on `sent_at IS NULL` without re-checking `approved_at`, so a client-side undo fails open: the UI would say undone while the DM goes out. Discard-restore is the sanctioned reversibility feature.
- Existing keys stay: `⌘D` voice (`Shell.tsx:224`), `j`/`k` queue walk in the draft window (`DraftPane.tsx:958`) and magnet window (`MagnetWindow.tsx:325`), `Escape` close (`Takeover.tsx:42`, guarded against fields). Do not double-bind or steal them.

## 1. The ⌘K palette, built on machinery that already works

`ChatPane.tsx:140` `matchCommands` already renders a real command list: token-wise matching, the container's live models, and unavailable commands listed-but-dimmed with a reason. Read the comment block above it before you write anything — it documents, with the measurement that caused it, why **the vocabulary never shrinks**: an earlier build filtered unavailable commands out, the palette closed on no match, and Enter sent the literal `/retry` to the model. Reuse this behaviour; do not reinvent it and do not regress it.

The palette must:
- jump to any lane (the 9 jobs) or any person in the current list;
- run any action available on the current selection, with unavailable actions listed and dimmed with the reason;
- **print each command's direct shortcut on its own row**, so the palette teaches the keys. The magnet window already does printed-legend well (`MagnetWindow.tsx`); adopt that pattern app-wide;
- probe the container for capabilities at open. Never ship a hardcoded model list.
- open on `⌘K` / `Ctrl+K`, close on `Escape`, be fully keyboard-driven, and never trap focus when closed.

Guard the key against fields the way `Takeover.tsx:42` does, so it does not fire inside a textarea, input or contenteditable.

## 2. Selection and the bulk bar — this is a BUILD, not a wiring job

**Correction to the original plan, verified:** the plan said every content row already carries an unused checkbox. It does not. A DOM probe for `input[type=checkbox]`, `[role=checkbox]` and `[class*=check]` returns **0 elements** on every content lane at every viewport, and `ContentList.tsx`'s `Card` renders no such control. There is also no select-all. You are introducing the selection model.

- `x` toggles selection on the focused row; a visible selection affordance appears on rows (it may appear on hover/focus and on any selected row, rather than sitting on all 300 rows permanently, but a keyboard-only operator must be able to see what is selected).
- A select-all for the current tab, and a clear-selection.
- A bulk bar appears when a selection exists, states the count in words that name the objects (`12 drafts selected`), and offers only actions valid for every row in the selection. Actions invalid for some rows say so rather than silently applying to a subset.
- The 46-row Errors tab and the 88-row Archive must be workable in one pass. That is the acceptance case.
- **Destructive bulk actions get one confirm that names the count and the consequence**, and the confirm must state what cannot be undone. The existing stale-bar bulk fires N terminal writes behind one confirm; do not copy that shape without the naming.
- Selection state is per-tab and clears when the tab or lane changes. A selection that survives a filter change is how the wrong rows get acted on.

## 3. The restore control

Phase 4a shipped `restoreDraft(id)` (returns whether a row was affected) and `canRestore(...)`. Surface it:

- On a discarded draft, offer restore **only when `canRestore` says so** (the discard must be the newest outbound event on the thread; `composeReply` discards the AI draft after Ivan hand-types a reply, and restoring that one would send a second reply to a real person).
- Restore returns the row to the pending-draft state. It does NOT approve. Say that in the UI copy: the operator gets the draft back and still has to approve it.
- When `restoreDraft` resolves false (a stale view, the row moved on), tell the operator plainly and refresh. A silent no-op is its own bug.
- Restoring re-lists the thread in the answer bucket, reversing the "a human already ruled on this thread" suppression at `inbox.ts:357`. That is intended, and it is why restore is explicit.

## 4. The shortcut sheet

`?` opens a sheet listing every key. It is generated from the same source the palette prints, so the two can never disagree. One list, two renderings.

## 5. Verification

```
npx vite build --outDir dist-p4 && npx vite preview --outDir dist-p4 --port 4177 --strictPort &
node goal-runs/workbench-2026-plan-2026-08-21/tools/probe.mjs --lane content --vw 1440 --tab Errors
npm run build && npm test
```
Rebuild before every measurement. Extend `probe.mjs` (or write your own alongside it) to drive keys: it must prove, in a real authed browser, that `⌘K` opens, that `j`/`k` move the focused row, that `x` selects, that `/` focuses search, that `?` opens the sheet and that `Escape` closes each. **Assert against the DOM after each keypress.** A key that "should" work is not a key that works.

Gates:
- `⌘K` opens and every palette row prints its shortcut.
- `j`/`k`/`Enter`/`x`/`/`/`?` work on all three list lanes (dms, content, magnets).
- No bare-key action shortcut exists anywhere: grep your own diff for new key handlers and list every key you bound.
- Bulk actions work on the 46-row Errors tab in one pass.
- Restore round-trips in a test (never against production data: no live writes from this phase either), and the ineligible cases offer no control.
- Keys do not fire inside text fields.
- 0 console errors, 0 attempted writes, `npm run build` and `npm test` clean.

## 6. Deliverable

`goal-runs/workbench-2026-plan-2026-08-21/phase4-command.md`: the palette's command source, the full key table with every binding you added, the selection model, the bulk-bar action matrix, the restore control's eligibility gating, the DOM-asserted proof for each key, and a written note that restore cannot cause a send (citing Phase 4a's trace rather than repeating it).

Commit in 3-4 logical commits. Never push. Zero em dashes in code, comments, UI strings or report. UI copy names what happens, in plain words.
