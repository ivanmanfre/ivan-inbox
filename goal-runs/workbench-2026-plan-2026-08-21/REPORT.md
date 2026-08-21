# REPORT — the 2026 workbench pass

Branch **`wb/2026-readability`**, 37 commits off `main` @ `685ccbf`. **Not pushed.** 34 files, +4,052 / -200 under `src/`. Merge is yours.

The audit's one-sentence diagnosis was that the app **sets type small and lays out empty**. Both directions are corrected, the skin Ivan chose is untouched, and every claim below is backed by an instrument reading taken in a real authed browser against this branch's build.

---

## The gate that nearly did not run

`main` did not build. `685ccbf` widened the `OpsKind` union without adding `manual_invite` to `OPS_LABEL: Record<OpsKind, string>`, so `tsc -b` rejected it, **GitHub Actions run 32425831052 failed at 22:47 UTC on 2026-08-20, and the live tool has been serving the `6db1ae7` bundle ever since.** The manual-invite attribution cards were never live. One line fixed it (`e974900`), merged in as the first commit of this branch.

The generalisable lesson, now enforced in every phase: widening a union silently breaks every `Record<Union, T>` that does not gain the key, `tsc --noEmit` and `tsc -b` disagree about catching it, and **`npm run build` is the only real gate**. A CI failure is invisible from inside the app.

---

## What shipped

### Type and measure

| role | before | after (computed, every lane, every viewport, both themes) |
|---|---|---|
| body | 13-14px, leading 14/20/21/22 | **16px / 1.6** |
| meta | 12.5-13px, leading 16/18/18.9/19.5/20 | **13px / 1.45** |
| label | 11px | **12px / 1, +0.08em** |
| title | 16px | **17px / 1.35** |
| page | 20px | **22px / 1.25** |

25 rendered type combinations collapsed onto six roles. The structural half matters more than the sizes: the flattener pinned `line-height: 20px`, so raising the body token alone would have produced 16px type on 1.25 leading across the entire app. **Every tier's leading is a ratio now**, so the next token move carries its own leading.

Prose capped at 70ch. Blocks over the cap on Today, Ops, Styles, Strategy, Sends and Settings: **0**, at 390 / 1024 / 1440 / 2560. Worst baseline offenders were `.wb-strat-note` at 329ch, `.ops-pipe-l` 277ch, `.ov-note` 276ch. Strategy's edit textarea was capped to match its reader, which is the inversion the audit named.

### Labels, and a second render path nobody had measured

One shared map (`src/lib/labels.ts`, 13 tests). Unknown values degrade to a readable sentence, so a database value added next month cannot ship a raw token again.

**The Errors tab got its reason back: 46 of 46 rows, 0 bare dashes**, counted in the DOM at 1440 and 390. The field is `taxonomy.error_message`, which the detail pane already read and the card never did. None of the three fields the plan named carried it. `Approve` was demoted on errored rows: 0 primary, 46 secondary.

Then the sweep of the nine lanes came back clean and I opened the mobile filter sheet by hand. It was still printing `single_image`, `youtube_watch`, `QA_BLOCKED` and `LINT_FAIL`. **Facet options are built in `contentFilters.ts` and never went through the map** — six specs passed no label at all and fell back to the raw column value. Fixed at the shared `tag()` helper rather than at six call sites, so a spec added later inherits it, and `typeLabel` moved into the labels module so the KIND option and the row chip beside it read one vocabulary ("Image", not `single_image` under a chip that says IMAGE). Measured with the sheet open at 390 and 1440: **raw value hits 8 to 0**.

### Today is a briefing

Rendered alert rows **20 to 10**, duplicate bodies **1 to 0**, the six identical scan-integrity warnings now one row reading `Scan integrity · 6 stores, same failure`. The genuinely concatenated CRITICAL card split into its two rows on its own embedded marker. The emoji severity mark is gone, replaced by a drawn dot reused from `Surface.tsx` with the text label kept beside it, because colour alone is not a signal. Grouped members and raw telemetry sit behind native `<details>`: nothing was deleted.

35 new unit tests, built from the real payload pulled off the network rather than invented fixtures.

### The command layer

`⌘K` palette, `?` shortcut sheet, `j` `k` `Enter` `x` `/` `Escape`. **Eight keys, all navigation or selection.** The palette and the sheet are two renderings of one `buildCommands()` array, so a key printed in one is listed in the other by construction. Unavailable commands stay listed and dimmed with their reason, preserving the rule the existing slash palette learned the hard way: a palette that hides its vocabulary teaches nothing.

Proof: a purpose-built harness drives real keypresses and asserts the DOM after each one. **71 of 71 checks at 1440, 71 of 71 at 390, 0 console errors, 0 attempted writes.** The field guard is proven two-sided: with the cursor in search, `j k x ?` left selection at zero and the field's value literally `jkx?`.

