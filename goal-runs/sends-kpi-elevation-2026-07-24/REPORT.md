# Final Report — Sends KPI Elevation goal-run (2026-07-24)

**End state: born-dead as designed.** All work on `feat/sends-kpi-elevation` (+ 4 tournament branches). `main` untouched — `origin/main` = `b395ade` = the SHA recorded at run start. UI direction ends in a BALLOT (panel split, per mission rule); SQL apply + merge are operator-gated. Operator actions: see **DECISION-SUMMARY.html** (3 decisions).

## What shipped on the branch
- **SQL fix pack** `db/009-013` + regenerated `db/APPLY-kpi-views.sql` (idempotent paste block with embedded post-apply verification SELECTs). NOT applied — T2.
- **Frontend pack** (commit `7e13f81`): cohort-acceptance caption, governor v2 wiring (null-safe, enforcement-gap warning), campaign fetcher with new-view + silent legacy fallback (runs clean against BOTH DB worlds), harvest lane label, log honesty caption. 38 tests green, build + lint clean.
- **Tournament**: 3 raw directions (tourney/a command-grid, tourney/b persona-rail, tourney/c decision-first) + **tourney/s synthesis** built from the judge panel's converged recipe. 22 judge crops. `BALLOT.html` = the deliverable; S verified on Ivan/Rise/**All** × mobile/desktop, overflow-asserted, console clean, s→feat merge verified conflict-free.

## Findings (all live-gated; 4 named skeptics; 3 verdicts overturned by skeptics)
| # | Verdict | One-liner |
|---|---|---|
| F1 | CONFIRMED | Trailing acceptance inflates (ivan 7d 29.3% → cohort-true 19.5%; 4/12 cross-cohort accepts, row-exact, twice independently) |
| F2 | CONFIRMED (worse) | PostgREST 1000-row cap (proven for the app's authed role) drops 29% of sends from Campaigns; 12/27 campaigns wrong; 587-dupe burst was hard-deleted 07-22→24 |
| F3 | Researcher REFUTED by skeptic | 19/19 open-bearing slugs token-null BUT 47/149 scans are RISE-branded; truth = ivan 64 / rise 3 (neve-foods open 25s after DM) |
| F4 | Researcher REFUTED by skeptic | lane_of() mechanically correct; semantically Ivan's "Engager" = 0% own-content → new `harvest` lane |
| F6 | Operator-reported, resolved | Every logged note was API-accepted with note; no-note fallback never fired and writes no row; honest caption + n8n write-back handed off |
| F7 | 2 real bugs | Ivan governor row contaminated (98 = 41+57; sender gates on shared counter) + Rise cap shows 35 vs enforced 100; labels reconciled (cohort vs trailing) |

## Verified-by-run
- Headline numbers hand-computed **in-thread** (not subagent summaries): cohort accepts ivan 8 / rise 3; scan attribution ivan 64 / rise 3 (exact); Agency-Focused all-time 331 (exact; my first 324 was itself the 1000-row cap biting — third independent proof of F2).
- F3 null-rate stated: **100%** (0/19 open-bearing slugs tokened); 47/149 RISE-branded by `report_json->dtc->brand->wordmark`.
- r7 governor reproduction matched the live RPC exactly (cohort 139, accepted 23, 16.55%; weekly 98 = 41+57).
- Interface drift check (critic): db/012's 18 columns = `GovernorRow` field-for-field; db/010 = fetcher's ViewRow; 009/011 shapes match live views.
- Tests 38/38, build + lint clean on feat AND tourney/s. Screenshots asserted (scrollWidth===clientWidth, doc + scroller) on: S × {ivan,rise,all} × {mobile,desktop} and feat × {ivan,rise} × {mobile,desktop}. Only console noise = the expected 404 probe on the not-yet-applied view (documented pass condition; disappears post-apply).
- `main` untouched: proven by SHA comparison after `git fetch`.

## Watch-first (in DECISION-SUMMARY, with actions)
1. **Ivan's cold sends gated by shared governor counter** (live now; enforcement fix = sender_health scoping, operator's call).
2. First accepts post-apply (cohort rate must only rise). 3. Next Rise scan opens (46 branded scans pending). 4. n8n note write-back + already_invited-as-success bug. 5. 14 orphan DM sends + 17 room_census prospects invisible to all KPIs. 6. Adaptive-cap contamination once Rise cohort matures. 7. Post-apply grant check for `inbox_campaign_sends_v` (app silently falls back otherwise — tell: 7d numbers appear in Campaigns).

## Notable deviations
- **Session-limit casualty**: the synthesis builder died mid-run (post-merge-resolution, pre-commit). Finished inline: staged, committed, recaptured all crops with asserts. Also two Phase-1-era dispatch retries earlier in the build run (unrelated).
- **F6/F7 had no independent skeptic** (flagged by the completeness critic). Mitigations: F7's numbers reproduced exactly against the live RPC by researcher, re-verified by the Task-S implementer's live column checks and the Opus SQL reviewer; F6 quotes the n8n node code directly. Residual risk labeled, not hidden.
- Acceptance caption ships slightly early (describes cohort semantics; live view is trailing until SQL applies) — accepted transient, documented in taskF report.
- The 2026-07-24 mission's known-defect list assumed the 587-dupe burst still existed; live data changed under the run (rows hard-deleted) — resolved with evidence rather than assumed.

## Artifacts
`phase0-scope.md` · `phase1-accuracy.md` + `phase1/` (6 researcher + 4 skeptic files) · `phase3/` (INTERFACES + 2 task reports) · `phase-ui/` (brief, 2 judge verdicts, 22 crops) · `BALLOT.html` · `DECISION-SUMMARY.html` · this report.
Commits on feat: `89d0f13` → `7ab77f3` → `7e13f81` (src) → `59c462e` (db) → `66edd59` → crops/ballot/report commits. Tournament: `tourney/a 802be84`, `tourney/b 3caa624`, `tourney/c 139efe0`, `tourney/s 38c6fe0`.
