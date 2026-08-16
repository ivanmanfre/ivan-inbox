# Cold-eyes screenshot test — Workbench dashboard (localhost:5431)

Viewport 1440×900, dark theme, real data (56 inbox threads, 173 drafts, 109 published).
All routes visited (today, inbox, drafts, content, sends, ops, settings), settled, screenshotted.
Interactions exercised: hover on 4 control types, Content filter pills, "Filters" panel,
a real draft detail, "/" in the Claude composer, closing the Claude pane.

**Overall call: the owner would find plenty to screenshot — this is NOT an empty builder.**
The dashboard is dense with real numbers (Sends funnel, Ops queue, Content pipeline) and the
draft-detail QA card is genuinely impressive. But it is **not clean enough to hand over as-is**:
one screenshot (#1) shows the QA system contradicting its own verdict on-screen, which is the
kind of thing that erodes trust in the whole pipeline the moment someone actually reads it.

## Ranked findings

1. **QA verdict contradicts itself inside the same draft-detail card** — `cold-content-draft-detail-open.png`.
   Header shows a green **PASS** pill at 79/100. Body text three lines down reads
   `VERDICT: REWRITE_OK` (a different label than the pill) and further down `Fact Check: FAIL`
   with an explicit note that the draft inverted a real fact ("Anthropic deliberately turned the
   safeguards off... WRONG fact caps at rewrite_ok"). A card that failed its own fact-check is
   badged PASS in green at the top. This is the one an owner reads twice and loses trust over.

2. **Red "39" alert box reads as a live error when the copy says it isn't one** — `cold-content-1-top.png`.
   Large red numeral "39" with "4 errored · 35 elsewhere" sits directly under a sentence explaining
   these are 20 old unacknowledged ClickUp-era alerts that "no draft link exists and none is faked —
   and nothing here acknowledges them" — i.e. explicitly non-blocking, backlog noise. The red/alarm
   styling contradicts the reassuring copy right above it.

3. **POST PIPELINE bubble chart looks broken for 2 of 5 stages** — `cold-content-1-top.png`.
   GEN and APPR are both 0 and render as nothing at all (no bubble, no "0" label — just a bare
   baseline), while PUB (109) renders as an enormous teal blob dominating the whole chart. Next to
   REVIEW (19) and SCHED (2), which do get small pills, two stages simply vanish — reads like a
   half-rendered/broken chart rather than an intentional "zero state."

4. **Inconsistent hover feedback across near-identical controls** — measured via computed style,
   see `cold-hover-1-active.png` for the one that did respond. Of 4 clickable control types
   hovered on the Content page, only the "Stage: Any" filter pill visibly darkens on hover. The
   red "39" alert button, the "01 Ideas" section header (itself styled and sized like a button),
   and the Ivan/Mattan toggle chip show zero visual change before/after hover — they look inert
   even though all of them are clickable (confirmed elsewhere in the sweep).

5. **Drafts page silently teleports you to a different route** — `cold-drafts-detail-open-2.png`.
   Clicking a row under "Ops · 2 — approved in Ops, not here" on the Drafts page doesn't open a
   detail panel, it navigates away to the Ops tab entirely (sidebar selection jumps too) with no
   transition or "why did I just leave Drafts" cue. The label does say "not here," so it's
   arguably intentional, but the click affordance (row looks identical to an openable row) doesn't
   match the actual behavior (full navigation).

## Notes, not ranked (minor / working as intended)
- Content "Filters" dropdown panel renders a facet list (STRUCTURE: Any/Hot Take/Teardown/...)
  that runs right to the bottom edge of the viewport with no visible scroll affordance — plausible
  more facets are clipped below the fold (`cold-content-filters-panel-open.png`).
- The "/" composer palette (`cold-content-slash-palette.png`) and closing the Claude pane to
  reclaim width (`cold-content-after-click-1414-33.png`) both work cleanly — good screenshots in
  the positive sense, no defects found there.
- Real draft detail card (setting #1 aside) is the single best "look what this does" screenshot in
  the app — dense QA rubric, fact-check with a cited source URL, inline "Ask Claude without
  leaving it" panel. Worth leading a demo with, once #1 is fixed.

## Screenshot index
`/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-faithful-revamp-2026-08-02-out/phase6-blind/`
- cold-today-1-top.png, cold-inbox-1-top.png / cold-inbox-2-scroll.png
- cold-drafts-1-top.png, cold-drafts-before-open.png, cold-drafts-detail-open-2.png
- cold-content-1-top.png / cold-content-2-scroll.png
- cold-content-filter-pills-before.png / -after-click.png
- cold-content-filters-panel-open.png
- cold-content-draft-detail-open.png (finding #1)
- cold-content-slash-palette.png
- cold-content-before-close-claude.png / cold-content-after-click-1414-33.png (reclaimed width)
- cold-sends-1-top.png, cold-ops-1-top.png, cold-settings-1-top.png
- cold-hover-1-active.png
- cold-log.json / cold-log2.json / cold-log3.json (raw interaction data behind the findings)
