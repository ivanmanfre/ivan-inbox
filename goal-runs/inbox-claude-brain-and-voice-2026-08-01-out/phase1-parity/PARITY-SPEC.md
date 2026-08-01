---
name: Phase 1 — parity spec (live-context injection for the inbox Claude chat)
description: Block-by-block mapping of ~/.claude/hooks/inject-live-context.py onto a broker-side context assembler, plus the three architectural calls (where it runs, tenancy allowlist, size cap).
type: reference
---

# PARITY-SPEC — full memory parity for the inbox Claude chat

Goal-run `inbox-claude-brain-and-voice-2026-08-01`, Phase 1. READ-ONLY pass: no code modified, no row written. Every live figure below came from a probe run in this session against project `bjbvqvzbzczjbatgmccb` with the service key hardcoded at `/Users/ivanmanfredi/Desktop/claude-code-railway/main.py:46` (SELECT/HEAD only). Sizes are **measured**; token counts are **estimates at chars÷4** and are labelled as such — Phase 2 replaces them with a real count.

Companion docs: `DEPTH-SPEC.md` (on-demand recall/brain), `INJECTION-SAFETY.md` (control 2 framing + threat model).

---

## 0. Nine live findings that drove every decision below

These are new to this phase and each one changes the design. Cited, reproducible.

**F1 — The container's memory restore is silently truncated to 1000 of 1885 rows.**
`entrypoint.sh:276` issues `GET /rest/v1/claude_memory?select=client_id,file_path,content` with **no `limit`**. PostgREST's server-side max-rows cap is 1000. Probe of that exact query today returned exactly 1000 rows: `ivan 963, global 28, agencyops 7, -workspaces-ivan 2` — i.e. **all 29 `shared-tech` rows restored: zero**, 419 of Ivan's 1382 rows missing, all 272 `unscoped` missing. Which 1000 you get is undefined ordering, so it changes silently between boots.

**F2 — The restored files land in the wrong place and are invisible to the machinery that wants them.**
`Dockerfile:135` sets `WORKDIR /workspaces`; `entrypoint.sh` performs no `cd` before the restore (`grep -n "^cd "` → only lines 475, 598, both later/unrelated). `entrypoint.sh:281` writes `os.path.expanduser(row['file_path'])`, and 1883 of 1885 `file_path`s are **relative** (`project/…`, `global/…`, `shared/…`, `session-logs/…`, per `phase0-research-db.md` §1). So they resolve to `/workspaces/project/…`, `/workspaces/global/…` etc. — a junk tree sibling to every tenant's cloned workspace, readable by every tenant's session. Meanwhile the container's own hook reads `/home/appuser/.claude/memory/{global,shared}` (`claude-code-railway/hooks/inject-live-context.py:18-19`) and **nothing in the repo ever writes there** (grepped `entrypoint.sh`, `main.py`, `hooks/`, `Dockerfile`).

**F3 — Consequence of F1+F2: the container's SessionStart hook already runs on every turn, and two of its parity blocks are dead.**
`entrypoint.sh:206-273` registers `python3 /home/appuser/.claude/hooks/inject-live-context.py` as a `SessionStart` hook with `timeout: 8`. `/chat/stream` never passes `--resume` (`main.py:773-865`), so **every turn is a fresh CLI session and this hook fires every turn**. But `build_global_index()` / `build_shared_index()` (`hooks/inject-live-context.py:216-227`) both `return None` because `index_dir()` short-circuits on `if not directory.exists()` (`:50-51`). Net today: the container injects only the client header + `compiled_context` + n8nClaw + ClickUp + compaction — roughly **1.2k tokens of unframed, unscoped memory per turn, already, before this run changes anything**. That is a standing injection-safety fact, carried into `INJECTION-SAFETY.md` §T9.

**F4 — `file_path` is NOT unique per path; two paths are claimed by two tenants.**
Full-table scan (1885 rows, two paginated pages): exactly two `file_path`s are claimed by more than one `client_id`, and both are Ivan-vs-ProSWPPP:
```
['ivan', 'proswppp']  project/MEMORY.md
['ivan', 'proswppp']  project/_compaction-review.md
```
`ivan`'s `project/MEMORY.md` is 19,162 chars (`updated_at` 2026-08-01T10:40:18Z); `proswppp`'s is 9,452 chars. Any assembler query keyed on `file_path` alone returns a paying client's memory index. On the container these two rows also collide on disk (last-writer-wins at `/workspaces/project/MEMORY.md`) — today ProSWPPP happens to fall outside the truncated 1000-row page (F1), so the collision does not fire, by luck, not by design.

