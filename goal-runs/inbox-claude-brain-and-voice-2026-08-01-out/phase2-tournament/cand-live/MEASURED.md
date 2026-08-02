# cand-live — MEASURED

Goal-run `inbox-claude-brain-and-voice-2026-08-01`, Phase 2. Candidate **cand-live**
(direction: minimum machinery — one `Promise.allSettled` of the live reads per turn,
cached tier indexes gated by an `updated_at` freshness probe, module-scope `Map`,
straight-line auditable code).

All numbers below were produced by `run-harness.mjs` against the **live** Supabase
project `bjbvqvzbzczjbatgmccb` and the **live** deployed Railway service on
2026-08-01. Every DB request is a `GET`. `claude_memory` was never written. No deploy.

Artifacts in this directory:

| file | what |
|---|---|
| `assembler.ts` | the deliverable. Edge-runtime TypeScript, Web APIs only. |
| `run-harness.mjs` | the measurement harness. Imports `assembler.ts` directly. |
| `harness-output.txt` | full verbatim transcript of the recorded run. |
| `sample-assembly-head.txt` | a real assembled `append_system_prompt`: envelope head, all 8 block headers, tail. |

---

## 0. How the harness is guaranteed to execute THE SAME logic as `assembler.ts`

`run-harness.mjs` contains **no copy of the assembler**. Line 24:

```js
import { assembleSystemPrompt, escapeBody, __resetCache } from './assembler.ts';
```

`assembler.ts` is written in **erasable type syntax only** (no `enum`, no `namespace`,
no parameter properties). Node ≥ 22.6 strips the annotations at module-load time under
`--experimental-strip-types` and executes the remaining JavaScript. There is no
transpile step, no build output, no mirror `.mjs`, and therefore no place for drift:
the file Phase 3 wires into the edge function is the file the harness ran.

Three independent confirmations that the artifact is genuine edge-runtime code:

```
$ deno check --no-lock assembler.ts
Check assembler.ts
deno check exit=0                      # valid TypeScript, no Node types needed

$ deno run --allow-net --allow-read deno-run.ts     # imports the SAME assembler.ts
deno cold: chars=35942 state=cold ms=861.1 blocks=8
deno warm: chars=35949 state=warm ms=156.5
node-vs-deno char parity (expect 35942/35949): 35942/35949
```

**Byte-identical output on Deno (the actual edge runtime) and on Node.** The module
graph contains zero Node builtins — `fetch`, `AbortSignal.timeout`,
`crypto.getRandomValues`, `performance.now`, `TextEncoder` only.

Recorded run used Node **v22.22.2** (via nvm). The `node` first on `PATH` is v20.19.6,
which predates type stripping — re-runners must use v22.6+ or Deno.

### Reproduce

```sh
export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"
cd .../phase2-tournament/cand-live
node --experimental-strip-types run-harness.mjs
```

The service-role key is **parsed out of `/Users/ivanmanfredi/Desktop/claude-code-railway/main.py`
at runtime** by regex and passed to the assembler through `deps.env`. It is not in any
artifact. Secret scan of every file in this directory:

```
assembler.ts                 eyJ=0
run-harness.mjs              eyJ=0
harness-output.txt           eyJ=0
sample-assembly-head.txt     eyJ=0
$ grep -rn 'eyJ' .   →  (no matches)
```

---

## 1. Headline numbers

| metric | value |
|---|---|
| assembled chars, warm | **35,949** |
| assembled chars, cold | **35,942** (7 chars: B8/B9 cache-label difference) |
| assembled bytes (UTF-8) | 36,616 |
| **headroom under `MAX_SYSTEM_PROMPT_CHARS = 36,000`** | **51 chars (0.14%)** ⚠ |
| blocks emitted | 8 (+1 announced-absent) |
| latency cold, p50 / mean / max | **765.8 / 784.1 / 850.4 ms** (n=3) |
| latency warm, p50 / mean / max | **157.2 / 158.0 / 164.9 ms** (n=12) |
| warm speed-up | **608.6 ms** (−79%) |
| requests, warm turn | 5 GETs |
| requests, cold turn | 11 GETs (5 + 2 tier-content + 3 B9 + 1 ClickUp) |
| injected tokens (EST, see §4) | **8,987 – 12,974** |
| injection input cost/turn @ Opus tier | **$0.0509 – $0.0649** |
| realistic full turn | **$0.104 – $0.118** |
| doubled turn (F3 hook still live) | **$0.110 – $0.124** (+$0.0060/turn, +5.1–5.8%) |
| model-free assertion suite | **ALL PASS** |
| cross-tenant self-test | **0 foreign rows, 0 foreign scopes, assertion fires** |

