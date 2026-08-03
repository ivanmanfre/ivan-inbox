# Goal-run: inbox-faithful-revamp-2026-08-02

Authored 2026-08-02 21:00 after Ivan reviewed the parity build on :5431 and said: the filter/tag area is
"a super mess", Today shows "old stuff... the approve dm draft is old asf", the design is "not polished
and with errors and lack of hover, animations and proper readability", "the claude tab doesnt even work",
voice is missing, mobile untested, and **"lets do a proper /goal-run to go in depth and give this a
revamp."** He also answered two open ballot items in the same message: **colour = TRIAD**, and semantics
questions are "solvable by seeing the old content panel on ivanmanfredi.com/dashboard" (e.g. whether LM
status `live` means live on the site or posted on LinkedIn).

Execute everything below the divider as the goal.

---

## Mission

Take the voted direction (`exp/vis-faithful`, judged `22168ef`, parity commits on top) from
"survives instruments" to "feels finished in Ivan's hands": correct data on every surface, one coherent
filter system instead of a facet wall, hover/motion polish inside the existing contract, a Claude tab that
completes real turns, mobile as good as desktop, triad as the shipped colour. The prior runs proved the
skeleton; this run is muscle and skin. **The bar is Ivan opening :5431 on desktop and his phone and
finding nothing to screenshot at me.**

I will not answer questions mid-run. Make every technical call yourself and log why. Anything
taste-locked lands in the final report as a shown-not-asked comparison, never a mid-run question.

## Decisions already made (do not reopen)

1. **Direction: `faithful` won the ballot.** Work continues as new commits on `exp/vis-faithful`.
   `spine` and `split` branches stay untouched as gene pools.
2. **Colour: TRIAD.** Ivan: "color i want tried [triad]". Set `data-cat` default to `triad` (boot +
   absence of the localStorage key = triad). Mono remains available behind the toggle, undocumented.
3. **Voice on the browser Speech API is dead** (WER 38.6%, lost finals, google endpoint). The mic stays
   hidden until the server-side rebuild in Phase 5 passes its gate. Never re-show it on the browser API.
4. **The spine contract binds** (`goal-runs/inbox-visual-rebuild-2026-08-02-out/phase2-spine.md`),
   with one amendment this spec makes explicitly: the two `wb-cap` badges at 4.43:1 must now be fixed
   INSIDE the triad answer (colour is decided, the excuse is gone). §12 DQ list unchanged.