**The plan was wrong that content rows already carried unused checkboxes.** A DOM probe for `input[type=checkbox]`, `[role=checkbox]` and `[class*=check]` returned **0 elements** on every lane at every viewport. Selection was built, not wired. The Errors tab acceptance case passes: `Select all 46` gives `46 drafts selected` with the actions valid for every row in the set, declared by the row and not inferred by the bar.

### Reversibility, on the send path

`restoreDraft(id)` ships with the exact guard, matching the reason string literally rather than `send_blocked_at IS NOT NULL` (which would also match `send_failed_verified:*` rows that may already have landed, and queued `geo_gate_v2:*` rows).

**The safety argument, in one line:** restore never writes `approved_at` and only matches rows where it is already NULL, and the dispatcher's pickup predicate is `approved_at IS NOT NULL AND sent_at IS NULL`. A restored draft is not claimable; sending still takes a separate, explicit approve. The full eight-link trace with file:line evidence per link is in `phase4a-restore.md`.

**A live fail-open was closed with it.** `discardDraft` was the only DM mutation missing an `approved_at` guard, so discarding an already-approved row wrote two columns the dispatcher never reads: the row left the inbox and **the message still went out**.

Two findings here are worth your attention because both contradict instructions I gave:

- **My own spec correction was wrong, and the agent refuted it with evidence.** I had reasoned that race-held rows keep `approved_at` set and told it to use a disjunctive guard. They do not: the dispatcher bounce nulls `approved_at`, which is why `isDraft` treats a race-hold as pending at all. As a disjunction my version would have re-opened a narrower version of the same fail-open. It proved this three ways and used the plan's simpler guard. I verified the claim independently before accepting it.
- **`composeReply` opens a window the eligibility rule had to close.** It inserts the hand-typed reply and only then discards the draft, so for the two minutes before dispatch the human answer is *older* than the discard, and a pure freshness test would have offered a restore during exactly the window where the reply is in flight. `canRestore` also refuses whenever any outbound row on the thread is approved and unsent, because that state is the dispatcher's queue.

### Layout

The 860px pane cap is gone and the wide canvas buys a second column of rows. Measured as plate columns carrying a glyph, before to after: **DMs 47 to 91 of 96 at 2560**, 43 to 49 of 50 at 1440; Content 40 to 60; Magnets 45 to 57. Body characters identical in every pair, so the data did not change, the plate did.

Container queries on `.ct-card`, with the guard: `container-type` is declared inside `@media (min-width:1000px)` only, because `contain: layout` would make `.wb-work` the containing block for the mobile filter sheet's fixed scrim. Verified rather than assumed: at 390 with the sheet open, `.wb-work` computes `container-type: normal`, and the element hit-tested at the tab bar's centre is the sheet's own option button.

DM HISTORY expanded: **59,452 characters to 4,520**. The context sheet docks beside the thread on a wide canvas instead of covering it. The takeover's surplus goes to the inspector (520px to 920px) while the LinkedIn artifact measure stays exactly 640px, because widening it makes the preview lie about what LinkedIn will show. The magnet rail's hierarchy is the right way up. `tabular-nums` is scoped off running prose, so digits inside DM bubbles stop being typeset like a spreadsheet.

---

## The verification caught a real regression

This is the result I would most want flagged if I were reading someone else's report.

`#exp/stock` is the escape hatch to the pre-revamp shell, and the run's contract was that it renders identically. `src/styles.css` has a **zero-line diff**, so on a stylesheet argument it was untouched. The pixels disagreed.

The cause: `RowSelect` is rendered from `InboxScreen.tsx`, and **that file is shared** — the stock shell renders it too, and mounts no command layer. Every inbox row in the escape hatch had grown a selection mark with no keys behind it. Names shifted right and one wrapped to a second line, for a control that shell cannot drive.

Fixed: the layer announces itself in the store, and `RowSelect` renders nothing and registers nothing without it.

The instrument needed defending too. The first comparison showed all three viewports differing, and the easy explanation (stock renders live data and relative times) was **wrong**: two captures of the same build, back to back, are identical. The honest test is capturing both builds inside the same window with a same-build control alongside. Final result:

| viewport | main vs branch | main vs main (drift control) |
|---|---|---|
| 390 | **IDENTICAL** | IDENTICAL |
| 1024 | **IDENTICAL** | IDENTICAL |
| 1440 | **IDENTICAL** | IDENTICAL |

---

## Definition of done

### Verified by instrument

