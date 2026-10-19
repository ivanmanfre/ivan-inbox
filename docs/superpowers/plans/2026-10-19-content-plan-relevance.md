# Content Plan and relevance repair implementation plan

> For agentic workers: use test-driven implementation and independent whole-branch review. The user approved the displayed navigation proposal with "OK FIX", then explicitly required retaining Content Brain insights.

**Goal:** One daily Plan with relevant recommendations and preserved brain insights, using one adopted posting policy.
**Architecture:** Reuse PlanV2, BrainStrip and the existing ContentBrain insight sections. Preserve Calendar, Ideas, Review and Lead magnets; redirect the old daily Brain route to Plan while preserving explicit patterns/history routes. Recommend only posts carrying positive, post-specific fit evidence; keep the complete raw source library accessible under an honest label.
**Tech stack:** Existing React/TypeScript/Vite, Vitest and Supabase RPCs.
**Spec:** The preceding review and navigation artifact, plus user correction: "dont delete content brain insights tho its relevant".

## Global constraints
- Keep current app styling and existing controls, source attribution, rule Accept/Dismiss/Undo, predictions, results, decisions and source browsing.
- No publishing, rescheduling posts, deleting sources, outreach edits, n8n work or changing canonical prompt content.
- Preserve all account boundaries, error states and unadopted SwishDM holds.
- Changes occur only in the isolated worktree based on origin/main 94b34a4e.
- Keep code changes surgical, tests first for changed behavior.

## Review focus
- An unknown, rejected, purpose-less or reason-less source cannot become a recommendation, including on a failed fit read.
- All brain insights and rule actions remain reachable after navigation consolidation.
- Old links retain lane and explicit patterns/history intent.
- Plan and direction share the current adopted weekly target, with unresolved authority visible.
- Sparse stored source metadata shows an honest gap, never an invented explanation.

## Task 1: Source relevance
**Model:** gpt-6-sol
**Ownership:** ContentBrain.tsx niche selection/rendering and related tests only.
- [x] Add failing cases for raw filler, null/low fit, none purpose, missing reason, expired picks and fit-read failure.
- [x] Keep verified picks with positive fit (existing recommendation threshold, inspect SQL), recognized purpose, reason and current window. Never infer fit from author name or lift.
- [x] Keep raw catalogue available, labelled tracked sources, with unknown fit visible as research.
- [x] Run focused tests; report RED/GREEN evidence and changed paths. Do not commit.

## Task 2: Daily Plan and retained insights
**Model:** gpt-6-sol
**Ownership:** PlanV2.tsx, SubNav.tsx, content/index.tsx, shell navigation references if needed, associated tests/CSS. Do not edit ContentBrain.tsx or PlanPanel.tsx/contentPlan.ts.
- [x] Add failing navigation and retained-insight tests.
- [x] Consolidate daily Brain into Plan; Calendar remains directly reachable. Old daily brain links redirect with lane/context, patterns route remains supported.
- [x] Show adopted DirectionView, scoped review link and plan warnings before week/list posts. Place Content Brain insights after the plan, with visible affordance and retained BrainStrip, NicheIdeas, BestPosts and RecentDecisions.
- [x] Preserve existing rule action callbacks, account switches, waiting-list open, stock popover, move day and draft open paths.
- [x] Scope the zero-review headline to planned posts. Retain broader review queue access.
- [x] Run focused tests; report RED/GREEN evidence and changed paths. Do not commit.

## Task 3: Policy consistency and source explanation
**Model:** gpt-6.1-sol (current session)
**Ownership:** contentPlan.ts, policy helper/tests, PlanPanel.tsx/tests, additive scoped SQL migration if required.
- [x] Read current adopted direction, format policy and plan configuration without displaying credentials. Resolve authority using current explicit adoption.
- [x] Test shared target and honest fallback. Ensure planning backend uses the adopted target too if it currently diverges.
- [x] Restore stored source evidence in PlanPanel when available using existing bounded source read; retain honest unknowns.
- [x] Snapshot and verify any routine config/RPC change; no post or schedule writes.

## Task 4: Release
**Model:** independent gpt-6-astra reviewer
- [x] Run relevant suite, type/build/lint and required read-only thread smoke. Compare known baseline failures.
- [x] Inspect live-data local desktop/phone UI and source drilldown, preserved insights, no unrelated app regressions.
- [x] Independent whole-branch review; address material findings with regression evidence.
- [ ] Commit only owned changes, create/link PR, pass required checks, merge and verify actual Pages deployment and DOM on desktop/phone.


## Verification and review receipts

- Source recommendation regression: RED then GREEN; no raw fallback; fit 7+, purpose, reason and current 21-day window required. Research catalogue remains accessible.
- Direction uses live Plan target: current format policy v9 (17 October) explicitly supersedes the older four-post baseline with five; no configuration change needed. Historical direction objective retained without inventing a fifth purpose allocation.
- Original stored source can be opened from PlanPanel; no selection reason is invented when absent. Read retry is covered.
- Independent release review found skin-off accessibility and failed-Plan insight coupling; both repaired. Actual skin-off screenshots at 1440 and 375 show styled Plan and no overflow or page errors. Shared CSS change preserves tab and motion guards.
- Final account-isolation review found the retained insight subtree needed its account reset boundary. Regression failed before adding the lane key and passed afterward.
- Read-only live-data verification: old Brain deep link opens Plan insights; source author/text/link works; Ivan, Rise, Arch and held SwishDM boundaries verified. SwishDM retains four held drafts and no adopted cadence.
- Required read-only DMs smoke passed at 390 and 1440, zero page errors or forbidden writes.
- Wider repository suite: 478 files passed, seven failed, one skipped; 5,666 tests passed, seven failed, six skipped. All seven failed files reproduce on clean starting commit 94b34a4e (seven failed tests, 53 passed). Failures concern unrelated editorial workflow fixtures/imports and a timestamp-offset assertion; no n8n changes made.
- Final focused suite, build and deployment receipts recorded in the PR and shared task at release.