**F5 — A correctly-scoped `in.(…)` query still silently drops a whole tier.**
Probe: `GET /claude_memory?select=client_id&client_id=in.(ivan,global,shared-tech)&limit=2000` returned **1000 rows: `{ivan: 972, global: 28}`** — `shared-tech` entirely absent, because `ivan`'s 1382 rows exhaust the page before the other tiers are reached. The `limit=2000` param is ignored; the server cap wins. **The assembler must query per tier, never one `in.()` page.** (Same class as the standing trap "PostgREST caps SELECT at 1000".)

**F6 — `unscoped` is Ivan's, is 100% session-logs, and is unreachable from Ivan's local tooling.**
All 272 rows: `kind=episodic`, `file_path` prefix `session-logs/`, zero semantic (`file_path=not.like.session-logs/*` → count 0; `kind=eq.semantic` → count 0). Parsed the `cwd:` frontmatter of all 272: **0 originate from `/workspaces`** (the container); 152 from `/Users/ivanmanfredi/…`, the rest from `/private/tmp/…` scratchpads on his Mac. So provenance is Ivan's own machine. But content-wise, 16 mention `risedtc`, 9 `lemonade`, 7 `proswppp`, 4 `interlude`, 1 `secondmile`. And neither local tool reaches them: `inject-live-context.py` indexes only the two tier dirs, and `recall.py:411-413` builds `semantic_client_ids = ["global","shared-tech"] + [project_label]` where `project_label` is `"ivan"` — never `"unscoped"`.

**F7 — `-workspaces-ivan` is a dead 2-row container stub.**
Both rows read: `/home/appuser/.claude/projects/-workspaces-ivan/memory/MEMORY.md` (100 chars) and `.../feedback_n8n_url.md` (437 chars), both `kind=semantic`, both `updated_at` **2026-04-16**, content = the n8n-URL correction that already lives in current memory. These are also **the only two absolute `file_path`s in the table** — the exact rows that let `entrypoint.sh:281` write outside the tree.

**F8 — `~/.claude/CLAUDE.md` is not mirrored anywhere.**
611 bytes / 6 lines on Ivan's Mac. `GET /claude_memory?file_path=ilike.*CLAUDE*` returns 7 rows, none of them it (they are topic files with "claude" in the name). It is reachable from **no** container-side or broker-side data source.

**F9 — The container has no `personal-site` checkout, and never will under the current registry.**
`client_registry.github_repo` for all 8 tenants: six point at `ivanmanfre/<client>-config.git` (`ivan` → `ivan-config.git`), and `interlude`/`risedtc` are empty strings (they get template copies from `/app/workspaces-src`, `entrypoint.sh:343+`). `entrypoint.sh:305-339` clones exactly those into `/workspaces/<cid>`. `personal-site`, `ivan-video-engine`, `resources`, `Ivan - Content System` are **not** on the container in any form.

---

## 1. ARCHITECTURAL DECISION — where the assembler runs

### Decision: **(a) inside the `inbox-claude` edge function**, as the single authoritative assembler, emitting on a **new `append_system_prompt` channel** forwarded to the upstream. The container's existing SessionStart hook is left untouched (out of grant) and treated as a known duplicate + reported defect.

### Why (a) beats (b) — the Railway container as a pre-turn hook

1. **Tenancy must be asserted where the tenant is already pinned, not re-derived on a shared filesystem.** The broker already knows exactly one tenant and refuses everything else: `user.id !== ALLOWED_USER_ID → 403` (`index.ts:94-97`), and it deliberately forwards neither `client_id` nor `working_directory` (`index.ts:99-104`). An assembler there can carry Ivan's allowlist as a **literal constant** — there is no resolution step for a caller to steer. On the container, tenancy would come from `identify(cwd)` (`hooks/inject-live-context.py:253` → `hooks/lib/identify_client.py`), i.e. identity derived from a *path*, on a box where the turn has unsandboxed `Bash` under `bypassPermissions` and can `cd`. The prior run's security skeptic already ruled workspace pinning theatre (`phase0-scope.md` §1); deriving the *memory allowlist* from that same path would rebuild the control on the sand we already condemned.
2. **Blast radius. `~/.claude/settings.json` on the container is one global file for all tenants** (`entrypoint.sh:206-273`). There is no per-client hook config anywhere. Enriching the SessionStart hook to give Ivan parity necessarily enriches ProSWPPP's, RISE DTC's, and Lemonade's sessions with the same machinery — and the machinery's whole job is reading `claude_memory`.
3. **Out of grant.** `phase0-scope.md` §4 S2 grants exactly two hunks on Railway (`model` field + two invocation sites) and says "**nothing else**". Option (b) means editing `/app/hooks/*` and redeploying the image.
4. **The container's caching is worse than useless here.** `hooks/inject-live-context.py:27-29` keys the cache on `md5(cwd)`, TTL 300s (`:22`, `:246-251`). Every inbox turn shares one cwd (`/workspaces/ivan`, `main.py:42`), so all turns in a 5-minute window get one frozen blob — and that `/tmp` file is shared with any other process on the container using that cwd. The broker can instead cache deliberately, with a cheap freshness probe (§4).
5. **Option (b) is already built and already broken, silently.** F3: two of its blocks return `None` and nothing reports it. That is the failure mode we are trying to eliminate, demonstrated in the very implementation option (b) would extend.

