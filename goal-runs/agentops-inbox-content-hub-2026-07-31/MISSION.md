# agentops-inbox-content-hub-2026-07-31

Authored 2026-07-31 by the goal-run skill from Ivan's request: "move agentops from ivan dashboard into the inbox new panel (ivanmanfre.github.io/ivan-inbox) — since I'm living way more here. It could be an overall content section divided by ivan and rise, and a styles section with previews of each style and included resources like lead magnets. Audit very in depth for this."

---

## Mission

The ivan-inbox app (`~/Desktop/ivan-inbox`, deployed at https://ivanmanfre.github.io/ivan-inbox) is becoming Ivan's daily operator surface — he lives there now, not in the personal-site dashboard. This run (1) audits both surfaces in depth, then (2) brings three capabilities into the inbox app as first-class surfaces: **AgentOps** (the dashboard's `agent` section — agent chat, alerts, ops feed — merged with/alongside the inbox's existing Ops tab), a **Content section split into Ivan and Rise lanes** (posts/queue/calendar state for both brands), and a **Styles section** with live previews of every content style (8 carousel styles, 6 post image styles) and their attached resources (lead magnets). Show me your best work, not your safest. I will not answer questions mid-run — make every technical and factual call yourself and log why; carry the one taste-locked final pick (the navigation/IA winner) to a ballot, never to a mid-run question and never to an autonomous convergence.

## Locked forks (recorded, not to be re-litigated mid-run)

- **LOCK 1 — Capability-elevate, design-native.** The dashboard panels (AgentPanel, PostWorkSurface, StylesLive, LM surfaces) are the **capability floor**: every piece of data and every action they expose must be accounted for in the parity ledger. Their **visuals are anti-anchors**: the inbox app's own design language (TodayScreen, OpsScreen, TabBar, its cards/tokens/typography) is the binding canon. No dashboard CSS ports.
- **LOCK 2 — Navigation/IA goes to a ballot.** The mobile tab bar is finite; where AgentOps, Content (Ivan/Rise), and Styles live in the app's information architecture is founder taste. The run builds 2–3 structurally distinct IA candidates as real code, deploys them inert behind an `?exp=` flag, and ships a BALLOT. The shared data layer merges regardless of which candidate wins.
- **LOCK 3 — Nothing is deleted from the dashboard in this run.** Additive to ivan-inbox only. Dashboard-side retirement of the `agent` section is a named follow-up in the final report, executed only after Ivan adopts the winner (the dashboard's "nothing disappears / deeplinks never dead-end" rule applies there).
- *(Deviation note: these locks were set by the authoring session with logged rationale because the session was non-interactive; Ivan may edit them in this file before launching.)*

## Hard guardrails + mutation tier

- No new spending. Invent nothing — research and cite every claim to a file/line, table, or live query.
- Mission prose is never a data source — resolve every id/table/slug/status value from the live repo and DB before any bulk operation or UI wiring.
- Voice/brand canon: the inbox app's existing screens are the visual canon (LOCK 1). Re-read the memory index and any canon files modified since the session began before generating any user-facing copy.
- **Auth/keys:** the inbox app ships with the Supabase ANON key only. Never ship a service-role key, edit token, or any new secret to the client bundle. Any data need the anon key + RLS cannot satisfy goes through an existing edge function, or a new read-only policy added by migration (T1: snapshot + one-line rollback + read-back) — and never anon-opens Rise/client rows to the public: all new reads sit behind the inbox app's existing login gate.
- **Write actions:** reuse EXISTING RPCs, edge functions, and status-flow conventions only. Never create a new write path that publishes anything externally (LinkedIn, client channels, email). Known live traps: some approve actions PUBLISH (comment-intel lane; LM watchers' `approved=publishes`); `status='scheduled'` hides posts from board This-week views; client-channel sends are disabled until Ivan's personal go. Port gates with their semantics intact — if unsure whether an action fires externally, wire it read-only and log it as deferred.
- **n8n:** read-only if touched at all. No workflow edits, no activations.
- **personal-site repo:** read-only this run except optional commit-unpushed pointer changes. NO `git push` on personal-site (it carries known unpushed commits that must not ride along).
- **PWA:** ivan-inbox is an installed PWA with a service worker (`src/sw.ts`). Audit its caching before shipping; follow the repo's existing cache-bust convention so new surfaces actually appear on Ivan's phone.
- Repo conventions: vitest tests exist for lib code (`src/lib/*.test.ts`) — new lib/data code gets tests in the same style; commit messages match the repo's existing voice.

**Mutation tier:** T2 create-new-born-dead for all new UI (candidates ship deployed but inert behind `?exp=`, invisible in the default app), T1 for any Supabase migration (snapshot + rollback + read-back), and:

`Deploy authority GRANTED (Ivan, 2026-07-31, scope: ivan-inbox repo — git push origin main only, default-visible UI unchanged until ballot winner is applied)`

## Orchestration mandate

Fan out parallel researchers; run a tournament where independent agents pitch competing IA/design directions and a judge panel scores them; adversarially verify every load-bearing claim with skeptic agents whose only job is to refute it — **skeptics default to REFUTED/FALSE on ambiguous or thin evidence**. Give skeptics named domain roles with real past-incident negatives to hunt: an **"Authed-empty skeptic"** (the authed-empty hazard: a panel that renders blank because the client key can't read the table — this run's central risk), a **"Phantom-publish skeptic"** (the fabricated-DMs incident: any wired action that could fire externally), and a **"Blank-board skeptic"** (`status='scheduled'` hiding rows; a lane that looks dead because the query is wrong, not because it's empty — starved ≠ broken). Run a completeness critic before any phase is "done". Use the Agent tool for judgment fan-out; the Workflow tool for deterministic fan-out (same probe across N tables/surfaces). Build phases follow superpowers:subagent-driven-development's implementer→reviewer→ledger discipline. These patterns are a floor, not a ceiling.

### Model routing (assign every seat)

| Seat | Model | Job |
|---|---|---|
| Orchestrator + judge | **Fable** | planning, phase design, judge panels, adversarial verdicts, synthesis, packaging |
| Hard execution | Opus | crux reasoning, tournament candidate generation, data-layer design |
| Standard execution | Sonnet | research passes, audit readers, component drafting |
| Scouting | Haiku | file listing, link-gathering, dedup, formatting, availability checks |

## Phases

Each phase writes its artifact(s) into `goal-runs/agentops-inbox-content-hub-2026-07-31/` inside the ivan-inbox repo. On finishing a phase, immediately begin the next. After ANY compaction or resume, re-read this file + the latest phase artifacts before acting.

**Phase 0 — Scope, central risk, surface inventory.** Central risk: **the anon-key/RLS gap** — the dashboard reads tables the inbox client may not be able to see, so a naive port ships blank ("authed-empty") panels. Neutralize it with a live per-table access probe (Phase 1e) before any UI is built. Surface inventory (grep the code and query the APIs — never recall from memory): every dashboard surface involved (`components/dashboard-v2/DemoShell.tsx` NAV — `agent`, `styles`, `posts`, `calendar`, `lmstudio`, `prompts`; `components/dashboard/AgentPanel.tsx`, `AgentReadyPanel.tsx`, `AgentLogFeed.tsx`, `sections/StylesLive.tsx`, `sections/rebuilt/AgentRebuilt.tsx`; `hooks/useAgentData` and every table/RPC it touches), every inbox surface (`src/App.tsx` tabs, `src/components/TabBar.tsx`, `src/screens/*`, `src/hooks/*`, `src/lib/*`, `src/lib/route.ts`, `src/sw.ts`, push in `src/lib/push.ts`), the deploy path (`.github/workflows/deploy.yml`), and the resources/lead-magnet surfaces (LM data tables, resources.ivanmanfredi.com pages) that a Styles section would preview. Artifact: `PHASE0-INVENTORY.md` with per-surface verification requirements.

**Phase 1 — Deep audit (the explicit "audit very in depth" ask).** Parallel readers, one artifact each, synthesized into `AUDIT.md`:
- (a) **AgentOps capability map** — every stat, feed, alert type, chat capability, and action in the dashboard's agent section; which tables/RPCs/edge functions back each; which actions mutate vs read.
- (b) **Content surfaces map** — how Ivan posts and Rise posts are stored, their status vocabularies and lifecycle (including the `scheduled`-hides trap and which statuses mean "needs Ivan"), what the boards/calendar read, what the inbox's existing Drafts/Ops/Today screens already cover, and where the Ivan/Rise split lives in the data (client_id scoping — every query scoped in SQL, tenancy rules apply).
- (c) **Styles + resources map** — the 8 carousel styles + 6 post image styles: where each is defined, where a real preview asset can be sourced (live rows, storage, StylesLive's approach), and how lead magnets/resources attach to styles or stand alone; note the Studio-leaks-client-LMs hazard and keep lanes labeled.
- (d) **Inbox app architecture** — design tokens/idioms, routing, hook patterns, test conventions, PWA/service-worker behavior, login gate, how the existing Ops tab and its approval cards are wired.
- (e) **Access matrix (instrument, not opinion)** — for EVERY table/RPC identified in (a)–(c): probe with the inbox app's actual anon key + authed session and record read/write reality in `ACCESS-MATRIX.md`. Every gap gets a named resolution (existing edge function, T1 migration, or defer-with-reason).
Adversarial pass: the three named skeptics attack the audit's load-bearing claims before Phase 2 may start.

**Phase 2 — IA + design tournament.** 2–3 candidates for how AgentOps + Content(Ivan/Rise) + Styles fit the app — structurally distinct skeletons (vary composition, not copy): e.g. Content as a first-class tab with Ivan/Rise segmented lanes absorbing Styles; a single hub screen; Ops absorbing AgentOps with Content separate. Each candidate implemented as real code (worktrees), screenshotted at mobile viewport via playwright-driver against real data, judged by a calibrated panel (existing TodayScreen/OpsScreen screenshots as known-good controls; a bare-wireframe render as known-bad). Judges score capability coverage, one-thumb ergonomics, and native-ness to the app's language. Artifacts: `phase2-tournament/` with per-candidate crops + judge scores. A gate contradicting itself on identical input = ceiling signal; route the residual to the ballot.

**Phase 3 — Build-out.** Shared data layer first (hooks + lib with vitest tests, per repo convention), then all surviving candidates wired to it behind `?exp=<candidate>`, born-dead: default UI byte-identical for a user who never passes the flag. Deploy via git push origin main. Verify on the LIVE deployed URL (not localhost): each candidate renders real data with the production anon key; md5/served-bytes check that the deploy actually landed (a wrong path can still 200).

**Phase 4 — Verification (full population, instruments over judgment).**
- `PARITY-LEDGER.md`: every dashboard AgentOps capability → its inbox equivalent, or an explicit deferred-with-reason line. No sampling — the full capability list from Phase 1a.
- Every style (all 8 + all 6) renders a real preview in the deployed Styles surface; every lead magnet resource resolves (no dead links) — full population.
- Content section: both lanes show live queues; a known `scheduled` row is verifiably present; zero Rise rows visible without login (probe logged-out).
- Write-path audit: grep the added-lines diff for any new external-publish path — must be zero; every wired action traced to a pre-existing RPC/function.
- `npm run build` + full test suite green; service worker serves the new bundle after one refresh cycle.

**Phase 5 — Ballot + report.** `BALLOT.html`: every finalist rendered as real screenshots from the deployed app (the surface it ships on — Ivan can also open the live `?exp=` URLs on his phone), side by side, judged in under 2 minutes, with the one-line apply step per candidate pre-authored. `REPORT.md`: what shipped, deviations, the dashboard-retirement follow-up plan, and the watch-first list. The staged ballot is the legitimate end-state — do not auto-apply a winner.

## Deliverables

All in `goal-runs/agentops-inbox-content-hub-2026-07-31/`: `PHASE0-INVENTORY.md`, `AUDIT.md` (+ per-reader artifacts), `ACCESS-MATRIX.md`, `phase2-tournament/` (crops + scores), `PARITY-LEDGER.md`, `BALLOT.html`, `REPORT.md`. Code: shared data layer merged to main; candidates live-but-inert behind `?exp=`; any migrations with snapshots + rollback lines.

REUSE pointer: prior run `goal-runs/sends-kpi-elevation-2026-07-24/` in this repo shows the house style for run artifacts. Grounding facts (verify, don't trust — memory may be stale): Supabase project `bjbvqvzbzczjbatgmccb`; dashboard repo `~/Desktop/personal-site` (deploys via git push — but NOT this run, see guardrails); inbox deploys via GitHub Actions on push to main with `VITE_SUPABASE_*` secrets.

## Definition of done

**Verified-by-run** (each backed by an instrument or full-population check, never a sub-agent's summary):
- [ ] ACCESS-MATRIX probed live for every table/RPC the new surfaces read — zero "assumed readable" rows.
- [ ] All finalist candidates render real data on the LIVE GitHub Pages URL behind `?exp=`; default UI verified byte-identical without the flag.
- [ ] PARITY-LEDGER covers 100% of dashboard AgentOps capabilities (mapped or deferred-with-reason).
- [ ] All 14 styles show real previews; all attached resources resolve — full population, on the deployed surface.
- [ ] Logged-out probe shows zero Rise/client data.
- [ ] Added-lines diff contains zero new external-publish paths.
- [ ] Build + tests green; deploy hash of served bytes matches the built bundle.
- [ ] BALLOT.html exists, self-contained, screenshots from the deployed app.

**Watch-first** (hand to Ivan in REPORT.md):
- First real day of living in the winning candidate on the phone — does anything he does daily in the dashboard still force him back there? (log it → dashboard-retirement follow-up scope)
- Installed-PWA update behavior on HIS device: does the new bundle arrive without a manual reinstall?
- Push-notification interplay with the new surfaces (deep links landing on the right tab).
- Any approve-style action's first real use — confirm it did exactly what the gate semantics promised, nothing external.

## Never-ask rule

Never ask mid-run. Make every technical and factual call yourself and log it. The single taste-locked pick (IA winner) ends at BALLOT.html — never a mid-run question, never an autonomous convergence. Start now.
