# inbox-visual-rebuild-2026-08-02 — final report

Run executed 2026-08-02 against the spec in `goal-runs/inbox-visual-rebuild-2026-08-02.md`. Base
`exp/brain` @ `17e3cfb`. `main` untouched throughout. Nothing merged, nothing converged: the run ends at
`BALLOT.html` with Ivan choosing.

## What shipped

- **Three candidate branches, all running, all gated, all on real data:**
  - `exp/vis-faithful` @ `22168ef` (15 commits) — reference-forward expressive.
  - `exp/vis-spine` @ `c16f184` (15 commits) — restraint-first precision, instrument heritage on dark.
  - `exp/vis-split` @ `9d7441e` (9 commits) — full expression on overview surfaces, monastic lists,
    the spine as the seam.
- **The shared spine** (`phase2-spine.md`): 14-section contract — 7-token type scale with a stepped 34/44/56
  display tier, the verified OKLCH dark ladder, radius family 6/10/18/24/999 with a closed 7-item pill
  licence, dense-list vocabulary (28px anchor rail, de-bordered rows, sticky counted headers, 40-60px
  density band), mark anatomy with probe-backed denominators, motion contract with one 200ms beat, and
  **both colour answers as token sets** every candidate ships behind `data-cat`.
- **Phase artifacts:** surface classification at real row counts (`phase0-surfaces.md`), diagnosis
  re-verification (`phase0-diagnosis.md`), live counts (`phase0-counts.md`), six live-fetched references
  with a 17-move table (`phase1-references.md` + `refs/`), colour harness
  (`phase2-colour-harness.py`), three independent gate reports (`phase4-instruments-*.md`), five blind
  row-find reports, the calibrated panel (`phase4-panel.md`), 94 verified captures
  (`baseline/`, `final/`, `final2/`), and `BALLOT.html`.

## What the instruments found (the run's real catches)

- **A canon bug in the prior research doc:** §4.3.1's CSS block publishes `--text4:#606562`, which is the
  pre-fix L=0.500 value failing the 3:1 bar (2.87/2.61 on surface2/3). The generator's true L=0.555 hex is
  `#6F7472`. Every candidate ships the correction; the research doc's block is wrong as written.
- **The triad's CVD collapse:** at the accent's own lightness, the two derived hues cleared every contrast
  and hue bar and then merged under protanopia and deuteranopia (dE 0.041/0.046 vs a 0.08 bar) —
  structural, since dichromacy folds the hue wheel. Fixed by lifting `--cat-3` to L 0.7624; the triad now
  separates on hue and lightness.
- **A pre-existing severity collision:** Sends Volume channel dots were painted from the raw iOS palette
  with the Emails channel wearing severity amber. Predates this run; fixed on the spine branch, worth
  porting to whichever candidate wins.
- **The blind test catches what censuses cannot:** `split` passed every rail/position census while its
  statuses rendered as identical gray chips — contract satisfied, purpose lost. Two blind judges failed it;
  the fix (a 9px severity corner dot on the anchor, `§5.5` spent only on mixed runs) then passed a fresh
  blind judge with the dot pixel-verified in three colors.
- **A self-reported fix is not a landed fix:** `spine`'s loop-2 agent reported 390 review rows at 60px;
  direct viewing showed title/chips/buttons stacking ~3 lines. The blind FAIL stands; the discrepancy is
  recorded in the panel (protocol rule 5, applied to a fixer rather than a judge).
- **Capture instrumentation matured all run:** the Today masthead paints from a fast counts fetch while
  zones still read "Loading the brief…" (word-count floors pass half-loaded shots — a literal-"Loading"
  gate is now standard); realtime data streams after skeleton-clear (a resettle check before every band);
  the list scroller is `.rows.ct-rows`, the document does not scroll it; `?cat=` toggles get stomped by a
  mount-time effect unless set after mount.

## What the data refused

- The Sends log can only honestly say "newest 113 of 1,524 sent · 7 of 211 blocked" (client-scoped,
  probe-backed) — 76% of blocked rows are invisible by construction in the base app's fetch window; every
  candidate now states the denominator instead of pretending the window is the world.
- `TodayScreen` zones 01-03 bind to the opaque `get-morning-brief` edge function; instruments styled it but
  cannot independently verify its figures from this repo.
- Ideas renders 59 of 1,716 (`status='reviewing'`); any "ideas total" must come from a probe, and now does.
- `split`'s fix surfaced 34 Resources in terminal status with no `landing_url` on the Mattan lane — the
  same defect class the baseline's red wall was shouting about, now countable in one header.

## What stayed open (routed to the ballot or the backlog)

1. **The two ballot decisions:** direction (faithful / spine / split) and colour (mono / triad). The panel
   recommends `faithful` with named grafts and does not ship.
2. `spine`'s 390 residual: actionable review-row anatomy + QA-square subtlety; loop budget spent.
3. The shared `#null` Ops context label — pre-existing on `exp/brain`, inherited by all candidates.
4. The behaviour track (persist section state, optimistic actions, per-section counts) — explicitly out of
   scope per the spec's Fork 4, still the highest-felt-value work per the research ranking.
5. Filter-grammar nuance: both `faithful` and `spine` render multi-pill filter rows on working lists where
   the spine's §11.2 wants one compact pill; `split` is the conformant one. Judged as taste residue, not a
   gate, since §11 admits both anatomies.

## Where everything is

- Ballot: `goal-runs/inbox-visual-rebuild-2026-08-02-out/BALLOT.html` (open in a browser).
- Live previews: worktrees under the session scratchpad (`wt-faithful` :5431 · `wt-spine` :5442 ·
  `wt-split` :5443), or `git switch exp/vis-<id>` in the main repo.
- Every number in this report traces to a file in this directory; nothing above is from memory.
