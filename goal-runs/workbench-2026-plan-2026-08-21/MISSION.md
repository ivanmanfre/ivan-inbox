# MISSION — ivan-inbox workbench: 2026 readability, command layer, layout

Authored 2026-08-21 from the full-surface audit in this folder. Read this whole file before acting.

---

## Mission

Ship the audit's Tiers 1 to 3 into `ivan-inbox`: make the workbench read the way Ivan asked for three separate times, give it a command layer so his hands never leave the keyboard, and make the layout fill the canvas it already occupies. The audit is done and is not up for re-litigation — `baseline/audit-report-no-images.html` is the finding set, `baseline/report.json` + `baseline/clicks*.txt` are its measurements, `baseline/shots/` is the before state. Your job is execution and proof, not re-diagnosis.

Show me your best work, not your safest. I will not answer questions mid-run: make every technical and factual call yourself and log why. Where a call is irreducibly Ivan's taste, ship a ballot artifact, never a mid-run question and never an autonomous convergence.

**The one-sentence target:** the app currently sets type small (13-14px body) while laying out empty (Content renders 1 row on 1440x900; DMs wastes ~65% of a 2560 plate). Both directions get corrected, and the skin Ivan chose does not change.

---

## Hard guardrails

- **No new spending.** No paid API calls, no image generation, no regen buttons fired, no new dependencies. The app has exactly 3 runtime deps and keeps exactly 3.
- **Invent nothing.** Every claim in your report is backed by an instrument reading or a file:line. Mission prose is never a data source: resolve every selector, token, count and id from the live code or a live read before acting on it.
- **THE SKIN DOES NOT CHANGE.** Pistachio ground `#C5E1A5`, the floating charcoal plate, `--plate-r: 40px`, the lime `#B8FF66` accent, dark-as-default: all untouched. Ivan chose this direction from a reference he named himself, and the audit's own adversarial pass ruled that a readability request never licenses a skin change. The ground/plate question is Tier 4 and is NOT in this run.
- **NO PROSPECT-FACING COPY CHANGES.** You are changing UI labels only. Any string that reaches a prospect — `message_text`, connect notes, DM templates, n8n hardcoded strings, `content_prompts` rows — is out of scope and untouchable. Changing outreach copy requires a written proposal and Ivan's explicit OK (standing rule, 2026-08-21).
- **NO n8n CHANGES. NO DATABASE MIGRATIONS.** Everything in this run is app code. The dispatcher `kFYlfnWd98YaiErH` is not edited, not read from, not depended on. If a phase seems to need either, that phase is out of scope: log it and move on.
- **Do not touch `#exp/stock`.** It is the escape hatch to the pre-revamp shell. Its rendering must be pixel-identical before and after; prove it in Phase 6.
- **Re-read canon before writing copy.** `content_prompts` slugs `forbidden-language` and `author-voice` are authoritative for any user-visible string you write, including empty states and error text. Zero em dashes. Re-read the project memory index too; it may have moved since this file was authored.

### Mutation tier: **T1 — mutate-with-rollback, deploy authority NOT granted**

- You work on a branch. `main` is never committed to and never pushed.
- **Deploy authority is NOT granted.** `git push origin main` triggers GitHub Actions and publishes to Ivan's live tool. You do not push to main under any circumstance. You finish on a branch with a merge-ready summary; Ivan merges.
- Live Supabase rows and n8n workflows: read-only. No writes.
- **Any click-through verification runs behind a write interceptor.** Opening a DM thread stamps `read_at` (`src/lib/inbox.ts:721` via `src/screens/ThreadScreen.tsx:110`). `baseline/clicks.mjs` carries the working interceptor: it fulfils every PATCH / PUT / DELETE / non-rpc POST locally and logs the attempt. Reuse it. Report the attempted-write count in Phase 6; the audit's count was 0 and yours should be too.

---

## Locked forks (resolved; do not reopen)

