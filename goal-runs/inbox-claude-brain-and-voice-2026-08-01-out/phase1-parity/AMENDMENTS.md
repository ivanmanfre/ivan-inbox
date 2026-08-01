# Phase 1 amendments — adopted by the orchestrator after the adversarial pass, 2026-08-01

Sources: `SKEPTIC-CROSS-TENANT.md` (this dir) and `../phase1b-content/SKEPTIC-FALSE-VERIFICATION.md`. The specs themselves are left as written (audit trail); these amendments BIND Phase 2/3 builders wherever they conflict with the spec text.

## A1 — F1's quoted distribution is a snapshot, not a fact (false-verification skeptic, REFUTED)
PARITY-SPEC §0 F1 quoted "shared-tech restored: zero, unscoped: all missing" from one probe. Re-runs today return all 29 shared-tech and 96 unscoped rows within the 1000-row page. **Standing truth:** the restore IS capped at 1000 of 1885 with undefined ordering — *which* rows drop is nondeterministic and can change per boot. All design consequences (per-tier queries, rely-on-nothing-restored) are unchanged. Any Phase 5/report text must state the cap + nondeterminism, never a specific dropped-tier breakdown.

## A2 — depth scoping is unenforced by the server; say so and design for it (cross-tenant skeptic, REFUTED-as-safe)
The depth recipes execute as model-driven `curl` with the container's service key. There is NO server-side tenancy enforcement on `claude-brain-query` `mode:recall` without `client_ids` (live: 5/5 ProSWPPP rows returned), and `connections`/`related_to` hardcode `p_client_ids:null`, `neighbors` has no filter at all. Binding changes:
1. Every documented recipe carries the literal allowlist inline; recipes are formatted so the scoped form is the ONLY form shown (no unscoped example anywhere in the injected text).
2. `connections` / `related_to` / `neighbors` modes stay excluded and are named as UNSAFE in the depth block itself ("do not use these modes: they ignore tenancy").
3. DEPTH-SPEC's residual-risk section is amended in spirit: **a plain model mistake (no attacker needed) can silently read another tenant's memory**, because the key on the container is all-powerful and the scoping lives in prose. This is a pre-existing container property this run cannot remove (out of grant); the report and watch-first list must carry it, and the injected depth block must instruct the model to always include `client_ids` and to state in its answer when a depth query was run.
4. Phase 5 verification adds: a probe that the DEPLOYED injected depth text contains zero unscoped query examples, plus the leak-vs-scoped brain-query pair re-run.

## A3 — collision handling is luck-dependent unless both keys are pinned everywhere (cross-tenant skeptic)
Confirmed: unpinned `file_path` queries return `ivan` then `proswppp` by undefined order. The spec already mandates pinning both `client_id` and `file_path` (F4); this amendment extends it to `client_instances`: fetch `compiled_context` by `?client_name=eq.Ivan System&limit=1` AND assert exactly-one-row; if >1 row ever returns, fail visibly (same class of unenforced uniqueness).

## A4 — two confirmed UI bugs become build requirements (false-verification skeptic, CONFIRMED)
1. `normalizeAgentLog` discards `agent` and `source` on 2999/2999 live entries → the content build MUST carry agent attribution through to the rendered log (the DoD's full-register log is impossible without it).
2. `source_detail` is an object on 71 rows (63 Mattan-lane) and reaches an unguarded `{v}` JSX child → the content build MUST render it structurally (or stringify defensively); this is a live crash class on Mattan's lane, not a polish item.

## A5 — citation drift, cosmetic
`entrypoint.sh:276`→`:282` for the restore fetch line; the `grep '^cd '` repro line in F2 returns zero matches (conclusion unaffected). Carry corrected line numbers into any Phase 5 citation.