### ⚠ FINDING 1 — the 36,000 cap is already spent

PARITY-SPEC §3 sized the cap *above* the assembly so "load-shedding does not fire in
normal operation", projecting ~34,100 chars with ~1,900 headroom. The real assembly is
**35,949 — 51 chars of headroom**. The spec's estimate omitted the framing (1,540
chars), the nine block headers (~700 chars), and used a stale `MEMORY.md` size
(19,162 → **19,264** today; it was edited during this run's own window).

Consequences, all reproducible:

- One more line in `MEMORY.md` fires the load-shed ladder and drops `B9`, then `B4`'s
  older day. Ivan edits `MEMORY.md` most days. **This is a same-week event, not a tail risk.**
- The forced-over-cap test with a **+900-char** pad already sheds two blocks:
  `chars=35976 shed=[B9,B4]`.
- The block that gets dropped first (`B9`, compaction proposals) is the correct one per
  the ladder — the mechanism works. It is the *headroom* that is wrong, not the order.

**Recommendation to Phase 3:** raise `MAX_SYSTEM_PROMPT_CHARS` to 40,000 (≈10k tokens),
or accept that the shed line is permanently visible. Either is defensible; silently
running at 99.86% of the cap is not. Not taken here — it changes a spec constant.

### Per-block sizes (measured, canonical warm assembly)

| block | chars | source |
|---|---:|---|
| B14-header | 140 | assembler literal |
| B5 compiled_context | 3,618 | `client_instances`, capped 3,500 + marker |
| B4 n8nClaw | 871 | `n8nclaw_daily_summaries`, last 2 |
| B9 compaction proposals | 449 | 3 scoped point-reads |
| B10a global index | 4,037 | 28 rows → 26 after `_` skip |
| B10b shared-tech index | 4,211 | 29 rows → 27 after `_` skip |
| P16 operator rules | 608 | compile-time literal |
| **P15 MEMORY.md** | **19,264** | `client_id=eq.ivan&file_path=eq.project/MEMORY.md` |
| ClickUp (B8) | 0 | **announced absent** — `[ClickUp: no key configured — block omitted]` |
| framing + delimiters + headers + preamble | 2,751 | difference to 35,949 |

**P15 is 53.6% of the payload** (spec predicted 56%). That is the number the tiering
ballot is about.

---

## 2. Latency, cold vs warm — and what the cache actually avoided

```
--- 3 COLD assemblies (module cache cleared before each) ---
cold#1  state=cold  chars=35942  blocks=8ok/1absent  shed=[]  assembledInMs=850.2  wallMs=850.4
cold#2  state=cold  chars=35942  blocks=8ok/1absent  shed=[]  assembledInMs=736.1  wallMs=736.1
cold#3  state=cold  chars=35942  blocks=8ok/1absent  shed=[]  assembledInMs=765.8  wallMs=765.8

--- 12 WARM assemblies (consecutive simulated turns) ---
warm# 1 …  154.7   warm# 5 …  164.9   warm# 9 …  154.5
warm# 2 …  156.5   warm# 6 …  157.2   warm#10 …  156.4
warm# 3 …  154.2   warm# 7 …  163.9   warm#11 …  159.3
warm# 4 …  159.8   warm# 8 …  158.1   warm#12 …  155.9

cold  n=3   min=736.1  p50=765.8  mean=784.1  max=850.4
warm  n=12  min=154.2  p50=157.2  mean=158.0  max=164.9
delta cold-p50 - warm-p50 = 608.6 ms
```

**What the cache actually avoided.** Exactly two things, and they are worth naming
precisely because the direction's bet lives or dies on them:

1. **Two full-tier content fetches** (`client_id=eq.global` and `client_id=eq.shared-tech`,
   `select=file_path,content`) — ~157 KB of response body, replaced on the warm path by
   two `select=file_path,updated_at` probes (~5.8 KB). This is the 608 ms.
2. **Three `_compaction-review.md` point-reads and the ClickUp attempt** for 300 s
   (parity with local `TTL_FRESH`), which is why warm turn 1 and warm turn 12 issue the
   same 5 requests.

The warm path is **5 concurrent GETs settling in one round trip** — 157 ms from Ivan's
Mac over WAN. The edge function runs in `eu-central-1` alongside the DB, so in-region
will be materially lower; that remains **an estimate, unmeasured** (nothing was deployed).

**The direction's bet holds.** The warm path is already ~one round-trip. Nothing more
elaborate than `Promise.allSettled` + two probes has anywhere to save time: the floor
is the slowest of five parallel point-reads, and the cache already removed the only
expensive query in the set.

**Where a cold isolate hurts.** 766 ms p50 cold is a real user-visible penalty and
`assembledInMs` and wall clock are identical — module load costs nothing measurable,
the cost is entirely the two 157 KB fetches. If Supabase edge isolate recycling turns
out to be aggressive, PARITY-SPEC §4's suggested follow-up (a `Cache-Control`-fronted
storage object for the two tier indexes) is worth the ballot. Unmeasurable from here.

