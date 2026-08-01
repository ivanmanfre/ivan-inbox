# Phase 3 build ledger — inbox-claude-brain-and-voice-2026-08-01
Branch: exp/brain (off exp/v2 @64e3b72; archival commit d1b4f33). Every build task appends: what changed, commits, tests/lint/build status, self-verification evidence. Sections in build order.

## 1. Content structural build (per phase1b-content/ IA + AMENDMENTS A4)

Structure and data completeness only. The app's existing visual treatment, tokens
and card shells are reused verbatim — the re-skin is a separate phase, and a
second aesthetic in the meantime would be two.

### Commits (all on `exp/brain`, nothing pushed, `main` untouched)

| Hash | Message (subject) |
|---|---|
| `4d79630` | feat(content): carry the fields the surface was dropping — agent attribution, the QA register, source_detail |
| `3ec20bb` | feat(content): two lanes, each with its own view — Ivan by pipeline, Mattan by promotion state |
| `6fea33f` | verify(content): both lanes, both viewports, against the live database |

### Files touched

**Data layer (extended, additive except the three fixes)**
- `src/lib/content.ts` — `LANE_LABEL`/`LANE_POSSESSIVE`/`CONTENT_LANES` (the one
  place `'risedtc'` becomes a name); `AgentLogEntry` grows `agent`/`source`/
  `comment_id` (A4.1); `source_detail` retyped `unknown` + `normalizeSourceDetail`
  (A4.2); `QaSummary` grows the full 23-key register incl. `rewriteText`;
  `parseLogEntry`/`scoreProgression`/`isBackfillEntry`; `taxonomyExtras`/
  `taxonomyValue`; `fetchIdeaCandidates` (R7); `queueFailed`; `ScheduledQueueRow`
  grows `post_kind`/`unipile_share_url`; list `COLS` grows `funnel_stage` and four
  PostgREST jsonb projections (`qa->>verdict` etc.).
- `src/lib/styles.ts` — `fetchResources(lane)` via `laneFilter` (R6);
  `Resource.landing_url`; `isStuckResource` + `RESOURCE_TERMINAL_STATUSES`.
- `src/lib/contentFilters.ts` — **new.** Generic facet machinery + per-row-set
  specs (drafts, ideas, queue, resources, styles).
- `src/hooks/useContent.ts` — `useScheduledQueue` (R4, first consumer),
  `useIdeaCandidates` (R7), `useResources` (R6), `useStyleRoster` (R5),
  `useAgentDigest` (R8/R9).

**UI**
- `src/exp/v2c/ContentList.tsx` — rewritten as the lane router + `IvanLane` +
  `MattanLane` + the merged alert strip.
- `src/exp/v2c/ContentSections.tsx` — **new.** Ideas, publish-queue strip,
  resources, style roster, pillar mix, alert count line, daily summaries.
- `src/exp/v2c/ContentBits.tsx` — **new.** `Val` (the defensive unknown
  renderer), `Rows`/`KeyRows`, `FilterBar`, `FilteredEmpty`, `Figure`.
- `src/exp/v2c/Register.tsx` — **new.** `QaRegister` + `AgentRegister`.
- `src/exp/v2c/DraftPane.tsx` — the full per-draft register; exports
  `draftContextLabel`.
- `src/exp/v2c/ChatPane.tsx` + `Shell.tsx` — one new optional prop
  (`aboutContext`) so the payload carries the lane and the register (IA §5.7).
- `src/exp/v2c/styles.css` — appended block, existing tokens only.
- `src/exp/cand-a/DraftDetail.tsx`, `cand-b/StudioScreen.tsx`,
  `cand-c/StylesGallery.tsx`, `cand-a/ContentStyles.tsx` — retired shells, kept
  compiling. `tsc` failing cand-a's `source_detail` JSX child is the proof the
  retype works.

**Tests / instruments**
- `src/lib/content.test.ts` (+22 cases), `src/lib/contentFilters.test.ts` (new,
  15 cases), `src/lib/styles.test.ts` (+3 cases).
- `scripts/verify-content.mjs` — **new**, the live instrument.

### Gates

