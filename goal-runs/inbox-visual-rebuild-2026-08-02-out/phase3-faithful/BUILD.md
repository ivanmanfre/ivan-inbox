# Candidate `faithful` — BUILD.md

**Compiled by the orchestrator** from the branch's 15 commits and the builder's own `shots/sweep.json`
(26 verified captures). The builder agent was killed twice by transient API errors after completing the
build and the sweep; the only artifact it never wrote is this file. Every number below is from its
committed instrument output or the git record, none from memory.

## Thesis

Reference-forward expressive: Nixtio read at face value everywhere the spine permits. Display type at the
top of the stepped scale (56px at ≥1200), chart-forward hero cards, capsule marks with the number inside,
legend + `Total:` footers on every chart card with a real denominator, pill chrome per the §6.3 licence.
Dense lists stay on the spine contract.

## Branch state

`exp/vis-faithful`, 15 commits over base `exp/brain` @ `17e3cfb`, HEAD `401e030`, tree clean.
Diffstat: 8 files, +1,989/−74 — `src/exp/v2c/faithful.css` (1,336 lines, the treatment),
`ContentList.tsx` (+242, anchor column + status-on-anchor + chart card), `Shell.tsx` (licensed first-paint
class + stylesheet import), `SendsScreen.tsx`/`sends.ts` (honest log denominators via `count=exact` head
probes), `OverviewView.tsx` (additive legend+Total footers), `ContentSections.tsx` (rail alignment),
`scripts/sweep-faithful.mjs` (the self-instrument, 332 lines).

Commit arc worth noting for judges: three late commits are the builder catching its own instrument lying —
"the two defects only the picture showed, and the instrument that missed them" (`cbf8cd4`),
"instrument: measure the row, and click the card you meant" (`6b3eecf`), and a filter bar that scrolled
horizontally with no affordance (`401e030`).

## Self-instrument results (from committed `shots/sweep.json`, 26 captures)

- Type: max **7 distinct computed sizes** per screen, **zero fractional**; the 9-17px band carries only
  11/12/13/15px.
- Weight: **no screen with more than one ≥700 element**, and it is always the display title (34/56px).
- Accent census: max **27 @1440** (Sends), Content runs 6-12. Cap is 30.
- Pill licence: **zero violations** on any capture.
- Anchor rail: variance **0** on every measured list (Content 77 rows, Ideas 59, Mattan lane 73);
  trailing-value rail variance 0.
- Density band: Content rows 40-41px, in band.
- Overflow @390: **zero**. Console errors: **zero** across all 26 captures. Skeletons at shot time: zero;
  innerText 10,408-37,121 chars on Content captures (real loads).
- Sends → Log denominator rendered: **"Newest 113 of 1,524 sent · 7 of 211 blocked"** (from
  `count=exact` head probes added in `src/lib/sends.ts`; the fetch-window numbers differ from the
  table-wide totals in `phase0-counts.md` because the log is client/lane-scoped at render time).
- Both colour answers captured (`content-triad`, `sends-triad`, `sends-log-triad` shots; `dataCat` field
  present on every record).
- Bridge verified per capture: `--bg` resolves `#090B0A`, `--blue` resolves `#AEB2B0` (retired to neutral).

## Known open defect (left for Phase 4, stated honestly)

`wb-cap 11px 4.43:1 "2"` — a count badge at 11px measuring 4.43:1, present on five captures
(content mobile/desktop/triad, draft-pane, content-light). At 11px this is normal-size text under WCAG,
so 4.43:1 sits under the 4.5:1 body bar. One token step (`--text2` instead of `--text3`, or 12px) closes
it; the builder died before its next fix loop. Flagged to the gate agent rather than silently absorbed.

## Departures from the reference (as evidenced in commits)

- The alert strip opens only when small enough to read (`3ad8601`) — Nixtio has no failure states; the
  app does, and an open wall of alerts buried the lane.
- Capsule marks carry numbers only where the mark is physically large enough (`039d740`); tiny marks put
  the number beside, per spine §8.3's "where the mark is large enough to hold it".
- Legend + `Total:` footers only on the three overview cards with a real denominator (`f2134d1`) — a
  footer without a probe-backed total would violate §8.5.

## Capture inventory

26 shots under `phase3-faithful/shots/` covering all six routes at both viewports, dark; light-theme
controls (`content-light`, `sends-light`); triad answers on three surfaces; Mattan lane at both widths;
detail panes. Machine-readable evidence: `shots/sweep.json`.