5. **The Railway `/chat/stream` one-token fix is now VOTED** (standing decision 2 from
   `inbox-claude-brain-and-voice-2026-08-01`; Ivan's "the claude tab doesnt even work" is the vote).
   Phase 4 applies it under the tightest possible diff.

## Re-read as canon before acting

- `memory/inbox-visual-rebuild-2026-08-02.md` — every trap is live (capture discipline, `.wb` scoping,
  port 5432 is Postgres, census-pass ≠ glanceable, fixer self-reports need re-measurement).
- `memory/inbox-claude-brain-and-voice-2026-08-01.md` — the broker/transport findings: `/chat/stream`
  builds `claude -p --output-format stream-json` with **no `--verbose`** since `df6801e` (2026-02-24) and
  returns `{"type":"done","returncode":1}`; `/chat` works; the inbox broker (`inbox-claude` edge fn) is
  deployed, fails closed, CORS-allowlisted; `RAILWAY_CLAUDE_API_KEY` unset by design; memory-injection
  cost traps; escaper traps.
- `.../inbox-visual-rebuild-2026-08-02-out/phase2-spine.md`, `phase6-BUILD.md`,
  `phase6-dashboard-parity.md`, `phase6-reflow-and-slash.md`.
- `~/.claude/memory/global/brand-visual-system.md` header — warm-paper/serif stays absolutely retired.

## Hard guardrails + mutation tiers

- **`ivan-inbox`: T2 on `exp/vis-faithful`** (new commits on the voted branch; judged history intact).
  `main` untouched, never pushed, no merge. `:root` in `src/styles.css:1-16` never edited (DQ).
  Treatment stays `.wb`-scoped. No new npm dependency, no webfont, no serif. No `git add -A` ever
  (foreign untracked dirs in `goal-runs/`). Stage explicit paths.
- **Railway claude-code service: T3-EXTERNAL, one change only.** The permitted diff is the minimal fix
  that makes `--output-format stream-json` legal in `--print` mode (the researched fix adds `--verbose`
  to the spawned arg list) plus nothing else. Multi-client service: no other file, route, or env
  changes. Sequence: re-confirm the breakage live first (curl both endpoints, record outputs) → apply →
  deploy → verify `/chat/stream` streams AND `/chat` still works with the no-model default and an
  allowlisted model → record the rollback command. If the service shows ANY sign the breakage was fixed
  by someone else since 08-01, stop and re-diagnose before touching it.
- **Arming the broker:** if completing a real turn requires `RAILWAY_CLAUDE_API_KEY`, set it from the
  existing Anthropic credential path Ivan already uses for agent chains (never a new key, never in the
  browser bundle; it lives in Railway env only). Verify with one real turn, then check
  `client_api_usage` telemetry wrote a row. If the proxy-first routing canon
  (`proxy-first-api-fallback-routing-2026-07-30`) applies to this call path, follow it.
- **Supabase edge functions (`get-morning-brief`, `inbox-claude`): T2** — read first, smallest diff,
  deploy only what Phase 2 diagnosis demands, never touch RLS or other tenants' functions.
- **No secret in `dist/`** (grep gate). **No fabricated data** (DQ, not correctable). Every denominator
  from `count=exact` or the full fetched set.
- **Capture discipline** (all evidence): minted session or verified-exp `.session.json`; literal-
  "Loading" gate; innerText-settled + resettle before every shot; scroller is `.rows.ct-rows`; never
  `networkidle`; set `data-cat` after mount. A skeleton crop is a failed capture.
- **Never ask.** Taste-locked calls ship as before/after evidence in the report.

## The live dashboard is now a source (Ivan's explicit instruction)

Questions the code cannot answer, the LIVE panel can: open `ivanmanfredi.com/dashboard` authenticated
(playwright-driver with an existing profile under `~/.claude/playwright-profiles/`, or the personal-site
dev server with Ivan's session; deploy nothing) and study the Content panel as built: what `live` means
for an LM (site-live vs posted-on-LinkedIn), how it labels/orders stages, what its filter UI looks like,
how Today-type freshness is decided. Screenshot the panel; cite it like a file. The LM `live` row gets
folded per what the panel shows, with the evidence in the build note.

## Phases

**Phase 0 — triage the screenshot + ground truth** → `phase0-triage.md`
Reproduce every item in Ivan's complaint on the live build with evidence: (a) the facet wall on Content
(his screenshot shows Stage/Kind/Pillar/Structure/Image-style/Hook/Source/Funnel/QA-verdict/QA-score
chip rows — inventory every facet row and where it comes from); (b) Today staleness — find the exact
"approve dm draft" item he saw, trace why it is still surfacing (edge fn `get-morning-brief` server
logic vs `today.ts` localStorage cache vs the underlying row's state), and define "today-fresh" from the
live dashboard's own behaviour; (c) console errors on every route, both viewports (his "with errors");
(d) hover/motion audit — walk every interactive element class and record which have no hover/press/focus
state (the spine's §10 allows hover ≤100ms bg-shift; "lack of hover" means the contract was
under-executed, the fix is inside it); (e) readability audit at real widths (line lengths, the §3.5
text3-on-surface3 rule, truncations like the judge's "PUBLIS" clip); (f) mobile sweep at 390 of every
route, listing every defect; (g) the live-dashboard study above. Everything gets a file:line or
screenshot citation.

**Phase 1 — the filter system** → commits + `phase1-filters.md`
Kill the facet wall. One vocabulary per spine §11: on working lists a search field + compact
`label: value ⌄` pills that open a panel/menu holding the facet's options WITH their counts (the counts
are good data, the permanent wall is the defect); active filters render as removable pills; everything
else lives behind the panel. Facet groups collapse into a sensible few (Stage, Kind, Pillar, Source, QA;
merge or demote the rest into an "All filters" panel). Filter state persists per section (the
`today.ts:4` localStorage projection pattern with a field allowlist, generalized; this is the ONE
behaviour-track item promoted into scope because the filter rebuild touches the same code). Mobile: the
panel becomes a sheet. Prove with before/after captures at 1440 and 390.

**Phase 2 — Today freshness** → commits + `phase2-today.md`
Fix per the Phase 0 diagnosis wherever the root is (client cache windowing, brief visibility rules, or
the edge fn's selection query). "Today" must mean: actionable now, not previously handled, not stale
beyond the window the live dashboard uses. If the fix lands server-side, deploy under the T2 edge-fn
guardrail with a before/after probe of the brief payload. The stale "approve dm draft" Ivan saw must be
demonstrably gone or demonstrably fresh-for-a-reason (stated in the UI, e.g. an age stamp).

**Phase 3 — polish pass, desktop + mobile** → commits + `phase3-polish.md`
Execute the motion/hover contract everywhere: every interactive element gets hover (≤100ms bg-shift),
press, and the 2px accent focus ring; the one choreographed beat stays the only choreography; row
selection/keyboard nav stay motionless. Fix every Phase 0 readability and truncation finding. Fix the
two `wb-cap` badges inside triad. Mobile gets its own fix list executed, then a fresh blind row-find +
readability judge at 390 (new agent, zero context). Then the spine §14 censuses re-run and stay green —
polish that breaks a census is not polish.

**Phase 4 — the Claude tab works** → commits + `phase4-claude.md`
(a) Re-confirm `/chat/stream` breakage live; apply the one-token Railway fix under the T3 guardrail;
verify both endpoints. (b) Arm the broker if required (guardrail above); complete a REAL turn from the
pane against real context; verify telemetry. (c) Pane correctness pass: error states render honestly
(the CORS-noise-while-unarmed class dies once armed), the slash palette's three commands work against
the live transport, `/clear` ships only if `useChat` gains a clean reset (small, in scope now). The
phase gate is a screen recording or step-capture of a full conversation turn in the pane.

**Phase 5 — voice, rebuilt server-side** → commits + `phase5-voice.md`
Transcription moves off the browser API: audio → existing infra (evaluate in order: the ivan-video-engine
Railway whisper path; the proxy; a Deepgram/OpenAI STT key IF one already exists in the stack — never a
new vendor without flagging it in the report) → text lands in the composer. Key stays server-side behind
an edge function or the Railway service; the static bundle never sees it. Gate before the mic
re-appears: WER < 15% on a 20-utterance product-noun script (the 08-01 run's test script is reusable),
p50 latency < 2s to first text. Fails the gate → mic stays hidden, findings + cost table in the report,
no half-working control ships. Passes → mic returns with a working-state indicator, `wb-voice` flag
flips to default-on.

**Phase 6 — full verification + handoff** → `phase6-verify.md` + `REPORT.md`
Instruments: tests/lint/build, censuses, console sweep (bar is now ZERO errors including the broker
class), overflow, secret grep, default-app regression vs base. Blind seats: row-find on Content at both
widths, a mobile polish judge, and a "screenshot test" seat that looks at every route cold and lists
anything it would screenshot at a builder. Fix loops: 2 per gate, then residuals to the report. Leave
:5431 running on the final commit. REPORT.md: per-complaint before/after, the Railway diff + rollback
line, the voice gate numbers, what stayed open. Memory writeback to
`memory/inbox-visual-rebuild-2026-08-02.md` (or a new topic file if this one is full), indexed.

## Orchestration mandate

Fan out Phase 0 as parallel scouts (facets, Today, errors/hover, mobile, live-dashboard study). Phases
1-3 are implementer→reviewer per **superpowers:subagent-driven-development**; builders commit every
10-15 minutes (the API dropped six agents across the last two runs; commits are the recovery path — and
a fixer's self-report is NEVER accepted without an independent re-measurement, twice proven this week).
Phase 4's Railway step runs in the main loop, not a subagent (external prod service; smallest blast
radius, full attention). Skeptics: fabrication, capture, regression (default app + the other two
candidate branches must still build), and a fresh-eyes screenshot seat. Deterministic instruments over
LLM judgment wherever measurable. Model routing: Fable orchestrates and judges; Opus builds Phases 1-5;
Sonnet scouts, probes, captures; Haiku sweeps and formats. All four seats required.

## Definition of done

1. Every Phase 0 complaint reproduced with evidence, then demonstrably closed or reported as open with
   a reason Ivan can read in one line.
2. The facet wall is gone; the filter system matches spine §11 on every list, persists per section, and
   works as a sheet at 390.
3. Today shows nothing stale without an honest age stamp; the diagnosis names the root cause.
4. Hover/press/focus exist on every interactive element; censuses still green; both `wb-cap` badges
   pass in triad; triad is the boot default.
5. Mobile passed a fresh blind judge at 390 on every route.
6. A real Claude turn completes in the pane end-to-end, telemetry row written; the Railway diff is one
   token + nothing else, rollback line recorded.
7. Voice either passes its WER/latency gate and ships server-side, or the mic stays hidden with the
   numbers and cost table in the report.
8. Zero console errors on every route, both viewports, including the formerly-allowed broker class.
9. `main` untouched; no new dependency; no secret in `dist/`; no `git add -A`; spine DQ list clean.
10. `REPORT.md` with per-complaint before/after captures; :5431 running the final commit; memory
    written back and indexed.