| Gate | Result |
|---|---|
| `npm test` | **334 passed / 20 files**, 0 failed (was 294; +40 new) |
| `npm run lint` | **0 errors**, 17 warnings — all pre-existing and all outside `src/exp/v2c`, `src/lib`, `src/hooks` |
| `npm run build` | clean (`tsc -b` + vite, 0 errors) |
| new npm dependency | none |
| write affordances | `grep '\.update(\|\.insert(\|\.delete(\|\.upsert(\|\.rpc('` over every content file → **exactly 2 hits**, both pre-existing `approveDraft`/`skipDraft`, both `.is('client_id', null)` |
| AgentOps destination | `grep -n 'agent' src/exp/v2c/{layout.ts,route.ts,Rail.tsx}` → **0 hits** |
| `.eq('client_id','ivan')` | 0 hits; Ivan is `IS NULL` everywhere, pinned by unit test |
| `supabase.functions.invoke` | 0 hits (no edge call added) |

### Live self-verification — `scripts/verify-content.mjs`

Real Supabase session (`scripts/dev-login.mjs`), `vite preview` on :4173, 8 runs
at **390×852** and **1440×900**. Screenshots in `phase3-build/content-shots/`:

`ivan-lane-mobile.png` · `ivan-lane-desktop.png` · `mattan-lane-mobile.png` ·
`mattan-lane-desktop.png` · `ivan-filtered-desktop.png` ·
`draft-register-desktop.png` · `mattan-draft-mobile.png` ·
`mattan-draft-desktop.png` · `verify.json`

Result: **zero horizontal overflow, zero console errors, zero clipped text, zero
"Rise" labels** across all 8.

Claims checked against live rows:
- lanes render exactly `["Ivan", "Mattan Danino"]`;
- Ivan's sections: Ideas · Generating · Needs review · Scheduled · Published ·
  Archived · Pillar mix · Resources · Styles · Daily summaries; **23 facet groups**;
  60 idea rows + 21 draft cards rendered;
- Mattan's groups: **On Mattan's board → Internal**, each with stages nested
  inside; lane note "20 of 84 on Mattan's board"; 73 cards;
- filtering to `stage=Archived` on Ivan's lane: 39 matched of 171 loaded, and the
  filter bar prints both numbers;
- **proof row `792ee91c`: 37 register entries, 11 distinct agents, 0
  unattributed, 0 "Show more", 0 clamped**, with `THE APPLIED REWRITE`,
  `VERDICT PROVENANCE`, `GENERATION REGISTER · 37 entries` and
  `TAXONOMY · OTHER KEYS` blocks present;
- a Mattan draft whose `source_detail` is a jsonb object (`Case Study: Don Pablo`,
  `{kind,label,metric,slug,source_url}`) opens with its source block rendered on
  both viewports — the crash class is closed.

Three defects the instrument found that reading the file could not:
1. a live `composite_score` is a float (68.32) and the fixed-width score box
   clipped it — the box now sizes to content rather than rounding a score;
2. a `qa` payload nests four levels deep, and label-beside-value ate the width
   until the innermost value had 0px to wrap into — keys now sit above values,
   depth drawn with a rule;
3. 63 rows carry a taxonomy `error_message` and most recovered — only a row
   errored *now* gets the red box; on the rest it renders as history.

### Deviations from IA.md, with reasons

1. **The merged idea log (IA §5.4 item 6) is not built.** The linked idea's
   `agent_log` cannot be read: `client_ideas` returns **0 rows** to this app's
   authenticated role (RLS — probed live, HTTP 200 with `[]`), and
   `lm_idea_candidates` has **no `agent_log` column at all** (column list probed
   live). The linkage still renders — `client_idea_id` and
   `taxonomy.source_candidate_id` are rows in the Source block — but the merged
   timeline the IA describes is not derivable. **SKEPTIC-confirmed reality wins.**
2. **`fetchResources` no longer filters `resource_url IS NOT NULL`.**
   AFFORDANCES §2.4 makes "has a resource URL" a *facet*, and a facet whose rows
   were already removed at the query has one side. Dropping it is also what lets
   Mattan's lane render all 5 of its rows rather than 3 (2 of his 5 have a null
   `resource_url`). The lane scope (the R6 change) is unaffected — and the stuck
   proof row `bb07706c…` does carry a `resource_url`, so it was hidden by the
   tenancy filter alone, exactly as the DECISION-TABLE says.
3. **`slug` and `lm_ref` inside `source_detail` render as rows, not links**
   (IA §5.3 groups them with `source_url`). They are references, not resolvable
   URLs; linking one produces a dead anchor that looks like a working one. Only
   `http(s)` values become links.
4. **"Regenerated" and "Backfilled" facets are derived from `qa` only**, not from
   `agent_log` as well (AFFORDANCES §2.1). `agent_log` is not in the list fetch
   and must not be: 2 999 entries across 282 rows is a payload nobody scrolls.
   Both facets are exact for the `qa` half and simply absent where only the log
   knows; the detail pane shows the log-side evidence in full.
