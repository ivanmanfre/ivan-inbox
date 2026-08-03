# Goal-run: inbox-v2-revamp-2026-08-01

Authored 2026-08-01 by the planning session. Execute everything below the divider as the goal.

---

## Mission

Produce the next version of ivan-inbox (`~/Desktop/ivan-inbox`, live at `ivanmanfre.github.io/ivan-inbox`): an in-depth audit and revamp of its usability and aesthetics, folding in the content section (the two finalists from the 2026-07-31 tournament are inputs, this run's ballot supersedes that one), embedding a Claude Code chat connection scoped to Ivan's instance only (modeled on `https://claude-code-railway-production.up.railway.app/` but rebuilt inside the inbox), and a measurably better voice-mode UX. Show me your best work, not your safest. I will not answer questions mid-run - make every technical and factual call yourself and log why; carry a taste-locked final pick to a ballot, never to a mid-run question and never to an autonomous convergence.

## Hard guardrails + mutation tier

- **Tier T2 create-new-born-dead.** All new/changed surfaces ship behind `#exp/` gates exactly like the 2026-07-31 tournament did (the repo deploys to GitHub Pages on push to main, so anything not behind a gate is instantly live). The default routes (`#inbox`, `#drafts`, `#ops`, `#sends`, `#today`, `#settings`) stay pixel-untouched until the ballot verdict is applied in a separate step. Verified inert = load each default route after deploy and diff against a pre-run screenshot.
- **No new spending.** Use existing infra: Supabase project `bjbvqvzbzczjbatgmccb`, the deployed Railway claude-code app, GitHub Pages. No new paid services, no new Railway services.
- **🔴 SECRET-LEAK FENCE (the single central risk, see Phase 0):** the inbox is a STATIC bundle on public GitHub Pages. The Railway app's `API_KEY` / `ANTHROPIC_API_KEY` must NEVER appear in the repo, the bundle, or any commit. The Claude connection must be brokered (Supabase edge function with authed-user check, or equivalent) so the browser never holds a long-lived secret. DoD includes a grep of the built `dist/` and full git log for key material.
- **Instance scoping:** the embedded Claude connection talks ONLY to Ivan's own workspace/instance. No workspace picker, no listing of other workspaces (old AI clients on that Railway app are out of scope and must be unreachable from the inbox UI and from the broker). Scope enforced server-side in the broker, not by hiding UI.
- **Invent nothing.** Every claim about current behavior comes from reading the code, probing the live app, or querying the DB - cite file:line or the probe. Mission prose is never a data source; re-resolve every id/route/flag from the live repo and DB before acting on it.
- **Re-read canon at start:** `memory/MEMORY.md` index plus `memory/inbox-content-hub-tournament-2026-07-31.md` (traps: `carousel_drafts.client_id` NULL for Ivan rows, two `content_prompts` style families colliding on `before-after`, post-07-19 RLS closure means anon 200-with-0-rows = RLS not empty, sendChat is RPC-only - never port the unauthenticated `webhook/n8nclaw-whatsapp` fallback, `dashboard_action` allowlist contains outreach-arming fields so wrappers hard-code fields, Playwright auth via admin `generate_link` + service key, `#exp/x` hash is read at load time only). Any canon file modified after session start gets re-read before use.
- **Never ask.** The one carve-out is the taste-locked final pick, which ends in BALLOT.html.

## Forks resolved and recorded

1. **Elevate, not new (LOCKED by Ivan, 2026-08-01):** the current inbox's modern styling and mobile friendliness are the FLOOR. The tournament explores hierarchy/density/composition within that canon. Do not strip the existing visual language.
2. **Content section ships (LOCKED by Ivan):** the content hub is in scope. The 2026-07-31 finalists at `#exp/a` (Content tab) and `#exp/b` (Studio hub) plus their shared data layer (`src/lib/{content,styles,agent}.ts`) are REUSE inputs - do not rebuild the data layer. This run's ballot replaces the old `goal-runs/agentops-inbox-content-hub-2026-07-31/BALLOT.html`; mark that one superseded in this run's report.
3. **Claude connection architecture:** the run resolves broker shape (edge function vs other) itself under the secret-leak fence, logging the decision and the rejected alternative in `phase0-scope.md`.

## Orchestration mandate

Fan out parallel researchers; run tournaments where independent agents pitch competing directions and judge panels score them; adversarially verify every load-bearing claim with skeptic agents whose only job is to refute it - skeptics default to REFUTED/FALSE on ambiguous or thin evidence. Give skeptics named domain roles with real past incidents to hunt: a **Secret-leak skeptic** (the fence above; also hunt keys in git history), a **Dead-route skeptic** (the 07-31 empty-session incident: a surface that "shipped" but no instrument ever loaded it), a **Mobile-regression skeptic** (the 2026-07-31 morning session's "too wide on desktop" styling bug - hunt its inverse on 390px), and a **Cross-tenant skeptic** (the tenancy-sweep incident: scope enforced in UI only). Run a completeness critic before any phase is "done". Use the Agent tool for fan-out needing judgment or per-agent artifacts; use the Workflow tool for deterministic fan-out (same probe across N routes/viewports). The build phase follows superpowers:subagent-driven-development's implementer→reviewer→ledger discipline. These patterns are a floor, not a ceiling.

## Model routing (all four seats REQUIRED)

| Seat | Model | Job |
|---|---|---|
| Orchestrator + judge | **Fable** | planning, phase design, judge panels, adversarial verdicts, synthesis, packaging |
| Hard execution | Opus | crux reasoning, tournament candidate builds, broker implementation |
| Standard execution | Sonnet | audit passes, research, drafting, screen-by-screen fixes |
| Scouting | Haiku | route/viewport probe sweeps, link checks, formatting, dedup |

## Phases

**Phase 0 - Scope + surface inventory** → `phase0-scope.md`
Name the central risk (the secret-leak fence) and how the run neutralizes it. Actively search - grep the code, hit the live app, query the DB, never recall from memory - for EVERY surface the revamp must land on: every screen in `src/screens/` (including `kpi/`), every `#exp/` route, every component branch that forks on viewport, the service worker (`src/sw.ts`), the login/auth path, and the Railway web-ui (`~/Desktop/claude-code-railway/web-ui/` - `server.js`, `src/`, the voice probes `v2_voice_probe.mjs` / `v2_stt_probe.mjs`) as the reference implementation for chat + voice. Inventory the Railway app's endpoints and auth model from its README/code. Per-surface verification required later - two prior runs shipped to one of two live surfaces and called it complete.

**Phase 1 - Audit** → `phase1-audit/` (one file per auditor + skeptic verdicts)
Parallel auditors over the LIVE app (authed via the `generate_link` Playwright pattern) and the code: (a) usability/task-flow per screen - the three daily jobs (triage inbox, review/approve drafts, monitor sends/ops) measured in taps and dead-ends; (b) aesthetic/craft against the existing visual canon - run `design-metrics` instruments, mobile 390px + desktop 1440px screenshot bands of every screen; (c) information architecture - what Ivan actually uses vs what exists (query real usage where possible, e.g. which RPCs fire); (d) voice-mode UX on the Railway web-ui - what works, latency, where it breaks; (e) Claude-connection reference audit - what the Railway UI does that the inbox port needs, what it must NOT port (workspace listing, other clients). Every finding gets file:line or a screenshot. Skeptics then attack the audit; findings that survive become the fix ledger.

**Phase 2 - Design tournament** → `phase2-tournament/` (crops in `judge-crops/`, specs on disk)
2-3 independent directions, each in its own git worktree, each a structurally distinct skeleton (COMPOSITION varies - layout structure, nav model, hero element - not just copy/colors), each covering: the revamped core screens, the content section (may absorb/refine finalist A or B or a synthesis), the embedded Claude chat panel (mock the broker if not yet live), and visible voice-mode affordance. Existing canon is the floor. Density gates in every build spec BEFORE spawning: ≤140 words/1000px, ≤30% prose share, primary number ≥40px per KPI panel, ≥1 visual encoding per section. Capture 390px + 1440px crops of every screen per candidate. 3-seat judge panel, calibrated on a known-good (current inbox) and known-bad (a prose-heavy strawman) control first, scoring distinct dimensions: ergonomics, craft/native-ness, IA scalability. Write finalist fix-specs to disk BEFORE dispatching fix passes. Max 2 rounds in this session; if a round gets worse, lock the best prior candidate and stop tournament iteration.

**Phase 3 - Build** → `phase3-build/LEDGER.md`
Merge-quality build of the winning direction behind `#exp/v2`: (a) revamped screens; (b) content section folded in on the existing data layer; (c) the Claude Code connection - broker deployed per the Phase 0 decision (edge function ships born-dead-testable: callable only by Ivan's authed user, verified by an anon probe returning 401/403), chat UI wired RPC/broker-only, streaming if the reference supports it, instance-scoped server-side; (d) voice mode - port the working parts of the Railway voice probes into the inbox chat with the concrete improvements the Phase 1 audit named (target: hands-free dictate→send with visible state, measured round-trip). Implementer→reviewer pairs per work packet, ledger updated per packet. All tests green (`npm test`), lint clean.

**Phase 4 - Verification** → `phase4-verify.md`
Instruments only, full population: every screen × {390px, 1440px} screenshot re-sweep on `#exp/v2`; `scrollWidth===clientWidth` on every screen at 390px; density gates re-measured; secret grep over built `dist/` AND `git log -p` for key fragments; anon + wrong-user probes against the broker (must fail closed); default routes diffed against pre-run screenshots (pixel-identical); service worker still installs; Playwright authed click-through of the three daily jobs end to end; voice round-trip measured with a real utterance fixture. Any gate contradicting itself on identical input = ceiling signal - route residual to the ballot, don't gate-chase past cycle budget (2 loops per gate).

**Phase 5 - Ballot + report** → `BALLOT.html`, `REPORT.md`
BALLOT.html: finalists rendered (live `#exp/` links + embedded crops, mobile and desktop), judged in under 2 minutes; include the winner-apply command (one-line App.tsx change + fold-in steps) but DO NOT apply it. REPORT.md: what shipped, per-surface verification table, deviations, the superseded 07-31 ballot noted, watch-first list handed to Ivan, and the exact resume/apply commands.

## Deliverables

All in `goal-runs/inbox-v2-revamp-2026-08-01/`: `phase0-scope.md`, `phase1-audit/`, `phase2-tournament/` (specs, crops, judge scores), `phase3-build/LEDGER.md`, `phase4-verify.md`, `BALLOT.html`, `REPORT.md`. Code on `#exp/v2` (+ tournament worktree branches, losers deleted after ballot). Broker code wherever the Phase 0 decision puts it, born-dead-testable.

**Grounding briefing (verify, don't trust - memory may be stale):** Supabase project `bjbvqvzbzczjbatgmccb`; inbox deploys on push to main (GitHub Pages); prior run artifacts in `goal-runs/agentops-inbox-content-hub-2026-07-31/`; content data layer already shipped in `src/lib/`; Railway reference app local source `~/Desktop/claude-code-railway/`; `#exp/` hash read at load time only - fresh page load per route; wip/mac checkpoint branches are session-start noise, not work.

## Definition of done

**Verified-by-run (instrument or full-population proof required):**
- [ ] Phase 0 surface inventory lists every screen/route/viewport-branch with a per-surface verification row filled by Phase 4
- [ ] Audit findings each carry file:line or screenshot evidence; skeptic-survived ledger exists
- [ ] Tournament: every candidate has full screen × viewport crops; judges calibrated on controls before voting
- [ ] `#exp/v2` live: every screen loads authed, zero horizontal overflow at 390px, density gates pass, tests green
- [ ] Claude connection: broker rejects anon and non-Ivan probes (probe transcript in phase4-verify.md); no secret in `dist/` or git history (grep transcript); chat round-trip proven against the live instance with a real prompt
- [ ] Voice mode: one full dictate→send round-trip proven on `#exp/v2` with measured latency
- [ ] Default routes pixel-identical to pre-run screenshots; nothing armed - winner-apply is a documented command, not an executed one
- [ ] BALLOT.html renders all finalists on both viewports; REPORT.md complete

**Watch-first (named for the operator, not claimable by the run):**
- First real week of daily use: does the revamped triage flow actually beat the old one in taps/time - Ivan judges by feel
- Voice mode on real mobile hardware over cell network (run verifies on desktop Chrome + devtools emulation only)
- Broker cost/latency under real usage bursts; Railway cold starts
- iOS Safari PWA quirks (service worker + mic permissions) on Ivan's actual phone
- The first winner-apply: old ballot superseded cleanly, loser routes actually deleted

The DoD is not met until every phase passes - a staged ballot IS the legitimate end-state. Never ask mid-run. **Start now.**
