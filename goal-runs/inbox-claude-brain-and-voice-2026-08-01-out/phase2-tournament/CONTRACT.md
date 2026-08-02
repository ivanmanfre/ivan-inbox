# Phase 2 — assembler tournament contract (written before any candidate dispatched)

## What is being competed

Two independent implementations of the context assembler specified in `phase1-parity/PARITY-SPEC.md` + `INJECTION-SAFETY.md`. The spec fixes: where it runs (edge-function module), the channel (`append_system_prompt`), the tenancy allowlist (`ivan`,`global`,`shared-tech`, per-tier queries, collision paths pinned), the cap (36,000 chars, visible load-shed, MEMORY.md never shed), and the freshness model. Candidates compete on **implementation quality within the spec**: query orchestration, cache design, failure honesty, code clarity, and measured performance. This is deliberately a narrow tournament — the wide decisions were Phase 1's and are not re-litigated by candidates.

## Deliverables per candidate

Working code in `phase2-tournament/cand-<id>/assembler.ts` — **edge-runtime-compatible TypeScript** (Web APIs only: `fetch`, `AbortSignal`, no Node builtins, no npm deps) exporting:
```ts
assembleSystemPrompt(deps: {env: (k:string)=>string|undefined}): Promise<{
  text: string;            // the full framed append_system_prompt payload
  blocks: {id:string; chars:number; ok:boolean; note?:string}[];
  shed: string[];          // block ids dropped by load-shed
  assembledInMs: number;
  cacheState: 'cold'|'warm'|'stale';
}>
```
plus `phase2-tournament/cand-<id>/MEASURED.md` with, per run (≥3 cold, ≥10 warm consecutive simulated turns):
- assembled chars + **real token count** (count with a real tokenizer method — state which; chars÷4 only as cross-check)
- assembly latency cold vs warm (and what the cache actually avoided)
- per-turn cost in dollars at the upstream's model: read the live model id from the deployed Railway service (`GET /v1/models` or the documented `CLAUDE_MODEL` default `claude-opus-4-7`) and take CURRENT published per-MTok pricing — cite the pricing source you used; compute cost for the injected block alone and for a realistic full turn (injection + 24k context + reply), and the prompt-cache-hit variant if the route supports cached system prefixes
- the doubled-turn measurement: the container's own SessionStart hook still injects ~1.2k tokens (PARITY-SPEC F3) — include it in the realistic-turn arithmetic
- cross-tenant self-test: run the assembler live, assert zero rows outside the allowlist entered any block; print the assertion output

Candidates run their module locally against the live DB (service key per `phase0-research-db.md` method) — READ-ONLY, no writes, no deploys. `claude_memory` stays untouched.

## Hard rules (DQ)

- Every REST query: `client_id` filter in the URL, per tier, above any limit (F5). No `in.()` covering all tiers in one page. Collision paths fetched with both `client_id` and `file_path` pinned (F4).
- Post-fetch allowlist assertion that THROWS on violation (assertion, not control).
- MEMORY.md whole or `413`-style error, never mid-truncated; visible `[LOAD-SHED: …]` line when shedding; visible `[STALE: …]` label on fallback; absent blocks announced, never silent.
- Framing per `INJECTION-SAFETY.md` (delimiters, anti-instruction preamble, escaping strategy implemented, not just described).
- No secret in any artifact file; key read from env at runtime only.

## Candidate directions (assigned, so the two differ by design)

- **cand-live**: minimum machinery. Per-turn `Promise.allSettled` of the 4 live reads + cached tier indexes with `updated_at` probe, module-scope Map, straight-line code optimized for auditability. Bet: the warm path is already ~one round-trip; complexity buys nothing.
- **cand-memo**: maximum honest caching. Single-flight assembly memo keyed by a composite freshness fingerprint (one cheap HEAD/`updated_at` multi-probe decides whether ANY block rebuilds), byte-stable output ordering to maximize upstream prompt-cache hits, explicit cache-state reporting. Bet: byte-stability + fingerprint probe cuts warm latency and enables upstream prompt caching to pay for MEMORY.md.

## Judging

Panel of 3 calibrated seats (run AFTER both MEASURED.md land):
1. **Spec-fidelity seat** — walks the DQ list against the code, line-cited. Calibration control: a planted known-bad variant (post-fetch filtering + single `in.()` query) must FAIL before the seat votes on real candidates.
2. **Measurement-truth seat** — re-runs each candidate's assembler itself and compares against the claimed MEASURED.md numbers (the v2a zeros incident is the hunted pattern). A claim that doesn't reproduce within reasonable variance = the candidate's measurement section scores zero.
3. **Operational seat** — failure modes: what does a turn look like when Supabase is slow, when a block 500s, when the isolate is cold, when content contains the delimiter. Scores the honesty artifacts (shed/stale/absent lines) as rendered, not as described.

Winner + named grafts written to `phase2-tournament/VERDICT.md`. Cycle budget: max 2 fix loops per candidate against gate failures, then residual goes to the report.
