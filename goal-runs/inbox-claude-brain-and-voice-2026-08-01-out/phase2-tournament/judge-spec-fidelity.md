# Judge seat 1 — SPEC FIDELITY

Goal-run `inbox-claude-brain-and-voice-2026-08-01`, Phase 2 tournament. Read-only pass over
`CONTRACT.md`, `phase1-parity/PARITY-SPEC.md` §2/§3, `INJECTION-SAFETY.md`, `AMENDMENTS.md`,
`cand-live/assembler.ts`, `cand-memo/assembler.ts` (+ both `MEASURED.md`/harnesses where
behaviour was unclear from the source alone).

---

## 0. Calibration (run before any real candidate was scored)

Wrote a deliberately non-compliant strawman assembler
(`/private/tmp/.../scratchpad/strawman-calibration.ts`, not in the goal-run dir) that:
(a) fetches all tiers in a single `client_id=in.(ivan,global,shared-tech)&limit=2000` query,
(b) filters `client_id` in JS after the fetch (`allRows.filter(...)`),
(c) locates `project/MEMORY.md` by `file_path` alone (`allRows.find(r => r.file_path === ...)`),
(d) silently truncates the assembled text at 36,000 chars with `.slice(0, MAX)`.

**Rubric used** (from `CONTRACT.md` Hard Rules §"Hard rules (DQ)" + `PARITY-SPEC.md` §2/§3 +
`AMENDMENTS.md` A3):

| # | criterion |
|---|---|
| 1 | Per-tier queries, `client_id` in the URL above any `limit`, never one `in.()` page for all tiers |
| 2 | Both collision paths (`project/MEMORY.md`, `project/_compaction-review.md`) pinned by `client_id` AND `file_path` |
| 3 | A3: `client_instances` fetched by `client_name` with an exactly-one-row assertion |
| 4 | Post-fetch allowlist assertion that THROWS, and is not swallowed by any fallback/catch path |
| 5 | `MEMORY.md` whole or visible error, never mid-truncated |
| 6 | Visible `[LOAD-SHED]`/`[STALE]`/absent-block lines actually emitted by code |
| 7 | Framing + escaping per `INJECTION-SAFETY.md` implemented in code |
| 8 | No secret literal in any artifact |
| 9 | Edge-runtime compatible (Web APIs only, no Node builtins in `assembler.ts`) |
| 10 | Load-shed order matches `PARITY-SPEC.md` §3 |

**Strawman scored against criteria 1–5 (the four planted defects plus their direct
consequence):**

| # | verdict | why |
|---|---|---|
| 1 | **FAIL** | exactly the F5 anti-pattern the contract names: one `in.()` page for all three tiers |
| 2 | **FAIL** | `find(r => r.file_path === 'project/MEMORY.md')` has no `client_id` pin — the exact F4 hazard, returns whichever tenant's row the undefined page order puts first |
| 3 | **FAIL** | no `client_instances` query exists at all; A3 is not implemented, not even attempted |
| 4 | **FAIL** | `filter()` silently drops out-of-allowlist rows; nothing throws, nothing asserts, a violation is invisible |
| 5 | **FAIL** | `.slice(0, MAX)` can cut `MEMORY.md` mid-sentence with no marker, no `413`, no `[LOAD-SHED]` line |

**Confirmed: the strawman fails all four planted defects (and cascades into 5).** Calibration
passes — proceeding to score the real candidates against the same rubric.

---

## 1. Per-criterion table

