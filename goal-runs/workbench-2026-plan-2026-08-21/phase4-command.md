# Phase 4b: the command layer, selection, the bulk bar and the restore control

Branch `wb/2026-readability`. Four commits: `bf4b366`, `bc8fbe4`, `deba26d`, `026ab43`.

No live write was made. Every measurement below comes from the local preview of this branch
(`localhost:4177`, `dist-p4`) in a real authed browser, with the write interceptor from `probe.mjs`
carried unchanged. **Attempted writes: 0.**

---

## 1. The palette's command source

One array, `buildCommands(ctx)` in `src/exp/v2c/commandSource.ts`. The palette
(`CommandPalette.tsx`) renders it matched against a query; the `?` sheet (`ShortcutSheet`, same
file) renders `keyRows(cmds)`, which is that array filtered to the commands a key runs. **There is
no second table of shortcuts in this app.** A key printed on a palette row is the key listed in the
sheet, by construction rather than by discipline.

`ctx` is built once, in `CommandLayer.tsx`, from the live surface: the job off the hash, the rows in
the DOM in render order, the selection, and which capability each selected row carries. Nothing is
hardcoded. There is no model list.

**The five groups, and what is in them:**

| group | commands | source |
|---|---|---|
| Move | next row, previous row, open the focused row, search this list, keyboard shortcuts, command palette, close what is open | fixed |
| Select | select the focused row, select every row in this tab, clear the selection | fixed |
| Act | approve / skip / delete the selected rows | fixed, readiness from the selection |
| Go | the 9 jobs (`layout.ts` `JOBS`) | `JOBS`, never a copy |
| Open | every row on screen, by name, capped at 200 | the DOM, at the moment the palette opens |

Measured, Content lane on the Errors tab at 1440: **68 rows** in the palette, of which 46 are the
Open group. On DMs: 30. On Magnets: 33.

### The vocabulary never shrinks

Read the comment above `matchCommands` in `ChatPane.tsx:140` before touching this. An earlier build
of that palette filtered unavailable commands out; with no turns on the pane, typing `/retry`
matched nothing, the palette closed, and Enter sent the literal string `/retry` to the model. Three
behaviours are reused here rather than reinvented:

1. **Unavailable commands are listed, dimmed, and print their reason.** Measured: 5 dimmed rows on a
   clean lane, 5 of 5 carrying a reason. `.wb-cmdk-row.off` is `opacity:.5`, and its hint slot holds
   the refusal instead of the description.
2. **Token-wise matching, not whole-string.** `row next` finds `Next row`. The whole-string form
   returned zero commands for `model haiku` against `/model claude-haiku-4-5`, which is what closed
   that palette.
3. **A query that matches nothing does not close the palette.** It renders `Nothing is called
   "zzqq". Clear the box to see every command again.` and Enter is a no-op. There is no
   fall-through here for a stray Enter to hit.

### Every row prints its shortcut

`.wb-cmdk-k` is spent on every row. A command that no key runs prints **`no key`** rather than
leaving the column blank: a column that is empty on half the rows teaches the reader to stop looking
at it. Measured at both viewports and on all three lanes: **rows with a printed key = rows total**
(68/68, 30/30, 33/33).

