# Goal-run: inbox-visual-rebuild-2026-08-02

Authored 2026-08-01 23:50 by the planning session, immediately after Ivan looked at the surviving state of
`inbox-claude-brain-and-voice-2026-08-01` and said **"disgusting"**, then pasted a reference and said
**"something like this is better."**

That verdict lands on a tournament that produced two directions and kept neither: `inkline` was killed for
carrying serif display off the marketing site, and `instrument` is a cool-neutral **light** direction whose
own brief says its dark theme is "functional, legible, not the thesis" — after Ivan chose **dark**. So the
visual work is at zero, and this run restarts it against a reference Ivan picked himself.

Execute everything below the divider as the goal.

---

## Mission

Rebuild the visual system of `ivan-inbox` to the standard of the reference Ivan chose, on a dark ground,
without losing the density the app actually needs. The reference is an expressive analytics dashboard: huge
display type, chart-forward cards, categorical colour, pill chrome. The app is **half** that and half
something the reference contains none of — working lists 300 rows long. **The run's real problem is making
those two surface classes read as one designed system rather than two apps stapled together.** That is the
hard part, it is where a lazy run will fail, and it is what the ballot will be judged on.

Second, and not optional: the last run's visual phase produced two directions and shipped zero. This one
ends with **something Ivan can look at and feel**, at native scale, on both viewports, in the browser, on a
branch. Screenshots in a ballot are evidence, not the deliverable.

I will not answer questions mid-run. Make every technical and factual call yourself and log why. Carry any
taste-locked final pick to a ballot, never to a mid-run question and never to an autonomous convergence.

## The reference, and exactly what is licensed

**`https://dribbble.com/shots/25683483-Dashboard-UI` — "Dashboard UI" / "CHECK BOX" by Nixtio (nixtio.com).**
**Chosen by Ivan personally, 2026-08-01 23:47.** Record that: given the paper incident below, an agent may
over-correct and try to kill this as an unauthorised direction. It is not. It is the brief.

Fetch it live in Phase 1 (Dribbble refuses `WebFetch`; use playwright-driver or a headed browser and save
the capture). Do not work from this prose description alone: it is a summary written from one screenshot and
is explicitly not a substitute for looking.