| # | criterion | cand-live | cand-memo |
|---|---|---|---|
| 1 | per-tier queries, `client_id` above limit, no `in.()` for all tiers | **PASS** — `probeTier`/`fetchTierRows` (`cand-live/assembler.ts:525-538`, `:541-549`) issue `client_id=eq.<tier>` per tier; `fetchP15` (`:411-423`) and `fetchB9` (`:473-496`) same pattern. No `in.()` anywhere in a fetcher. | **PASS** — `probeFingerprint` (`cand-memo/assembler.ts:369-380`) one probe per tier; `pB10a`/`pB10b` (`:505-524`) separate `client_id=eq.global` / `client_id=eq.shared-tech` queries; `pB9` (`:468-484`), `pP15` (`:526-539`) same. |
| 2 | collision paths pinned by `client_id` AND `file_path` | **PASS** — `fetchP15` (`:415`) `client_id=eq.ivan&file_path=eq.project/MEMORY.md`; `B9_SOURCES`/`fetchB9` (`:468`, `:480`) same for the project compaction path. | **PASS** — `pP15` (`:530`) `client_id=eq.${CLIENT_ID}&file_path=eq.${PATH_MEMORY_MD}`; `compactionTargets`/`pB9` (`:469`, `:477-478`) same. |
| 3 | A3: `client_instances` by `client_name` + exactly-one assertion | **PASS** — `fetchB5` (`:427-433`) `client_name=eq.Ivan%20System&limit=1` + `Prefer: count=exact`/`Range:0-0`, then `assertExactlyOneRow` (`:433`, def. `:194-205`). | **PASS** — `pB5` (`:440-452`) same query shape with `count:true`, explicit `if (x.total !== 1) throw new UniquenessViolation` (`:446`); redundantly re-checked in `probeFingerprint`'s `instanceProbe` (`:382-390`). |
| 4 | post-fetch allowlist assertion THROWS, never swallowed by a fallback path | **PASS** — see §2 below, traced in full. | **FAIL (DQ)** — see §2 below, traced in full. This is the Hard Rule the contract names by pattern; cand-memo has it live. |
| 5 | `MEMORY.md` whole or visible error, never mid-truncated | **PASS** — P15 is excluded from the load-shed ladder entirely (`:899-907` never touches P15); exhausted ladder throws `413 context_assembly_over_cap` (`:934-939`). | **PASS** — `SHED_LADDER`/`ShedLevel` (`:606-615`) has no P15 field; `renderBlocks` always emits P15 whole (`:726-734`); exhausted ladder throws `ContextAssemblyOverCap` (`:978-982`). |
| 6 | visible `[LOAD-SHED]`/`[STALE]`/absent lines actually emitted | **PASS** — `shedLine()` (`:837-850`), `absent[]` pushes (`:697-708`), `[STALE:...]` (`:669`); all captured rendering in `MEASURED.md` §7. | **PASS**, with a caveat — `shedLine()` (`:814-816`), `staleLine` (`:953-956`), per-block absent bodies (`:646,667,678,687,705,722`); captured in `MEASURED.md` §8. Caveat: the B9/B10a/B10b "unavailable" lines are the SAME code path that swallows a tenancy violation (see §2) — technically visible, but visually indistinguishable from ordinary network flakiness, which defeats the point of a security assertion. |
| 7 | framing + escaping per `INJECTION-SAFETY.md` implemented | **PASS** — `framingText()` (`:324-352`) byte-diffed against spec §2.3: identical apart from template-literal syntax (`${nonce}` vs the spec's `{nonce}` placeholder notation and code-fence wrapper lines — confirmed via `diff`). `escapeBody` (`:277-288`) implements §3.1/§3.2/§3.4 in order. | **PASS** — `FRAMING()` (`:765-791`) byte-diffed identical to spec, same caveat. `escapeBody` (`:178-185`) same three steps. Soft risk not in cand-live: an env-gated `MEMORY_NONCE_MODE=per-memo` toggle (`:888`, `:958`) that — if ever set — weakens the exact control §5 says the whole channel decision rests on. Defaults to spec-compliant `per-turn` and is disclosed/balloted (`MEASURED.md` §6), so not a DQ, but it is configuration surface cand-live doesn't have. |
| 8 | no secret literal in any artifact | **PASS** — `grep -rn 'eyJ\|sk-ant'` across both candidate dirs (assembler.ts, run-harness.mjs, MEASURED.md, `.build/assembler.mjs`): zero hits outside MEASURED.md's own reporting of the zero-hit grep. | **PASS** — same grep, same result. |
| 9 | edge-runtime compatible, no Node builtins in `assembler.ts` | **PASS** — zero Node-builtin patterns (`require(`, `node:*`, `process.env`, `Buffer`) in `assembler.ts`. Verified stronger: `deno check` + `deno run` execute the exact file with byte-identical output vs Node (`MEASURED.md` §0). | **PASS** — same grep clean on `assembler.ts` (Node builtins only appear in `run-harness.mjs`, which is the harness, out of scope for this rule). Verification method is a `deno bundle` transpile to `.build/assembler.mjs` consumed by the Node harness — a mechanical build step, lower audit-directness than cand-live's zero-build approach but not a compliance failure. |
| 10 | load-shed order matches `PARITY-SPEC.md` §3 | **PASS** — ladder (`:899-907`): `B8 → B9 → B4(older day) → B5(3500→1800) → B10b(desc) → B10a(desc) → P16`. Matches spec order 1–7 exactly. | **PASS** — `SHED_LADDER` (`:606-615`): identical order, same seven steps. |

---

## 2. The named DQ, traced

**Criterion 4 (Hard Rule, `CONTRACT.md` line 31): "Post-fetch allowlist assertion that THROWS
on violation (assertion, not control)."**

**cand-live — PASS, verified end to end.** `assertScoped`/`assertExactlyOneRow` tag their errors
`Error.name = 'AssertionViolation'` (`:165-169`, `:194-205`). Every settled job is walked and any
`AssertionViolation` is rethrown (`:660-663`) **before** the P15-unreachable→stale-fallback branch
is even reached (`:666-682`) — the throw-loop runs first in source order, so a tenancy violation
on P15 can never fall through to `[STALE: ...]`. Same for the tier-index rebuild path (`:620-656`).
cand-live's own `MEASURED.md` §6 documents having *found and fixed* exactly this defect in an
earlier build ("the rejection was caught by the `P15 unreachable → serve stale` branch... An
assertion that can be caught by a fallback is not an assertion") — corroborating evidence they
specifically tested for it, not merely got it right by accident.

**cand-memo — FAIL. Two independent instances of the assertion being swallowed:**

1. **Unconditional swallow for B9/B10a/B10b/every non-P15 block.** `assertAllowlist` throws
   `AllowlistViolation` (`:331-338`, called at `:480` B9, `:511` B10a, `:521` B10b). But
   `fetchAll`'s `settled.forEach` (`:571-573`) catches **every** rejection — assertion or
   ordinary network failure alike — and reduces it to a string in `out.errors[id]`. Only P15's
   error is re-escalated (`:576`); B9/B10a/B10b's tenancy violations are **always**, unconditionally,
   rendered as a cosmetic `[B9 compaction proposals: unavailable — allowlist_violation: ...]` line
   (render sites `:687`, `:705`, `:722`) and the turn proceeds normally. This is not "swallowed by a
   fallback" — it is never wired to fail the turn in the first place.
2. **Conditional swallow for P15, via the stale-fallback catch.** `fetchAll` discards the error's
   type when building the P15 throw (`:572` stringifies, `:576` wraps in a plain `new Error(...)`).
   That plain error propagates through `build`/`runBuild` to `assembleSystemPrompt`'s
   `catch (e) { if (LAST_GOOD && ...) { memo = LAST_GOOD; cacheState = "stale"; ... } else { throw e; } }`
   (`:939-947`). Since there is no type tag to distinguish "P15 tenancy assertion violated" from
   "P15 REST 500'd," **any warm turn with a cached `LAST_GOOD`** (i.e. every turn after the first)
   will silently downgrade a P15 tenancy violation to a `[STALE: ...]`-labelled turn instead of
   failing closed. Only a cold-start poisoning (no `LAST_GOOD` yet) would still throw, because the
   `else` branch fires. This is the exact failure class cand-live's own MEASURED.md names and had
   already fixed in its own earlier iteration — cand-memo ships it live.

**Verdict: cand-memo fails Hard Rule 4 as shipped.** This is a DQ under `CONTRACT.md`'s own list,
not a stylistic nit — it is the named pattern the panel was specifically briefed to hunt.

---

## 3. Adjudication — the "nonce appears exactly twice" claim (INJECTION-SAFETY §3.3/§6.4)

Read `INJECTION-SAFETY.md` §2.3 (framing bytes) against §3.3/§6.4's literal "exactly twice
(opener + closer)" claim. Counted occurrences of the nonce placeholder in the mandated §2.3
framing text: the opening sentence ("The material between `<<<IVAN-MEMORY-{nonce}>>>` and
`<<<END-IVAN-MEMORY-{nonce}>>>` is...") names it **twice**, and the later sentence ("The only
closing delimiter for this turn is `<<<END-IVAN-MEMORY-{nonce}>>>`.") names it **once more** —
three occurrences inside the framing alone, plus the opener and the closer = **5**, not 2.

**Ruling: cand-live's claim is correct.** §3.3/§6.4's "exactly twice" is arithmetically
impossible against the very framing bytes the same document (§2.3) mandates be shipped
byte-for-byte. This is a genuine spec self-contradiction, not a candidate misreading.

Both candidates independently found this and both resolve it soundly, by different means:

- **cand-live** (`:354-365`, `:942-947`) hardcodes `NONCE_SCAFFOLD_OCCURRENCES = 5` with an
  inline comment deriving the count, and asserts `(a)` zero nonce hits inside any escaped body
  and `(b)` total occurrences === 5.
- **cand-memo** (`:984-1001`) derives the expected count **dynamically** by composing an empty
  envelope (`compose(nonce, ts, "", [])`) and counting the nonce in that scaffold — self-adjusting
  if the framing text ever changes, rather than a constant that would silently go stale.

Both are correct implementations of the real invariant ("no body ever carries the nonce; the
scaffolding count is whatever the framing text actually produces"). cand-memo's dynamic derivation
is the more maintainable of the two and is worth grafting into cand-live regardless of which
candidate wins. Recommend Phase 3 correct `INJECTION-SAFETY.md` §3.3/§6.4 to state the invariant
this way, per both candidates' independent recommendation.

---

## 4. Ranking

1. **cand-live** — passes every criterion in the table, including the one Hard Rule this seat was
   specifically primed to hunt (§2), and its own measurement artifact shows it was tested against
   that exact failure mode rather than accidentally correct.
2. **cand-memo** — DISQUALIFIED on Hard Rule 4. Everything else it does (per-tier queries,
   collision pinning, A3, load-shed order, framing/escaping, no-secret, edge-runtime, cap
   discipline) passes cleanly and in several places (byte-stable ordering, dynamic nonce-count
   derivation, real differential token measurement) shows stronger engineering than cand-live. The
   DQ is narrow but structural: its post-fetch allowlist assertion does not reliably fail the turn,
   which is the one property `CONTRACT.md` treats as non-negotiable.

**Winner on spec fidelity: cand-live**, conditional on the panel weighing this seat's Hard-Rule DQ
as decisive (it is listed as a DQ item, not a scored criterion, in `CONTRACT.md`).

---

## 5. Named grafts (cand-memo → cand-live, worth taking regardless of the DQ)

1. **The single graft cand-memo needs to survive a fix loop**: adopt cand-live's
   `Error.name = 'AssertionViolation'` tagging (`cand-live/assembler.ts:165-169`) and check it
   *before* any stale/absent/unavailable branch is consulted, for every block that calls
   `assertAllowlist`/`UniquenessViolation`, not just P15.
2. **`sources-as-of=<max updated_at>` header instead of a wall clock**
   (`cand-memo/assembler.ts:802-812`, esp. `:826-838`) — strictly more honest than cand-live's
   `assembledIso` wall-clock header (`cand-live/assembler.ts:710,716-724`) and costs nothing to
   adopt even though cand-live doesn't depend on prompt-cache hits working.
3. **Dynamic nonce-scaffold-count derivation** (`cand-memo/assembler.ts:984-1001`) over cand-live's
   hardcoded `NONCE_SCAFFOLD_OCCURRENCES = 5` (`cand-live/assembler.ts:365`) — see §3.
4. **Single-flight in-flight-promise coalescing** (`cand-memo/assembler.ts:INFLIGHT`, `:927-936`) —
   a real concurrency win cand-live lacks, safe to graft once grafts #1 is in place.