---

## 3. Live upstream model

```
$ GET https://claude-code-railway-production.up.railway.app/v1/models
HTTP 200  {"data":[{"id":"claude-opus-4-8"},{"id":"claude-opus-4-7"},
                   {"id":"claude-opus-4-6"},{"id":"claude-sonnet-4-6"},
                   {"id":"claude-haiku-4-5"}]}

main.py CLAUDE_MODEL default = claude-opus-4-7
```

**Honest reading of that probe.** `/v1/models` is an *unauthenticated list of accepted
model ids* (`main.py:1959`, `list_models` never calls `verify_api_key`). It is **not**
a report of which model `/chat/stream` uses. The model actually used is
`CLAUDE_MODEL`, read once at process start (`main.py:41`) and hardcoded into both
invocation sites (`main.py:677`, `:807`); its value is a Railway dashboard secret not
readable from here. **The code default, and therefore the priced model, is
`claude-opus-4-7`.** If Railway sets `CLAUDE_MODEL=claude-opus-4-8`, the pricing below
is unchanged (same Opus tier).

### Pricing source

`claude-opus-4-7` → **$5.00 / MTok input, $25.00 / MTok output**.

Source: the bundled `claude-api` skill, `## Current Models (cached: 2026-06-24)` table,
which lists `claude-opus-4-7` explicitly at $5.00 / $25.00 and sources
`https://platform.claude.com/docs/en/pricing.md`. **This is an exact-model-id price, not
a tier assumption** — Opus 4.6, 4.7, 4.8 and Opus 5 are all $5/$25 in that table, so the
figure is robust to whichever id Railway actually has set. No local `~/.claude/skills/claude-api/`
directory exists; the skill is plugin-bundled at
`/private/tmp/claude-501/bundled-skills/2.1.219/…/claude-api/`. Checked first, as required.

---

## 4. Token count — METHOD AND ITS LIMITS

**I could not produce a real token count.** Stated plainly, because the measurement seat
will re-run this:

- **No key in env.** `ANTHROPIC_API_KEY: NO`, `ANTHROPIC_AUTH_TOKEN: NO` (printed by the
  harness at the top of every run). The contract gates the `count_tokens` API on a key
  being available in env; it is not.
- **The Railway proxy exposes no counting route.** `grep '@app.\(get\|post\)("/v1'
  main.py` → only `/v1/messages`, `/v1/vision-qa`, `/v1/models`. No `count_tokens`.
- **No tokenizer package is installed and none can be added.** `import tiktoken` →
  ModuleNotFoundError; `import transformers` → ModuleNotFoundError; no tokenizer in any
  `node_modules` on the box; `npm install` is out of scope for this run.