1. **Scope = Tiers 1-3 only.** Tier 4 (the ground/plate ballot) is excluded by design.
2. **Action keys are OUT; navigation keys are IN.** `a`/`r`/`e`/`s` action shortcuts were deliberately REMOVED from the draft window on 2026-08-09 as unneeded. You ship the ⌘K palette, `j`/`k`, `Enter`, `x`, `/`, `?` and `Escape`. You do NOT re-add bare-key action shortcuts. `⌘Enter` to approve is permitted only where a confirm sheet still fires. Anything beyond that goes in the report as needing Ivan's word.
3. **Approve-undo is killed.** Verified: the dispatcher claims rows on `sent_at IS NULL` without re-checking `approved_at`, so a client-side undo fails open — the UI says undone and the DM sends anyway. Do not build it, do not build a variant of it. Discard-**restore** is the sanctioned reversibility feature.
4. **Light theme stays opt-in.** Do not make it default and do not add `prefers-color-scheme`. Its lime-on-white contrast bug (1.20:1) still gets fixed.
5. **`@layer` is out of scope.** The `.wb.wb` / `.wb.wb.wb` specificity flattener stays. Fixing it properly is a three-layer refactor across 1,605 selectors and belongs to a day spent inside the stylesheets. You live with it — see the central risk.

---

## Orchestration mandate

Fan out. Parallel implementer agents per phase, each owning a disjoint file set, each committing every 15-20 minutes so no more than one surface is ever at risk. Capture every agent ID at dispatch. Cap parallel Opus builders at 4.

Every load-bearing claim gets an adversarial verification pass by a skeptic whose only job is to refute it; **skeptics default to REFUTED on thin or ambiguous evidence.** Give them named roles and real past incidents from this repo to hunt:

- **The Flattener skeptic** — "this new CSS rule silently lost its type to `.wb.wb *` and renders at 14px/20px instead of what it declares." Hunt it with computed-style reads, never by eyeball. This exact defect shipped once already: the LinkedIn artifact rendered 13px/20px instead of 15px/1.6 until every selector took `.wb.wb.wb`.
- **The Surface skeptic** — "this landed on desktop and not on mobile / not in the takeover / not in the peer / not at 2560." Two prior runs shipped to one of several live surfaces and called it complete.
- **The Self-Report skeptic** — "the implementer's summary says it is fixed and the pixels disagree." A prior candidate certified zero sub-32px controls; the instrument reproduced nine, twice.
- **The Waiver skeptic** — "this type raise trampled a size Ivan explicitly ruled on." Two live waivers: Sends KPI tile labels at 9px below 480px (load-bearing, measured), and client-board chips at 10/10.5px (Ivan's explicit word).
- **The Stale-Bundle skeptic** — "you verified by grepping the built bundle instead of looking at the page." Ivan said "you changed nothing" after three real deploys because of this. Authed screenshots are the only accepted proof.

Run a completeness critic before any phase is called done: "what surface, viewport, tab or state did this phase not verify?"

Use the Agent tool for work needing judgment or per-agent artifacts; use the Workflow tool for deterministic fan-out (the same measurement across N known surfaces). Any phase that is a multi-task implementation build follows `superpowers:subagent-driven-development` implementer→reviewer→ledger discipline. Load `surgical-edits` before any edit: touch only what the phase requires, no drive-by refactors. These patterns are a floor, not a ceiling.

---

## Phase 0 — Scope, central risk, surface inventory

**Central risk, named:** this app's stylesheet wins by repetition. `faithful.css` flattens every descendant (`.wb.wb, .wb.wb *` → one size, line-height 20px) and re-asserts its tiers at `.wb.wb.wb`. A single-class rule loses silently and renders at body size. A type run against this cascade is exactly the run that ships invisible no-ops. **Neutralisation:** every CSS change in this run is verified by reading `getComputedStyle` on the real element in a real authed browser, per surface, and the phase is not done until a computed-style table exists proving the intended value landed. Never eyeball, never trust the source declaration.

**Surface inventory — build it by searching, not from memory.** Grep the code and drive the app. Enumerate every place each change must land, and carry the list forward as the per-phase verification matrix:

- 9 lanes: `today · dms · content · magnets · styles · strategy · sends · ops · settings`
- 3 canvases: mobile `<1000px`, desktop `>=1000px`, wide `>=1320px` (test at 390 / 1024 / 1440 / 2560)
- Takeovers: draft window (+ inspector tabs QA / Source / Log / Fields / Artifact), magnet window
- Peers: thread peer, Claude pane; and the context sheet over the thread
- Content: all 9 stage tabs (`Ideas 82 · Needs review · Generating · Approved · Scheduled · Published 113 · Errors 46 · Archived 88 · Other`), Flow and Calendar views, 3 client lanes (Ivan / Mattan Danino / Davorin Smit), the filters sheet
- Sends: Overview / Lanes / Log, plus the range menu
- DMs: the 5 client filters, search, DM HISTORY expanded, pushed-to-later
- Both themes (dark default, light opt-in), and `#exp/stock` as the untouched control

Write `phase0-scope.md` with the risk, the inventory, and the branch name.

**Baseline gates, measured 2026-08-21 at HEAD `685ccbf` — re-measure at launch, do not trust these numbers blind:**

- `npm run build` — **was FAILING** at `685ccbf` (TS2741: `manual_invite` missing from `OPS_LABEL: Record<OpsKind, string>`, `src/screens/DraftsScreen.tsx:20`). Fixed on branch `fix/ops-label-manual-invite`; if that branch is not in your history, the build will fail before you change anything and you fix it first.
- `npm test` — **827 passed / 1 failed** of 828, in 42 files. The single failure is `src/lib/calendarItems.test.ts > "passing no queue is the old behaviour exactly"`: `buildCalendarItems([d()], [], NOW)` yields `stage: 'scheduled'` where `buildCalendarItems([d()], undefined, NOW)` yields `stage: 'stuck'`. Pre-existing, unrelated to this run's scope. **Do not chase it and do not let it block you**; your job is that the failure count does not GROW. If you touch calendar staging for another reason, fix it and say so.
- `npm run lint` — warnings only, all inside `goal-runs/` artifacts, none in `src/`.

⚠ **A prior memory claim that `src/lib/inbox.test.ts` carries 9 pre-existing failures is STALE** — that file passes 54/54 today. Verify counts yourself; do not import them from any memory file.

🔴 **Lesson from that build break, which applies directly to this run:** adding a member to a union type (`OpsKind`, `Job`, `PeerKey`, `Seg`) silently breaks every `Record<Union, T>` map that does not also gain the key, and `tsc --noEmit` and `tsc -b` disagree about what they catch. `npm run build` is the only real gate. If any phase widens a union, grep for every `Record<ThatUnion` before committing.

---

## Phase 1 — The type ramp and the measure

One ramp, six roles, one line-height per role, replacing 30 measured combinations. Target values:

| role | from | to |
|---|---|---|
| body / prose | 13-14px, lh 14/20/21/22 | **16px / 1.6** |
| meta | 12.5-13px, lh 16/18/18.9/19.5/20 | **13px / 1.45** |
| label (uppercase) | 11px | **12px**, +0.08em, lh 1 |
| title | 16px | **17px / 1.35** |
| page | 20px | **22px / 1.25** |
| figure / display | 30 / 34-56px | unchanged |

Then the measure: cap prose at **70ch** on Today, Ops, Styles, Strategy, the QA inspector, and **strategy's edit textarea** (today the reader is capped and the editor runs the full 1,156px pane, which is backwards). Collapse 35 padding pairs to a 4/8/16/24 scale and 10 rendered radii to 8/12/20 plus the 40px plate.

**Honour the two waivers.** Sends KPI tile labels at 9px below 480px, and client-board chips at 10/10.5px, are Ivan's rulings. A blanket raise that trips them is a defect, not a win.

Deliver `phase1-type.md` with a computed-style table: role, surface, declared value, computed value, per viewport.

---

## Phase 2 — Retire the raw database values, and give Errors its reason back

One shared label map. Eight known leaks, found by driving the app; grep for more and fix the class, not the instances:

`Dm_sent` and `dm_sent` (thread header, context sheet) · `thread_already_answered` (Ops, appears 4× and some rows are nothing but the reason code) · `LEAD_MAGNET` · `youtube_watch` · `QA_BLOCKED` · `LINT_FAIL` · `gold_icp_v2_seatless` (score reasoning).

The same map supplies the **Errors tab's missing reason column**: 46 errored drafts render, 44 of them show a bare dash where the failure reason belongs. The verdict data exists — it drives the two chips that do appear. Render it for all 46. While you are there: errored rows currently offer **Approve** at primary weight; demote it.

Deliver `phase2-labels.md`: the map, every call site, and a before/after of the Errors tab at 1440 and 390.

---

## Phase 3 — Today becomes a briefing

Today is the first screen of Ivan's day and currently renders machine output. Measured: 84 alert nodes / 72 distinct; the `bennett-ca` scan warning ships twice byte-identical; six warnings share one identical body and never group; the CRITICAL card concatenates a WARN block inside its own string; 14 text blocks run past the comfortable measure; dismiss targets are 15×20px.

Rebuild the alert row: dedupe on identical body, group by kind with a count ("Scan integrity · 4 stores, same failure"), lead with the number as a number (not buried mid-sentence), attach the action, park the raw telemetry string behind a disclosure, replace the 🔴 emoji with a colored severity mark, and take dismiss targets to 44px.

Alert copy rule: an alert must name something actionable today. Deliver `phase3-today.md` with before/after at 1440 and 390 and the new node/distinct counts.

---

## Phase 4 — The command layer and reversibility

**Build the ⌘K palette on the machinery that already works.** The Claude pane's slash palette (`ChatPane.tsx`, `matchCommands`) already renders a real command list with the container's live models and self-explaining disabled rows. Reuse it; do not reinvent it. The palette: jump to any lane or person, run any action visible on the current selection, and **print each command's direct shortcut on its row** so the palette teaches the keys. Probe the container for capabilities at open; never ship a hardcoded model list.

Keys, all modifier-guarded (a prior reference bound bare `⌘A` to approve and `⌘R` to reject — do not copy that): `j`/`k` move · `Enter` open · `x` select · `/` focus search · `?` shortcut sheet · `Escape` close. Adopt the magnet window's printed-legend pattern app-wide; it already does this well.

**Bulk actions get their bar.** Every content row already carries a checkbox with nothing to do and no select-all. Wire `x`-select plus a bulk bar so the 46-row Errors tab and 88-row Archive are workable in one pass.

**Discard-restore.** A discarded draft is currently unrecoverable and the stale-bar bulk fires N terminal writes behind one confirm. Restore is dispatcher-invisible and needs no migration: `discarded_in_inbox` appears nowhere in the sender workflow. Guard it exactly:

```
.eq('id', id).is('sent_at', null).is('approved_at', null)
.eq('send_blocked_reason', 'discarded_in_inbox')
```

Match the **exact reason string** — never `send_blocked_at IS NOT NULL`, which also holds `send_failed_verified:*` rows (which may have actually landed) and `geo_gate_v2:*` rows (still queued). Offer restore only when the discard is the newest outbound event on the thread, because `composeReply` silently discards the AI draft after Ivan hand-types a reply, and restoring that one would send a second reply to a real person.

**Ship the latent-bug fix with it:** `discardDraft` (`src/lib/inbox.ts:697`) is the only DM mutation missing `.is('approved_at', null)`. A discard landing on an already-approved row writes the block columns while the dispatcher — which never reads them — still sends the message, and the row goes invisible in the UI. One-line guard.

Deliver `phase4-command.md`, including a written verification that restore cannot cause a send.

---

## Phase 5 — Layout fills the canvas

- **Kill the 860px list cap** (`src/exp/v2c/styles.css` ~line 35-40, `.wb.dt .wb-solo .rows > *`). The cap belongs on the prose measure, not the pane. At 2560 a wide canvas should buy a second working pane.
- **Container queries on `.ct-card`** — the single best effort-to-payoff change in the repo (~40 lines). The content table carries 736px of fixed grid tracks and the list pane hard-narrows to 400px whenever a peer docks, so titles collapse and action columns clip. The `narrow` flag never fires here because `content` is a list job. **Guard:** declare `container-type` inside `@media (min-width:1000px)` only, or `contain: layout` makes `.wb-work` the containing block for the mobile filter sheet's fixed scrim and it stops covering the tab bar.
- **The context sheet moves beside the thread** instead of covering it, using the width the wide canvas already wastes. Its content is the best information design in the app: move it, do not rewrite it.
- **DM HISTORY paginates.** One click currently inlines all 213 conversations: body text 2,499 → 59,452 chars, controls 12 → 225, unvirtualized, and the expanded state persists across reloads. Cap the window with an explicit "show more".
- **The magnet queue rail flips back.** Titles truncate at ~14 chars while metadata wraps to four lines; rows swing 60→110px. Two lines of title, one quiet meta line, fixed row height.
- **The takeover's surplus goes to the inspector.** The middle column grows to ~1,968px at 2560 while its content rides a 640px centered ribbon. The 640px LinkedIn artifact measure is correct and must not widen (widening it makes the preview lie); give the extra width to the 360px inspector, which currently wraps its prose at 331px.
- **Mobile chrome: four stacked control rows become two.** A horizontally-scrolling job row (clipped mid-word at "St…"), lane pills, search and filters currently push content ~30% down a 390px screen.
- **`popover`** replaces the hand-rolled dismiss hook on the Filters and range menus (iOS 17+, top layer and light-dismiss for free, `.wb` selectors keep matching). **Scope `tabular-nums` off prose** — it is declared once at the `.wb` root and inherits into DM bubbles and post previews, padding digits inside running text.

Deliver `phase5-layout.md` with 2560 / 1440 / 1024 / 390 before-and-after pairs per surface.

---

## Phase 6 — Verification sweep and report

Gates, all of them, on the full surface inventory from Phase 0:

1. **`npm run build`** is the real gate. `tsc --noEmit` and `tsc -b` disagree; the build catches what `--noEmit` misses.
2. **`npm test`** — pass count at least the Phase 0 baseline; the pre-existing `inbox.test.ts` failures must not grow.
3. **Authed screenshot sweep** across every surface × 4 viewports × both themes: 0 console errors, 0 real layout overflow. Remember that children of an `overflow-x:auto` scroller are not overflow — check the parent or you report ~20 phantoms.
4. **Computed-style table** proving every type and measure change landed (the Flattener risk).
5. **`#exp/stock` unchanged** — before/after screenshots, identical.
6. **Write-interceptor count** — attempted writes during verification, expected 0.
7. **Completeness critic** — what did this run not verify?

Then `REPORT.md`: what shipped, what was measured before and after, what was deliberately not done and why, the merge-ready branch summary, and the watch-first list.

---

## Deliverables

All in `goal-runs/workbench-2026-plan-2026-08-21/`:

- `phase0-scope.md` … `phase5-layout.md`, one per phase, each with its instrument readings
- `REPORT.md` — the merge-ready summary
- `after/` — the authed screenshot set mirroring `baseline/shots/`
- `computed-style.md` — the anti-flattener proof table
- A branch, committed, not pushed to `main`, with a clean commit history a human can read

---

## Definition of done

### Verified-by-run (an instrument or full-population check backs each one)

- [ ] Body prose computes to 16px/1.6 and labels to 12px on **every** surface in the Phase 0 inventory, proven by computed-style reads per viewport — not by source declarations
- [ ] The two documented small-type waivers still hold at their measured sizes
- [ ] No prose block on Today / Ops / Styles / Strategy / QA inspector / strategy editor exceeds the 70ch cap
- [ ] All 8 raw database values are gone from the UI, and a grep for the class finds no survivors
- [ ] All 46 Errors rows render a reason; 0 render a bare dash
- [ ] Today's duplicate alerts are gone: distinct-node count equals rendered-node count, and the 6 identical bodies render as 1 grouped row with a count
- [ ] Every dismiss and primary target on Today and Sends is >=44px at 390px
- [ ] ⌘K opens, every palette row prints its shortcut, and `j`/`k`/`Enter`/`x`/`/`/`?` work on all three list lanes
- [ ] No bare-key action shortcut was added anywhere (the 08-09 ruling)
- [ ] Discard-restore round-trips on a real discarded row, and a written trace proves it cannot cause a send; `discardDraft` carries the `approved_at` guard
- [ ] At 2560 the DMs lane renders a second working pane; no lane leaves >40% of the plate empty
- [ ] The content table does not clip at any width with a peer docked (container queries), and the mobile filter scrim still covers the tab bar
- [ ] DM HISTORY expanded stays under 10,000 body characters
- [ ] The 640px LinkedIn artifact measure is unchanged; the inspector gained the surplus width
- [ ] `npm run build` clean; `npm test` >= baseline; 0 console errors and 0 real overflow across the full sweep
- [ ] `#exp/stock` renders identically before and after
- [ ] Attempted-write count during verification is 0
- [ ] Zero em dashes and zero forbidden-language hits in any string this run added

### Watch-first (only Ivan or a live cycle can surface these)

- [ ] 16px body in real daily use: does the reading win hold, or does the list now feel long?
- [ ] The palette on real muscle memory — is ⌘K the right key against his other tools, and does `x`-select land where he expects?
- [ ] Discard-restore's first real use on a draft he actually wants back
- [ ] The context sheet beside the thread rather than over it, on his real screen width
- [ ] DM HISTORY pagination: is the page size right for how he actually searches history?
- [ ] Whether the DRAFT-badge staleness the audit saw once (a badge 37s after its draft was approved and sent) reproduces
- [ ] The Tier 4 ground/plate question, still open and still his call alone

**The DoD is not met until every phase passes.** Shipping Tier 1 alone is not a stopping point. Nothing in this run arms anything on real traffic, and nothing gets pushed to `main`.

---

## Orchestrator rules (re-read this section if prior turns appear summarised)

- Fan execution out to cheap workers; keep judgment, arbitration and packaging in the main loop.
- Never ask mid-run. A taste-locked final pick ships as a ballot artifact.
- Re-read this MISSION.md at the start of each phase once session tokens exceed 180k, and after ANY compaction or resume, before acting.
- On finishing a phase, immediately begin the next. A human "continue" is not a gate.
- Past ~265k tokens in the main loop, delegate all remaining precision work to fresh-context subagents with written spec files; the main loop does verification and arbitration only.
- Agent death ladder, in order: WIP-commit first, then resume by `SendMessage` if the agent id lives, then spawn a continuation seeded with the checkpoint, then take the remaining phases in the main loop. Never open a fresh agent as a silent replacement — it restarts from zero and may double-apply.
- Confirm completion by polling artifacts on disk, never by an agent's self-report.
- Verification consumes the rendered artifact. Authed screenshots and computed styles, never a bundle grep.

## Model routing

| Seat | Model | Job |
|---|---|---|
| Orchestrator + judge | **Fable** | planning, phase design, judge panels, adversarial verdicts, synthesis, packaging |
| Hard execution | Opus | crux reasoning, the cascade/layout work, tournament generation |
| Standard execution | Sonnet | implementation passes, label mapping, copy fixes |
| Scouting | Haiku | surface enumeration, screenshot sweeps, dedup, formatting |

---

Start now.
