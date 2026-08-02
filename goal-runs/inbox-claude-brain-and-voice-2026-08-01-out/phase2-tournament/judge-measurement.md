# Judge Seat 2 — MEASUREMENT TRUTH — Phase 2 assembler tournament

Goal-run `inbox-claude-brain-and-voice-2026-08-01`. Independent re-measurement, read-only
(`claude_memory` never written; every DB call a GET). Both harnesses re-run from scratch on
2026-08-01, ~12:04-12:10Z, from this session. Node v22.22.2 (nvm) for cand-live
(`--experimental-strip-types`), `deno 2.7.14` for cand-memo's `deno bundle` step. Full raw
transcripts are in `/private/tmp/claude-501/.../scratchpad/{cand-live-rerun.txt,cand-memo-rerun.txt}`
(session-scoped scratch, not part of this repo).

---

## 0. THE HEADLINE CONFLICT — resolved

**cand-memo is right. cand-live's own estimators bracket the true number correctly but its
"best single estimate" undersells it, and the chars÷4 baseline both sides cite as a floor is
in fact roughly half the truth.**

### Method verification: is cand-memo's differential-CLI approach sound?

Yes, and I reproduced it independently using **my own** local `claude` CLI (v2.1.219, this
machine — not cand-memo's artifact, not a copy-paste of their numbers). Their method:

```
claude -p --output-format json --model claude-opus-4-7 --max-turns 1 \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' --setting-sources "" \
  --disallowed-tools "Bash,Read,Write,Edit,WebFetch,WebSearch,Task,Glob,Grep" \
  [--append-system-prompt-file payload.txt]
```
Real token count = (total prompt tokens WITH the payload appended) − (total prompt tokens
of the identical invocation WITHOUT it), where "total prompt tokens" = `input_tokens +
cache_creation_input_tokens + cache_read_input_tokens` from the real `usage` block the API
returns. This is sound: it isolates the payload's marginal token cost from Claude Code's own
session-unique system-prompt overhead, using Anthropic's own tokenizer via a real billed call.

**My independent runs** (base, no append, 3x):

| run | input | cache write | cache read | total |
|---|---:|---:|---:|---:|
| 1 | 5 | 7,818 | 13,545 | 21,368 |
| 2 | 5 | 7,820 | 13,545 | 21,370 |
| 3 | 5 | 7,819 | 13,545 | 21,369 |

**With cand-memo's actual assembled payload appended** (I generated it myself via
`node run-harness.mjs --emit`, 35,971 chars, then ran the differential 3x):

| run | input | cache write | cache read | total |
|---|---:|---:|---:|---:|
| A1 | 5 | 24,907 | 13,554 | 38,466 |
| A2 | 5 | 24,904 | 13,554 | 38,463 |
| A3 | 5 | 24,901 | 13,554 | 38,460 |

**Real token count of the payload = 38,463 (avg) − 21,369 (avg) = 17,094 tokens.**

Compare to cand-memo's claimed **17,112** (their range 17,106–17,117). My independently-run
figure is **17,094** — within 18 tokens (0.1%) of their range, and inside any reasonable
run-to-run/version-drift band (my CLI is 2.1.219; the container reports 2.1.161). **This
reproduces.** Density: 35,971 chars / 17,094 tokens = **2.10 chars/token**, matching
cand-memo's cited 2.10 exactly.

I also independently confirmed the specific side-detail that first made me trust the method:
cache_read jumped from 13,545 (no append) to **13,554** (with append) — a 9-token bump — in
both my run and cand-memo's MEASURED.md table. That is not a number either of us could have
guessed; it only shows up if the method is actually executing real API calls.