Computed style on the printed key: `12px / 19.2px / 700` against the palette box's `16px / 25.6px /
400`, so it is not landing on the flattener's body tier.

---

## 2. Every key bound, in full

`CommandLayer.tsx`, one `keydown` listener on `window`.

| key | what it does | group |
|---|---|---|
| `⌘K` / `Ctrl+K` | open the palette | Move |
| `j` | focus the next row | Move |
| `k` | focus the previous row | Move |
| `Enter` | open the focused row (the same as clicking it) | Move |
| `x` | select or deselect the focused row | Select |
| `/` | put the cursor in this list's search field | Move |
| `?` | open the shortcut sheet | Move |
| `Escape` | close the top layer | Move / Select |

Eight keys. **Nothing else is bound.**

### No bare-key action shortcut exists

`a` / `r` / `e` / `s` were removed from the draft window on 2026-08-09 as unneeded, and the
reference implementation that bound bare `⌘A` to approve and `⌘R` to reject is not copied. Approve,
skip, delete and send stay on their buttons and in the palette, behind the confirm sheets they
already carry.

**`⌘Enter` is not bound either.** The spec permits it where a confirm still fires; it was not taken.
An approve key is an approve key, the confirm is one Enter away from it, and the phase gained
nothing by adding a ninth binding to a surface whose whole point is that the destructive verbs are
deliberate. If Ivan wants it, that is his word to give.

This is asserted, not asserted-about: `commandLayer.test.tsx` fails if any command in the `Act`
group carries a key, and fails if the set of bound keys is anything other than
`['/', '?', 'Enter', 'Esc', 'j', 'k', 'x', '⌘K']`.

### Approve-undo is not built, in any variant

The dispatcher claims rows on `sent_at IS NULL` without re-checking `approved_at`
(`docs/send-path-verification.md:40-46`), so a client-side undo fails open: the screen would say
undone while the DM went out. Discard-restore is the sanctioned reversibility feature, and it is a
database guard rather than a timer. Nothing in this phase adds an undo, a countdown or a grace
period to approve.

### Existing keys, not stolen

- `⌘D` voice (`Shell.tsx`) untouched.
- `j`/`k` in the draft window (`DraftPane.tsx:958`) and the magnet window (`MagnetWindow.tsx:325`)
  untouched: the layer returns early whenever `.wb-tkscrim`, `.sheet-scrim` or `.wb-fsheet-scrim` is
  in the DOM, so two listeners never walk two queues off one keypress.
- `Escape` in `Takeover.tsx:42` still closes the window. While the palette or the sheet is open the
  layer calls `stopImmediatePropagation()` so the window underneath does not close in the same
  keypress; when neither is open it does not interfere.

### Keys never fire inside a field

Same rule as `Takeover.tsx:42` and wider, because this listener binds bare letters: if
`document.activeElement` is an `INPUT`, `TEXTAREA`, `SELECT` or `isContentEditable`, the handler
returns before anything else, `⌘K` included. The palette's own input handles its keys locally
(`CommandPalette.onKey`: `Escape`, `ArrowUp`/`ArrowDown`, `Enter`), so the palette is fully
keyboard-driven under the same rule.

**Proof, two-sided.** With the cursor in the search field, `j` `k` `x` `?` were pressed. After:
selection 0, sheet absent, palette absent, `activeElement` still `INPUT`, and the field's value is
literally `jkx?`. The keys were delivered to the field, not swallowed and not acted on.

---

## 3. The selection model

There were no checkboxes to wire. Phase 0 measured it: `input[type=checkbox]`, `[role=checkbox]` and
`[class*=check]` return **0 elements** on every content lane at every viewport. This is the control
being introduced.

- **State** lives in `commandStore.ts`, a module store with per-row scalar subscriptions. Three list
  surfaces owned by three files get selection by rendering one component inside the row; moving the
  focus re-renders the two rows that changed rather than all 300.
- **The mark** is `RowSelect.tsx`. It writes `data-wbrow`, `data-wbsel` and `data-wbfocus` onto the
  row it finds with `closest('.ct-card, .r')`, so the keyboard layer walks the DOM and the CSS
  paints from the same three attributes.
- **It is not painted on all 300 rows.** The mark appears on hover, on the keyboard-focused row, and
  on any selected row. A keyboard-only operator therefore always sees the row he is on and every row
  he has picked; a mouse operator sees a mark wherever the pointer is.
- **Order comes from the DOM, metadata from a registry.** j/k walks the rows the operator can
  actually see, filtered and searched and tab-selected, because the render order IS that answer. Any
  copy of it kept in React would be a second source of truth that drifts on the next filter change.
- **Select-all** takes every row on the current tab. **Clear** drops the selection and writes
  nothing.

### Scope: what a selection is allowed to survive

`setScope` is called every 400ms with a signature read off the live surface: `job | lane | tab |
search text`. Any change to it drops the selection **and** the focus. A selection that outlives a
tab change is how the wrong rows get acted on: pick twelve error rows, switch to Archived, and the
bar still says twelve while pointing at rows you can no longer see.

Measured: 46 rows selected on the Errors tab, one click on Published, selection 0 and the bar gone.

---

## 4. The bulk-bar action matrix

Capabilities are declared by the row, in `ContentList.tsx`'s `Card`, from the same functions the
single-row controls already obey. The bar never infers one.

| row | approve | skip | delete | why |
|---|---|---|---|---|
| Ivan draft at `review` or `error` | yes | yes | yes | `reviewActionable(status, 'ivan')` |
| Ivan draft at any other stage | no | no | yes | not actionable, but the ✕ is legal |
| client draft not on the board | no | no | yes | `reviewActionable` is Ivan-only; `boardGroupOf(d) !== 'board'` |
| client draft on the board | no | no | no | deleting a promoted draft leaves a ghost on the client's board |
| lead magnet | no | no | no | no bulk write exists for this row set |
| conversation | no | no | no | an answer is written one at a time |

**Rules the bar keeps:**

1. **The count names the object.** `46 drafts selected`, `1 conversation selected`, `2 lead magnets
   selected`. Mixed kinds fall back to `rows` rather than picking one.
2. **An action runs on every selected row or none.** If 4 of 12 rows cannot take it the button is
   refused, its title says `4 of the 12 selected rows can take this`, and a line under the bar says
   it in words. The refusal is enforced in `useBulkRun`, not only in the disabled state, because the
   palette can reach the same action.
3. **One confirm, naming the count and the consequence.** Approve: `Approve 46 drafts?` /
   `Each one is marked approved. Nothing publishes and no date is set…`. Skip: `Skip 46 drafts?` /
   `…leaves the queue. This screen has no way to bring them back.` Delete: `Delete 46 drafts?` /
   `This removes them for good and nothing here can undo it. Any row the database refuses to delete
   is archived instead, and the bar says how many.` The last clause is `deleteDraft`'s real
   fallback, reported as a number after the run rather than left to be discovered.
4. **A surface with no bulk write says so** instead of showing buttons that would refuse:
   `A conversation is answered one at a time. Open one to read it and reply.`

The writes are `approveDraft`, `skipDraft`, `deleteDraft` / `deleteClientDraft` from `lib/content.ts`,
the same functions the row buttons call. No bulk path has a write of its own.

### The acceptance case

**Errors tab, 46 rows, one pass.** Measured at 1440 and at 390: `j`, `x`, then `Select all 46` gives
`46 drafts selected` with `Approve 46 · Skip 46 · Delete 46 · Clear`. Archived (88 rows) works the
same way and offers Delete only, since none of those rows is `reviewActionable`.

Screenshots: `phase4-shots/bulkbar-errors-1440.png`, `phase4-shots/bulkbar-errors-390.png`.

---

## 5. The restore control, and its eligibility gating

`RestoreStrip.tsx`, mounted in `ThreadScreen.tsx` between the conversation and the draft card.

**A discarded draft had no surface anywhere.** `isDraft` excludes blocked rows so it leaves
`thread.draft`; `ThreadScreen`'s own bubble filter drops `discarded_in_inbox` by name; and the
failed-send log excludes the same reason on purpose (`sends.ts:104`). The row was reachable from
nowhere, which is fine for a decision that was right and useless for one that was a mis-tap.

**The gate is `canRestore` and nothing else.** When it says no, the row is still drawn (reading what
was thrown away is the point) and **no control is offered**. The sentence under an ineligible row
explains what `canRestore` decided; it never decides anything itself.

| case | control | what the row says |
|---|---|---|
| the discard is the newest outbound event | Bring it back | `It comes back as a draft waiting on you. Nothing is sent until you approve it.` |
| a reply is approved and unsent on this thread | none | `A reply on this thread is already in the send queue…` |
| our own side has spoken since the ruling | none | `You have written on this thread since this draft was thrown away…` |
| an inbound reply arrived after the discard | Bring it back | eligible: they wrote again, the thread owes an answer |
| any other block reason | the strip renders nothing at all | not our discard |

**Restore is not approve, and the copy says so** rather than leaving it to be discovered. The write
clears two columns and nothing else.

### Restore cannot cause a send

Not repeated here: the link-by-link trace is `phase4a-restore.md` section 2. In one line, restore
only matches rows where `approved_at` is already NULL and it never writes that column, so the row it
produces is invisible to the only process that sends from this queue, whose predicate is
`approved_at IS NOT NULL AND sent_at IS NULL`. The send decision stays where it was: one human tap
on Approve, made after the copy is back on screen and readable. This phase adds no path around that.

### A false return is not a success

Both writes report a refusal instead of a silent no-op, which is what phase 4a's boolean returns
were for.

- **`restoreDraft` false** (`RestoreStrip.tsx`): `Nothing changed. This row has moved on since the
  screen loaded, so the draft was left alone. Reloading the conversation.` and the thread refetches.
- **`discardDraft` false** (`ThreadScreen.tsx` `onDiscard`, `DraftsScreen.tsx` `handleDiscard`):
  `This one was already approved and is in the send queue, so the discard did not stop it. Nothing
  was changed.` Before this, discarding an approved row wrote two columns the dispatcher does not
  read: the row left the inbox and the message still went out on the next two-minute tick, and the
  operator was shown a successful discard. The guard closed in 4a; this is where it is spoken.

---

## 6. The key proof, asserted against the DOM

`tools/keys-probe.mjs`, a copy of `probe.mjs` with its write interceptor unchanged. It drives real
keypresses and reads the DOM after each one. Both viewports, all three list lanes.

```
node goal-runs/workbench-2026-plan-2026-08-21/tools/keys-probe.mjs --vw 1440
node goal-runs/workbench-2026-plan-2026-08-21/tools/keys-probe.mjs --vw 390
```

| check, per lane (dms / content / magnets) | 1440 | 390 |
|---|---|---|
| rows carry `data-wbrow` | 8 / 46 / 11 | 8 / 46 / 11 |
| `j` focuses the first row, exactly one row focused | pass | pass |
| `j` moves down one row | pass | pass |
| `k` moves back up one row | pass | pass |
| `x` selects the focused row | pass | pass |
| the bulk bar appears and names the count | `1 conversation` / `1 draft` / `1 lead magnet` | same |
| `x` again deselects, and the bar leaves | pass | pass |
| `Escape` clears the selection | pass | pass |
| `/` puts the cursor in the search field | `search-in` / `ct-fsearch-in` | same |
| no key fires while an input has focus, and the characters reach the field | typed `jkx?` | typed `jkx?` |
| `?` opens the sheet, every sheet row prints a key | 9 rows | 9 rows |
| `Escape` closes the sheet | pass | pass |
| `⌘K` opens the palette | pass | pass |
| every palette row prints its shortcut | 30/30, 68/68, 33/33 | same |
| unavailable commands listed and dimmed with a reason | 5 of 5 | 5 of 5 |
| a no-match query keeps the palette open and says so | pass | pass |
| `Escape` closes the palette | pass | pass |
| the palette lists the rows on screen by name | `Open` group present | pass |
| `Enter` opens the focused row | pass | pass |
| `Escape` walks back out of the opened row | pass | pass |

| whole-surface check | result |
|---|---|
| Errors tab: 46 rows on screen | pass |
| select-all takes every row in one pass | `46 drafts selected`, 46 of 46 |
| the bar offers the actions valid for the selection | `Approve 46`, `Skip 46`, `Delete 46` |
| selecting every row does not move the row anatomy | title x 292 and row height 86, identical before and after |
| the mark is taken out of the grid flow | `position: absolute` |
| a selection does not survive a tab change | 0 selected, bar gone |
| the palette is a real overlay above the takeover layer | `position: fixed`, `z-index: 70` |
| the printed key is not flattened to body size | key 12px against box 16px |

**71 of 71 checks at 1440. 71 of 71 at 390. Console errors: 0. Attempted writes: 0.**

Screenshots at both viewports: `phase4-shots/palette-{1440,390}.png`,
`phase4-shots/bulkbar-errors-{1440,390}.png`, `phase4-shots/shortcuts-{1440,390}.png`.

### Three defects the proof caught

A key that "should" work is not a key that works, and the same is true of a control that "should"
not disturb a row.

1. **The selection mark took the anchor's grid column.** `.ct-card` is a seven-column grid with a
   fixed template (`faithful.css:2488`). A mark rendered as its first child consumed column 1, so
   every cell moved one place right: on the Errors tab the title wrapped and the review buttons
   jumped a row. The mark now lives inside `.ct-anchor` (already `position: relative`), absolutely
   placed over its corner, and finds its row with `closest()`. The probe now asserts the title's x
   and the row height are identical with 46 rows selected and with none.
2. **`Escape` could not close an opened row.** `Takeover.tsx` owns Escape for the draft and magnet
   windows, but a peer is not a Takeover. At 390 a thread opened with Enter became the whole screen
   with no key that left it. Escape now presses the peer's own close control as its last layer,
   after the palette, the sheet, the selection and the focus, so there is one close path and it
   cannot drift from the button. Three selectors, because the peers were built at three times:
   `.wb-take .wb-back`, `.wb-take .back`, `.wb-peer .wb-pane-x`.
3. **The layer was unmounted on the mobile takeover branch**, which does not render the work surface
   at all. It mounts there too. The list keys are inert (no rows), and `⌘K` and `Escape` are the way
   back out.

### Two false failures in my own instrument, and what they were hiding

Worth writing down, because both would have been read as product defects:

- **A fragment-only `goto` does not reload the document.** Walking `dms` → `content` → `magnets` is
  three hash changes in one document, so at 390 the full-screen peer opened by the previous lane's
  Enter test was still covering the work surface and every later lane measured zero rows. Nine
  failures, one cause, and it was hiding the real defect underneath it (number 2 above). The probe
  reloads now.
- **Setting an input's `.value` from `evaluate()` does not fire React's `onChange`.** The query
  stayed in state, the list stayed filtered, and the Content and Magnets lanes measured empty for the
  rest of the run. Clearing goes through `locator.fill('')` now.

---

## 7. Tests and gates

`src/exp/v2c/commandLayer.test.tsx`, 24 cases, none of which can reach the database:
`renderToStaticMarkup` runs no effects and fires no events, so the restore control is asserted on the
markup it draws rather than by calling the write.

- the vocabulary never shrinks: the same command ids with nothing selected as with a full selection
- every unavailable command carries a reason
- the lane you are on is listed and dimmed, not dropped
- a bulk action only some of the selection can take is refused, and the reason states the number
- `matchWbCommands` is token-wise, an empty query is the whole vocabulary, a no-match returns nothing
- every sheet row comes from the palette array and prints a key
- **no command in the `Act` group carries a key**
- **the only keys bound are `/ ? Enter Esc j k x ⌘K`**
- `selectionNoun` names the object, and falls back to `rows` on mixed kinds
- the store: toggle, select-all does not duplicate, the row scalar, a scope change drops selection
  and focus, the same scope leaves it alone, a row unregisters
- the restore control: offered when the discard is newest; withheld while a hand-typed reply is
  queued (the `composeReply` window, where the human answer is OLDER than the discard); withheld
  once our side has spoken; still offered after an inbound reply; renders nothing on a thread with
  no discard; refuses every block reason that is not ours

| gate | result |
|---|---|
| `npx tsc -b` | clean |
| `npm run build` | green |
| `npm test` | 906 passed / 1 failed (44 files) |
| `npx oxlint` on the new files | clean |
| console errors, both viewports | 0 |
| attempted writes | 0 |

The one failure is the documented pre-existing `calendarItems.test.ts > "passing no queue is the old
behaviour exactly"`, unchanged since phase 0. The tree's count moved from 827 to 906 across four
phases; 24 of that delta are this one's.

