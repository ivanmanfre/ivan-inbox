# Phase 0 — scope, central risk, surface inventory
Goal-run `inbox-claude-brain-and-voice-2026-08-01`. Written 2026-08-01 from five parallel research passes (raw material: `phase0-research-{injector,db,railway,inbox,dashboards}.md`, all claims there cited file:line with probe transcripts). Everything below was re-resolved from live state, not recalled.

## 1. The central risk, restated

We are injecting a persistent memory system into a chat surface whose upstream is **unsandboxed `Bash` under `bypassPermissions` on a multi-tenant container**. The container pre-materializes every client's n8n key and per-client Supabase service-role keys into `/workspaces-config/<cid>/.mcp.json` at boot (`entrypoint.sh:356-460`), and additionally carries a live same-project service-role JWT hardcoded as a source default (`main.py:46`). Workspace pinning is mostly theatre (prior run's security skeptic, confirmed): the JWT allowlist at the broker is the only real containment. Adding memory makes the surface more capable and a mistake more expensive. Three controls:

1. **Cross-tenant memory bleed → scope in SQL, above any limit.** `entrypoint.sh:274-296` already restores **all 1883** `claude_memory` rows with **no client_id filter** to arbitrary `file_path`s (confirmed in this run's re-read, `phase0-research-railway.md` §2). The context assembler must select rows with an explicit `client_id=in.(ivan,global,shared-tech)` (exact allowlist decided in Phase 1) in the query itself, never post-fetch. Phase 5 carries the proof query. Note the real tenant surface: `claude_memory.client_id` values are `ivan(1382), unscoped(272), proswppp(158), shared-tech(29), global(28), agencyops(7), risedtc(5), -workspaces-ivan(2)` — `proswppp`/`agencyops`/`risedtc` rows exist and MUST be excluded from Ivan's assembly (`risedtc` is a paying client's material; `unscoped` needs an explicit decision in Phase 1, not a default-include).
2. **Prompt injection through memory content → data-not-instructions framing, adversarially tested.** Memory rows reach `--append-system-prompt`, which flows **verbatim, unsanitized, straight onto the CLI argv** (`main.py:697-698`, `817-818`). The assembler wraps injected memory in a delimited reference-material block with explicit anti-instruction framing; an injection skeptic attacks it with a crafted row in a scratch copy (never written to `claude_memory` — the table is read-only this run).
3. **Token cost per turn → measured, tiering configurable.** Parity injection is real tokens on every turn. Phase 2 measures assembled token count and dollar cost per candidate at the model in use; the tiering choice is configurable and, if cost is material, goes to the ballot rather than being silently downgraded.

## 2. Corrections to mission prose (live state vs briefing — the re-resolve mandate paid for itself)

| Briefing claim | Live fact | Source |
|---|---|---|
| `claude_memory` ~400 rows | **1883 rows** (episodic 1191 / semantic 692), actively written (newest today) | `phase0-research-db.md` §1 |
| only 2 absolute `file_path`s | CONFIRMED — both `client_id='-workspaces-ivan'`, `/home/appuser/...` | same |
| `lm_drafts_v2` 121 resources | **127** total (40 published / 37 pending / 34 disqualified / rest misc) | §3 |
| `content.ts` 29 exports, UI consumes 11 | 29 **value** exports (+14 types) confirmed; shipped v2c UI consumes **19**, incl. the full agent-log/QA/taxonomy set — `DraftPane` already renders much of what Phase 1B was framed as missing. `fetchScheduledQueue`/`scheduled_posts` (152 rows) confirmed unused. | `phase0-research-inbox.md` §5 |
| exp/v2 changes 16 shared files | **20 distinct files** outside `src/exp/` | §8 |
| taxonomy columns `structure_used`/`image_style` | **no such columns** on `carousel_drafts` (38 cols). Closest: `style_id` + `taxonomy` (jsonb) + `slide_metadata`. Phase 1B must map the mission's tag vocabulary onto real columns. | `phase0-research-db.md` §3 |
| `scheduled_posts` needs lane scoping | table has **no `client_id` column at all** — single-tenant, Ivan's alone. It belongs to Ivan's lane by construction. | same |
| broker returns `upstream_not_armed` | the broker never emits that string; Railway 401 → broker `502 upstream_error` with `detail:"status 401..."` → **client-side** `classify()` in `src/lib/claude.ts:75` remaps it. Arming state is still unprobed (no real turn attempted in Phase 0). | `phase0-research-inbox.md` §1-2 |
| main at `7c9ea96` | CONFIRMED | git |

## 3. 🔴 State hazard found and RESOLVED: deployed broker source was on no branch

The inbox researcher claimed six files were untracked on no branch. Direct `git ls-tree` re-verification shows the claim held **only for `supabase/functions/inbox-claude/index.ts`** (the deployed broker source, 188 lines, probe-matched to production) — `src/lib/claude.ts`, `claude.test.ts`, and `scripts/{sweep,diffshots}.mjs` were already tracked on `exp/v2` with content identical to the disk copies, and the untracked `scripts/density.mjs` disk copy was an *older pre-calibration* version than the branch's (the calibrated 148-line one won). **Resolved 2026-08-01:** run branch **`exp/brain`** created off `exp/v2` (`64e3b72`), archival commit `d1b4f33` adds the broker source verbatim. Local `main` briefly gained a stray commit during the aborted first attempt and was reset to `7c9ea96` (origin/main never moved; nothing deployed). Colliding untracked prior-run crops were relocated to the session scratchpad after byte-verifying they match the branch-tracked copies. Lesson for the false-verification skeptic: the researcher's `git ls-tree` sweep produced a wrong negative for 5 of 6 files; branch-existence claims need per-path verification.

## 4. Surface inventory — every place the three changes land, each with its Phase 5 verification row

| # | Surface | What changes this run | Phase 5 verification row |
|---|---|---|---|
| S1 | `supabase/functions/inbox-claude/index.ts` (deployed on bjbvqvzbzczjbatgmccb; source untracked → run branch) | context assembler injection via upstream `append_system_prompt`; `model` field (allowlisted); depth plumbing | re-probe: anon→401, anon-key-bearer→401 `invalid_token`, wrong-user→403, oversize→413, real turn streams; grep deployed source: no `working_directory`/`client_id`; CORS allowlist unchanged; fail-closed intact |
| S2 | Railway `main.py` `/chat` + `/chat/stream` (T3, narrow grant) | `model: Optional[str]` on `ChatRequest` + allowlist map at the two invocation sites (`main.py:677`, `807`); **nothing else** | turn on model A + turn on model B, both read back from the stream's `system` init frame; `git diff` of the service showing only the granted hunks; before-snapshot + restore line in LEDGER |
| S3 | Context assembler (new module, lives broker-side) | new | captured real-turn injected context shows every parity block; token+dollar cost stated |
| S4 | `claude_memory` (READ-ONLY) | consumed by assembler, never written | cross-tenant proof query: assembler's exact SQL cannot return a row with `client_id` outside Ivan's allowlist (demonstrated against the live table incl. `proswppp`/`risedtc` rows) |
| S5 | On-demand depth (recall/brain from the container) | reach `claude-brain-query` (confirmed deployed, v22 contract; only source = dated backup snapshot `~/.claude/backups/memory-efficiency-2026-07-25/claude-brain-query.v22.as-deployed.ts` — flagged) + `claude_memory` REST | a real turn that reaches the brain/memory and cites what it found |
| S6 | Chat UI incl. model picker (`src/exp/v2c/chat/*` on run branch) | picker; honest degrade when upstream rejects a value | degrade probe (bogus model → visible honest state, not silent fallback); sweep gates |
| S7 | Content surface, both lanes (run branch, `#exp/` gated) | Phase 1B IA + Phase 2B treatment | live render per lane; nav grep: no AgentOps destination; agent_log full render on proof row `792ee91c-5b0e-475b-9150-3bee9937bbb5` (37 entries, 3+ regen cycles); stuck-row proof `bb07706c` (lm_drafts_v2 approved 9d, landing_url NULL); tag filter to a known row; write-affordance grep (no publish/schedule/delete added; `lm_drafts_v2` read-only) |
| S8 | Voice (`src/exp/v2c/chat/voice.ts` reducer + `useVoice.ts` + `VoiceControl.tsx`) | instrumentation only (latency marks); harness external | per-fixture latency + WER vs `phase4-fixtures/transcripts.json` (10 WAVs incl. jargon/noisy/fast); explicit <1.2s verdict |
| S9 | Built `dist/` + run-branch history | — | secret grep (sk-ant-, service_role JWT shape, RAILWAY_CLAUDE_API_KEY, X-API-Key literals) over dist + `git log -p` of the branch |
| S10 | Default routes (main app shell) | must NOT change beyond exp/v2's already-pending diff | `scripts/diffshots.mjs` against the prior run's baseline |
| S11 | GitHub Pages `main` | untouched | `git log main` unchanged; no push |
| S12 | `entrypoint.sh` all-clients memory restore + `/workspaces-config` materialization | **reported, not touched** (outside grant) | reported in REPORT.md watch-first + risk section |

## 5. Load-bearing mechanics confirmed for the build (so later phases stop re-deriving)

- **Model passthrough is low-risk and proven-adjacent**: `MODEL_MAP` (`main.py:1232-1244`) already maps Anthropic IDs → CLI aliases and `--model` is proven working on `/v1/messages`/`/v1/vision-qa`. The change: add `model: Optional[str]` to `ChatRequest` (`:80-90`), allowlist-map it at `:677` and `:807`. `CLAUDE_MODEL` env (default `claude-opus-4-7`) stays the fallback. Serialize this change; touch nothing else (not `verify_api_key`, not `main.py:46`, not transcripts).
- **Injection channel**: broker → upstream body `append_system_prompt` (currently not forwarded by broker; upstream forwards verbatim to argv). Assembler output must respect combined size vs broker's `MAX_CONTEXT_CHARS=24_000` discipline — new caps to be set consciously in Phase 1, not inherited silently.
- **Session continuity truth**: `/chat/stream` never reads `session_id` (`main.py:773-865`) — every turn is a fresh CLI session; the transcript replay via `context` is the only continuity. Parity design must treat per-turn injection as the whole story (matches how the local hook works: every prompt gets the injection).
- **Depth credentials**: the container already holds `SUPABASE_SERVICE_KEY`; the brain skill's five HTTP modes and `recall.py`'s semantic path are pure Supabase REST/edge-fn calls, portable as-is (`phase0-research-injector.md` §2, confirmed live with probes). Not portable: cwd-based tenant identify, file-grepped creds, local `fetch_git_log`, local memory-dir grep (the `claude_memory` mirror carries the same content, scoped queries replace it).
- **Voice reality**: state machine IDLE→ARMING→LISTENING→TRANSCRIBING→SENDING→SPEAKING (+ERROR, PAUSED-after-3-no-speech), on-device `webkitSpeechRecognition`+`speechSynthesis`, zero network legs, **zero instrumentation today** — the `<1.2s` target has no measurement artifact anywhere. Phase 4 builds the first one.
- **Instruments**: `sweep/density/diffshots.mjs` exist (untracked), calibrated; surviving gate set from prior CALIBRATION.md: 390px zero-overflow, zero console errors, >100 words → ≥1 visual encoding, prose ≤80%, stat tiles ≥26px, three distinct data states. Prior baselines live in `goal-runs/inbox-v2-revamp-2026-08-01/baseline/`.
- **Tenants that exist** (for the cross-tenant skeptic): registry = ivan, risedtc, proswppp, agencyops, secondmile, lemonade, the-reeder, interlude (8 active). Memory rows exist for proswppp/agencyops/risedtc — real bleed material, not hypothetical.

## 6. Content ground truth for Phase 1B (counted, not recalled)

- `carousel_drafts` 282 = Ivan(NULL) 198 (109 published / 69 disqualified / 16 review / 2 scheduled / 2 error) + risedtc 84 (70 review / 9 published / 3 error / 2 disqualified). Log = `agent_log` jsonb `{ts, agent, body, source?}`; proof row `792ee91c…` has 37 entries. `board_visible`, `image_urls`, `taxonomy`, `style_id`, `funnel_stage`, `video_*`, `covers` columns confirmed.
- `scheduled_posts` 152 (135 posted / 15 cancelled / 2 pending), **no client_id column** → Ivan lane. Statuses are its own vocabulary (`QUEUE_STATUSES` in content.ts).
- `lm_idea_candidates` 1709 total; 48 reviewing / 197 promoted / 1448 archived / 9 pending / 7 scored.
- `lm_drafts_v2` 127; read-only on purpose (publish watcher). Stuck proof row `bb07706c…` (only `approved` row, 9 days, `landing_url` NULL).
- `content_prompts` 129 total; **17 style rows**: 11 `Carousel layouts` + 6 `Single-image styles`, colliding on `before-after` (`style-before-after` vs `image-style-before-after`) → previews stay family-keyed via `previewKeyFor`.
- Dashboard field inventory (what the inbox must carry or consciously drop) in `phase0-research-dashboards.md`: ClientOps inspect-rail provenance (idea source/ICP score, merged idea+draft agent timeline, `QAVerdictPanel` score trend, actual rewrite text), health-strip live aggregates with the "null → honest empty, never fabricated" law, cover A/B stores, `operator_schedule_draft`/`operator_set_board_visible` RPCs, client actions feed w/ voice-note playback, and ClientBoardPage's deliberate stripping of ALL internal machinery from client eyes (the authority on what Mattan sees).

## 7. Phase plan consequences

- Phase 1 (parity spec) can start now — injector block table is complete in `phase0-research-injector.md` §1 (14 blocks with portability verdicts).
- Phase 1B can start now — dashboards + DB research done; must reconcile mission tag vocabulary onto real columns.
- Phase 2B design track starts now — DIAGNOSIS.md written (verdict: CONFIRMED, the prior contract outlawed a new look), brand refs captured.
- Build order in Phase 3: (0) archival commit of untracked deployed code, (1) assembler + broker, (2) depth, (3) **Railway passthrough serialized last**, (4) model picker UI.