### Why (a) beats (c) — client-side

Dead on arrival. The assembler must read `claude_memory` and `client_instances`; the inbox is a static bundle on public GitHub Pages that "can never hold the upstream credential" (`index.ts:1-3`) — nor a service-role key. The anon key clears the gateway for `claude-brain-query` (probe in `phase0-research-injector.md` §3) but not for direct `claude_memory` REST reads under RLS, and shipping the assembler client-side would put **the tenancy allowlist itself into editable, publicly-served code**. Reject.

### The channel: `append_system_prompt`, not the concatenated prompt

The upstream `ChatRequest` already carries `append_system_prompt: Optional[str] = None` (`main.py:89`) and forwards it verbatim to `--append-system-prompt` at both `/chat` (`main.py:697-698`) and `/chat/stream` (`main.py:817-818`). The broker does **not** currently forward it — `index.ts:105` reads only `{prompt, context}` and `index.ts:117-120` builds `{prompt: context + "\n\n---\n\n" + prompt, stream: true}`. Forwarding it is in scope this run.

Three reasons the assembled memory goes there and not into the concatenated prose:

- **Authority.** The anti-instruction framing (`INJECTION-SAFETY.md` §2) is only strong if it outranks the content it wraps. In the system channel it is a standing rule; in the user channel it is peer text to whatever a hostile row says back. Full reasoning, including the cost of that choice, in `INJECTION-SAFETY.md` §5.
- **We already know the other channel's delimiter.** `index.ts:118` joins with a literal `\n\n---\n\n`. A memory row containing `\n\n---\n\n` forges it. Don't inherit a delimiter that is public in tracked source.
- **Budget separation.** `MAX_CONTEXT_CHARS = 24_000` was sized for transcript replay (`index.ts:37-43`: "the only continuity that exists is the transcript the client replays here"). Sharing it with memory means a long conversation silently evicts memory, or vice versa, with no signal to anyone.

### Consequence to carry forward (not fixed this run)

The container hook keeps emitting its own unframed copy of three of our blocks (`compiled_context`, n8nClaw, ClickUp) on every turn — F3. Phase 2 must **measure the doubled turn**, not assume it away. The one-line fix (empty the `SessionStart` array for this path, or gate the hook on an env var) is inside the container's grant boundary and therefore **proposed, not taken**. Recorded as an S12-class report item.

---

## 2. TENANCY DECISION — the exact allowlist

### Decision: `client_id IN ('ivan', 'global', 'shared-tech')` — three values, baked as a literal, applied **in every query, above the limit, per tier**.

Explicitly **excluded**: `unscoped`, `-workspaces-ivan`, `proswppp`, `risedtc`, `agencyops`, and any value not in the literal.

| value | rows | verdict | why |
|---|---|---|---|
| `ivan` | 1382 (590 semantic `project/*.md`, 792 episodic `session-logs/*.md`) | **INCLUDE** | Ivan's own project tier. Semantic rows only for injection; episodic only via explicit depth mode. |
| `global` | 28 | **INCLUDE** | Always-on tier the local injector indexes (`inject-live-context.py:32`, `:263-268`). |
| `shared-tech` | 29 | **INCLUDE** | Always-on tier (`:33`, `:270-274`). ⚠ F5: needs its own query or it vanishes. |
| `unscoped` | 272 | **EXCLUDE** | F6. All episodic session-logs. Ivan's by provenance (0 of 272 from `/workspaces`), but **unreachable from Ivan's local tooling** — `recall.py:411-413` never puts `unscoped` in `client_ids`, and the injector never touches session-logs. Including them would be *more* than parity, and 37 of them name other tenants' work. Excluding is simultaneously the parity-correct and the safe call, which is why this is not a close decision. If Ivan later wants his own session-log recall, that is a ballot item with the token number attached — not a default. |
| `-workspaces-ivan` | 2 | **EXCLUDE** | F7. A 2-row, 537-char, 2026-04-16 container stub whose only fact is already live elsewhere. Also the only absolute-path rows in the table — the class we want de-normalised, not blessed. |
| `proswppp` | 158 | **HARD EXCLUDE** | Other tenant. Also owns a colliding `project/MEMORY.md` (F4). |
| `risedtc` | 5 | **HARD EXCLUDE** | Paying client's material. |
| `agencyops` | 7 | **HARD EXCLUDE** | Other tenant. |

