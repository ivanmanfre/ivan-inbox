# MISSION — make the workbench feel designed, not internal

Authored 2026-08-22 after Ivan used the shipped 2026 pass and said: *"this still looks like a 2013 design"*, *"the calendar pills look like ugly 3d"*, *"there is a green background that is taking some space from us"*, *"this section looks like an internal tool ui not polished at all"*, and *"I also asked you to propose truly good UI-UX improvements that would improve my experience and work effectivity"*.

---

## Mission

The previous run fixed the bones: type ramp, labels, command layer, layout mechanics, and it fixed them well. It was fenced off from the look by an explicit guardrail, so it raised the readability of a surface that still looks like an admin panel. **This run does the part that was fenced off.** Make every surface read as a designed product, propose and build the workflow improvements Ivan asked for and did not get, and add the AI capabilities that make the inbox worth sitting in.

Show me your best work, not your safest. I will not answer questions mid-run: make every technical and factual call yourself and log why. Where a call is irreducibly Ivan's taste, ship a ballot artifact rendered on his real screens with his real data, never a mid-run question and never an autonomous convergence.

**The brief, in his words, is the acceptance test.** At the end, a stranger looking at the draft window, the calendar and the DMs lane should not be able to tell it was built by an operator for himself.

---

## The named defects (his screenshots, not inferred)

**The draft window** (`#exp/v2/content` → open a draft, 1440x900):

1. `urn:li:activity:7496174424996585473` is printed at the user under "SPUN FROM POST". A raw platform id is not a fact a human reads.
2. A section header reads **"BACKEND DEPTH"**. The app is naming its own internals at the operator.
3. Five buttons (Edit / Schedule / Regenerate / Add image / Delete) render as identical grey rectangles in a row, floating in a large empty field, with no hierarchy between "Edit" and "Delete". Delete is red, which is the only signal present.
4. **"Post note"** is a full-width lime slab, the loudest element on the screen, for one of its least important actions. The accent is being spent on the wrong thing.
5. Inspector rows are ALL-CAPS label plus value inside bordered boxes, stacked. That is a database inspector, not an information design.
6. The middle column runs ~1250px while the LinkedIn artifact sits at 640px centered, leaving a large dead field below the buttons.

**The calendar** (`#exp/v2/content` → Calendar):

7. Chips read as raised objects. Measured: `background #1F1F1F` on a parent that is also `#1F1F1F`, 12px radius, 3px left rail, no shadow. So the "3D" is not a shadow, it is that a chip is a **same-colour block with a coloured left bar** and nothing else — it reads as a bevelled button because it has no other relationship to its cell. This needs a real solution, not a shadow removal.
8. A chip occupies **70% of its cell height** (87px of 124px), so a day with two posts cannot show both.
9. The tooltip ("Posted 15:01 (was set for 15:00)…") renders pinned to the top-left of the viewport, overlapping the client tabs, instead of anchored to the cell it describes.
10. The pistachio frame costs **20px on every side plus a 40px corner radius**. Ivan reads it as the app giving away space. On the calendar, where cells are already tight, it is the most visible.

---

## Hard guardrails

- **No new spending.** No paid API calls, no image generation, no regen fired against production, no new runtime dependencies. The app has exactly 3 and keeps exactly 3.
- **Invent nothing.** Every claim in your report is an instrument reading or a file:line. Resolve every selector, token, id and count from live code or a live read.
- **NO PROSPECT-FACING COPY CHANGES.** UI chrome only. `message_text`, connect notes, DM templates, n8n strings and `content_prompts` rows are untouchable and need a written proposal plus Ivan's OK.
- **NO n8n CHANGES. NO DATABASE MIGRATIONS** unless a phase's deliverable is a migration *file* that ships unapplied for Ivan to run. The dispatcher `kFYlfnWd98YaiErH` is not edited or depended on.
- **`#exp/stock` stays pixel-identical.** It is the escape hatch. Prove it with the same-window method in `workbench-2026-plan-2026-08-21/tools/sweep.sh` step 9: capture both builds inside one window with a same-build drift control. A stale baseline reports the clock as a difference.
- **Re-read canon before writing any user-visible string.** `content_prompts` slugs `forbidden-language` and `author-voice`. Zero em dashes.
- **Do not regress the 2026 pass.** 16px/1.6 body, the label map, the grouped Today briefing, the command layer, discard-restore and the container-query fix all stay. `goal-runs/workbench-2026-plan-2026-08-21/REPORT.md` is the record of what they are and why.

