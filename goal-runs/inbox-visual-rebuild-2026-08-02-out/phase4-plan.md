# Phase 4 — Instruments then judges (orchestrator plan, written before any build landed)

Order is fixed: deterministic gates first (DQ only), judge panel second, and only survivors reach judges.
Gate results per candidate go to `phase4-instruments.md`; panel verdicts to `phase4-panel.md`.

## A · Deterministic gates (one instrument agent per candidate, in its worktree)

| gate | method | source |
|---|---|---|
| G1 tests / lint / build | `npm test`, `npm run lint`, `npm run build` in the worktree | spec |
| G2 no new dependency | `git diff exp/brain -- package.json package-lock.json` is empty | D3 |
| G3 `:root` untouched | `git diff exp/brain -- src/styles.css` shows no change to lines 1-16 | D1 |
| G4 no webfont / serif | grep diff for `@font-face`, `ui-serif`, `serif` in font stacks, external font URLs | D3/D4/D5 |
| G5 no fabricated data | read the FULL diff: any new literal array feeding a chart/series/figure; every new denominator traced to a count probe or full fetch | D2 |
| G6 secret sweep | build then grep `dist/` for `service_role`, `sk-ant`, `SUPABASE_SERVICE`, long non-anon JWTs | D8 |
| G7 console sweep | fixed-wait capture run, 6 routes × 2 viewports: errors classified; anything from `src/` fails; the unarmed `inbox-claude` CORS pair is the one allowed exception, counted precisely | D9 |
| G8 overflow @390 | same run: `document.documentElement.scrollWidth === clientWidth === 390` on every route | D10 |
| G9 contrast walk | per-leaf WCAG walk (alpha-composited), dark theme: body ≥4.5, non-text ≥3.0 | D11 |
| G10 both colour answers | toggle `data-cat` mono↔triad on a chart surface: colours change, zero layout shift, exact spine §9 hexes present | D12 |
| G11 light patches visited | `git diff exp/brain -- src/exp/v2c/styles.css` touches lines 58 and 127 (or the candidate's stylesheet overrides both selectors) | D13 |
| G12 spine censuses | runtime: type census (≤9 sizes/screen, zero fractional), weight (≤1 ≥700 and ≥28px), accent (≤30 @1440), pill licence, anchor-rail x-variance 0px, tabular-nums | spine §14 |
| G13 default-app regression | capture default app (`#inbox`, `#today`, `#sends`) base vs candidate, same session; diff for structural change — shared-screen edits were additive-only | regression skeptic |

Gate policy per spec: DQ only on true disqualifiers; **no metric-parity requirement with any floor** — gates
never punish ambition, only breakage. Cycle budget: 2 fix loops per candidate for `fail`-class items
(D9-D13); DQ-class items (D1-D8) are terminal.

## B · Skeptic passes (parallel with gates, per candidate)

- **Fabrication skeptic** (G5 owner): reads the full diff cold, hunts hard-coded series and unbacked
  denominators. Default verdict on thin evidence: REFUTED (the claim of honesty fails).
- **Capture skeptic**: re-checks every capture the builder submitted as evidence — innerText length,
  skeleton count, session expiry at capture time. A crop that cannot prove it loaded is discarded.
- **Density skeptic**: loads Content on the candidate's branch at REAL data (285/88), both viewports,
  scrolls the full lane; hunts surfaces that look good at 8 rows and collapse at 285.
- **Brand skeptic**: hunts serif faces, warm-paper tokens, a second accent outside the licensed categorical
  sets, pill-licence violations.
- **Regression skeptic** (G13 owner): the default app and the tests are the blast radius; also checks the
  candidate never edits outside its branch scope.

## C · Judge panel (after gates; only survivors)

Protocol: `~/.claude/skills/design-metrics/judge-protocol.md` — pairwise-vs-anchor only, calibration pair
first, measurements-as-text attached, native-scale banded evidence, capture-artifact exclusion, no absolute
scores.

- **Calibration pair:** GOOD = `refs/nixtio-checkbox.png` (Ivan's own pick). BAD = `baseline/` current-state
  captures (Ivan: "disgusting"). A judge that cannot rank these correctly is disqualified before touching a
  candidate.
- **Evidence per candidate:** banded native-scale captures at 1440 and 390 of all six routes, dark, mono +
  triad on one chart surface; the G12 census JSON attached as text.
- **Seats (each votes better/worse-than-anchor per axis, citing measured numbers + positions):**
  1. Reference fidelity — does it deliver the moves (M1-M9) as moves, on the overview class?
  2. Craft — alignment, rhythm, mark anatomy, header face; measured, not vibed.
  3. Dense-surface scannability — runs the three-second row-find on Content at 390 AND 1440 (blind: given a
     target row description, timed); also owns the density band numbers.
  4. Spine coherence — do the two classes read as one system? Names the shared elements visible in both.
  5. Felt difference — against the BAD anchor: is this unmistakably a different app within 3 seconds?
     Calibrated on the prior run's known-too-subtle control (a recolor that scored "different" and was not).
  6. Variety/monotony seat (protocol rule 8) — is the candidate monotonous across its six routes?
- **Output:** per-seat comparative verdicts + named grafts (what to steal from losers), a recommendation,
  **never a shipped winner** — the ballot decides.

## D · Colour fork presentation

The fork is judged only for legibility/craft (both answers must be well-executed); the CHOICE between mono
and triad belongs to Ivan on the ballot, presented as two built surfaces per finalist.
