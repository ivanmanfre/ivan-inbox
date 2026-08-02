# Phase 2 verdict — assembler tournament

**Winner: `cand-live`, with three named grafts from `cand-memo`.** Panel: 3 calibrated seats, each of which ran its own controls before voting, plus an independent re-measurement seat that re-derived every headline number.

## Seat results

| seat | verdict | decisive finding |
|---|---|---|
| Spec fidelity (calibrated on a 4-defect strawman that correctly FAILED all four) | **cand-live** | cand-memo **DQ**: the mandated tenancy assertion is swallowed — B9/B10 violations reduce to a cosmetic "unavailable" note, and P15 violations can be served from the stale-cache catch on any warm turn (`cand-memo/assembler.ts:939-947`). That is the precise bug cand-live documents having found and fixed in itself mid-build. |
| Measurement truth (re-ran both harnesses; re-derived tokens independently) | **cand-memo's numbers** | The true injected size is **~17,100 tokens** (judge reproduced 17,094 against cand-memo's 17,112 by the same differential-usage method on an already-authenticated CLI). `chars ÷ 4` understates by **1.90×** because Ivan's memory is emoji/hash/ID-dense (2.10 chars/token vs ~3.03 for prose). cand-live's cost figures are honestly labelled estimates but understate reality ~1.9-3×. One cand-live claim did not reproduce (its "identical after masking nonce+timestamp" — an unmasked per-second timestamp in its own B14 header makes it a coin flip). Neither candidate showed the hunted zeros-with-confident-summary pattern. |
| Operational honesty (calibrated on a silent-omission bad control; forced 7 failure modes and read the rendered output) | **cand-live** | cand-memo's single fingerprint probe gates the *entire* assembly: on a cold start, one non-critical source failing (n8nClaw 500, or a 9s hang past its 2.5s timeout) throws `assembly_failed` and Ivan gets **zero context, not even MEMORY.md**. It also mislabels live reality today — ClickUp has no key configured, and instead of `[ClickUp: no key configured]` it renders `[LOAD-SHED: … this context is partial]` every turn, telling Ivan the wrong causal story. cand-live degrades per-source and names the failed block inline. |

## What ships

`cand-live/assembler.ts` as the base, plus these grafts (each conditional on cand-live's assertion-tagging pattern surviving intact, so a tenancy violation can never be swallowed):
1. **cand-memo's `sources-as-of` header** replacing cand-live's wall-clock timestamp — removes the per-second nondeterminism the measurement seat caught and is a precondition for any future cache work.
2. **cand-memo's dynamic nonce-count derivation** (both candidates independently found the spec's "nonce appears exactly twice" invariant to be arithmetically impossible — the real count against the mandated framing is 5; spec-fidelity seat ruled cand-live's objection correct).
3. **cand-memo's in-sequence numbered rendering of absent blocks**, and its single-flight request coalescing.
Plus one fix cand-live must take from the operational seat's finding: keep absent-because-unconfigured (`[ClickUp: no key configured]`) distinct from absent-because-shed.

## The numbers that go to the ballot, not to a silent decision

- **Injected context is ~17,100 tokens per turn**, not the ~8,500 the parity spec estimated. The mission said: report the number, ballot the tiering, never silently downgrade. This is that number.
- **Cost as deployed today: $0.1711 per turn for the injection alone** (a fresh Claude session per turn writes a 1-hour cache at 2× and never reads it), against ~$0.0086 with a cache hit. Today's route therefore costs **2× more than no caching at all**. Realistic full turn ≈ $0.3365, of which injection is 51%.
- **The 13× fix is real and measured twice independently** (cand-memo 13.1×, judge 13.05×): pass `--resume` on `/chat/stream` and keep the payload byte-stable → $0.2587 → $0.0197. Both halves are **outside this run's grant** (the Railway grant is the model passthrough only), so this is a ballot/report item, not an action.
- **The cap has no headroom.** Measured payload 35,949-35,971 chars against a 36,000 cap — 29-51 chars, not the ~1,900 the spec projected. One more MEMORY.md line fires load-shed. Phase 3 raises the cap deliberately or accepts shedding; recorded as a build decision, not left to chance.
- **The container's duplicate injection is 2× its estimate**: measured 5,146 chars / 2,390 tokens ($0.0239/turn) of unframed context that the container's own SessionStart hook still adds on every turn (PARITY-SPEC F3/T9). Out of grant; report item.
