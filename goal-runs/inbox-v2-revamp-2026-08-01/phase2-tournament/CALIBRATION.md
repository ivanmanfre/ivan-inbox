# Density gate calibration — and why two of the contract's gates were withdrawn

Gate-trust rule: calibrate every detector against known-good AND known-bad controls *before* it gets a vote. I built `scripts/density.mjs`, ran it against controls, and it failed calibration. Recording that honestly rather than shipping a gate that punishes good work.

## Instrument defect found and fixed first

The first run reported `height=852` for every screen — the viewport height. This app scrolls an **inner** container (`.app` and its panes), not the document, so `documentElement.scrollHeight` is pinned to the viewport and "words per 1000px" silently degraded into "words per screen". Fixed by measuring the tallest actually-scrolling element and the content bounding bottom, whichever is larger. All numbers below are post-fix.

## Calibration results (live production app, 390px)

| surface | height px | words/1000px | prose % | max number px | visual encodings |
|---|---|---|---|---|---|
| sends (audit called it best-composed) | 1,978 | **142.5** | 20.9 | 28 | 75 |
| today | 2,841 | **277** | 74.6 | 19 | 5 |
| ops (empty queue) | 852 | 30.5 | 0 | 0 | 0 |
| inbox | **83,453** | 594.2 | 86.7 | 0 | 56 |
| **bad control** (prose strawman) | 852 | **169** | 88.9 | 0 | **0** |

## Verdict: two gates withdrawn, one kept, one added

**WITHDRAWN — `words per 1000px ≤ 140`.** It does not separate good from bad on this app. The strawman scores **169** while the app's best-composed real screen scores 142.5 and its legitimately text-heavy briefing screen scores 277. A threshold that fails Today and passes the strawman by 27 points is measuring length, not quality. Kept as a **reported comparative metric** between candidates, never as pass/fail.

**WITHDRAWN — `primary number ≥ 40px`.** It contradicts the canon the contract locks. This app's own type scale caps stat numbers at 26-38px (`src/styles.css:181,349,454,581`) with a 34px large title; the best-composed screen's biggest number is **28px**. Chasing 40px would force candidates to break the locked type scale to satisfy a gate imported from a client-report context, where 40px hero numbers belong. Replaced below.

**KEPT — `prose share`, ceiling raised to ≤ 80%.** At the contracted 30% it fails three of four real screens. At 80% the strawman (88.9%) fails and every good control passes. Note inbox lands at 86.7%, which is a *true positive*: 1,354 unvirtualized rows of message snippets. Flagged, not gated, since it is pre-existing.

**ADDED — the gate that actually separates: `any content-bearing surface must carry ≥1 visual encoding`.** Formally: `totalWords > 100 → encodings ≥ 1`. This cleanly splits every control — strawman 0 encodings **FAIL**; sends 75, inbox 56, today 5 **PASS**; empty ops exempt at 26 words. It is the honest expression of "drawn not typeset": a section may not be text alone.

**ADDED — `primary number ≥ 26px` on any surface that renders stat tiles**, matching the app's real scale instead of an imported one.

## The gates that survive, as run

1. `scrollWidth === clientWidth` at 390px — zero horizontal overflow. *(Never failed calibration; a true instrument.)*
2. Zero console errors on load.
3. `totalWords > 100 → encodings ≥ 1`.
4. `prose share ≤ 80%`.
5. Stat-tile surfaces: largest number ≥ 26px.
6. Three visibly distinct data states: loading / genuinely-empty / fetch-failed.

Reported but not gated: `words/1000px`, exact prose share, encoding count, rendered height. These go to the judge panel and the ballot as comparisons, because calibration showed they rank candidates without cleanly separating good from bad.

## Consequence for judging

Per gate-trust rule 4, the residual (is this screen *too dense*, does it *feel* like a wall) cannot be settled by instrument and is therefore routed to the judge panel and ultimately Ivan's ballot, rather than gate-chased. The instrument's job here is to catch overflow, dead states, and text-only sections; taste stays with the human.