### Mutation tier: **T1 — mutate-with-rollback. Deploy authority IS granted, once, at the end.**

`Deploy authority GRANTED (Ivan, 2026-08-22, scope: this repo's app code only, after the ballot is answered or for the non-taste work if he does not answer)`. Work on a branch. Live Supabase rows and n8n: read-only. Every click-through verification runs behind the write interceptor (`tools/measure.mjs` carries it); opening a thread stamps `read_at`.

---

## Locked forks (resolved; do not reopen)

1. **ELEVATE, not replace.** The identity stays: dark plate, pistachio ground, lime accent, the rail, the lane structure. Ivan said *"it doesn't need to change a lot"* in the same breath as *"2013"*, which is a craft complaint, not an identity complaint. Prior artifacts are the **floor**, never an anti-anchor. What changes is execution quality: elevation, hierarchy, spacing rhythm, control design, information design, motion.
2. **Frame geometry is on the table; the ground colour is not.** `--plate-gap` and `--plate-r` may change, including to zero, and one ballot arm must test a tighter frame. `--ground: #C5E1A5` itself only moves if the ballot says so, and the ballot must render it, never describe it.
3. **The accent is a budget, not a decoration.** Lime marks the one action that matters on a screen. "Post note" is not that action. Re-spending the accent is in scope everywhere.
4. **No bare-key action shortcuts.** The 2026-08-09 ruling stands. Navigation and selection keys only.
5. **AI features ship inert or read-only unless they are pure UI.** Anything that could send, post, or write to a prospect ships behind an explicit human action with a confirm, or does not ship.

---

## Orchestration mandate

Fan out. Parallel implementers on disjoint file sets, each committing every 15-20 minutes. **Commit after every item, not at the end** — long agent runs died four times on API errors during the last run; a committed partial pass beats an uncommitted complete one. Capture every agent id at dispatch. Cap parallel Opus builders at 4.

Adversarial verification on every load-bearing claim, skeptics **default to REFUTED** on thin evidence, with named roles and this repo's real incidents to hunt:

- **The Flattener skeptic** — `faithful.css` flattens every descendant (`.wb.wb, .wb.wb *`). A selector with fewer than three `.wb` classes silently renders at body size. Hunt with computed styles, never eyeball.
- **The Stale-Bundle skeptic** — verifying in a fresh headless browser is verifying in the one browser that never has the user's bug. This run's own predecessor spent an hour asserting a live deploy while Ivan's tab could not see it. Prove user-visible behaviour in a persistent profile.
- **The Shared-Component skeptic** — `src/styles.css` untouched is a scope proof, not a rendering proof. `InboxScreen.tsx` and `SystemAlertStrip.tsx` render in BOTH shells; a change there lands in `#exp/stock`.
- **The Surface skeptic** — "this landed on desktop and not on mobile, not in the takeover, not in the peer, not at 2560."
- **The Taste skeptic** — "this is a different arrangement of the same look." Its job is to find work that measures better and looks equally like an internal tool.

Run a completeness critic before any phase is done. Use Agent for judgment work, Workflow for deterministic fan-out. Load `surgical-edits` before editing. Any multi-task build follows `superpowers:subagent-driven-development`.

---

## Phase 0 — Ground truth and the design system that does not exist