**What the reference actually does** (from Ivan's capture, to be verified against the live shot):

- Near-black canvas, cards one step lighter, ~20px card radius, generous internal padding.
- Screen title set **enormous, uppercase, heavy, tight-tracked** ("CHECK BOX"), as the composition's anchor.
- Top nav = floating **pill chips** with icon + label; circular icon buttons; a circular left icon rail; a `+` FAB.
- Filters as a row of `label: value ⌄` pills, muted label and white value.
- Cards carry an uppercase micro-eyebrow + a `…` menu, and a **legend + right-aligned `Total:` footer**.
- Metric anatomy: a small direction triangle, a large numeral, a micro-caption under it.
- **Data visualisation is the hero.** Sparklines with no axes, a dot-matrix density grid, a beeswarm/lollipop
  chart with the value printed inside each mark, a Gantt timeline whose bars carry the entity's avatar or
  logo and a trailing number.
- Three categorical data colours (lime / orange / white) with a legend, distinct from any status meaning.

**The nine moves to extract (the move, never the skin):**

| id | move | where it applies here |
|---|---|---|
| M1 | Oversized uppercase display title as the screen anchor | every screen header |
| M2 | Data viz is the hero on overview surfaces | Today, Ops, Sends |
| M3 | Metric anatomy: direction glyph + big tabular numeral + micro-caption + eyebrow | KPI strips |
| M4 | Legend + `Total:` footer makes a card self-explaining | every chart card |
| M5 | Filters as `label: value ⌄` pills in a row | Content, Inbox, Sends |
| M6 | Entity identity **inside** the data mark, so a row is identifiable without reading text | timelines, lanes |
| M7 | Pill chrome, floating nav, circular icon rail | shell |
| M8 | Categorical colour with a legend, separate from severity | any multi-series chart |
| M9 | The number lives inside the mark | bars, pills, lanes |

**What is NOT licensed by this reference:** the lime hue as our accent (see Fork 2), the pale staging
backdrop (that is Dribbble presentation, not app chrome), fake data, and any chart whose underlying series
does not exist in our database. **A chart we cannot populate from real rows does not ship.**

## Forks resolved and recorded

1. **Ground (LOCKED by Ivan, 2026-08-01): dark.** The generated OKLCH ladder in
   `goal-runs/inbox-claude-brain-and-voice-2026-08-01-out/phase2b-design/RESEARCH-INTERNAL-TOOL.md` §4.3.1
   is the **starting point, not a cage** — it was derived for an austere Linear-grade treatment and this
   reference is warmer and more expressive. A candidate may re-derive the ladder, but must re-run
   `scratchpad/oklch.py`'s contrast harness and clear the same bars. Light demotes to a generated
   secondary theme, held to legibility only.
2. **Accent and categorical colour (OPEN — this is Phase 2's headline decision, and it goes to the ballot).**
   `CONTRACT-2B.md` locks one accent hue `#10A37F` and forbids a second. The reference gets much of its life
   from **three categorical data colours**. These cannot both hold. The severity tokens
   (`#10A37F` clear / `#FF9F0A` attention / `#FF453A` urgent) carry *meaning*, so reusing them as
   category encoding silently breaks severity. Design at least two answers, build both, ballot them.
   **Do not resolve this by quietly adding a hue and hoping.**
3. **`inkline` is dead** and warm-paper editorial is dead (see Traps). Neither returns under any argument.
4. **Scope (LOCKED): visual system + the surfaces, not the plumbing.** The behaviour work ranked 1-3 in
   `RESEARCH-INTERNAL-TOOL.md` §4.9 (persist section state, optimistic actions, per-section counts) is
   **out of scope for this run** and stays on its own track. Exception: if a candidate's design depends on
   a count that does not exist, it may compute it read-only.

## Hard guardrails + mutation tier

- **`ivan-inbox` repo: T2, create-new-born-dead.** Branch off **`exp/brain`** (which carries the Phase 1B
  content structure and this research). Route everything behind the existing `#exp/` gate. **`main` stays
  untouched** — every push to it deploys GitHub Pages instantly with no CI gate. Do not merge. Do not apply
  the prior run's pending ballot.
- **Three foreign untracked directories sit in `goal-runs/`** (`agentops-inbox-content-hub-2026-07-31`,
  `inbox-v2-revamp-2026-08-01`, and stray PNGs). **Never `git add -A`.** Stage by explicit path, always.
- **No new dependency, no webfont, no `@font-face`, no npm install.** System stack only. The reference's
  display face is a licensed font we do not have; achieve M1 with weight, scale, tracking and case.
  `ui-serif` remains **banned** here, unlike the prior contract: it was the vector for the killed direction.
- **No fabricated data.** Every chart binds to a real query. A candidate that ships a chart backed by a
  hard-coded array is disqualified, not corrected. The prior run's confirmed failure mode was a metrics file
  of 23 rows of zeros summarised as precise figures.
- **No secret in the browser.** Static public bundle. DoD greps built `dist/`.
- **Invent nothing.** Every claim cites `file:line`, a query result, or a probe. Re-resolve every id, path
  and flag from live state; this spec's prose is never a data source.
- **Never ask.** The single carve-out is the ballot.

## Re-read as canon before acting

- `memory/MEMORY.md` and `memory/inbox-claude-brain-and-voice-2026-08-01.md` (every trap in it is live here)
- `goal-runs/inbox-claude-brain-and-voice-2026-08-01-out/phase2b-design/RESEARCH-INTERNAL-TOOL.md`
  — the measured diagnosis, the reference corpus, the ladder, the contrast harness. **Do not re-derive it.**
- `.../phase2b-design/brief-instrument.md` — its *thesis* (hairlines, rationed accent, tabular numerals,
  de-bordered rows, one separation device per boundary) matches the research and its 51 crops are proven
  layout on real data. Its **ground** was wrong. Harvest it; do not restart from nothing.
- `~/.claude/memory/global/brand-visual-system.md`

## Traps that will bite this run specifically

- 🔴 **Warm-paper editorial is dead, second offence.** Paper ground, editorial/DM serif display, sage,
  italic register: retired on **every** surface, not scoped to client work. A screenshot of
  `ivanmanfredi.com` is not a licence. Never author an unasked-for direction and defend it on scope.
- 🔴 **The measured "meh" diagnosis, already established — do not re-litigate it.** 8 of 9 surface/text
  tokens are Apple iOS system colours hex-for-hex; **28 distinct font sizes** with 237/290 declarations in
  the 9-17px band and ten half-pixel steps; **218 of 231 weight declarations ≥600 with exactly one 400**;
  zero `font-variant-numeric` in `src/styles.css`; 18 radii. Fixing these is table stakes, not the mission.
- 🔴 **A failed capture reads as a design verdict.** The prior run scored a candidate 2/10 on craft from
  crops that were skeletons (expired session, "not loaded" footer). Check the footer and word count of every
  capture before it reaches a judge. Re-capture on any doubt.
- 🔴 **Sampling pixels beats looking.** In this session I described two crops as dark; sampling showed
  `#FFFFFF`. Any claim about a rendered colour is verified by reading the pixel, never by eye.
- 🔴 **`diffshots.mjs` prints "REGRESSION" for any geometry change.** That is its vocabulary, not a verdict.
- ⚠ **Subagents died to the harness watchdog 6 times** on long builds last run. Brief every builder to
  **commit early and often**; recover a stalled agent by reading its on-disk work, not by restarting it.
- ⚠ **Ballot fidelity:** judge and ballot on native-scale scrolling captures per `judge-protocol.md`, never
  one stitched full-page PNG per direction. Any post-ballot "polish" is a new artifact needing fresh approval.
- ⚠ **Tournament gating:** gate challengers only on true disqualifiers (console errors, horizontal overflow,
  contrast failure, fabricated data, new dependency, banned face). Do **not** require metric parity with the
  floor; that silently caps ambition and produces timid recolors.

## The central risk, and how this run neutralizes it

**The reference contains no dense list, and this app is mostly dense lists.** A run that faithfully applies
the reference will produce four beautiful cards on Today and a disaster on Content, where 300 rows have to
be scanned in a few minutes. The prior run already proved the app's densest surface is *prose*: eleven
consecutive rows reading `Resource "…" is published with no landing URL (updated 6d ago)`, with no anchor
column, so nothing tells the eye which row it is on without reading the row.

Three controls:

1. **Classify every surface in Phase 0** as `overview` (chart-forward, reference applies directly) or
   `working-list` (density-forward, reference applies only through the shared spine). Publish the list.
2. **Define the shared spine in Phase 2 before any builder is dispatched** — the specific elements that make
   both classes read as one system (type scale, display-title treatment, eyebrow, hairline, radius family,
   accent budget, mark anatomy). A candidate that achieves the reference on Today and abandons the spine on
   Content is disqualified.
3. **Judge the dense surfaces hardest.** Content at 1440 and 390 is the test. A panel seat exists only to
   ask whether a stranger can find a specific row in three seconds.

## Orchestration mandate

Fan out parallel researchers. Run a blind tournament of independent builders in separate worktrees, each
briefed on one thesis, and score with a calibrated judge panel. Adversarially verify every load-bearing
claim with skeptics whose only job is to refute it; **skeptics default to REFUTED on thin evidence.**

Named skeptic roles, each hunting a real incident from this corpus:

- **Fabrication skeptic** — hunt hard-coded chart data, summaries unbacked by artifacts, and the 23-rows-of-zeros pattern.
- **Capture skeptic** — hunt skeleton screenshots, expired sessions, and any crop whose word count implies a failed load.
- **Density skeptic** — hunt surfaces that look good with 8 rows and collapse at 300; run every list at real row counts.
- **Brand skeptic** — hunt any reappearance of retired identity, a second accent introduced without a ballot, and any serif face.
- **Regression skeptic** — `exp/brain` already changes shared production files; hunt what this run breaks.

Run a completeness critic before any phase is called done. Use the Agent tool for fan-out needing judgment
or per-agent artifacts; use the Workflow tool for deterministic fan-out. Any phase that is a multi-task build
follows **superpowers:subagent-driven-development** implementer→reviewer→ledger discipline. Prefer
deterministic instruments over LLM judgment wherever the property is measurable; cycle budget 2 loops per
gate, then route the residual to the ballot. **These patterns are a floor, not a ceiling.**

## Model routing (all four seats REQUIRED)

| Seat | Model | Job |
|---|---|---|
| Orchestrator + judge | **Fable** | phase design, judge panels, adversarial verdicts, synthesis, packaging |
| Hard execution | Opus | the spine design, the tournament builds, the dense-surface problem |
| Standard execution | Sonnet | reference acquisition, probe harnesses, measurement runs, drafting |
| Scouting | Haiku | path/route sweeps, capture inventory, formatting, dedup |

## Phases

**Phase 0 — ground truth and surface classification** → `phase0-surfaces.md`
Re-read canon. Inventory every screen and every dense lane at real row counts (query the real tables, report
actual counts). Classify each `overview` or `working-list`, with the reasoning. Confirm the measured
diagnosis still holds against current `exp/brain` rather than assuming it. Publish the classification table.

**Phase 1 — reference acquisition** → `phase1-references.md` + `refs/`
Fetch the Nixtio shot live and capture it. Then fetch **at least five more** best-in-class references,
chosen to cover what Nixtio does not: at least two must be **dense working lists** (Linear, Attio, Height,
Superhuman, Raycast, Vercel/Geist). Recalled-from-memory references score zero. For each: the URL, the
retrieval evidence, and the specific move extracted. Produce the moves table, superset of M1-M9.

**Phase 2 — the shared spine + the colour fork** → `phase2-spine.md`
Design the spine that unifies both surface classes: type scale, display-title treatment, eyebrow, hairline
and radius families, mark anatomy, motion contract, and the accent/categorical budget. Resolve Fork 2 into
**two competing answers**, both buildable, both destined for the ballot. Re-run the OKLCH contrast harness on
whatever ladder the spine adopts. Nothing dispatches before this file exists.

**Phase 3 — blind tournament** → `phase3-<id>/` per candidate, branches `exp/vis-<id>`
Three to four independent builders, separate worktrees, blind to each other, each with a distinct thesis
that reads the reference differently (e.g. reference-faithful expressive · spine-first restrained ·
density-first with expression reserved for overview). Every candidate ships **all** surfaces, both classes,
real data, both viewports. Commit early and often.

**Phase 4 — instruments then judges** → `phase4-instruments.md`, `phase4-panel.md`
Deterministic gates first (DQ only): zero console errors, zero horizontal overflow at 390, contrast AA on
the primary theme, no new dependency, no webfont, no banned face, no fabricated data, tests and lint green.
Then a judge panel **calibrated on controls before voting**, with seats for: reference fidelity, craft,
dense-surface scannability (the three-second row-find test), spine coherence across both classes, and felt
difference against the current shipped look.

**Phase 5 — ballot** → `BALLOT.html` + `REPORT.md`
Native-scale scrolling evidence per direction at both viewports, beside the current state. The colour fork
as its own decision. A running branch per finalist with the URL Ivan can open. **No autonomous convergence:
the panel recommends and names grafts, it never ships a winner.**

## Deliverables

- `goal-runs/inbox-visual-rebuild-2026-08-02-out/` with every phase file above
- 3-4 candidate branches `exp/vis-<id>` off `exp/brain`, each running, each openable
- `BALLOT.html`, self-contained, verified: zero broken images, zero external requests, zero console errors
- `REPORT.md`: what shipped, what the instruments found, what the data refused, what stayed open
- Memory written back to `memory/inbox-claude-brain-and-voice-2026-08-01.md` or a new topic file, indexed

## Definition of done

1. Every surface is classified and the classification is published with reasoning.
2. At least six references fetched live with retrieval evidence, at least two of them dense working lists.
3. The shared spine exists as a written contract, and every candidate is measurably built to it.
4. Three or more candidates run on their own branches, on real data, both viewports, all surfaces.
5. All deterministic gates pass or the candidate is disqualified with the artifact that disqualified it.
6. The dense-surface seat has run the three-second row-find test on Content at 390 and 1440.
7. The colour fork is presented as two built answers, not an argument.
8. `BALLOT.html` verified clean, with a live URL per finalist.
9. `main` untouched; no `git add -A`; no new dependency; no secret in `dist/`.
10. Nothing merged, nothing converged. The run ends with Ivan choosing.