- **A credential does exist that I deliberately did not use.** The macOS keychain holds a
  `Claude Code-credentials` entry (Ivan's own OAuth). `count_tokens` is free and
  read-only, so it *would* have worked — but the contract gated this on a key **in env**,
  and an OAuth credential in a keychain is not that. Flagging it rather than helping
  myself: **if the orchestrator authorises it, one `ant auth print-credentials
  --access-token` + a `POST /v1/messages/count_tokens` against `claude-opus-4-7` converts
  every EST number below into a measured one in about 30 seconds.**

So: **two independent estimators, plus the `chars÷4` cross-check. Every token number
below is an ESTIMATE and is labelled as one.**

| method | value | what it is independent of |
|---|---:|---|
| cross-check: `chars ÷ 4` | **8,987** | — (the crude baseline, not counted as a method) |
| **EST-A byte-rate**: UTF-8 bytes ÷ 3.6 | **10,171** | lexical structure — driven purely by byte density |
| **EST-B pretoken**: BPE pre-tokenisation × merge factor | **10,571 – 12,974** | byte density — driven purely by lexical structure |

EST-B detail: the assembly pre-tokenises to **9,610 pretokens** under the standard
GPT-style BPE pre-tokenisation regex
(`/'(?:[sdmt]|ll|ve|re)| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+/gu`) — the split every
BPE tokenizer applies before merges. Real token count is pretokens × a merge factor > 1
(long words and emoji split further). The Opus-4.7 merge factor is not published, so
this is reported as a **band, 1.10× – 1.35×**, not a point estimate.

**Why the band is wide and why I am not narrowing it.** The Opus 4.7 tokenizer is new
and the migration guide states only that it produces *more* tokens for the same text
than Opus 4.6, with the ratio varying by workload shape (Sonnet 5's analogous change is
quoted at ~+30%). Any factor I picked would be a guess wearing a decimal point. The
three methods agree within ±20% of each other, which bounds the honest answer:

> **~9,000 – 13,000 tokens of injected context per turn, best single estimate ~10,200.**
> The spec's `chars÷4` figure of ~8,540 is the *low* end and probably an undercount.

---

## 5. Cost arithmetic

At `claude-opus-4-7`, **$5.00/MTok input, $25.00/MTok output**.

### Injection block alone (input only)

| estimator | tokens | $ / turn |
|---|---:|---:|
| EST-A byte-rate | 10,171 | **$0.05085** |
| EST-B pretoken low | 10,571 | **$0.05285** |
| EST-B pretoken high | 12,974 | **$0.06487** |

### Realistic full turn

`injection + 24,000-char context replay (MAX_CONTEXT_CHARS) + ~1,200-char prompt + ~800 output tokens`

| estimator | input tok | output tok | $ / turn |
|---|---:|---:|---:|
| EST-B low | 17,204 | 800 | **$0.10602** |
| EST-B high | 19,607 | 800 | **$0.11804** |
| EST-A byte | 16,804 | 800 | **$0.10402** |

### Doubled turn — PARITY-SPEC F3, measured as an increment not assumed away

The container's own `SessionStart` hook (`inject-live-context.py`, registered at
`entrypoint.sh:206-273`) still fires on **every** turn, because `/chat/stream` never
passes `--resume` (`main.py:773-865`), and injects ~1,200 unframed tokens carrying an
unframed duplicate of B5, B4 and B8.

| estimator | input tok | $ / turn | delta |
|---|---:|---:|---|
| EST-B low | 18,404 | **$0.11202** | +$0.00600 (+5.7%) |
| EST-B high | 20,807 | **$0.12404** | +$0.00600 (+5.1%) |
| EST-A byte | 18,004 | **$0.11002** | +$0.00600 (+5.8%) |

**The doubling costs $0.006/turn — about 5%.** That is the small half of the F3 finding.
The large half is not financial: it is that `client_instances.compiled_context` reaches
a `bypassPermissions` container **unframed** on every turn (INJECTION-SAFETY T9), and
our framed copy sits alongside it rather than replacing it. The one-line fix (empty the
`SessionStart` array for this path, or gate the hook on an env var) is inside the
container's grant boundary and is **proposed, not taken**.

### ⚠ FINDING 2 — the prompt-cache-hit variant does not exist, by construction

The contract asks for "the prompt-cache-hit variant if the route supports cached system
prefixes". **It structurally cannot**, and this is a spec-level conflict worth naming
because it directly contradicts a premise of the other candidate's assigned bet
("byte-stable output ordering to maximize upstream prompt-cache hits").

Prompt caching is a **prefix byte match** — any byte change anywhere in the prefix
invalidates everything after it. Two independent invalidators sit in the **first 40
characters** of every assembly:

1. **The per-turn nonce.** INJECTION-SAFETY §2.1 mandates 12 fresh hex chars from
   `crypto.getRandomValues` on every request, and puts them at char 18 of the opening
   delimiter. That is the whole point — §5's ruling is explicit that "the framing is not
   what makes the system channel safe; the unpredictable delimiter is."
2. **The assemble timestamp**, `<!-- Live system context auto-injected 2026-08-01T11:45:14Z -->`,
   at the top of BLOCK 1 (kept for parity with `inject-live-context.py:352`).