---

## 8. Collisions, and what the spec got wrong

**`Shell.tsx`, shared with the layout pass.** Two mount points and one import, all by exact-anchor
`Edit`, never a whole-file write, with a `git status` read immediately before each one. There was no
conflict: the layout agent was working in the region below. The second mount (the mobile takeover
branch) was not optional, per defect 3 above.

**`wb2026.css`.** Section C only, every selector at `.wb.wb.wb`. The layout agent's commits twice
swept my uncommitted section C into theirs; nothing was lost and nothing of theirs was clobbered,
and both times I re-checked that the working-tree diff was section C alone before staging it. One
rule in section C is order-dependent and says so in place: `.ct-anchor > .wb-selmark` carries the
same specificity as the base `.wb-selmark` rule, so it must stay after it for `absolute` to win.

**`src/lib/inbox.ts` was not touched.** `restoreDraft`, `canRestore`, `isDiscarded` and
`discardDraft` are called as they ship. No signature change is needed.

**`src/styles.css` was not touched.**

### What the spec got wrong

1. **`ContentList.tsx`'s `Card` cannot host the mark as a direct child.** The spec assigned the file
   and left the placement open; the card is a fixed seven-column grid, so the only correct home is
   inside `.ct-anchor`. Anything that adds a box to that row breaks the anchor rail every list in
   this app is built on.