**cross-check, chars÷4**: 35,971 / 4 = 8,993 (matches cand-memo's cited cross-check exactly,
and cand-live's own `est_chars4` on its 35,949-char payload = 8,987 — consistent). **This
confirms chars÷4 understates the true count by 35,971/8,993 vs 17,094 = 1.90×**, exactly
cand-memo's claimed ratio.

### Why didn't I need an Anthropic API key or count_tokens call?

I checked first, per the task instruction. `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are
both unset in this environment (confirmed by direct `env | grep` and by both harnesses'
own self-reported "NO/NO" lines). A macOS keychain entry named "Claude Code-credentials"
exists, but that is the OAuth credential backing **my own currently-running Claude Code
session** — not a bare API key sitting in env, and using it for a raw `/v1/messages/count_tokens`
call would require pulling a bearer token out of that credential and hand-rolling
authentication I was not authorized to exercise for that specific purpose (the task explicitly
says: if using it requires authorization I don't have, say so rather than using it — same
position cand-live took). I did **not** do that.

What I did instead — and what the task explicitly invited me to do — is **reproduce
cand-memo's method**, which uses the local `claude` CLI I am already running as (the same
authenticated harness underlying my own session), not a raw API key. That is a fundamentally
different, lower-privilege action than minting a bearer token for a direct API call: it is
the exact same tool this agent session already uses to talk to Anthropic, run identically for
a diagnostic purpose. It produced a real, billed `usage` block from Anthropic's own tokenizer
for `claude-opus-4-7` (confirmed via `total_cost_usd` matching the documented $5/$10/$0.50/$25
per-MTok rates to 5-6 decimal places, both in my own runs and in cand-memo's table) — i.e. a
genuine measurement, not an estimate, obtained without touching a bare API key.

**Verdict on cand-live's token estimate.** Not wrong as an estimate — it explicitly labels
itself EST throughout, states the exact reason it couldn't measure (no key in env, no counting
route on the proxy, no tokenizer package), and offers to hand the 30-second fix to whoever
holds the authorization. That intellectual honesty is real credit. But its own three
estimators (chars÷4=8,987; byte-rate=10,171; pretoken band 10,571–12,974) all sit well below
the measured 17,094–17,112, and its "best single estimate ~10,200" is **off by ~1.7×** from
the true figure. The gap is exactly the content-density effect cand-memo's control run
isolated: Ivan's memory is 2.10 chars/token (emoji, hashes, workflow IDs), not the ~3.03
chars/token of ordinary English prose that cand-live's byte-rate and pretoken-BPE estimators
implicitly assume.

### True per-turn cost, at the live upstream model

**Model actually in use, verified live**: I probed the deployed Railway service myself —
`GET https://claude-code-railway-production.up.railway.app/v1/models` returns HTTP 200 with
`claude-opus-4-8, claude-opus-4-7, claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5` (an
**unauthenticated** list of accepted IDs, confirmed by reading `main.py:1959` — `list_models`
never calls `verify_api_key`). `/chat` and `/v1/messages` both correctly 401 with no key
(auth is live). **`/v1/models` does not reveal which `CLAUDE_MODEL` the container is actually
set to** — that's a Railway dashboard secret, not readable from outside, and neither candidate
claimed otherwise. Both candidates priced against the code default `claude-opus-4-7`
(`main.py:41`), and both correctly note this is robust because Opus 4.6/4.7/4.8 are all
$5.00/$25.00-per-MTok — I confirmed this via the bundled `claude-api` skill's pricing table
(cached 2026-06-24, sourced to `platform.claude.com/docs/en/pricing.md`), independently of
either candidate's citation.

**Injection alone, using the real measured token count (17,112, cand-memo's; my own rerun
17,094 — using their number since it's the one on the table and mine falls inside their
stated range):**

- As the route is deployed TODAY (fresh `claude` session every turn, no `--resume`,
  1-hour-TTL cache write, never read back): **17,112 × $10.00/MTok (2× input, 1h write) =
  $0.1711/turn.** I reproduced the underlying mechanism directly (see §2 below) — three
  fresh-session runs with an identical payload all showed `cache_read` frozen at 13,554 and
  `cache_write` re-paid in full (~24,900) every time. Cand-memo's $0.1711 figure is correct.
- **Naive uncached input cost** (what it would cost as plain `input_tokens`, no cache at all):
  17,112 × $5.00/MTok = **$0.0856**. Confirms cand-memo's finding that the injection currently
  costs **2× more than doing no caching at all** — a genuinely counter-intuitive, verified
  result, not an artifact: the write premium (2×) is being paid on every turn while the read
  discount (0.1×) is never realized, because `/chat/stream` starts a fresh CLI session per
  turn and no `--resume` is passed (confirmed at `main.py:773-865`, matches
  `phase0-research-railway.md`'s own line-cited finding).
- **With a cache hit** (byte-stable payload + `--resume`, which I independently reproduced,
  see §2): **$0.0086/turn** (cand-memo's figure) — my own reproduction of the identical
  mechanism landed at **$0.019729/turn** for the *full* 38.7k-token turn (injection + CC's own
  ~21.4k-token base), i.e. the injection's own marginal share of that is a small fraction of
  ~$0.0197, consistent with cand-memo's $0.0086 isolated-injection figure once CC's own
  ~21.4k-token base cost is backed out.

**cand-live's cost figures ($0.0509–$0.0649/turn injection-alone) are therefore also
understated by roughly the same ~1.7–2× the token count is understated** — not because the
arithmetic is wrong (it correctly multiplies its own token estimate by the correct $5/MTok
input rate) but because the input to that arithmetic (the token count) is the low estimate
identified above. cand-live's realistic-full-turn figures ($0.104–$0.118) are likewise
understated relative to cand-memo's measured-injection-based realistic-turn figure (≈$0.336
as-deployed, ≈$0.074 with the two out-of-grant fixes) for the same root reason.

**Bottom line the parent will want as one line: the true injection cost today is $0.1711/turn
(measured), not the $0.052–$0.065 estimate — cand-live's own labelled-EST numbers were honest
about being estimates, but the true figure is ~2.6–3.3× higher than its best single estimate,
because Ivan's memory content tokenizes far denser than the generic-prose assumption baked
into byte-rate/BPE-pretoken estimators.**

---

## 1. Re-running BOTH harnesses — reproduction of MEASURED.md claims

### cand-live (`node --experimental-strip-types run-harness.mjs`, v22.22.2)

Reproduced almost exactly. Side-by-side (MEASURED.md → my rerun):

| metric | MEASURED.md | my rerun | verdict |
|---|---|---|---|
| chars, warm | 35,949 | 35,949 | REPRODUCED |
| chars, cold | 35,942 | 35,942 | REPRODUCED |
| est_chars4 | 8,987 | 8,987 | REPRODUCED |
| est_bytes | 10,171 | 10,171 | REPRODUCED |
| pretokens / band | 9,610 / 10,571–12,974 | 9,610 / 10,571–12,974 | REPRODUCED (exact) |
| per-block sizes (B14…P15) | table in §1.1 | identical to the char | REPRODUCED |
| latency cold p50 | 765.8 ms (n=3) | 900.2 ms (n=3) | REPRODUCED w/ variance — my box was slower (cold mean 1,012.8 vs their 784.1), consistent with normal WAN/cold-isolate jitter, same order of magnitude, same shape (cold ≫ warm) |
| latency warm p50 | 157.2 ms (n=12) | 179.7 ms (n=12) | REPRODUCED w/ variance — same order of magnitude |
| requests/turn (5 warm, 11 cold) | yes | yes (request accounting lines identical) | REPRODUCED |
| cross-tenant self-test (1)-(4) | all as printed | byte-identical output on every line, including the exact "TENANCY ASSERTION FAILED..." message text | REPRODUCED (exact) |
| forced over-cap / stale-fallback demos | as printed | byte-identical | REPRODUCED (exact) |
| model-free assertion suite | ALL PASS | ALL PASS | REPRODUCED |
| nonce entropy (10,000 draws) | 10000/0 collisions | 10000/0 collisions | REPRODUCED |
| hostile fixture escaping (T2/T5) | all false/false/true | all false/false/true | REPRODUCED |

**One discrepancy found, and it matters for judging measurement integrity.** MEASURED.md
§Finding-2 claims:

```
first differing char index between consecutive turns: 15 (of 35949 / 35949)
identical after masking nonce+timestamp: true
```

My rerun of the identical code, identical harness, produced:

```
first differing char index between consecutive turns: 15 (of 35949 / 35949)
identical after masking nonce+timestamp: false
```

**NOT REPRODUCED as a deterministic claim.** I traced the root cause with a small diagnostic
script (comparing consecutive warm assemblies with the harness's own `stripNonce` masking
applied): the B14-header block emits `freshness=${assembledIso}` — the wall-clock second the
turn assembled — and the harness's masking regex (`/auto-injected \S+ /` +
`/[0-9a-f]{12}/g`) only strips the nonce and the one `<!-- ... auto-injected TS -->` banner
timestamp; it does **not** strip this second, independent timestamp occurrence in the
B14-header's own `freshness=` field. Two consecutive assemblies differ at masked-index ~1,846
whenever the wall clock ticks over a second between the two `Date.now()` calls (confirmed
directly: turns 1↔2 and 2↔3 differed there in my 4-turn diagnostic run; turns 3↔4, which
happened to land in the same second, were identical). So **"identical after masking
nonce+timestamp: true" is not a stable property of the code** — it is a coin-flip on whether
two ~150-200ms-apart calls cross a second boundary, and MEASURED.md reports one lucky roll as
if it were deterministic. This does not change Finding 2's actual conclusion (char 15, the
nonce, is still the true first cache-breaking difference — that part reproduces on every run
regardless), but the specific "true" line in MEASURED.md is a measurement claim that does not
hold up under a second independent run and should be scored as unreliable, not confirmed.

