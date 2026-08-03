> Written before the judge agents were dispatched, so a session limit cannot cost the panel. Each judge scores ONE dimension across ALL candidates, reads the rendered crops (not the briefs' self-descriptions), and returns a ranking with evidence.

# Judge panel spec

## Calibration before any judge votes

Every judge first scores two controls and must place them correctly, or its scores are discarded:
- **Known good:** the live production Sends screen, `baseline/sends-{mobile,desktop}.png` — the aesthetics audit independently called it the best-composed surface in the app.
- **Known bad:** `baseline/ops-mobile.png` as an *empty-state* control (19 rendered words) plus the prose strawman described in `CALIBRATION.md`.

A judge that ranks the strawman above Sends, or calls the empty Ops screen well-composed for a working queue, is miscalibrated and its ballot is void.

## What judges must NOT do

- Do not re-derive the instrument numbers. Overflow, word counts, prose share, encoding counts and console errors are already measured per candidate in their `crops/<id>/sweep.json` and their brief's gate table. Treat those as given.
- Do not reward novelty for its own sake. This is an ELEVATE run: the locked canon in `CONTRACT.md` is the floor, and a candidate that invents a new aesthetic has failed craft-fidelity regardless of how it looks.
- Do not score from the brief's prose. **Open the PNGs.** A brief that claims "clear hierarchy" while the crop shows a wall of rows is the exact failure this panel exists to catch.
- Do not average away a disqualifier. Any violated load-bearing trap from `CONTRACT.md` is a loss, not a deduction.

## Three seats, one dimension each

**Seat 1 — Ergonomics (does it cost fewer taps and fewer wrong moves).** Score each candidate on the three daily jobs from `phase1-audit/usability.md`: triage the inbox, review/approve drafts, monitor sends+ops. Count taps from cold open per candidate. Judge whether pending items have one home or several (the U1 hazard: the same draft appearing in Today, Inbox and Drafts with three different action affordances). Judge whether the three data states (loading / empty / failed) are actually distinguishable in the pixels, not merely claimed. Weigh Chat and Voice reachability: is Claude one gesture away, and can the operator tell what state a voice turn is in?

**Seat 2 — Craft and native-ness (does it look like it belongs in this app).** Fidelity to the locked tokens, type scale, severity 3-tier, radii discipline, glyph icons. Whether the five must-not-lose decisions survived (honest over-cap gauge with hatched overflow; Today's numbered/ruled/counted zone header; Today↔Sends tile mirroring; terse zero-state copy voice; the single shared tap-feedback rule). Then the pixel-level question the instruments cannot answer: at 1440px does the layout look designed, or like a stretched phone? Name specific defects with the crop filename.

**Seat 3 — IA scalability (does it survive the next surface).** Each candidate accommodates 8 surfaces today. Score what happens at surface 9 and 10 — a second client's board, a reports view. Where does each nav model break, and does it break gracefully or require another restructure? Judge the desktop/mobile fork handling: `App.tsx:148-192` plus three candidate shells was the same layout logic in four files; a candidate that extracted it scores higher than one that added a fifth copy. Judge the content-grouping choice (lifecycle `groupByStage` vs triage `bucketDrafts`, `content.ts:264-277`) and whether the two coexist without confusing the operator.

## Output per judge

A ranking of the candidates on that dimension with a one-paragraph justification each, every claim citing a crop filename or a file:line. Then: the single strongest element in any candidate worth grafting onto a different winner, and the single worst defect that must be fixed whoever wins. Write to `phase2-tournament/judge-<seat>.md`; return under 300 words.

## Arbitration (orchestrator, not a judge seat)

The orchestrator reads the three rankings plus its own look at the 1440px crops, then picks a winner and names explicit grafts from the runners-up. Where the seats disagree irreconcilably, that disagreement is the ceiling signal: it goes to Ivan on the ballot rather than being averaged into a false consensus. The ballot always ships regardless of how decisive the panel is, because the final call is taste and taste is Ivan's.