2. **"Escape closes each layer in order" had a layer nobody had counted.** The spec lists the
   takeover, the palette and the sheet. The peer is a fourth, it is the whole screen at 390, and
   nothing closed it from the keyboard before this phase.
3. **Mounting from the work surface does not cover the whole app.** The spec's "an import plus a
   mount line" is right for the two main returns and wrong for the mobile takeover branch, which
   renders no work surface. Two mount lines, and the reason is in the comment.
4. **`DmsSurface.tsx` was not the file to edit for DM rows.** It delegates to
   `InboxScreen.tsx`, which owns the thread row markup. The edit landed there (one line), not in the
   surface file the spec named.

### Deferred, with the reason

- **`⌘Enter` to approve.** Permitted by the spec where a confirm still fires; not taken. It is an
  action key on a surface built so the destructive verbs stay deliberate, and the confirm is already
  one Enter away. Ivan's word to give.
- **Bulk actions on lead magnets and conversations.** Neither row set has a bulk write that exists
  today. The bar says so in plain words rather than showing a button that would refuse.
- **`Escape` inside the search field.** The layer refuses to act inside a field, by rule, so it does
  not blur the box. The field is `type="search"`, so the browser's own Escape clears it; a Tab or a
  click leaves it. Adding an exception would have put a hole in the guard the phase gate is written
  about.