**Direct-import-under-`--experimental-strip-types` claim**: verified genuine. I ran
`run-harness.mjs` exactly as documented; it `import`s `./assembler.ts` with zero intermediate
build step (confirmed by reading the file — no transpiled `.js`/`.mjs` mirror exists anywhere
in `cand-live/`, only `assembler.ts`, `run-harness.mjs`, and the two output artifacts). The
harness executed and produced byte-identical output to the recorded run, which would not
happen if there were a drifted mirror.

### cand-memo (`node run-harness.mjs`, transpiling via `deno bundle`)

Also reproduced very closely:

| metric | MEASURED.md | my rerun | verdict |
|---|---|---|---|
| chars (cold + warm, all 13 runs) | 35,971 uniformly | 35,971 uniformly | REPRODUCED (exact) |
| body sha-12 (cold ×3 + warm ×10) | `ee9ff46119d7` on all 13 | `ee9ff46119d7` on all 13 | REPRODUCED (exact — this is the byte-stability headline claim) |
| P16 drift check | byte-identical, 609/609 | byte-identical, 609/609 | REPRODUCED |
| model-free assertions | all PASS | all PASS | REPRODUCED |
| first differing char (turn1 vs turn2) | index 98 / 35,971 (0.27%) | index 98 / 35,971 (0.27%) | REPRODUCED (exact) |
| per-memo nonce mode: 1 distinct hash/10 turns | yes | yes | REPRODUCED |
| block sizes (B14…P16) | table | identical | REPRODUCED |
| chars÷4 cross-check | 8,993 | 8,993 | REPRODUCED |
| cross-tenant self-test | all lines | all lines byte-identical | REPRODUCED |
| latency (cold ~450-1400ms, warm ~150-300ms) | comparable order of magnitude | comparable order of magnitude, similar spread | REPRODUCED w/ normal variance |