**Central risk:** this run can produce a re-arranged version of the same aesthetic and call it elevated, because every agent judges its own output against the codebase it just read. **Neutralisation:** a calibration set. Before designing anything, capture the current state of the ten worst surfaces, and have a judge panel score them against *named external reference points for operator tools in 2026* (Linear, Height, Raycast, Superhuman, Arc's command surfaces — study what they do with elevation, density, accent budget and control design, and cite the specific move, never the vibe). Any candidate that cannot beat the current state in a blind comparison is not shipped.

Then build the **surface inventory** by searching, not memory: every lane, takeover, peer, sheet, tab and menu, with its viewport branches. Carry it as the per-phase verification matrix.

**There is no design system in this repo.** There are tokens (`--fs-*`, `--sp-*`, `--r-*`, `--surface1-3`, `--text1-4`, `--sev-*`) and 6,600 lines of CSS that mostly agree with them. Phase 1 writes the missing layer.

Deliver `phase0-ground.md`: the inventory, the ten-surface baseline with screenshots, the reference study with cited moves, and the branch name.

## Phase 1 — The system: elevation, hierarchy, control design

This is the phase that fixes "2013". The current sheet has **surfaces but no elevation model**: a chip, a card and a pane are frequently the same colour, so depth is communicated by borders, which is exactly the 2013 tell.

Design and document, then apply:

- **An elevation model.** What is recessed, what is flat, what is raised, and by what means (surface step, hairline, shadow, or nothing). A chip on a cell must have a defined relationship to that cell. Kill same-colour-on-same-colour everywhere it appears.
- **A control system.** One button component with real variants: primary (accent, one per screen), secondary, tertiary/quiet, destructive. Sizes tied to the spacing scale. The draft window's five identical grey rectangles become a hierarchy where Edit and Schedule are not the same weight as Add image.
- **The accent budget.** Lime marks the primary action of a screen and the live/now state. Nowhere else. Re-audit every current use and report the count before and after.
- **Information design for label/value pairs.** The inspector's ALL-CAPS-label-in-a-box pattern is used across QA, Source, Log, Fields, Ops and Settings. Replace it with one designed pattern that carries the same facts in less space with better scan order.
- **Motion, deliberately.** The app has almost none. Add only what earns it: state transitions, the palette opening, a row committing an action. Respect `prefers-reduced-motion`.

Every new selector takes `.wb.wb.wb`. Deliver `phase1-system.md` with the documented system, a before/after of each primitive, and computed-style proof.

## Phase 2 — The draft window

Ivan's named surface. Fix all six defects above. Specifically:

- Retire every raw internal string and internal name from the UI (`urn:li:...` becomes a link labelled by what it is; "BACKEND DEPTH" becomes what that panel actually holds). Reuse `src/lib/labels.ts`.
- Rebuild the action row with the Phase 1 hierarchy, positioned where the eye ends rather than floating mid-canvas.
- Re-spend the accent: "Post note" stops being the loudest element.
- Redesign the inspector's four tabs with the new label/value pattern.
- Close the dead field: the 640px artifact measure must NOT widen (widening makes the preview lie about LinkedIn), so the surplus goes to structure around it. The previous run gave surplus to the inspector; go further.

Deliver `phase2-draft-window.md` with before/after at 1440, 2560 and 390.

## Phase 3 — The calendar

Fix defects 7-10. The chip needs a real relationship to its cell, a smaller share of cell height so a two-post day is readable, and a stage encoding that survives at that size. Anchor the tooltip to its cell. Test the frame geometry here first, because this is where Ivan sees the cost.

Deliver `phase3-calendar.md` with before/after and a two-post-day case.

## Phase 4 — The improvements he asked for and did not get

**This is the phase Ivan is actually angry about.** He asked for UI/UX improvements that make him faster, and got readability mechanics.

Ground it in evidence, not imagination: read the last 30 days of his real usage from the live DB (read-only) and from `docs/` and the goal-run reports — what he actually does, in what order, how many clicks it takes, where he repeats himself. Then propose and BUILD the improvements that remove the most work. Candidates to evaluate, not a shipping list:

- A real triage flow: what needs him now, ranked, with the action attached, so Today is a work queue and not a status board.
- Bulk everything, everywhere the command layer already knows the selection.
- Fewer round trips: inline edit where a takeover is currently required; optimistic state with an honest failure path.
- Search that finds things across DMs, drafts and magnets at once, from anywhere, on one key.
- Undo where it is genuinely safe (never on send: the dispatcher claims on `sent_at IS NULL` without re-checking `approved_at`, which is why approve-undo is permanently dead).
- The queue as a first-class object: see the week's shape, move things, spot the gap.

Rank by (work removed) / (risk plus effort). Build the top ones. Deliver `phase4-workflow.md` with the evidence behind each choice, including the ones you rejected and why.

## Phase 5 — AI that earns its place

Ivan asked what AI could make the whole inbox better. The Claude pane exists (`ChatPane.tsx`, `useChat`, `chat/transport` → `supabase/functions/inbox-claude`) and is a general chat that knows nothing about what is on screen.

Evaluate and build the ones that survive:

- **Selection-aware assistance**: the pane knows the current lane, selection and open row, so "why did these fail" or "summarise this thread" needs no copy-paste.
- **Thread pre-read**: one line before opening — what they want, what is blocking, what was promised. Read-only, generated on demand, never auto-sent.
- **Cluster the failures**: 46 errored drafts have maybe four causes. Say which four.
- **Semantic search** over threads and drafts, if it can be done with what exists and no new spend and no new dependency; if it cannot, say so and ship the best keyword search instead.

Hard rule: **nothing here writes to a prospect.** Anything that drafts, drafts into the existing review path with its existing confirms. Deliver `phase5-ai.md` including what you rejected as not worth its complexity.

## Phase 6 — Verify, ballot, ship

1. `npm run build` is the real gate (`tsc -b`; `--noEmit` misses things). `npm test` at or above baseline: **906 passing, 1 known pre-existing failure in `calendarItems.test.ts`.**
2. Authed sweep, every surface x 390/1024/1440/2560 x both themes: 0 console errors, 0 real overflow (children of an `overflow-x:auto` scroller are not overflow).
3. Computed-style proof for every type and elevation change.
4. `#exp/stock` identical, same-window method with drift control.
5. Attempted writes during verification: **0**.
6. **A persistent-profile check that a deploy reaches an open tab** — the fix shipped in `b773ab8`, and this run must not break it.
7. Completeness critic.
8. **`BALLOT.html`**: the taste-locked calls, rendered on Ivan's real screens with his real data, side by side, judgeable in under two minutes. Frame geometry gets an arm. Anything measurable gets a gate instead of a ballot slot.

Then `REPORT.md`: what shipped, measured before and after, what was deliberately not done, the watch-first list, and the merge command.

---

## Deliverables

All in `goal-runs/workbench-polish-2026-08-22-out/`: `phase0-ground.md` … `phase5-ai.md`, `BALLOT.html`, `REPORT.md`, `after/` screenshots mirroring the baseline, `computed-style.md`, and a branch with a commit history a human can read.

---

## Definition of done

### Verified by instrument
- [ ] Zero raw internal identifiers or internal section names in any UI surface, grep-proven across the full inventory
- [ ] Every screen has exactly one accent-weighted primary action; the before/after count is reported
- [ ] No same-colour-on-same-colour surface pairs remain where an elevation relationship is intended, proven by computed style
- [ ] A calendar chip is at most 45% of its cell height and a two-post day renders both, at 1440 and 390
- [ ] The cell tooltip is anchored to its cell at every viewport, never to the viewport corner
- [ ] The 640px LinkedIn artifact measure is unchanged
- [ ] Every Phase 4 improvement shipped has a measured before/after in clicks or seconds on a real task
- [ ] No AI feature can write to a prospect; the path is traced in the report
- [ ] Build clean, tests at or above 906, 0 console errors, 0 real overflow, full sweep
- [ ] `#exp/stock` identical, same-window with drift control
- [ ] An open tab still picks up a deploy by itself
- [ ] Attempted writes: 0. Zero em dashes and zero forbidden-language hits in added copy
- [ ] A blind judge panel prefers the new state on all ten baseline surfaces, with the reference moves cited

### Watch first
- [ ] Does the draft window still read as an internal tool to Ivan?
- [ ] Do the Phase 4 improvements survive a real working day, or add a step he has to learn?
- [ ] The AI features on real questions he actually asks
- [ ] Frame geometry on his real screen, at his real window size
- [ ] Whether any 2026-pass behaviour regressed under daily use

**The DoD is not met until every phase passes.** Shipping the visual work alone is not a stopping point: Phase 4 is the one he asked for twice.

---

## Orchestrator rules

- Fan execution out; keep judgment, arbitration and packaging in the main loop.
- Never ask mid-run. Taste-locked picks go to the ballot.
- Re-read this file at the start of each phase past 180k tokens, and after ANY compaction or resume.
- On finishing a phase, begin the next. A human "continue" is not a gate.
- Past ~265k in the main loop, delegate precision work to fresh-context subagents with written specs; the main loop verifies and arbitrates.
- Agent death ladder: WIP-commit first, resume by SendMessage if the id lives, then a continuation agent seeded with the checkpoint, then take it in the main loop. Never a silent fresh replacement.
- Confirm completion by polling artifacts on disk, never by an agent's self-report.
- Verification consumes the rendered artifact: authed screenshots, computed styles, persistent profiles. Never a bundle grep.

## Model routing

| Seat | Model | Job |
|---|---|---|
| Orchestrator + judge | **Fable** | planning, phase design, judge panels, adversarial verdicts, synthesis, packaging |
| Hard execution | Opus | the design system, the draft window, tournament generation |
| Standard execution | Sonnet | implementation passes, label and copy fixes |
| Scouting | Haiku | surface enumeration, screenshot sweeps, dedup, formatting |

---

Start now.