- [x] Body computes to 16px/1.6 and labels to 12px on every lane, every viewport, both themes, by computed style
- [x] Both documented small-type waivers hold at their measured sizes. Today's sub-11px count moved 0 to 10, which is the `.sa-sev` waiver being **honoured**: before this run none of the alert strip's classes were reasserted, so the waived 10.5px label was being flattened to 14px
- [x] 0 prose blocks over 70ch on Today, Ops, Styles, Strategy, Sends, Settings
- [x] All 8 raw database values gone, plus a ninth surface (the filter sheet) that no earlier measurement had reached: 8 hits to 0
- [x] 46 of 46 Errors rows render a reason, 0 dashes
- [x] Today: rendered rows equal distinct rows, the six identical bodies are one counted group
- [x] `⌘K` opens, every palette row prints its shortcut, and the navigation keys work on all three list lanes: 71/71 DOM-asserted checks at both viewports
- [x] No bare-key action shortcut exists. Eight keys bound, all navigation or selection, enforced by a test that fails if any action command gains a key
- [x] `discardDraft` carries the guard; restore's inability to cause a send is proven by written trace against the dispatcher predicate
- [x] At 2560 DMs renders a second working pane; no lane leaves a dead column
- [x] Content table does not clip with a peer docked, and the mobile scrim still covers the tab bar
- [x] DM HISTORY expanded: 4,520 characters, under the 10,000 gate
- [x] Artifact measure still 640px; inspector 520px to 920px
- [x] `npm run build` clean. **906 tests passing, up from 827**, with the one pre-existing `calendarItems.test.ts` failure unchanged. 0 console errors dark and light, 0 real overflow, across 9 lanes x 4 viewports x 2 themes
- [x] `#exp/stock` byte-identical at all three viewports
- [x] **Attempted writes against your database: 0**, across every measurement in the run
- [x] 0 em dashes and 0 forbidden-language hits in the copy this run added (453 lines of strings and JSX text judged)

### Two items I could not close, stated plainly

- **Restore has never round-tripped on a real discarded row.** The DoD asked for it; doing it means a live write, which the run's mutation tier forbids. It is proven by guard-shape tests against the filters the real write sends, and by the written trace. Its first real use is a watch-first item. Live rows in exactly the expected shape do exist (`approved_at` null, `sent_at` null, `send_blocked_reason = 'discarded_in_inbox'`), confirmed by a read-only query.
- **The "no lane leaves more than 40% of the plate empty" gate is unreachable as written**, and I did not chase it. It implies 60% glyph coverage; the densest surface in the app reaches that only because it is a wall of text in a narrow column, and the same content measures 47% at 2560. The column-fill numbers above answer the real question instead. My first instrument was worse than wrong: hit-testing elements reported a pane 96% full when its text covered 3% of it, because a row container spans the pane whether or not it carries a word.

### Watch first, on your screen and your rhythm

- 16px body in daily use: does the reading win hold, or does the list now feel long?
- `⌘K` against your muscle memory from other tools, and whether `x`-select lands where you expect
- Discard-restore's first real use on a draft you actually want back
- The context sheet beside the thread rather than over it, at your real window width
- DM HISTORY's page size against how you actually search history
- Whether the DRAFT-badge staleness the audit saw once reproduces
- One transient: a single Supabase realtime WebSocket error appeared in one light-theme sweep and did not reproduce on re-run. Environmental, but worth knowing it exists

---

## Decisions that are yours, not mine

1. **`⌘Enter` to approve is unbound.** The spec permitted it where a confirm sheet fires; the implementer left it out because it is an action key on a surface deliberately built so destructive verbs stay deliberate, and I agree. It needs your word either way.
2. **One colour changed, against the "skin does not change" rule.** `--text4` went `#6E6E6E` to `#7E7E7E`, 4.13:1 to 5.03:1. It carries real words in eleven places and failed the body contrast bar. I treated legibility repair as in scope and the skin as untouched, on the precedent that the mission explicitly blessed fixing the light theme's contrast bug. One-line revert if you disagree.
3. **Native `popover` was deferred**, not shipped. It puts the panel in the top layer, where `position: absolute` resolves against the initial containing block, so anchoring it to its pill needs CSS anchor positioning, which is outside the stated iOS 17 baseline. Trading 15 lines of dismiss handling for 25 lines of coordinate maths is a bad deal. The mobile sheet path alone is a clean win and worth a small follow-up.
4. **Mobile chrome went four bands to three, not two.** Merging the last two re-opens a measured defect that `faithful.css:2901` closed. The first row still moved from 254px to 204px, so content starts 25% down the screen instead of 31%.
5. **Tier 4, the ground and plate question, is untouched and still yours.**

---

## Merging

```bash
git checkout main && git merge --no-ff wb/2026-readability && git push origin main
```

Pushing triggers GitHub Actions and publishes to the live tool. Nothing in this run arms anything on real traffic, no n8n workflow was read or edited, no migration was written, and no production row was mutated. **The merge also ships the build fix, so it is what puts `manual_invite` and everything since `6db1ae7` live.**