5. **The alert strip is built from UNFILTERED rows.** A filter may narrow the
   flow; it may never hide a broken row. Consequence: with a filter active, the
   card count in the strip is not inside the "N of M shown" figure.
6. **Ivan's weekly ceiling renders as "N scheduled in the next 7 days of a
   4-a-week cadence"** — advisory, never red, never a gate (IA §2.5). Mattan's
   lane shows the observed figures and **no denominator** (IA §3.6).
7. **"Rise" was renamed inside the content section only.** `Sends`, `Inbox`,
   `Today`, `Drafts` and the KPI screens still label the `risedtc` scope "Rise";
   those are outreach client scopes on other surfaces and outside this mission.
   The content surface — every chip, section head, lane note, pane subtitle,
   filter label — is verified free of the string live.
8. **Mobile keeps the same structure, not a reduced one.** Both lanes, both
   registers and every section render at 390px; the only viewport fork is the
   Shell's existing takeover behaviour.

### Left for the design phase

- The section is dense and long by construction (the register is a document).
  Nothing here decides rhythm, scale or hierarchy beyond reusing existing tokens.
- The filter bar is a horizontally scrolling chip rail with 23 facet groups on
  Ivan's lane. It is honest and it fits without overflow; it is not yet
  *designed*, and it is the first thing a re-skin should take.
- `<details>` payload disclosure inside a log entry uses the UA triangle.
- The pillar-mix bars, the score progression and the stacked pipeline bar are the
  only visual encodings; the promotion groups on Mattan's lane have none yet.
- Nothing in this build has been shown to Ivan, and no client-facing artifact was
  created or sent.

## 2. Assembler into broker + depth block (per phase2-tournament verdict)

Built on `exp/brain` in the main tree. Nothing pushed, `main` untouched, no design
worktree and nothing in `claude-code-railway` touched.

### Commits

| sha | what |
|---|---|
| `5b81bb3` | the winning assembler + depth block + shared allowlist + 37 tests |
| `a5f75fb` | wired into `index.ts`, model plumbing, picker UI, 41 more tests |

### Files

| file | status | what it is |
|---|---|---|
| `supabase/functions/inbox-claude/assembler.ts` | new, 828 lines | cand-live base + 4 grafts + the FIX |
| `supabase/functions/inbox-claude/depth-block.ts` | new | DEPTH-SPEC §4 + AMENDMENTS A2, one file |
| `supabase/functions/inbox-claude/allowlist.ts` | new | the ONE allowlist constant both read |
| `supabase/functions/inbox-claude/assembler.test.ts` | new | 24 tests |
| `supabase/functions/inbox-claude/depth-block.test.ts` | new | 13 tests |
| `supabase/functions/inbox-claude/index.ts` | edited | assembly + depth wired to `append_system_prompt` |

### The verdict's four grafts, as shipped

1. **`sources-as-of` header** replaces the wall clock. Extended beyond the verdict's
   letter to the B8/B9 freshness labels, which were the *other* wall clocks and the
   measured source of the cold/warm 7-char delta; they now read `fetched this turn`
   / `cached (<300s)`, which is the whole information content of a 300s TTL without
   the per-second churn. **Measured live: two consecutive warm turns are
   byte-identical once the nonce is masked.**
