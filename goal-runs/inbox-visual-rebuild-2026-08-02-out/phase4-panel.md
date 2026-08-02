# Phase 4 — Judge panel (calibrated, comparative, per judge-protocol.md)

Judged artifacts (exact commits): `faithful` @ `22168ef` · `spine` @ `c16f184` · `split` @ `9d7441e`.
Evidence: `final/` + `final2/` capture sets (39 + 16 captures, all settled, 0 console errors), the three
`phase4-instruments-*.md` gate reports, and five blind row-find reports (`phase4-rowfind-*.md`).
All verdicts comparative against named anchors, never absolute scores.

## Calibration (protocol rule 2)

- **GOOD anchor:** `refs/nixtio-checkbox.png` — Ivan's own pick, 2026-08-01.
- **BAD anchor:** `baseline/content-desktop-band1.png` — the state Ivan called "disgusting": a wall of
  red full-sentence rows, severity red spent on every row, no anchor column, iOS pill idiom.
- Orchestrator-judge ranked the pair correctly and named the defect classes before viewing any candidate
  (recorded in-session). Blind row-find judges were given zero build context by construction.

## Gate summary (instruments, all three SURVIVE)

| gate | faithful | spine | split |
|---|---|---|---|
| G1-G8, G10, G11, G13 | PASS | PASS | PASS |
| G9 contrast | FAIL → fixed loop 1 (4.15→9.21:1; two marks documented at the 3:1 non-text bar) | PASS | PASS |
| G12 censuses | FAIL → fixed loop 1 (119 pill chips → 6px chip) | FAIL → fixed loop 1 (20px rail fork) | PASS (after its own build-time loops) |
| §7.9 row-find | PASS / PASS | PASS / **FAIL @390** (loop 2 spent; residual below) | FAIL → fixed → **PASS / PASS** |

Fabrication skeptics: zero hard-coded series in any diff; every rendered denominator traced to a
`count=exact` probe with file:line. Regression skeptics: default app unregressed on all three
(DOM tree compare + screenshots; shared-screen edits additive-only). Secret sweeps: only the public anon
key in any `dist/`.

## Seat verdicts

**1 · Reference fidelity (vs the Nixtio anchor).** `faithful` delivers the most moves as moves: the
capsule pipeline with numbers inside the marks (M9), hatch-pattern series separation doing MONO's work,
legend + probe-backed `Total:` footers (M4), the strongest M1 display presence, threshold bars on the
decision tiles (M14). `split` delivers the reference on its overview class with the best chrome economy of
the three: `Range: 7d ⌄` as one M5 pill where the others spend a full segmented row, and pattern-hatched
sparkline marks. `spine` takes only M1 and the eyebrow/legend anatomy by design; its charts are
deliberately Geist-grade, further from the reference than the brief's own thesis requires on Sends.
Order vs anchor: faithful > split > spine.

**2 · Craft (measured).** All three: ≤7 distinct computed sizes/screen, zero fractional, exactly one ≥700
element (the display title), zero unlicensed pills post-loops, rail variance 0, tabular numerals
throughout, zero resting shadows. Distinguishers: `spine`'s ticked section ruler + monogram anchor slot is
the most distinctive single object any candidate shipped; `split`'s shared `<Anchor>` component eliminated
7-11 empty slots per band and is the cleanest structural fix of the run; `faithful`'s late commits show
instrument-vs-picture discipline (it caught its own instrument lying twice). No ordering; three different
kinds of good.

**3 · Dense-surface scannability (blind seats, the §7.9 acceptance test).**
- `faithful` **PASS 1440 / PASS 390** (first attempt): "19 waiting on you" + NEEDS REVIEW header with
  amber dot answers before any row text; rail confirms.
- `split` **PASS 1440 / PASS 390** (after its fix loop): SKIP/APPROVE pair locates the actionable band;
  the corner dot verified by pixel crop as a real 3-colour QA signal (green PASS / gray NO QA / amber
  NEEDS_REGENERATE) at both widths; rows hold 1 title + 1 meta line at 390.
- `spine` **PASS 1440 / FAIL 390**: the second blind judge confirmed what the first found in different
  form — actionable review rows at 390 stack title / chips / button pair into ~3-line cards, outside the
  §7.8 band, and the filled-vs-hollow QA squares are too small to carry state at a glance.
  **Adjudication note (protocol rule 5):** the fix-loop agent reported these rows at 60px; the
  orchestrator viewed `final2/wt-spine/spine-content-390-mid-lane.png` directly and the judge is right,
  the measurement was wrong. A self-report of a fix is not evidence the fix landed.

**4 · Spine coherence (do two classes read as one system).** All three hold the seam: one type scale, one
ladder, one radius family, one header face, one selection vocabulary, verified by census on every route.
`split` proves the run's central bet in its strongest form: full expression on Today/Sends beside a
monastic Content, and the seam holds because the five shared elements are visible in both registers.
`spine` is the most uniform (least seam risk, least contrast). `faithful` sits between.

**5 · Felt difference (vs the BAD anchor, 3-second read).** All three are unmistakably a different
application within the first glance: the red picket fence is gone everywhere (one severity mark per run),
the display title anchors every screen, rows sit on rails. `faithful` lands the largest felt distance from
the baseline (chart-hero surfaces read as a new product); `split`'s Sends/Today do the same while its
Content reads as the baseline's disciplined opposite; `spine` reads as the same new family at lower volume.
This seat is calibrated against the prior tournament's known-too-subtle recolor control: none of the three
is a recolor; all pass the "would a stranger bin these with the baseline" test.

**6 · Variety/monotony (protocol rule 8).** `spine`'s named risk materialized partially: six routes share
one register with the display title as the only loud object, which reads as intentional austerity at 1440
and as sameness in a long session; its 390 residual amplifies this. `faithful` varies by chart anatomy per
surface without breaking the family. `split` varies by class, which is structural variety rather than
decoration. No candidate collapses into template-register.

## Recommendation (the panel recommends; it does not ship)

**Lead: `faithful`** — the only candidate that passed the acceptance test at both widths on first attempt,
the closest reading of the reference Ivan chose, and post-loop it carries zero open instrument findings.
**Runner: `split`** — now PASS/PASS, the best filter grammar and the cleanest proof that expressive and
dense can be one system; choosing it is choosing the class-contrast thesis. **`spine`** ships the run's
best single objects (ticked ruler, monogram anchor, header face) but carries an open 390 residual with its
loop budget spent; choosing it means accepting one more fix cycle before arming.

**Named grafts regardless of winner:**
- `split` → winner: the `Range: 7d ⌄` single-pill filter replacing any second segmented row (M5/M13 as
  one object), and the 3-colour QA corner dot if `faithful` wins (its amber-only dot says less).
- `spine` → winner: the ticked section ruler (the most anti-template object in the run) and the monogram
  anchor for thumb-less rows.
- `faithful` → winner if not itself: the "N waiting on you / of M loaded" hero figure + probe-backed
  `Total:` footer pattern exactly as built.

**Residuals routed to the ballot:** `spine`'s 390 review-row anatomy + QA-square subtlety; `split`'s one
capture caveat (the sole failing row sits one scroll below the 390 Mattan viewport — a data fact, not a
defect); the shared pre-existing `#null` Ops context label (on base, all candidates inherit it).

**Colour fork:** both answers verified rendering on all three candidates with exact spine §9 hexes and
zero layout shift. The choice is Ivan's on the ballot; the panel's only finding is craft parity — neither
answer is better built than the other.