### Defence: it is not a judgment call, it is a copy of local behaviour

`recall.py:411-413`:
```python
semantic_client_ids = ["global", "shared-tech"]
if project_label:
    semantic_client_ids.append(project_label)
```
With Ivan's cwd, `project_label == "ivan"`. So `{ivan, global, shared-tech}` is **exactly** the set Ivan's local instance can already reach by semantic search. Parity means that set, no more.

### Live cross-tenant proof (reproduce in Phase 5)

Scoped REST read is clean:
```
GET /rest/v1/claude_memory?select=client_id&client_id=in.(ivan,global,shared-tech)&limit=2000
→ 1000 rows, distinct client_ids = {ivan: 972, global: 28}  →  CLEAN (no proswppp/risedtc/agencyops)
```
And the depth path leaks without the allowlist — **this is the proof that the allowlist has to be baked into the documented queries, not left to the model**:
```
POST /functions/v1/claude-brain-query  {"mode":"recall","query":"proswppp swppp report","match_count":5}
→ client_ids returned: ['proswppp','proswppp','ivan','proswppp','ivan']      ← LEAK

POST /functions/v1/claude-brain-query  {"mode":"recall","query":"proswppp swppp report",
                                        "client_ids":["ivan","global","shared-tech"],"match_count":5}
→ client_ids returned: ['ivan','ivan','ivan','ivan','ivan']                   ← CLEAN
```

### Mandatory query shape (from F4 + F5)

1. **Every** query carries `client_id=eq.<one value>` or `client_id=in.(…)`, in the URL, before any `limit`. Never filter after fetch.
2. **Never** rely on one `in.()` page to cover all three tiers — issue **one query per tier** (F5). The assembler's tier fetches are: `client_id=eq.global`, `client_id=eq.shared-tech`, and two narrow `client_id=eq.ivan` point-reads.
3. **Never** key on `file_path` alone (F4). `project/MEMORY.md` must be fetched as `?client_id=eq.ivan&file_path=eq.project/MEMORY.md`.
4. The assembler asserts, post-fetch, that every returned row's `client_id` is in the literal allowlist, and **throws** (fail-closed, turn errors visibly) if not. This is an assertion, not the control — the control is the SQL.

---

## 3. SIZE / CAP DECISION

### Decision
- New broker constant **`MAX_SYSTEM_PROMPT_CHARS = 36_000`** (est. ~9,000 tokens), enforced on the assembled `append_system_prompt` before the upstream fetch, mirroring the existing `MAX_PROMPT_CHARS`/`MAX_CONTEXT_CHARS` discipline (`index.ts:42-43`).
- **Additive**, not shared with the existing caps. Worst-case turn payload = 12,000 (prompt) + 24,000 (context) + 36,000 (system) = **72,000 chars ≈ 18,000 tokens est.**
- `MAX_CONTEXT_CHARS = 24_000` and `MAX_PROMPT_CHARS = 12_000` are **unchanged**.

### Why 36,000 and not less

Measured full-parity assembly today is **~33.9k chars ≈ 8.5k tokens (est.)** — §5 table. The cap is set *above* the real assembly so load-shedding does not fire in normal operation. The mission is explicit: "if cost is high we report the number and ballot the tiering, we do not silently downgrade." **The number is ~8.5k tokens of injected context per turn, of which `MEMORY.md` alone is ~4.8k.** That number goes to the ballot; it does not get quietly trimmed here. Phase 2 replaces the estimate with a measured token count and a dollar figure at the model in use.

### Load-shed order (only fires above the cap)

Shed **whole blocks**, first listed first, until under cap:

1. `B8` ClickUp last-24h — external, lowest signal, already conditional on a key that may be absent.
2. `B9` compaction proposals — housekeeping, not operating knowledge.
3. `B4` n8nClaw: drop the older of the two days.
4. `B5` `compiled_context`: re-truncate 3,500 → 1,800 chars.
5. `B10b` shared-tech index: truncate each description 120 → 80 chars.
6. `B10a` global index: same.
7. `P16` operator rules (`CLAUDE.md`).
8. `P15` `MEMORY.md` — **never shed, never mid-truncated.** If `P15` + framing alone exceeds the cap, the broker returns a visible `413 context_assembly_over_cap` rather than sending a silently amputated brain. Rationale: `MEMORY.md` is topic-ordered with "Live state & open items" near the *end*, so end-truncation (what local does at `inject-live-context.py:355`, `[:MAX_LEN]`) throws away the freshest, most operationally live section first. Replicating that would be parity with a bug.

