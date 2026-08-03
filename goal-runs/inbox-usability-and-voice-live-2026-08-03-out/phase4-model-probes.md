# Phase 4 model/palette probes (orchestrator, 2026-08-03 morning)

## /chat/stream per-request model: WORKS on deployed container
- request claude-haiku-4-5 -> assistant frames report claude-haiku-4-5-20251001 (honest)
- request claude-opus-4-8 -> frames report claude-opus-4-8; claude-sonnet-4-6 -> claude-sonnet-4-6
- => broker's fail-closed 409 can be lifted: set UPSTREAM_MODEL_PASSTHROUGH=true (T2 secret) OR rely on
  openapi probe (still gated behind /login -> env flag it is)

## The Claude 5 mirage on /v1/messages
- claude-sonnet-5 / claude-fable-5 / claude-opus-5 all "succeed" BUT main.py:1476/1887
  `cli_model = MODEL_MAP.get(model, "sonnet")` silently runs SONNET and the response echoes the
  REQUESTED name. Cosmetic echo. (Also explains July's max-plan:claude-sonnet-5 telemetry.)
- MODEL_MAP (main.py:1234) has only 4.x keys; /chat's resolve_chat_model REJECTS unknown names (400).

## Truthful probed-working set (newest first) for the picker
- claude-opus-4-8 (CLI alias opus), claude-sonnet-4-6, claude-haiku-4-5(-20251001)
- opus-4-7/opus-4-6 map to the same "opus" alias -> dupes, drop from picker
- Claude 5 ids CANNOT currently run: needs T3 MODEL_MAP extension (one-line additive,
  "claude-fable-5":"claude-fable-5" style — CLI accepts full ids) + Railway deploy + re-probe.
  Decision deferred to Phase 4 execution: one-change grant with rollback recorded.

## Container skills (Phase 4 palette source of truth)
- GET /skills on deployed container: 19 skills (phase4-container-skills.json) — 9 NOT in the local
  repo (uploaded at runtime): xlsx pdf docx pptx video-use negotiate proposals recall pp-firecrawl.
- Slash commands: image ships ~/.claude/commands (gsd suite + 5 stochastic) per Dockerfile:78-81;
  live listing not reachable via /workspace (root-only listing) — verify via one CLI turn at
  palette-build time.