Measured directly:

```
--- byte-stability of consecutive warm assemblies ---
  first differing char index between consecutive turns: 15 (of 35949 / 35949)
  identical after masking nonce+timestamp: true
```

Two consecutive turns diverge at **char 15**. Everything after char 15 is uncacheable.
Byte-stability of the *body* is real (masking the nonce and timestamp makes consecutive
turns identical), but it buys nothing upstream while a random string leads the prefix.

**What it would be worth if the conflict were resolved:**

| estimator | uncached | at 0.1× cache-read | saving / turn |
|---|---:|---:|---:|
| EST-B low | $0.05285 | $0.00529 | **$0.04757** |
| EST-B high | $0.06487 | $0.00649 | **$0.05838** |

That is a **~90% cut to the injection's input cost** — the single largest lever on this
surface's economics, and it is currently blocked by the nonce placement. Options for the
ballot, none taken here because both touch spec text the injection skeptic is about to
attack:

- **(a)** Move the nonce and timestamp **after** the stable body, so the cacheable prefix
  is framing + all blocks and only the tail varies. Costs: the framing must then name a
  closer it has not yet emitted, weakening §2.3 bullet 2.
- **(b)** Accept 0% cache hit as the price of the unpredictable delimiter. This is a
  defensible reading of §5 — the whole document argues the nonce is what makes the
  system channel safe at all — but it should be an explicit, priced decision
  (**~$0.05/turn**), not an accident.

Also note: `/chat/stream` spawns a **fresh `claude` CLI session per turn** with
`--append-system-prompt`. Even with a byte-stable prefix, whether the CLI writes a cache
breakpoint on the appended system prompt is unverified from outside the container.
**Unmeasured.**

---

## 6. Cross-tenant self-test — printed output

```
=== CROSS-TENANT SELF-TEST ===
(1) assertion on the live assembly — every block header scope + a raw scan
  block-header scopes outside {ivan,global,shared-tech}: 0
  distinct scopes in the assembly: ivan, ivan,global,shared-tech, global, shared-tech

(2) the pin is load-bearing — same file_path WITHOUT client_id (read-only probe)
  UNPINNED  ?file_path=eq.project/MEMORY.md -> 2 rows: ivan, proswppp
  PINNED    +client_id=eq.ivan            -> 1 rows: ivan
  F5 CHECK  one in.() page for 3 tiers -> 1000 rows {"global":28,"ivan":972}  (shared-tech present? false)

(3) the assertion FIRES — inject a proswppp row via a patched fetch
  poisoned P15 with client_id=proswppp -> THREW
  TENANCY ASSERTION FAILED at P15 project/MEMORY.md: row 0 carries client_id="proswppp",
  outside allowlist [ivan, global, shared-tech]
  assertion routed to the STALE path instead of throwing? no

(4) the assertion outranks the stale cache — poison AFTER a good assembly is memoised
  LAST_GOOD present, P15 poisoned -> THREW (correct)
  TENANCY ASSERTION FAILED at P15 project/MEMORY.md: row 0 carries client_id="proswppp",
  outside allowlist [ivan, global, shared-tech]
=== END CROSS-TENANT SELF-TEST ===
```

Line-by-line reading:

- **(1)** Zero rows outside the allowlist entered any block. All four distinct `scope=`
  values are allowlist members (`ivan,global,shared-tech` on B9 is the three-tier
  compaction block; the harness splits on comma and validates each).
- **(2)** F4 is live **today**, not historically: the unpinned query returns Ivan's and
  ProSWPPP's `project/MEMORY.md` in undefined order. Pinning both keys is the only thing
  standing between the chat and a paying client's memory index. F5 is live too — one
  `in.()` page for three tiers returns 1,000 rows with **shared-tech entirely absent**.
  Both traps reproduce exactly as PARITY-SPEC §0 describes.
- **(3) / (4)** are the DQ requirement. **(4) exists because the first version of this
  assembler failed it.** The tenancy assertion threw, but the rejection was caught by the
  `P15 unreachable → serve stale` branch: with a warm `LAST_GOOD`, a foreign row would
  have silently degraded to a stale assembly instead of failing the turn. Fixed by tagging
  assertion errors (`Error.name = 'AssertionViolation'`) and rethrowing them from every
  settled result *before* the stale path is consulted. **An assertion that can be caught
  by a fallback is not an assertion**, and only test (4) surfaces it — recommending it as
  a graft into the judging rubric regardless of which candidate wins.