2. **Derived nonce count.** `emptyEnvelope(nonce, ts)` is composed and counted at
   runtime; the hand-typed `NONCE_SCAFFOLD_OCCURRENCES = 5` is gone. A test asserts
   the derivation still yields 5 against the mandated framing, so the spec defect
   (INJECTION-SAFETY §3.3's arithmetically impossible "exactly twice") stays
   recorded rather than silently absorbed.
3. **In-sequence numbered absent blocks.** Every non-shed block occupies its
   position whether it has content or not; the preamble is gone. A test asserts the
   numbering is `1..n` with no gaps and `n/total` agrees everywhere.
4. **Single-flight coalescing** — see the deviation below.

### The FIX the operational seat required — proven live

`[ClickUp: no key configured — block omitted]` renders at position 4 of 9 on the
live database today. It is a different sentence from `[B8 ClickUp: unavailable —
<reason>]` and a different sentence again from `[LOAD-SHED: dropped B8 … this
context is partial]`. Three states, no shared wording, three tests. A fourth state
was added on the same principle: an empty compaction queue reports
`[B9 compaction proposals: none pending in any tier]`, because "none pending" is a
fact and "unavailable" would have been the same class of wrong causal story.

### Deviations, with reasons

- **Coalescing is narrower than cand-memo's.** cand-memo single-flights the whole
  assembly; grafting that shape would have re-imported the exact coupling the
  operational seat disqualified it for (one n8nClaw 500 → zero context on a cold
  turn). It is applied to the whole-tier row fetch instead — the only read that
  pulls file bodies, so the only one worth coalescing — and a failure there still
  degrades one tier's block rather than the turn.
- **`allowlist.ts` is a third file.** DEPTH-SPEC §7 asks for "exactly one constant
  shared with PARITY-SPEC §2". Having the depth block import it from the assembler
  would have inverted the dependency once the assembler appends the block; a tiny
  shared module keeps one direction and one literal. A test asserts the two modules
  hold the *same object*, not two equal-looking arrays.
- **`AssembleDeps.reserveChars` added.** The depth block did not exist when the cap
  was written and now rides in the same `append_system_prompt`. The ladder runs
  against `cap − reserve`, so what is bounded is the artifact that actually leaves
  the broker.

### AMENDMENTS A2, clause by clause

| clause | where | test |
|---|---|---|
| A2.1 allowlist inline, scoped form the only form | every recipe, built from `ALLOWLIST_JSON`/`_CSV`/`_QUOTED` | every `client_ids` list parsed and compared to `ALLOWLIST` |
| A2.2 graph modes named unsafe | `NOT AVAILABLE` section names `connections`/`neighbors`/`related_to`, quotes `p_client_ids:null`, explains the `neighbors` timestamp race | asserted |
| A2.3 always include `client_ids` | `ALWAYS send client_ids` + "Nothing on the server enforces this" | asserted |
| A2.3 state when a depth query ran | `SAY when you ran one` — name the recipe so a live read is distinguishable from the injected index | asserted |
| A2.4 zero unscoped examples in the deployed text | per-recipe assertion, ready for Phase 5 to re-run against the deployed string | asserted |

No JWT literal appears anywhere in the block (asserted); the key is referenced by
name only, with the "never echo, print, expand, cat" rule intact — DEPTH-SPEC §3.5,
because every Bash call is synced to Supabase by a PostToolUse hook.

### Controls re-proven, with evidence

Read from the deployed `index.ts`, then probed live after deploy.

| control | evidence |
|---|---|
| JWT verified by `sb.auth.getUser` | `index.ts:162-165` unchanged; no manual `atob` anywhere in the file |
| `user.id` allowlist (never email, never role) | `index.ts:166-169` unchanged, still `user.id !== ALLOWED_USER_ID → 403` |
| no `working_directory` read or forwarded | body type is `{prompt, context, model}`; `grep -n working_directory index.ts` → lines 181, 182, 189, **all three comments** explaining its deliberate absence. It appears in no expression. |
| no `client_id` read or forwarded | `grep -n 'body.client_id\|body.working' index.ts` → no matches. The only `client_id` strings in the function are the assembler's own scoping literals, never caller-supplied. |
| CORS allowlist unchanged | same five origins; the only change is `Access-Control-Expose-Headers`, which widens what the browser may READ of our own response, not who may call |
| fails closed on missing config | `index.ts:147-153` unchanged → 503 `broker_not_configured` |
| existing size caps unchanged | `MAX_PROMPT_CHARS = 12_000`, `MAX_CONTEXT_CHARS = 24_000`, both untouched |
| new: assembled prompt bounded | `MAX_SYSTEM_PROMPT_CHARS`, reserved-then-asserted; over-cap fails the turn 500 rather than shipping |
| new: assembly fails closed | tenancy violation / MEMORY.md gone with no cache / over-cap → 503 `context_assembly_failed`, no turn sent |

Ordering is itself a control and was confirmed by probe: a 13,000-char body with a
non-allowlisted token returns `401 invalid_token`, **not** `413`. The size cap is
behind the allowlist, so the broker cannot be used as a size oracle by a stranger.

### Deploy

`supabase functions deploy inbox-claude --project-ref bjbvqvzbzczjbatgmccb`
(CLI authenticated, project confirmed LINKED before deploying). Four assets
uploaded: `index.ts`, `assembler.ts`, `depth-block.ts`, `allowlist.ts`. **No secret
was set or changed.** The assembler needs `SUPABASE_SERVICE_ROLE_KEY`, which the
platform injects automatically — nothing to add.

### Post-deploy probes

| probe | expected | got |
|---|---|---|
| anon, no `Authorization` | 401 | **401** `UNAUTHORIZED_NO_AUTH_HEADER` (platform gate, before our code) |
| anon key as bearer | 401 `invalid_token` | **401 `{"error":"invalid_token"}`** — the anon key is a valid JWT, so this proves `getUser` + the `user.id` check, not just signature validity |
| 13,000-char prompt (over the 12,000 cap) | 413 | **401 `invalid_token`** — auth precedes size, by design; the 413 is unreachable without Ivan's session and is **not verified end-to-end from here**. Its unit test passes. |
| OPTIONS preflight | scoped origin | **200**, `allow-origin: https://ivanmanfre.github.io`, expose-headers present |
| a real turn | — | **not possible from here**: needs Ivan's Supabase session. `RAILWAY_CLAUDE_API_KEY` state on the broker is therefore unconfirmed; if unset, the client classifies the container's 401 as `upstream_not_armed` and says so in words (path unchanged, tested). |

### Measured, live, against the shipped code

Run read-only against the live database with the service key parsed out of
`main.py` at runtime and never persisted.

```
cold 	state=cold	memory=36085	depth=5191	total=41278	cap=46000	headroom=4722	shed=[]	ms=1870
warm 	state=warm	memory=36082	depth=5191	total=41275	cap=46000	headroom=4725	shed=[]	ms=512
warm2	state=warm	memory=36082	depth=5191	total=41275	cap=46000	headroom=4725	shed=[]	ms=634

byte-stable across turns (nonce masked): true

 ok  B14-header      75
 ok  B5            3618
 ok  B4             871
 ABS B8              44   [ClickUp: no key configured — block omitted]
 ok  B9             449
 ok  B10a          4037
 ok  B10b          4211
 ok  P16            608
 ok  P15          19297
```

Three things this measurement settles:

- **The old cap was not merely tight, it was already insufficient.** 41,275 > 36,000
  by 5,275 chars. With the depth block in the same prompt, the 36,000 cap would have
  fired the full load-shed ladder on turn one, every turn.
- **MEMORY.md grew 33 chars between Phase 2's measurement and this one** (19,264 →
  19,297), inside one working day. That is the growth the 51-char headroom was
  measured against.