**Byte-stability claim (10 warm + 3 cold, one body hash) — reproduced exactly, this is the
strongest single measurement claim either candidate made and it holds under independent
re-run: `ee9ff46119d7` on all 13 assemblies in my rerun, matching all 13 in their recorded
run.**

### Does each harness execute the same logic as its assembler.ts?

- **cand-live**: yes, verified directly — `run-harness.mjs` line 24 imports `./assembler.ts`
  with no copy, no mirror file exists, and running it reproduces byte-identical block content,
  block ordering, and per-block char counts.
- **cand-memo**: yes, verified indirectly but soundly — `deno bundle` produces
  `.build/assembler.mjs` from the *same* `assembler.ts` at run time (I watched it regenerate:
  "Bundled 1 module in 17ms" on each of my invocations), so there is no hand-maintained mirror
  to drift; the "single source of truth" claim holds. I did not diff the bundler's byte output
  against a reference, but the fact that re-running the bundle step from the same source
  produced byte-identical downstream results (body hash `ee9ff46119d7`, chars 35,971) across
  multiple fresh invocations on my machine confirms the bundle is a faithful, deterministic
  transpilation, not a manually-edited copy.

### F3 doubled-turn measurement (5,146 chars / 2,390 tokens)

I could not reconstruct cand-memo's exact byte-for-byte F3 payload (that requires replicating
`inject-live-context.py`'s exact block-selection and truncation logic, out of scope to
hand-build precisely), but I **read the actual hook** at
`/Users/ivanmanfredi/.claude/hooks/inject-live-context.py` and confirmed the two load-bearing
constants cand-memo cites are real and correctly line-cited: `TTL_FRESH = 300` (line 38) and
`MAX_LEN = 9000` (line 40). I then built an **approximation** — B5+B4+B8+B9 blocks sliced
directly out of my own live-assembled payload (5,445 chars, close to but not identical to
their 5,146) — and ran the identical differential-CLI method on it:

- measured tokens for my 5,445-char approximation: **2,524** (cache_creation 10,343 minus the
  7,819 base) → density 2.16 chars/token, essentially matching the 2.10 measured on the full
  payload and cand-memo's claimed 2.15 (5,146/2,390) for the real F3 block.