### Deliberate divergence from local, stated once

Local truncates the assembled body silently at `MAX_LEN = 9000` (`inject-live-context.py:40`, `:355`). We do not. Any shed emits a visible line **inside** the injected block:
```
[LOAD-SHED: dropped B8, B9 to fit the 36,000-char cap — this context is partial]
```
so the model can tell Ivan its context is incomplete instead of confidently answering from a truncated brain. Flagged here as a divergence, not smuggled in.

Note the local `MAX_LEN = 9000` is itself why local parity is *narrower* than what we are building: at 9,000 chars the local hook cannot carry `MEMORY.md` (19,162 chars) — it doesn't try, because locally `MEMORY.md` arrives by a different mechanism entirely (§5, P15).

---

## 4. Freshness model

| tier | strategy | why |
|---|---|---|
| `P15` MEMORY.md, `B5` compiled_context, `B4` n8nClaw | **per-turn live read** | These are the "live state" blocks. `MEMORY.md` was written today at 10:40Z; `compiled_context` recompiled today at 06:30Z. Caching them defeats the purpose. Measured cost: 3 point-reads. |
| `B10` global + shared indexes | **cached, with a freshness probe** | Tier descriptions change rarely; the full-content fetch is 157KB. Probe `?select=file_path,updated_at&client_id=eq.<tier>` (5.8KB, 0.38s from WAN) → if `max(updated_at)` matches the memo, reuse the built index string; else rebuild. |
| `B8` ClickUp, `B9` compaction | **cached 300s**, matching local `TTL_FRESH` | Parity with `inject-live-context.py:38`. |
| `P16` operator rules | **compile-time literal** | F8 — no reachable data source. See P16 for the drift hazard. |

**Cache substrate.** Deno edge functions are stateless per *invocation* but isolates are reused while warm, so a module-scope `Map` is a real (best-effort) cache with no new infrastructure. It is honestly best-effort: a cold isolate rebuilds. We do **not** create a cache table — that would be a DB write, and `claude_memory` is read-only this run. If Phase 2 measures the cold-start rebuild as material, a `Cache-Control`-fronted storage object is the follow-up, on the ballot.

**Latency budget.** Probes from Ivan's Mac over WAN (upper bound; the edge function runs in `eu-central-1` alongside the DB, so in-region will be materially lower — **estimate**, unmeasured):

| query | time | bytes |
|---|---|---|
| A: `MEMORY.md`, scoped | 0.50s | 19,869 |
| B: global+shared full content (index source, cold) | 0.57s | 157,289 |
| C: global+shared freshness probe (warm path) | 0.38s | 5,785 |
| D: n8nClaw last 2 | 0.36s | 1,140 |
| E: `compiled_context` | 0.32s | 4,840 |