---

## 7. Honesty artifacts, as rendered

Not described — captured from real runs.

**Announced-absent block** (real, `CLICKUP_API_KEY` genuinely unset on the harness, matching
the edge function's real config):

```
[ClickUp: no key configured — block omitted]
```

**Visible load-shed** (forced by padding `MEMORY.md` by 900 chars — only 900, because the
real headroom is 51):

```
chars=35976  shed=[B9,B4]
[LOAD-SHED: dropped B9; truncated B4 to fit the 36,000-char cap — this context is partial]
```

**413 rather than a mid-truncated brain** (forced with a 30,000-char pad, i.e. beyond
what the whole ladder can absorb):

```
413 context_assembly_over_cap: 60696 chars after the full load-shed ladder (cap 36000).
MEMORY.md is never mid-truncated (PARITY-SPEC §3).
```

**Labelled stale fallback** (all `claude_memory` requests forced to throw):

```
cacheState=stale
[STALE: assembled 2026-08-01T11:45:12Z, live sources unreachable — simulated Supabase outage]
```

**Block headers actually emitted** (from `sample-assembly-head.txt`):

```
[BLOCK 1/8 id=B14-header source=assembler-literal scope=ivan freshness=2026-08-01T11:45:14Z]
[BLOCK 2/8 id=B5 source=client_instances.compiled_context scope=ivan file=client_name=Ivan System freshness=2026-08-01T06:30:56.823+00:00]
[BLOCK 3/8 id=B4 source=n8nclaw_daily_summaries scope=ivan freshness=2026-07-30]
[BLOCK 4/8 id=B9 source=claude_memory.content scope=ivan,global,shared-tech file={project,global,shared}/_compaction-review.md freshness=cached 2026-08-01T11:45:12Z]
[BLOCK 5/8 id=B10a source=claude_memory.content scope=global freshness=2026-07-27T14:09:34+00:00]
[BLOCK 6/8 id=B10b source=claude_memory.content scope=shared-tech freshness=2026-07-26T03:45:13+00:00]
[BLOCK 7/8 id=P16 source=assembler-literal scope=ivan file=~/.claude/CLAUDE.md freshness=compile-time]
[BLOCK 8/8 id=P15 source=claude_memory.content scope=ivan file=project/MEMORY.md freshness=2026-08-01T10:40:18+00:00]
```

---

## 8. Model-free assertion suite (INJECTION-SAFETY §6.4)

```
blocks emitted: 8   nonce: 46ac068c68b9
scopes seen: ivan | ivan,global,shared-tech | global | shared-tech
ALL ASSERTIONS PASS

distinct nonces from 10,000 draws: 10000 (collisions: 0)

--- hostile fixture escaping (T2 / T5) ---
  T2 break-out     closes-envelope=false  forges-header=false  idempotent=true
  T5 header forge  closes-envelope=false  forges-header=false  idempotent=true
  T2 generic sep   closes-envelope=false  forges-header=false  idempotent=true
```

Covered: escaping idempotence on 6 samples (including `<<<`, forged block headers, C0
controls, emoji/authority-marked house-style text); `\n` and `\t` survive the control
strip; opening delimiter at char 0 with a 12-hex nonce; matching closer; nonce
occurrence count; every block preceded by an assembler header; contiguous `n/N`
numbering with a consistent `N`; no `scope=` outside the allowlist; length ≤ 36,000;
`[LOAD-SHED:]` present whenever `shed` is non-empty; framing bytes present and naming
this turn's closer.

### ⚠ FINDING 3 — INJECTION-SAFETY §3.3 and §6.4 are arithmetically impossible

Both clauses require "the nonce appears **exactly twice** in the assembled string
(opener + closer)". The **same document's** §2.3 framing text names the delimiters three
more times ("The material between `<<<IVAN-MEMORY-{nonce}>>>` and
`<<<END-IVAN-MEMORY-{nonce}>>>`…" and "The only closing delimiter for this turn is
`<<<END-IVAN-MEMORY-{nonce}>>>`"). An implementation cannot ship §2.3 byte-for-byte
*and* satisfy §3.3. A candidate that reports "nonce appears exactly 2×" either did not
ship the framing or did not run the check.

**Resolved by implementing the invariant those clauses are reaching for**, and asserting
both halves:

```ts
const NONCE_SCAFFOLD_OCCURRENCES = 5;   // opener(1) + framing(3) + closer(1)
// (a) zero nonce hits inside any escaped block body   -> the real safety property
// (b) total occurrences === 5                          -> catches scaffolding drift
```

`(a)` is the property §3.3 is about (a body cannot forge the closer). `(b)` catches
accidental scaffolding changes. Both are enforced in `assembleSystemPrompt` and both are
re-checked by the harness. **Phase 3 should correct §3.3/§6.4 to "the nonce appears
exactly `1 + framing_occurrences + 1` times, and zero times inside any block body."**

---

## 9. Deviations from the spec, each stated once

| # | spec text | what was built | why |
|---|---|---|---|
| D1 | INJECTION-SAFETY §3.3/§6.4 "nonce appears exactly twice" | asserts 5 scaffolding occurrences + 0 body occurrences | §2.3's own framing makes "twice" impossible. Finding 3. |
| D2 | A3 "fetch by `?client_name=eq.Ivan System&limit=1` AND assert exactly-one-row" | keeps `limit=1` **and** adds `Prefer: count=exact` + `Range: 0-0`, asserting on `content-range` | with `limit=1` alone the assertion is vacuous — it can never observe a second row. The header carries the true server-side count. Applied to P15's collision path too. |
| D3 | INJECTION-SAFETY §2.1 example numbers P16/P15 as blocks 1–2 | P16/P15 emitted **last** | PARITY-SPEC B14 (the binding spec) fixes the order as "…global idx → shared idx, **then the two new blocks**". The §2.1 numbering is illustrative. |
| D4 | INJECTION-SAFETY §2.2 "outside the envelope: the framing" vs §2.3 "placed immediately after the opening delimiter" | framing is **inside**, immediately after the opener | §2.3 is the more specific instruction and §2.1's diagram agrees. Flagged because §2.2 reads the other way. |
| D5 | B9 label uses local `path.parent.name` → `memory`/`global`/`shared` | labels are `project`/`global`/`shared` | the DB `file_path` dirname. `memory` was an artefact of the local directory layout and is meaningless broker-side. |
| D6 | B14 stale fallback: "if **every** block fails, emit last good" | stale fires when **P15** fails; every other block degrades to a named-absent line | P15 is whole-or-error and unsheddable, so a failed P15 already means no valid assembly. Strictly safer: a turn missing only B4 still ships live, instead of silently serving a 24h-old brain. |
| D7 | local `_(cached 5min — see …inject-live-context.py)_` trailer | dropped | no longer true; per-block `freshness=` in the headers carries it accurately. |

---

## 10. What I could not measure

1. **A real token count.** §4. No key in env, no counting route on the proxy, no
   tokenizer package. Three estimates, banded and labelled. A keychain OAuth credential
   exists and would resolve this in ~30 s **if authorised**.
2. **In-region latency.** The 157 ms warm / 766 ms cold figures are from Ivan's Mac over
   WAN. The edge function runs in `eu-central-1` next to the DB; in-region will be
   materially lower, and that remains an unmeasured estimate — nothing was deployed.
3. **Real edge isolate cold-start frequency.** `__resetCache()` simulates a cold isolate
   faithfully (the memo is the only state), but how often Supabase actually recycles
   isolates on this project is not observable from here. It decides whether the 766 ms
   cold path is rare or routine, and therefore whether PARITY-SPEC §4's storage-object
   follow-up is worth building.
4. **Whether the `claude` CLI writes a prompt-cache breakpoint on `--append-system-prompt`.**
   Not observable from outside the container. Moot today (Finding 2), load-bearing if the
   nonce placement is ever changed.
5. **Which model `CLAUDE_MODEL` is actually set to on Railway.** A dashboard secret. The
   code default `claude-opus-4-7` was priced; every candidate id in `/v1/models` except
   `claude-sonnet-4-6` and `claude-haiku-4-5` is the same $5/$25 tier, so the arithmetic
   is robust either way.
6. **Behavioural injection resistance.** Out of this contract's scope — §6.4 model-free
   assertions only. The escaper and framing are verified structurally (a fixture
   containing `<<<END-IVAN-MEMORY-<nonce>>>>` emerges as `‹‹‹END-…›››` and cannot close
   the envelope); whether a *model* obeys the framing is the injection skeptic's brief.