- **The remaining cold/warm delta is 3 chars**, and it is the honest one: B9's
  freshness label moving from `fetched this turn` to `cached (<300s)`. Per-second
  nondeterminism is gone; the surviving difference carries information.

---

## 3. Railway model passthrough (T3 grant, serialized last)
(pending)

## 4. Model picker UI + honest degrade

### The decision that shapes this section

The hazard on this path is **not** that the upstream rejects a model. It is that it
*accepts* one and ignores it. FastAPI's Pydantic models drop unknown fields by
default, so posting `model` to today's `ChatRequest` (`main.py:78-88`) returns 200,
discards the field, and runs the turn on whatever `CLAUDE_MODEL` the container
booted with (`main.py:677`, `:807` both hardcode `"--model", CLAUDE_MODEL`). Ivan
picks Haiku, is billed for Opus, and nothing anywhere says otherwise.

So the broker refuses rather than forwards-and-hopes. Capability is decided by two
independent signals, either sufficient, neither assumed:

1. `UPSTREAM_MODEL_PASSTHROUGH=true` on the broker — the switch the serialized
   Railway task's owner flips once `model` lands upstream. **Unset. Not set by this
   run.**
2. the upstream's own `/openapi.json` showing `model` on `ChatRequest` — an
   automatic upgrade path needing no deploy here. **Measured today: `/openapi.json`
   302s to `/login`, so the schema is not readable from the broker.**

Both negative ⇒ a picked model produces `409 model_support_unknown` with a detail
that states the fact rather than shrugging. Neither state is ever a silent success.

### Model allowlist, verified twice against the deployed upstream

