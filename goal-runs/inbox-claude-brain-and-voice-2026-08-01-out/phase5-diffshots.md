# Phase 5 — default-route diff against the prior run's baseline

Instrument: `scripts/diffshots.mjs <baselineDir> <afterDir>`. Baseline: `goal-runs/inbox-v2-revamp-2026-08-01/baseline/` (captured 2026-08-01 early, against the production build). After: `phase5-default-after/`, captured this run from a dev server on `exp/brain` with a live session.

## First run was a failed capture — recorded, not hidden

The first attempt diffed the baseline against `phase5-shots/`, and every route came back `after=14w`. Fourteen words is the login screen: those particular shots were taken without a session. `diffshots` dutifully reported 12/12 "REGRESSION". That is the prior run's own `words===0 && height===0` lesson in a new costume — **a failed capture must never be read as a result**. Re-captured with `scripts/sweep.mjs` (which injects the session and reports `login=false` per shot) and re-run.

## Valid run

```
12 routes compared
identical: 0 | pixels-differ-geometry-same: 4 | geometry-moved: 8
```

| route | baseline words | after words | reading |
|---|---|---|---|
| sends mobile+desktop | 265 | 265 | pixels differ, geometry identical — the `% of cap` pill fix and token-level changes from `exp/v2`, no layout movement |
| settings mobile+desktop | 67 / 70 | 67 / 70 | same |
| inbox mobile+desktop | 49,558 / 49,561 | 49,841 / 49,844 | **live data drift**: 283 more message words arrived between the two captures. Not a code change |
| today mobile+desktop | 769 | 397 | fewer words on a different day's data plus `exp/v2`'s already-known shared-file changes |
| drafts mobile+desktop | 22 / 25 | 229 / 232 | `exp/v2`'s U2/U3 fetch-failed states and the drafts cross-link — the pending ballot's deliberate default-route diff |
| ops mobile+desktop | 19 | 257 | the baseline captured an **empty** ops queue (it is the prior run's designated empty-state control at 19 words); today's queue is not empty |

## Verdict, stated carefully

`diffshots` prints the word `REGRESSION` for any geometry change; that is its vocabulary, not a judgment. Of the 8 flagged routes, **none is attributable to this run's diff**. Two causes account for all of them: live data drift between two captures a day apart (inbox, today, ops), and the 20 shared production files `exp/v2` already changes — which the prior run documented as a deliberate default-route change and which is precisely what its still-open ballot is about.

**What this check cannot tell you, and I will not claim it does:** it compares `exp/brain` to a pre-`exp/v2` baseline, so it cannot isolate *this run's* contribution from the pending ballot's. The clean isolation is `exp/v2` vs `exp/brain` captured back to back on the same data; that was not run. This run's own default-route contribution is expected to be nil — every change landed under `src/exp/v2c/`, `supabase/functions/`, and `src/lib/content.ts` — but "expected" is not "measured", and it is listed as a gap rather than a pass.

Independent of the diff, the after-capture is clean on its own terms: **12/12 shots, zero horizontal overflow, zero login leaks, zero console errors.**