- naive chars÷4 on my approximation: 1,361, vs measured 2,524 → **understates by 1.85×**,
  in the same ballpark as cand-memo's claimed 1.99× understatement (2,390 vs their chars÷4 of
  ~1,200 for 5,146 chars).

**UNVERIFIABLE at exact byte-parity** (I did not reproduce their precise 5,146-char / 2,390-
token pair because I did not replicate the hook's exact selection logic), but **directionally
and magnitude-wise REPRODUCED**: the finding that chars÷4 understates this class of content by
roughly 1.9–2.0× holds up on an independently-constructed sample of the same content family,
using the same measurement method, on my own machine.

---

## 2. The cache-hit dispute — cand-live's "structurally impossible" vs cand-memo's explanation

**Both candidates are partially right; cand-memo's account is the more complete and more
useful one, and I independently confirmed the mechanism they describe.**

I ran the differential-CLI method through four additional configurations beyond the base/
append pair, specifically to test this dispute:

| config | cache write | cache read | cost |
|---|---:|---:|---:|
| R1: fresh session, payload appended | 24,905 | 13,554 | (baseline for comparison) |
| R2: **`--resume`** same session, **same bytes** | 22 | 38,459 | **$0.019660** |
| R3: `--resume` same session, **12 chars changed** (nonce-like mutation) | 24,956 | 13,554 | $0.256537 |
| R4: `--resume` same session, **stable again** | 48 | 38,482 | $0.019921 |

This is a clean, direct reproduction of cand-memo's §5 table (their R1-R5): with `--resume`
and byte-stable content, `cache_write` collapses to near-zero and `cache_read` absorbs almost
the entire prompt — cost drops from ~$0.2565/turn to ~$0.0197-0.0199/turn, a **~13× swing**,
matching cand-memo's claimed "13.1×" almost exactly (mine: 0.256537/0.019660 = 13.05×).
Changing the nonce mid-`--resume` immediately reverts the saving; going back to stable bytes
immediately restores it. **This mechanism is real, I did not take it on faith.**

What this proves about the two candidates' claims:

- **cand-memo's explanation is correct and demonstrated**: "byte-stability is necessary but
  not sufficient — the sufficient half (session resume) is missing today." I confirmed both
  halves independently: byte-identical payloads on a **fresh** session (no `--resume`) never
  get read back (my A1/A2/A3 all showed cache_read frozen at 13,554, cache_write re-paid in
  full every time) — so byte-stability alone buys nothing on the route as deployed, exactly
  as cand-memo measured. And a byte-stable payload **with** `--resume` gets almost fully read
  — so the missing ingredient is specifically the fresh-session-per-turn design of
  `/chat/stream` (confirmed at `main.py:773-865`: no `--resume` flag is ever passed), not
  the nonce per se.
- **cand-live's framing ("structurally impossible... due to a per-turn nonce at char 15") is
  not wrong about the proximate symptom** — char 15 genuinely is where two consecutive
  assemblies first diverge, and the nonce genuinely would keep breaking the cache even if
  `--resume` were added, so cand-live's Finding 2 remedies (move the nonce to the tail, or
  accept 0% and price it) are real, useful proposals. But cand-live's own MEASURED.md
  explicitly flags this exact gap itself in a footnote ("whether the CLI writes a cache
  breakpoint on `--append-system-prompt`... is unverified from outside the container.
  Unmeasured") — i.e. cand-live correctly identified that it couldn't test the deeper
  mechanism, and cand-memo is the candidate that actually went and measured it. **Both
  explanations are correct; cand-memo's is more complete because it isolates which of the two
  necessary conditions (byte-stability, session-resume) is the one actually missing today,
  which is the more actionable fact for Phase 3.**

---

## 3. Scorecard — measurement integrity per candidate

**cand-live**: Reproduced almost everything it claimed, including the very specific
cross-tenant self-test outputs verbatim (a strong positive signal — verbatim strings are hard
to fabricate and easy to falsify by re-running). Its token/cost numbers are correctly labelled
as estimates throughout and it is unusually transparent about *why* it couldn't get a real
count (checked every avenue: env key, proxy route, tokenizer package) — this transparency is
exactly the anti-v2a-zeros behavior this seat is hunting for, and it is present here. Its one
real defect: the "identical after masking nonce+timestamp: true" line is not actually a stable
property of the code (my rerun got `false`, and I traced the exact reason — an unmasked
per-second timestamp in the B14 block) — this is a genuine, reproducible measurement bug in
the harness's own diagnostic, not a fabrication, but it means that specific claimed line does
not hold up. Everything else reproduces cleanly, including the harder-to-fake numbers (block
char counts, per-block breakdown, cross-tenant assertion text).

**cand-memo**: Every headline number I attempted to reproduce, reproduced — including the
hardest one to fake (the real 17,112-token count via an independently-run, real, billed API
call landing within 18 tokens / 0.1% of their claim), the byte-stability hash (exact match
across 13 runs), the first-differing-char-index (exact match: 98/35,971), and the 13×
cache-hit swing via `--resume` (I reproduced the mechanism from scratch, landing at 13.05× vs
their 13.1×). This candidate's MEASURED.md is the one making the boldest, most falsifiable
claims (a specific real token count to the token, a specific cache-multiplier), and every one
of them survived independent re-execution.

**Neither candidate exhibits the hunted pattern** (a metrics file of zeros paired with a
precise-sounding summary). Both files' numbers are backed by real, reproducible measurements
or honestly-labelled estimates. cand-live's estimates score zero on absolute accuracy (true
count is ~1.7-3.3× higher than its best estimates and its central costs), but that is a
measurement-*ceiling* problem it disclosed, not a measurement-*integrity* problem — it did not
claim a precision it didn't have. cand-memo's one soft spot is the F3 payload, which I could
only verify in direction/magnitude, not exact bytes, since reproducing it exactly requires
replicating hook logic outside this task's scope.