`GET /v1/models` (open, no auth — `main.py:1959-1970`) returned today:
`claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `claude-sonnet-4-6`,
`claude-haiku-4-5`. Cross-read against `MODEL_MAP` (`main.py:1230-1243`, read-only,
never edited): all five map to `opus`/`sonnet`/`haiku`. The brief named four;
`claude-opus-4-6` is live and accepted, so it is in the list — a picker that omitted
an available model would be its own small lie.

### Error states, three of them, deliberately not one

| code | means | retryable |
|---|---|---|
| `model_not_allowed` (400) | the client offered something outside the broker's five | no |
| `model_not_supported_upstream` (409) | the container is KNOWN not to honour it | no |
| `model_support_unknown` (409) | the broker cannot confirm either way | no |

None are retryable: a container that does not take a per-request model will not
start taking one because Retry was pressed. `context_assembly_failed` **is**
retryable — it covers transient source outages and the assembler has a stale
fallback, so a second attempt genuinely can land.

### The UI

`src/exp/v2c/ChatPane.tsx`, `useChat.ts`, `chat/transport.ts`, `chat/events.ts`,
`src/lib/claude.ts`. Chip in the pane header showing the current selection, opening
a six-row menu (`Container default` first, then the five models, each with a
one-line note). Matched to the existing `.wb-mockchip` / `.wb-ask` register; a
later design phase re-skins it.

Two states are kept apart on purpose:

- **`wanted`** — what Ivan selected, shown on the chip.
- **`model`** — what the last turn ACTUALLY ran on, read off the broker's
  `X-Broker-Model` response header and shown in the subtitle as `ran on …`.

They are never merged. Merging them is exactly how a dropped model choice would
hide: the chip would keep saying Haiku while every turn ran Opus. The header is
read from the response, never echoed back from the request — a test asserts that
asking for Haiku and being told `container-default` reports `container-default`.

The menu also states the current truth where the choice is made — "the container
takes no per-turn model yet, so anything but the default is refused rather than
quietly ignored" — so the state is learned before a turn fails, not after.

**Honest degrade:** a refused pick leaves the selection ALONE. Reverting it silently
would be the app choosing for Ivan and hiding that it did. An amber banner names
what happened and offers the one action that works ("Use container default"), which
is a deliberate single click rather than an automatic fallback.

`Access-Control-Expose-Headers` was added to the broker's CORS — a browser cannot
read a response header it was not offered, so without it the UI would have had to
invent the model it displayed. Two other headers ride the same channel:
`X-Broker-Context-Chars` and `X-Broker-Context-Shed`, so the surface can eventually
say how much brain rode with the turn and what was dropped.

### Cap decision, and what it costs

**`MAX_SYSTEM_PROMPT_CHARS` raised 36,000 → 46,000.** Recorded as a build decision,
not left to chance.

*Why not accept shedding.* The ladder's first six rungs are the cheap, useful half:
ClickUp (0 chars today), the compaction queue (449), a summary day (~435), then the
tier **indexes** (8,248 combined) — which are the map the depth recipes navigate by.
P15 MEMORY.md is 19,297 chars and is never shed. Shedding at 36,000 buys ~1,300
chars, about three MEMORY.md lines, before it starts eating the index. That is a
worse trade than it looks: the depth block's entire value is that the model knows
what exists before deciding to read deeper.

*Why 46,000.* The measured combined artifact is 41,275 chars. That leaves 4,725 of
headroom — roughly 140 MEMORY.md lines at today's average, months of growth rather
than the 29-51 chars Phase 2 measured (one line). A `console.warn` fires above 90%
of the cap so the next squeeze is seen before it bites, not after.

*What it costs.* **Nothing today.** A cap is a ceiling, not a floor: the payload is
what the sources are, not what the cap allows. Injection stays as measured —
41,275 chars, ~19,700 tokens at Ivan's measured 2.10 chars/token, ≈$0.197/turn for
the injection alone on today's route (fresh session per turn writes a 1-hour cache
at 2× and never reads it). The cost consequence is deferred and bounded: the worst
case, MEMORY.md growing to fill the new ceiling, is ~21,900 tokens ≈ $0.219/turn,
+28% over the Phase 2 figure, reached over months.

*What was NOT done.* The tiering is untouched. Whether MEMORY.md belongs in every
turn whole, at 47% of the payload, is a ballot item per VERDICT.md and not a build
decision. It was not silently downgraded.

*Also not done, and still true:* the 13× caching fix (pass `--resume`, keep the
payload byte-stable) remains outside this run's grant. **Half of it is now done** —
the payload IS byte-stable turn to turn, measured. The `--resume` half is the
serialized Railway task's, and until it lands today's route still costs 2× more
than no caching at all.

### Gates

| gate | before | after |
|---|---|---|
| `npm test` | 20 files / 334 tests | **22 files / 378 tests, all passing** |
| `npm run lint` | 0 errors | **0 errors** (warnings unchanged; no new ones in shipped src) |
| `npm run build` | clean | **clean** |
| new npm dependency | — | **none** |
| `deno check` on the four function modules | — | **clean** |
| secret in an artifact or committed file | — | **none**; the measurement key was parsed from `main.py` at runtime and never written |

### Left open, deliberately

- The 413 probe is unreachable without Ivan's session; unit-tested, not
  end-to-end-verified. Phase 5 owes it a real-session run.
- A real turn was never executed from here, so `RAILWAY_CLAUDE_API_KEY`'s state on
  the broker is unconfirmed and the `upstream_not_armed` classification is untested
  against the live container.
- `X-Broker-Context-Chars` / `-Shed` are emitted and parsed but nothing renders them
  yet — the surface has the fact and no place to put it. A design-phase item.
- P16 is still a compile-time literal of `~/.claude/CLAUDE.md` with no propagation
  from the real file. Phase 5 owes the diff.

## 5. Voice instrumentation
(pending)

## 3. Railway model passthrough — T3 grant, executed serialized by the orchestrator

**Grant:** "an allowlisted model passthrough on the Railway claude-code service ONLY". Nothing else changed. Executed alone; the only other tasks in flight (three UI design worktrees) touch no Railway surface.

### Before-snapshot
- Repo `claude-code-railway`, branch `main` @ `2b1054f`, working tree clean except 6 pre-existing untracked probe files (untouched).
- `main.py` copied verbatim to `phase3-build/railway-snapshot/main.py.before`; sha256 `1783aa134768b7e787bd3d06e25588807cdbab2bcb7ea9c4020030e08307df97`.
- Deployed env snapshot (39 vars, names + value hashes, secrets never printed) in `phase3-build/railway-env-before.md`. **No variable was set, changed, or removed at any point.**
- Pre-deploy `GET /health` → 200.

### The change — commit `82e4ab1`, 3 hunks, +21/-2
1. `ChatRequest` (`main.py:91`): `model: Optional[str] = None`.
2. New `resolve_chat_model()` (`main.py:1248-1264`), placed directly after the pre-existing `MODEL_MAP`: `None` returns `CLAUDE_MODEL` (byte-identical to prior behaviour); any other value must be a key of `MODEL_MAP` or the request is rejected `400`. **Fails closed** — it never quietly serves the default under a different name, which is what the broker's honest-degrade contract needs.
3. Both invocation sites (`:678` `/chat`, `:808` `/chat/stream`) swap the `CLAUDE_MODEL` literal for `resolve_chat_model(request.model)`. No other line in the file differs — full diff in this ledger's commit.

Pre-deploy behavioural test of the resolver in isolation: `None`→`claude-opus-4-7` ✅; `claude-sonnet-4-6`/`claude-haiku-4-5` accepted ✅; `gpt-4`, `claude-opus-9`, bare alias `opus`, empty string, and a shell-metacharacter payload all rejected 400 ✅.

### Restore path (one line)
`cd ~/Desktop/claude-code-railway && git revert 82e4ab1 && railway up --detach`
(equivalently `git checkout 2b1054f -- main.py`, whose sha256 is recorded above.)

### Deploy + read-back (all against `claude-code-railway-production.up.railway.app`)
| probe | result |
|---|---|
| `POST /chat` with `model:"gpt-4-turbo"` | **HTTP 400** `Unsupported model 'gpt-4-turbo'. Allowed: [11 model ids]` — proves the new code is live |
| `POST /chat` with `model:"claude-haiku-4-5"` | HTTP 200, `success:true`, `result:"OK\n"` — **model A** |
| `POST /chat` with `model:"claude-sonnet-4-6"` | HTTP 200, `success:true`, `result:"OK\n"` — **model B** |
| `POST /chat` with **no** `model` field | HTTP 200, `success:true` — default path unchanged |
| `GET /health` post-deploy | 200, `claude_cli_available:true`, CLI `2.1.161`, `fork_watchdog.strikes:0` |
| `railway variables` diff vs before-snapshot | identical, 39 vars, no change |

### 🔴 P0 FOUND, PRE-EXISTING, NOT FIXED (out of grant): `/chat/stream` has been dead for every client
Every `/chat/stream` call — on model A, model B, **and the no-model default** — returns exactly `data: {"type":"done","returncode":1}` and nothing else. Root cause, obtained from the container itself by asking `/chat` to run the same output format:

```
STDERR: Error: When using --print, --output-format=stream-json requires --verbose
```

`/chat/stream` builds `claude -p --output-format stream-json` with no `--verbose` (`main.py:803-809`); the CLI refuses. Reproduced identically on the local CLI 2.1.219 and confirmed as the container's own stderr on CLI 2.1.161. The line dates to commit `df6801e` (2026-02-24).

**Not caused by this change:** the default path exercises `resolve_chat_model(None)`, which returns the same `CLAUDE_MODEL` string the old code passed, and it fails identically. `/chat` — same code path for the model argument — works on both models.

**Consequence:** `/chat/stream` is the broker's *only* transport (`inbox-claude/index.ts` posts there). So the inbox Claude surface could never have completed a turn even with `RAILWAY_CLAUDE_API_KEY` armed. This is a bigger finding than the arming gap it was hiding behind.

**Fix, ready but deliberately NOT applied:** add `"--verbose"` to the `cmd` list at `main.py:808`. One token. It cannot regress working behaviour because there is none. It is withheld because the grant reads "an allowlisted model passthrough ONLY. Nothing else on that service may change" — this is a different change on a multi-client service, so it goes to Ivan on the ballot rather than being taken unilaterally.

**What this blocks in the DoD:** stream-based read-back of the model passthrough (proven instead on `/chat`, both models), and any "real turn" verification through the broker (captured injected context, on-demand depth reaching the brain). Those rows are reported as BLOCKED with this evidence rather than claimed.

## 6. Injection hardening — blocking amendments A1/A2 applied (orchestrator, after two agent stalls)

Source: `phase1-parity/SKEPTIC-INJECTION.md` §6 defects, §9 amendments. Commit `6706802` on `exp/brain`; redeployed to `bjbvqvzbzczjbatgmccb`.

**A1 — normalise before you neutralise.** The shipped `escapeBody` was byte-exact while the model reads glyphs, so every row of the skeptic's evasion table walked through it *and left the counter at zero* — telemetry reporting clean over a live forgery. Rewritten as `escapeBodyCounted` with the order fixed: C0 controls → `\p{Cf}` format characters (ZWSP/ZWNJ/ZWJ/LRM/BOM) → NFKC fold restricted to single-character printable-ASCII results (`＜`→`<`, `［`→`[`) → delimiter runs tolerating intra-run space/tab → header shape tolerating leading/repeated/NBSP whitespace. Every rule counts; counts surface per block in `BlockReport.note` and once per turn as a trailer outside the envelope.

**A2 — header fields are no longer trusted.** `blockHeader` now routes `id`/`source`/`scope`/`file`/`freshness` through `sanitizeHeaderField`, which escapes **then** shape-validates (a value that only passed because a ZWSP hid a `]` still fails; a header field has no legitimate reason to carry escapable bytes). A failure becomes `malformed` plus a preamble line naming the block and field **without reproducing the offending bytes** — quoting attacker text into scaffolding is the defect being fixed. Only the assembler-computed `n`/`total` integers are still interpolated raw.

**A4** was already shipped by the Phase 3 builder (GRAFT 2 derives the nonce count from an empty envelope). **A3** N/A — grep confirms `MEMORY_NONCE_MODE` was never shipped (that flag lived only in the losing candidate). **A5** — the cap was already raised to 46,000 to cover envelope + depth block (§2).

**Evidence — `phase3-build/escaper-evasion-test.mjs`, run against the shipped file:**

| case | neutralised | counter |
|---|---|---|
| plain `<<<` | YES | 2 (delim=2) |
| ZWSP-split `<<<` | YES | 4 (cf=2, delim=2) |
| fullwidth `＜＜＜` | YES | 8 (fold=6, delim=2) |
| plain `[BLOCK` | YES | 1 (header=1) |
| NBSP `[BLOCK` | YES | 2 (fold=1, header=1) |
| double-space `[BLOCK` | YES | 1 (header=1) |
| leading-space `[BLOCK` | YES | 1 (header=1) |
| space-split `< < <` | YES | 2 (delim=2) |
| fullwidth `［BLOCK` | YES | 2 (fold=1, header=1) |

D2 header break-out (the 163-char forged `[ASSEMBLER NOTICE]` + fake `[BLOCK]` through `compiled_at`) → `malformed`, issue recorded. All 7 legitimate header values pass through byte-identical. **0 failures.**

**Gates:** 378 tests pass (22 files), lint 0 errors, `npm run build` clean, `deno check` clean, no new dependency.
**Deploy + re-probe:** `supabase functions deploy inbox-claude` → Deployed. anon (no auth) → **401**; anon-key-as-bearer → **401 `invalid_token`** (the function's own check, so platform `verify_jwt` is not being relied on).
**Secret grep:** `dist/assets/*.js` contains exactly one JWT — decoded `role=anon`, the intended public key. No `sk-ant-`, no `service_role`, no `RAILWAY_CLAUDE_API_KEY`. Branch history `exp/v2..exp/brain`: 0 hits.

**Not applied:** A6/A7 (framing-text edits — non-blocking, and the skeptic's own §5 pre-registration warns framing edits must not be treated as substitutes for A1-A3, which are done) and A8 (report-only: the instruction-shaped scanner fired on the two harmless attacks and none of the six real ones — kept as corpus telemetry, and the report says plainly it is not coverage).
