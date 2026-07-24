# Goal-run: Sends KPI dashboard — accuracy + UI elevation pass

Grounding briefing (verify, don't trust — re-read live before acting; some of this may be stale by run time):
- **Repo:** `/Users/ivanmanfredi/Desktop/ivan-inbox`. It is a static React+TS+Vite PWA that **auto-deploys to GitHub Pages on any push to `main`** (`.github/workflows/deploy.yml`). Current `main` already has the shipped dashboard (merge `b395ade`).
- **Supabase project** `bjbvqvzbzczjbatgmccb`. The service-role key is a SECRET — GitHub push protection + secret scanning are ON for this repo. NEVER write the literal key into any committed file (a doc with it in it blocked a push this week). Read it at runtime from the n8n Connection-Sender node or env; use `<SUPABASE_SERVICE_KEY>` as a placeholder in any artifact. Read-only PostgREST GETs + the `outreach_sender_health` / `inbox_governor` RPCs only.
- **Live SQL objects** (already applied): `inbox_sends_v`, `inbox_sends_daily_v` (90d), `inbox_accept_v`, `inbox_pipeline_v`, `inbox_scan_opens_v`, `inbox_governor()`. Confirmed schema facts + the source→lane map are in `db/NOTES-kpi-verification.md` — READ IT FIRST (no `source`/`client_id` cols on prospects; lane = campaign name; score = `icp_score`; `scans.prospect_token` is TEXT vs `outreach_prospects.id` UUID; integration_config is key/value).
- **Key files:** `src/screens/kpi/OverviewView.tsx` (the 5 blocks, ~340 lines), `src/screens/SendsScreen.tsx`, `src/lib/kpis.ts`, `src/lib/sends.ts` (`fetchCampaignSends`), `src/App.tsx` (`.dt-full` desktop full-width), `src/styles.css`, `db/005`–`db/008`.
- **Screenshot tooling:** `node scripts/dev-login.mjs` mints `.session.json`; `node scripts/shot-overview.mjs` starts nothing (you run `npm run dev` first, then it captures Ivan/Rise at mobile+desktop to the scratchpad). Injects into localStorage key `sb-bjbvqvzbzczjbatgmccb-auth-token` (default storageKey — do not change it).
- **REUSE pointer** (do not re-derive): the spec `docs/superpowers/specs/2026-07-24-sends-kpi-dashboard-design.md`, the plan `docs/superpowers/plans/2026-07-24-sends-kpi-dashboard.md`, and the live-schema findings `db/NOTES-kpi-verification.md`.
- **Known target defects to investigate (from the fable review + operator flags), not an exhaustive list:**
  1. Acceptance rate can read >100% during cohort lag (a note sent in a prior window accepted in-window). Currently only captioned.
  2. Campaigns "sends" is a recent 4000-row window, not all-time; a phantom-duplicate burst skews it.
  3. Scan opens attribute almost entirely to `ivan` because outreach `scans` rarely carry a `prospect_token` — confirm this is the true data distribution vs a join gap (Rise engager attribution).
  4. Lane bucketing of the 4 "Warm"-named engagement/profile-view campaigns (bucketed Engager) — confirm against how the operator thinks (engager = engagers of that account's own content).
  5. Governor panel uses only the left half on a single-person desktop view; the empty right half + overall desktop density is the main UI-elevation surface.
- **Operator context (do not treat as a defect):** Ivan intentionally raised his weekly connection cap yesterday off strong recent acceptance — the governor showing `used > cap` (e.g. 98/50) is CORRECT live state, not a bug. Any "over cap" finding must be framed as informational, never auto-"fixed" by re-clamping the real number.

---

## Mission
Make the just-shipped Sends KPI dashboard measurably more accurate and more useful, and elevate its visual/experience layer to best-in-class within Ivan's brand — without breaking the working views or the live data. Show me your best work, not your safest. **Never-ask contract:** I will not answer questions mid-run. Make every technical and factual call yourself and log why. The one carve-out is the final UI direction: it is taste-locked, so it ends in a rendered BALLOT, never a mid-run question and never an autonomous convergence. Every accuracy claim is decidable — gate it against the live DB, do not ballot it.

## Hard guardrails + mutation tier
- **No new spending.** Invent nothing — every claim about the data or the schema is cited to a live PostgREST/RPC read or a file:line. Mission prose is not a data source: resolve every field name, view name, and count from the live DB / the real files before changing anything (the shipped dashboard already caught 5 schema assumptions that were wrong).
- **Brand/voice canon is authoritative** for any copy or visual: re-read the memory index and `brand-visual-system.md` / brand-kit before the UI phase. This is an **improve run**: the current dashboard is the craft FLOOR, not an anti-anchor — the UI tournament explores hierarchy/density/composition *within* the existing dark-native design system (`--bg/--surface/--accent`, `.sc*` tokens), never a from-scratch reskin.
- **Mutation tier: T2 — create-new-born-dead.** All code + SQL changes land on a NEW branch off `main` (`feat/sends-kpi-elevation`). **Do NOT push `main`. Do NOT merge.** Pushing/merging deploys live and is the operator's call. SQL changes ship as new `db/*.sql` files + a consolidated paste block (idempotent `create or replace`) — you cannot apply DDL (no exec_sql RPC), so leave application to the operator. The run ends born-dead: a branch + a ballot + the exact merge/apply commands handed to Ivan. Nothing deploys unsupervised.

## Orchestration mandate
Fan out parallel researchers for the accuracy audit (one per suspect area, reading live data + code). Run the UI decision as a **tournament**: N agents each implement one distinct composition in its own git worktree, capture viewport crops (mobile + desktop, Ivan + Rise) to `phase-ui/judge-crops/`, and a Fable judge panel scores them before a BALLOT. Adversarially verify every load-bearing accuracy claim with a skeptic whose only job is to refute it — **skeptics default to REFUTED on thin/ambiguous evidence**; give them named roles ("Cohort-lag skeptic", "Join-gap skeptic: is the ivan-skew a real distribution or a broken join", "Phantom-burst skeptic"). Prefer deterministic instruments over LLM judgment: grep the diff, re-run the view's equivalent SELECT and compare counts, `scrollWidth===clientWidth` for overflow, screenshot the RENDERED pixels not the JSX. Run a completeness critic before any phase is done. Implementation phases follow superpowers:subagent-driven-development (implementer→reviewer→ledger). These patterns are a floor.

## Model routing (REQUIRED — all four seats)
| Seat | Model | Job |
|---|---|---|
| Orchestrator + judge | **Fable** | phase design, judge panels, adversarial verdicts, synthesis, packaging, crux reasoning in-thread |
| Hard execution | Opus | UI composition generation, tricky root-cause reasoning |
| Standard execution | Sonnet | accuracy research passes, implementation from a task brief, drafting |
| Scouting | Haiku | live-count pulls, dedup, screenshot capture, formatting |

## Phases (each writes an artifact into this folder)
- **Phase 0 — scope + surface inventory.** Central risk: silently degrading a working, live-data dashboard or the applied SQL views. Neutralize: branch off main, full-population re-verify every changed number against a raw SELECT, born-dead (no merge/push-main). Surface inventory: grep for EVERY place each metric is computed and rendered — every block in `OverviewView.tsx`, the `client==='all'` aggregation paths, `SendsScreen` timeframe wiring, `App.tsx` `.dt-full` desktop branch, and each `db/005-008` view — and require per-surface verification. Write `phase0-scope.md`.
- **Phase 1 — accuracy audit + adversarial verification.** For each of the 5 known targets + anything the researchers surface: reproduce against live data, root-cause, decide the correct behavior, and have a named skeptic try to refute the fix. Decidable ⇒ gated, not balloted. Deliverable `phase1-accuracy.md` with per-finding: live evidence, verdict, and the exact code/SQL change. Special care on #3: prove the ivan-skew by querying the real `scans.prospect_token` null-rate per company_slug that has opens — do not assume.
- **Phase 2 — UI elevation tournament.** 3-4 structurally distinct compositions of the Overview (vary layout skeleton, not just copy): e.g. governor Ivan+Rise side-by-side using the empty desktop half, a denser command-grid, a narrative pipeline-first arrangement. Each in a worktree; crops to `phase-ui/judge-crops/`; Fable panel scores against the current dashboard as floor; narrow to 2-3 finalists; write `BALLOT.html` (every finalist rendered on mobile+desktop, Ivan+Rise, openable in <2 min). Winner is NOT auto-merged.
- **Phase 3 — implement.** On `feat/sends-kpi-elevation`: apply the Phase-1 accuracy fixes (code + any new `db/*.sql`), and build the tournament-winning UI **only if a single direction dominated the panel**; if the panel split, implement the top-2 as a runtime toggle or leave the ballot as the deliverable and STOP (a staged ballot is a legitimate end-state). TDD where logic changes (`kpis.test.ts`), `npm run build` + `npm run lint` green, unit tests green. Commit per task. Frequent commits; never the literal service key.
- **Phase 4 — verify + package.** Full-population re-checks (re-run each changed view's equivalent SELECT and diff the counts; re-screenshot Ivan/Rise mobile+desktop, console must be clean). Completeness critic: what metric, surface, or claim is unverified. Write `DECISION-SUMMARY.html`, `open` it, and a final report naming: (a) the branch, (b) the exact `git checkout main && git merge feat/sends-kpi-elevation && git push origin main` merge+deploy command, (c) the consolidated SQL paste block to apply first (if any), (d) the **watch-first** list (defects only a live cycle surfaces: the first real accept after the cohort-lag change, the engager attribution once a tokened Rise scan lands).

## Deliverables (all in `goal-runs/sends-kpi-elevation-2026-07-24/`)
`phase0-scope.md`, `phase1-accuracy.md`, `phase-ui/judge-crops/*`, `BALLOT.html`, `DECISION-SUMMARY.html`, a final `REPORT.md`, plus the code/SQL changes committed on `feat/sends-kpi-elevation` (branch, not merged).

## Definition of done — two columns
**Verified-by-run (instrument/full-population proven):**
- Every accuracy fix: the changed view/function re-queried live and the corrected number matches a hand-computed raw SELECT (not a subagent summary).
- Finding #3 resolved with the actual `scans.prospect_token` null-rate number, stated.
- `npm run build` + `npm run lint` clean; `kpis.test.ts` green; new/changed pure logic has a test.
- Re-screenshotted Overview (Ivan + Rise, mobile + desktop) renders live data, console clean, no overflow (`scrollWidth===clientWidth`).
- Branch exists, `main` is UNTOUCHED (no merge, no push to main) — prove with `git log origin/main` unchanged.
**Watch-first (hand to operator):**
- The UI direction pick (ballot) — Ivan chooses; the run does not converge.
- First live accept after any cohort-lag change; first Rise scan that carries a prospect_token (engager attribution).
- The `main` merge + the SQL apply — operator-gated deploy.

## Never-ask rule
Never ask mid-run. Taste-locked UI pick ⇒ ballot. Decidable accuracy ⇒ gate against live data. Start now.