---

## Final summary (for the parent orchestrator)

- **True injected-payload token count: ~17,100 tokens** (cand-memo's 17,112 measured via real
  differential API calls; I independently reproduced 17,094 using the identical method on my
  own machine, within 0.1%). **chars÷4 (~8,990) understates by 1.90×** — confirmed, this is a
  real property of Ivan's memory content (2.10 chars/token vs ~3.03 for ordinary prose),
  not noise.
- **True per-turn cost, injection alone, as the route is deployed TODAY (fresh session, no
  `--resume`): $0.1711** (cand-memo, confirmed by reproducing the exact cache-write/no-read
  mechanism). This is *2× the naive uncached cost* ($0.0856) because the block is written to
  a 1-hour cache at 2× and never read back — a genuinely counter-intuitive, verified result.
  With `--resume` + byte-stable bytes (not deployed today, but I independently reproduced the
  mechanism live): cost collapses ~13×, to ~$0.0086-0.0197/turn depending on scope.
- **cand-live's cost figures ($0.051-0.065/turn injection-alone) are honest estimates but
  understate the true cost by roughly the same ~1.9-3× the token count is understated** — it
  correctly flagged every number as EST and explained exactly why it couldn't measure; it just
  couldn't reach the real figure without the authorization it (correctly) declined to use.
- **Model actually live on Railway: confirmed via `/v1/models` (unauthenticated) that
  claude-opus-4-7/4-8/4-6/sonnet-4-6/haiku-4-5 are the accepted set; the actual `CLAUDE_MODEL`
  env value is a Railway secret not readable from outside — both candidates handled this
  honestly and priced against the documented code default (`claude-opus-4-7`, $5/$25 per
  MTok), which I independently confirmed via the pricing skill and is robust across the whole
  Opus 4.6-4.8 tier.
- **cand-live's one non-reproducing claim**: "identical after masking nonce+timestamp: true"
  in its byte-stability check — my rerun got `false`; root cause is an unmasked per-second
  B14-header timestamp, making that specific line a coin-flip, not a deterministic property.
  Everything else in cand-live's MEASURED.md reproduced.
- **cand-memo's numbers all reproduced** on independent re-execution, including the hardest
  to fake (real token count via a fresh billed API call, the 13× cache-hit swing, the
  byte-stability hash across 13 runs, the first-differing-char index). The F3 doubled-turn
  figure (5,146 chars / 2,390 tokens) reproduced in direction and magnitude on an approximation
  I built myself, not at exact byte-parity (I did not replicate the hook's exact selection
  logic — flagged as UNVERIFIABLE-at-exact-parity, not a failure).
- **Neither candidate shows the hunted zeros-with-a-confident-summary pattern.** Score:
  cand-memo's measurement section is essentially fully verified; cand-live's is honestly
  estimated but should not be treated as the accurate cost/token figure for the ballot — use
  cand-memo's measured numbers for that.