Warm path = A ∥ C ∥ D ∥ E in a `Promise.allSettled` (the local hook's `ThreadPoolExecutor(max_workers=5)` shape, `inject-live-context.py:303-316`) ≈ **one round-trip's latency, ~0.5s WAN / less in-region**. Cold path adds B.

---

## 5. THE BLOCK-BY-BLOCK MAP

14 blocks from the local injector as enumerated in `phase0-research-injector.md` §1, **plus 2 additional parity blocks** (P15, P16) that the injector does not carry because locally they arrive by a different mechanism — and which "full memory parity with Ivan's local Claude Code instance" requires.

**Coverage: 16 blocks — 1 verbatim / 11 adapt / 4 drop.**

Sizes measured today by re-implementing each block's logic against the live sources. `est_tok = chars ÷ 4`.

| # | Local block (file:line) | Verdict | Container-side / broker-side data source | Freshness | chars | est_tok |
|---|---|---|---|---|---|---|
| **B1** | Module constants + `sys.path` + imports (`inject-live-context.py:29-40`) | **ADAPT** | All five hard-coded Mac paths (`:32-35`) become broker constants; `CLICKUP_TEAM="90132938061"` (`:36`) stays a literal; `TTL_FRESH/STALE` (`:38-39`) survive; `MAX_LEN=9000` (`:40`) is **replaced** by `MAX_SYSTEM_PROMPT_CHARS=36_000` (§3). `read_supa_key()`'s markdown-regex key lookup (`hooks/lib/identify_client.py:29-43` local) becomes `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`. | n/a | — | — |
| **B2** | Cache layer `cache_path_for`/`emit` (`:43-51`) | **ADAPT** | `/tmp/claude-live-context.<md5(cwd)>.json` has no analogue (no cwd, no writable per-turn tmp we want). Replaced by a module-scope `Map` in the warm isolate + the `updated_at` freshness probe (§4). The `hookSpecificOutput` JSON envelope of `emit()` is dropped — output is a plain string on `append_system_prompt`. | n/a | — | — |
| **B3** | `parse_frontmatter` + `index_dir` (`:53-87`) | **ADAPT** | Logic ports 1:1 (pure regex/string, no OS calls); the **input** changes from `directory.glob("*.md")` to rows of `claude_memory.content`. `path.name.startswith("_")` becomes `basename(file_path).startsWith('_')` — same skip. **Verified equivalence:** re-running `index_dir` over the DB rows produced byte-identical output to running it over the local dirs (3,941 and 4,110 chars, both sides). | see B10 | — | — |
| **B4** | `fetch_supabase_summaries` (`:90-117`) | **VERBATIM** | Same call, same shape: `GET /rest/v1/n8nclaw_daily_summaries?order=date.desc&limit=2`. Same formatting (`### <date>`, `Topics:` ≤6, `Actions:` ≤4). Only the key source changes (B1). | per-turn live | **871** | **218** |
| **B5** | `fetch_compiled_context(client)` (`:120-174`) | **ADAPT** | Same table, same 3,500-char truncation + `_(truncated…)_` marker (`:170-172`). **Dropped:** the 4-candidate × 2-pattern `ilike` probe loop (`:135-156`), which exists only because `identify()` returns a display name that may not match. Tenant is a literal here, so pin the row: `?client_name=eq.Ivan System`. Probe resolved `client_name = "Ivan System"`, `compiled_at 2026-08-01T06:30:56Z`, `compiled_context` 4,596 chars → 3,540 after the 3,500 cap + marker. ⚠ This block is the one **already** injected unframed by the container hook (F3) — see `INJECTION-SAFETY.md` §T9. | per-turn live | **3,540** | **885** |
| **B6** | `urllib_quote` (`:176-178`) | **DROP** | Pure Python stdlib shim for `urllib.parse.quote`. Deno has `encodeURIComponent`. Nothing to port. |  | — | — |
| **B7** | `fetch_git_log` (`:181-193`) | **DROP** | Two independent reasons, either sufficient. (i) **The repo is not on the container.** F9: `/workspaces` holds clones of `<client>-config.git` only; `ivan` → `ivan-config.git`. `personal-site` is absent from `client_registry.github_repo` for all 8 tenants and from `/app/workspaces-src`. (ii) **The assembler doesn't run on the container anyway** — it runs in Deno at the edge, which has no `git` binary and no checkout of anything. Substitute considered and rejected for this run: a GitHub API call `GET /repos/ivanmanfre/personal-site/commits?since=…` needs a `GITHUB_TOKEN` secret added to the edge function, which is new credential surface for the lowest-value block in the set. **Named ballot item**, not silently dropped. | | — | — |
| **B8** | `fetch_clickup_tasks` (`:196-231`) | **ADAPT** | REST call is location-agnostic and ports as-is. The **credential lookup** does not: local greps `clickup.md` for `API key:\s*(pk_[A-Za-z0-9_]+)` (`:199-207`). Re-source to `Deno.env.get('CLICKUP_API_KEY')`. ⚠ **If that env var is not set on the edge function, this block is absent and the assembler must say so** (`[ClickUp: no key configured — block omitted]`) rather than emit nothing. Note the container's own copy already prefers env then falls back to `rglob("clickup.md")` across **all clients' project dirs** (`claude-code-railway/hooks/inject-live-context.py:150-162`) — a cross-tenant credential scavenge we are not reproducing. Size est. from the `- [status] name (list)` format × 5. | 300s cache | ~300 *(est.)* | ~75 |
| **B9** | `fetch_compaction_proposals` (`:234-260`) | **ADAPT** | Same regex `##\s+\d+\.\s+\[(.+?)\]\s+(.+)`, same "skip if `No proposals`", same ≤3-per-tier / ≤6-total caps. Input becomes three scoped rows: `global/_compaction-review.md`, `shared/_compaction-review.md`, `project/_compaction-review.md`. 🔴 **The third one is an F4 collision path** — it MUST be fetched `?client_id=eq.ivan&file_path=eq.project/_compaction-review.md` or it can return ProSWPPP's cleanup queue. Local mtime-age logic (`:253`, `:256-257`) is dead code locally (computes `age_days`, does nothing with it) and is dropped. Measured live: 6 proposals across 3 tiers. | 300s cache | **412** | **103** |
| **B10** | `build_global_index()` + `build_shared_index()` (`:263-274`) | **ADAPT** | Same two headers verbatim (`## Global memory tier (~/.claude/memory/global/)` / `## Shared tech memory tier …` + "Loaded for every session. Read body on demand."). Source: `?client_id=eq.global` (28 rows → 26 after `_`-prefix skip) and `?client_id=eq.shared-tech` (29 → 27), **one query each** (F5). Output proven byte-identical to local. | cached + probe | **3,941** + **4,110** | **985** + **1,028** |
| **B11** | `main()` stdin/stdout hook protocol (`:277-291`, `:356-366`) | **DROP** | The `{"cwd": …}` stdin read and the `hookSpecificOutput.additionalContext` JSON envelope are SessionStart-hook protocol. The assembler is a function inside a request handler; it returns a string. The `if not cwd: return 0` guard (`:290-291`) has no analogue — there is no cwd. | | — | — |
| **B12** | `main()` fresh-cache short-circuit (`:293-298`) | **ADAPT** | Same intent (don't rebuild inside `TTL_FRESH=300`), different substrate: memo lookup in the warm isolate keyed by block, not one blob keyed by `md5(cwd)`. Per-block keying is the improvement — the live blocks (B4/B5/P15) stay live while the stable ones (B8/B9/B10) stay cached, instead of the local all-or-nothing 5-minute freeze. |  | — | — |
| **B13** | `identify(cwd)` (`:300`, `hooks/lib/identify_client.py:113-168`) | **DROP** | Path-map → git-remote → alias-substring resolution, all three cwd-derived. Replaced by a **literal**: the broker serves exactly one allowlisted user (`index.ts:94-97`), so the tenant is `ivan`, constant. Dropping this is a *security* improvement, not just a portability one (§1 reason 1). The header line it feeds (`:323-329`) survives as B14's output with the client hard-coded. | | — | — |
| **B14** | Parallel orchestration + assembly order + stale fallback + truncation (`:303-316`, `:318-338`, `:340-348`, `:350-355`) | **ADAPT** | `ThreadPoolExecutor(max_workers=5)` with per-future 5s timeout and blanket `except` (`:312-316`) → `Promise.allSettled` with per-fetch `AbortSignal.timeout(4000)`; a failed block is **omitted and named** (`[B4 n8nClaw: unavailable]`) rather than silently `None`. Assembly order preserved exactly: client header → compiled → summaries → *(git — gone)* → clickup → proposals → global idx → shared idx, then the two new blocks. Timestamp header `<!-- Live system context auto-injected <ts> -->` (`:352`) kept. Stale-cache fallback (`:340-348`) kept in spirit: if every block fails, emit the last good assembly if <24h old (`TTL_STALE`), labelled `[STALE: assembled <ts>, live sources unreachable]` — labelled, where local emits it indistinguishably. Truncation → §3 load-shed. Framing/delimiters (`INJECTION-SAFETY.md` §2) are added here. | per-turn | ~1,200 *(est., framing + headers + delimiters)* | ~300 |
| **P15** | **project hot index `MEMORY.md`** — *not in the injector* | **ADAPT (new)** | Locally this reaches every session through Claude Code's own auto-memory mechanism, not through the hook (`_SCHEMA.md:8-13` calls it the "**Hot**" tier: "auto-loaded into every session"). On the container it is **not** loaded: `autoMemoryEnabled: true` is set (`entrypoint.sh:271`) but the restore drops the file at `/workspaces/project/MEMORY.md` (F2), which is not `cwd/CLAUDE.md`, not a parent's, and not `~/.claude/CLAUDE.md`. So without this block the chat is missing the single densest artefact in the whole system. Source: `?client_id=eq.ivan&file_path=eq.project/MEMORY.md` (🔴 F4 — scoping is load-bearing; unscoped returns ProSWPPP's 9,452-char index too). Injected **whole, never mid-truncated** (§3). Measured today: 124 lines, 19,162 chars, `updated_at 2026-08-01T10:40:18Z`. | per-turn live | **19,162** | **4,790** |
| **P16** | **`~/.claude/CLAUDE.md` operator standing rules** — *not in the injector* | **ADAPT (new, inlined literal)** | Ivan's global instructions, loaded into every local session. F8: **not mirrored to any reachable source** — no `claude_memory` row, no container file. Only portable form is a compile-time literal in the assembler. 611 chars / 6 lines. ⚠ Two flags. (1) **Drift**: if Ivan edits the local file the broker copy goes stale silently. Phase 5 gets a verification row that diffs the literal against `/Users/ivanmanfredi/.claude/CLAUDE.md`; the durable fix is a `global/_operator-rules.md` memory row, which is a WRITE and therefore next run. (2) **Capability**: its content is "never ask permission for routine work… just do the work", injected into a chat whose upstream runs `bypassPermissions` + `Bash` on a multi-tenant box. Parity says inject it; honesty says name it. **Ballot item: does the inbox chat get the never-ask rule?** — surfaced, not silently answered either way. | literal | **611** | **153** |

### Totals

| | chars | est_tok |
|---|---|---|
| Measured blocks (B4, B5, B9, B10a, B10b, P15, P16) | 32,647 | 8,162 |
| Estimated blocks (B8, B14 framing) | ~1,500 | ~375 |
| **Full-parity per-turn injection** | **~34,100** | **~8,540** |
| Cap (§3) | 36,000 | ~9,000 |
| Headroom | ~1,900 | ~460 |

**`MEMORY.md` is 56% of the payload.** That is the number the tiering ballot is actually about. Two tiering options exist and neither is taken here: (i) inject `MEMORY.md`'s "Critical rules" + "Live state & open items" sections only (~40% saving, loses the trap sections that are the file's whole point), (ii) inject it fully but with prompt caching if the model/route supports a cacheable system prefix — the correct answer if available, since the block is byte-stable between edits. **Phase 2 measures; the ballot decides.**

---

## 6. What parity CANNOT include, stated plainly

1. **`personal-site` git activity (B7).** F9 — the repo exists on no container and the assembler has no git. A GitHub-API substitute is possible but adds a token to the edge function. *Missing capability: "what did I ship to the site today".*
2. **`~/.claude/CLAUDE.md` as a live source (P16).** F8 — inlined literal, will drift. *Missing capability: edits to Ivan's standing rules propagate automatically.*
3. **Local-only memory tiers of other projects.** `~/.claude/projects/<other-slug>/memory/` exists for Interlude, Lemonade, SWPPP, Agency Ops (`phase0-research-injector.md` §4). Deliberately out of scope — those are other tenants (§2).
4. **The container's restored memory tree.** By decision, **we rely on none of it.** F1 (truncated to 53% of rows, non-deterministically), F2 (written to `/workspaces/*`, invisible to every reader that wants it), F4 (path collisions between tenants). Every parity block reads live from Supabase, scoped, at assemble time. Anything the entrypoint restore does or stops doing has zero effect on this design — which is the point.
5. **ClickUp, if `CLICKUP_API_KEY` is not on the edge function (B8).** Absent, and *announced as absent*.
6. **Anything requiring a write.** `claude_memory` is read-only this run; no cache table, no `global/_operator-rules.md` row, no repair of the container's broken skills.
7. **Session-log recall (`unscoped`, and `ivan`'s 792 episodic rows).** Out of the injection channel by design; `ivan`'s episodic rows are reachable only through the explicit depth mode (`DEPTH-SPEC.md`), `unscoped` not at all (§2).

---

## 7. Handoffs

**Phase 2 (tournament / skeptics)** — measure, don't assume: real token count of the assembled block at the model in use (replace every `est_tok` here); the **doubled** turn caused by the container hook still firing (F3); cold-vs-warm isolate latency; the `MEMORY.md` tiering options in §5.

**Phase 2 injection skeptic** — `INJECTION-SAFETY.md` §6 carries the fixture format and pass criteria. Note the pre-existing unframed channel (F3/T9) is fair game.

**Phase 3 (build)** — order: (1) assembler module + `MAX_SYSTEM_PROMPT_CHARS` + `append_system_prompt` forwarding in `index.ts`; (2) depth block (`DEPTH-SPEC.md`); (3) Railway `model` passthrough, serialized last. The assembler's per-tier queries are non-negotiable (F5). The two collision paths (F4) are non-negotiable (`project/MEMORY.md`, `project/_compaction-review.md`).

**Phase 5 (verification)** — rows this spec adds: cross-tenant proof query (§2, both the clean REST read and the brain-query leak-vs-scoped pair); a captured real-turn `append_system_prompt` showing all 12 injected blocks with headers; the P16 drift diff; a forced-over-cap turn showing the visible `[LOAD-SHED: …]` line; a forced all-blocks-fail turn showing the labelled `[STALE: …]` fallback.

**Report to Ivan (watch-first)** — F1 and F2 are live defects in `entrypoint.sh` that this run does not touch and does not depend on, but they mean **the container's on-disk memory is a non-deterministic 53% slice written to a tenant-readable junk tree**. F4 means one boot-ordering change silently swaps Ivan's `MEMORY.md` for ProSWPPP's.
