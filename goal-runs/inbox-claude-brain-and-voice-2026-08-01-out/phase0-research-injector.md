---
name: Phase 0 research — Claude Code memory/context machinery inventory
description: Technical inventory of Ivan's local Claude Code memory system (inject-live-context.py, recall/brain skills, claude-brain-query edge fn, memory tiers) for remote-container portability planning.
type: reference
---

# Phase 0 — Claude memory/context machinery inventory (for remote-container port)

Goal-run: inbox-claude-brain-and-voice-2026-08-01. READ-ONLY research. All claims cited file:line. UNVERIFIED marked explicitly.

---

## 1. `/Users/ivanmanfredi/.claude/hooks/inject-live-context.py` — block-by-block

File is 371 lines (`/Users/ivanmanfredi/.claude/hooks/inject-live-context.py:1-371`). It is a **SessionStart hook**: stdin carries `{"cwd": "..."}`, stdout emits a JSON `hookSpecificOutput.additionalContext` string that gets prepended to the new session's context.

### Module-level constants and imports (lines 1-40)
- `/Users/ivanmanfredi/.claude/hooks/inject-live-context.py:29-30`: `sys.path.insert(0, "/Users/ivanmanfredi/.claude/hooks/lib")` then `from identify_client import identify, read_supa_key, SUPABASE_URL`. Hard-codes an absolute Mac path onto `sys.path`.
- `:32-36`: Hard-coded absolute paths — `GLOBAL_MEM_DIR`, `SHARED_MEM_DIR`, `PROJECT_MEM_DIR_IVAN` (all under `/Users/ivanmanfredi/.claude/...`), and `SITE_REPO = "/Users/ivanmanfredi/Desktop/personal-site"`.
- `:36`: `CLICKUP_TEAM = "90132938061"` hard-coded team id.
- `:38-40`: `TTL_FRESH=300`s, `TTL_STALE=86400`s, `MAX_LEN=9000` chars (hard output cap).

**Portability:** not-portable-verbatim — every path is an absolute Mac filesystem path baked into constants. A remote container needs these re-parameterized (env vars or a config file) and the referenced dirs need to exist in the container (git-sync of `~/.claude/memory/*` and the project memory dir), or the blocks that read them need to be swapped for Supabase-backed equivalents.

### `cache_path_for` / `emit` (lines 43-51)
Cache keyed by `md5(cwd)` under `/tmp/claude-live-context.<hash>.json`. **Portable-verbatim** — `/tmp` exists on any Linux container; this is pure caching logic with no Mac dependency.

### `parse_frontmatter` / `index_dir` (lines 53-87)
Pure text parsing of YAML-ish frontmatter (`description:` field) and first-`# `-heading fallback, over `directory.glob("*.md")`, skipping files starting with `_`. **Portable-with-adaptation**: the logic itself is portable Python (no OS-specific calls), but it depends on `GLOBAL_MEM_DIR`/`SHARED_MEM_DIR` (lines 32-33) existing on disk in the container. Adaptation: either (a) sync `~/.claude/memory/global` and `~/.claude/memory/shared` into the container filesystem (e.g. via git or a startup rsync/pull step), or (b) replace with a Supabase query against `claude_memory WHERE client_id IN ('global','shared-tech')` (the mirror already exists per `/Users/ivanmanfredi/.claude/memory/global/big-brother-brain-arch.md:15-16` and `:27`).

### `fetch_supabase_summaries` (lines 90-117)
Reads Supabase key via `read_supa_key()` (imported from `identify_client.py`, see §1 lib below), then `GET {SUPABASE_URL}/rest/v1/n8nclaw_daily_summaries?order=date.desc&limit=2` with `apikey`/`Authorization: Bearer <key>` headers via `urllib.request`. Formats last-2-days WhatsApp daily summaries.
**Portability: portable-verbatim** given `SUPABASE_URL` + a Supabase key are available — this is exactly the credential shape a remote container with `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` would have. Uses `urllib.request` (stdlib, no local-only dependency). The only wrinkle: `read_supa_key()` currently sources the key from local memory files, not an env var (see below) — that needs re-wiring, not this function.

### `fetch_compiled_context(client)` (lines 120-174)
Given the resolved `client` dict, tries several `client_name` candidates (display name, first word, client_id, title-cased id) against `GET {SUPABASE_URL}/rest/v1/client_instances?select=compiled_context,compiled_at,client_name&client_name=ilike.<pattern>&limit=1`, first exact then wildcard. Returns a `## Active client: <name>` block with up to 3500 chars of `compiled_context`.
**Portability: portable-verbatim** (pure Supabase REST call over `urllib.request`, no filesystem/Mac dependency) — contingent on `client` being resolved (see `identify()` below, which IS Mac-filesystem-dependent).

### `urllib_quote` (lines 176-178)
Trivial URL-encoding helper. **Portable-verbatim.**

### `fetch_git_log()` (lines 181-193)
Runs `git -C /Users/ivanmanfredi/Desktop/personal-site log --oneline -8 --since="24 hours ago"` via `subprocess`, gated on `Path(SITE_REPO, ".git").exists()`.
**Not-portable**: depends on a local clone of `personal-site` existing on disk with `.git` present, and on the `git` binary. A remote container "has no local git repos" per the task framing. Options: (a) drop this block entirely for the remote variant, (b) replace with a GitHub API call (`GET /repos/<owner>/personal-site/commits?since=...`) using a `GITHUB_TOKEN`, which is portable-with-adaptation.

### `fetch_clickup_tasks()` (lines 196-231)
Looks for a ClickUp API key by regex-scanning `PROJECT_MEM_DIR_IVAN / "clickup.md"` then `GLOBAL_MEM_DIR / "clickup.md"` for pattern `API key:\s*(pk_[A-Za-z0-9_]+)` (`:199-207`). If found, calls `GET https://api.clickup.com/api/v2/team/{CLICKUP_TEAM}/task?date_updated_gt=<24h-ago-ms>&include_closed=false&order_by=updated&reverse=true&page=0`, formats last 5 tasks.
**Portability: portable-with-adaptation.** The ClickUp REST call itself is location-agnostic, but the *credential lookup* is a local-file grep (not-portable as written). Adaptation: source the ClickUp key from an env var (`CLICKUP_API_KEY`) or a Supabase-vaulted secret instead of grepping a markdown memory file for a regex-matched key. Task explicitly notes the target container "has no ClickUp cache" — this block is the one place ClickUp is read, and it needs the credential re-sourced, not the dir cached.

### `fetch_compaction_proposals()` (lines 234-260)
Checks three candidate `_compaction-review.md` files (project/global/shared tiers) for pending memory-cleanup proposals, parsed via regex `##\s+\d+\.\s+\[(.+?)\]\s+(.+)`.
**Not-portable-as-written** (reads local files under `~/.claude/...`); **portable-with-adaptation** if those three memory tiers are synced into the container filesystem, since the parsing itself is pure text/regex with no Mac dependency.

### `build_global_index()` / `build_shared_index()` (lines 263-274)
Thin wrappers over `index_dir()` for the two always-on tiers. Same portability class as `index_dir` above — needs the memory dirs present locally in-container.

### `main()` (lines 277-371) — orchestration
- `:278-291`: Reads `cwd` from stdin JSON; returns silently (`return 0`, no injection) if no cwd. Pure hook-protocol handling, **portable-verbatim**.
- `:293-298`: Fresh-cache short-circuit (age < 300s) — reads `/tmp/claude-live-context.<hash>.json` verbatim. **Portable-verbatim.**
- `:300`: `client = identify(cwd)` — delegates to `identify_client.py` (see below); this is the piece that decides which "client" (tenant) this session belongs to. **Not-portable-as-written** in a remote container unless cwd-based resolution is replaced by an explicit client_id (e.g. an env var `CLIENT_ID` set by whatever launches the container), since `identify()` leans on git-remote inspection and alias matching against local cwd strings.
- `:303-316`: `ThreadPoolExecutor(max_workers=5)` runs `fetch_supabase_summaries`, `fetch_git_log`, `fetch_clickup_tasks`, `fetch_compaction_proposals`, `fetch_compiled_context` in parallel with a 5s timeout each, swallowing all exceptions (`except (FuturesTimeout, Exception)`). **Portable-verbatim** as an orchestration pattern (stdlib threading) — the individual futures carry the portability constraints listed above.
- `:318-320`: Builds global/shared indexes (always-on, cheap+local). Same as `index_dir` portability.
- `:322-338`: Assembles ordered `parts` list: client header → compiled context → summaries → git → clickup → proposals → global idx → shared idx. Pure string assembly, **portable-verbatim**.
- `:340-348`: If nothing but the client-header line came back, falls back to stale cache (<24h) or emits empty string. **Portable-verbatim** (pure cache-file logic).
- `:350-366`: Builds final timestamped `body` (truncated to `MAX_LEN=9000`), writes it to the per-cwd `/tmp` cache, and prints the JSON payload to stdout. **Portable-verbatim.**

### Summary table — inject-live-context.py

| Block | Data source | Creds/paths needed | Portability |
|---|---|---|---|
| Global/shared index | Local `.md` files under `~/.claude/memory/{global,shared}` | Filesystem dirs must exist in container | with-adaptation: sync dirs OR swap for Supabase query on `claude_memory` |
| `fetch_supabase_summaries` | Supabase `n8nclaw_daily_summaries` table | `SUPABASE_URL` + key | verbatim |
| `fetch_compiled_context` | Supabase `client_instances` table | `SUPABASE_URL` + key, resolved `client` | verbatim (once client resolved) |
| `fetch_git_log` | Local git clone of personal-site | `git` binary + local `.git` clone | not-portable; adapt to GitHub API + token, or drop |
| `fetch_clickup_tasks` | ClickUp REST API | ClickUp API key (currently grepped from local memory `.md` file) | with-adaptation: re-source key from env/vault |
| `fetch_compaction_proposals` | Local `_compaction-review.md` files, 3 tiers | Filesystem dirs | with-adaptation: sync dirs |
| `identify(cwd)` (client resolution) | Local cwd string, `.git` remote, Supabase `client_registry` | Filesystem + Supabase | not-portable as cwd-based; needs explicit client_id substitute |
| Cache layer | `/tmp/claude-live-context.<hash>.json` | none | verbatim |

---

## 2. `recall` and `brain` skills

### 2a. `recall` skill

Skill doc: `/Users/ivanmanfredi/.claude/skills/recall/SKILL.md:1-84`. Mechanically invokes:

```
python3 ~/.claude/skills/recall/recall.py "<query>" [--cwd /path] [--episodic]
```
(`/Users/ivanmanfredi/.claude/skills/recall/SKILL.md:11`)

Script: `/Users/ivanmanfredi/.claude/skills/recall/recall.py:1-472`. What it does, mechanically:

1. **Local-dir keyword search** (`search_dir`, `:212-253`): globs `*.md` under `GLOBAL_DIR` (`~/.claude/memory/global`, `:35`) and `SHARED_DIR` (`~/.claude/memory/shared`, `:36`), plus a project dir resolved via `identify(cwd)` (`:395-407`, tries `/Users/ivanmanfredi/.claude/projects/<cwd-slug>/memory` then falls back hard-coded to the Ivan project memory dir at `:401`). Scores lines by exact/substring/word-overlap match against the query, excludes `archive/` subdirs and `_`-prefixed files, annotates freshness date (filename `YYYY-MM-DD` else mtime, `file_date` `:85-93`) and WIP-staleness (`wip_stale_from_text`, `:66-82`, frontmatter `status: wip` + `observed:` date >7 days old).
2. **Supersession-map build** (`build_supersession_map`, `:137-209`): scans all `.md` files in the searched tiers for frontmatter/blockquote `SUPERSEDED → X` markers and each tier's `MEMORY.md` index lines, resolves chained supersessions to a terminal target.
3. **Semantic search** (`search_semantic`, `:256-327`): POSTs to `RECALL_FN_URL = {SUPABASE_URL}/functions/v1/claude-memory-recall` (normal) or `BRAIN_FN_URL = {SUPABASE_URL}/functions/v1/claude-brain-query` with `mode: "episodic"` (when `--episodic`), body `{query, client_ids, match_count}` (or `{mode:"episodic",...}`), auth via `read_supa_key()` (from `identify_client.py`). `client_ids` = `["global","shared-tech"]` plus the resolved project's `client_id` if any (`:411-413`). Parses `low_confidence` flag (server-computed or client-computed floor, `:317-327`).
4. **n8nClaw summary search** (`search_summaries`, `:330-353`): `GET {SUPABASE_URL}/rest/v1/n8nclaw_daily_summaries?date=gte.<30d-ago>&summary=ilike.%25<query>%25&order=date.desc&limit=10`.
5. **CLI output**: tier-grouped, each hit annotated with freshness date, supersession flag, WIP-staleness flag (`fmt_hit`, `:356-365`; `main`, `:368-467`).

**Credentials used**: `read_supa_key()` from `identify_client.py` (Supabase key sourced from a local `.md` file — see §2c below); no ClickUp/git credentials touched by recall.py itself.

**Portability**: the *keyword-search-over-local-files* part (steps 1-2, 4) is not-portable-verbatim (depends on `~/.claude/memory/{global,shared}` and a resolved project memory dir existing on disk); the *semantic search* part (step 3) is portable-verbatim (pure HTTP call to a Supabase edge function, works from any container with `SUPABASE_URL`+key). For a remote container without the local memory-tier files, recall would need either (a) the memory dirs synced in, or (b) fall back to semantic-only mode (drop `search_dir`/`build_supersession_map`, keep `search_semantic` + `search_summaries`).

### 2b. `brain` skill

Skill doc: `/Users/ivanmanfredi/.claude/skills/brain/SKILL.md:1-137`. No script — the skill is pure documentation of how to call the edge function directly via `curl`/HTTP. Mechanically it teaches invoking:

```
POST https://bjbvqvzbzczjbatgmccb.supabase.co/functions/v1/claude-brain-query
Headers: Authorization: Bearer <ANON_OR_SERVICE_KEY>, Content-Type: application/json
```
(`/Users/ivanmanfredi/.claude/skills/brain/SKILL.md:12-18`)

Five documented modes with exact request/response shapes (`:24-70`):
- `recall` — `{mode, query, client_ids?, match_count?}` → `[{client_id, file_path, summary, rrf, vec, bm25}]`
- `client_proposals` — `{mode, client_slug}` → `{client, count, totals, proposals[]}`
- `connections` — `{mode, target_kind, target_value, limit?}` → `{count, backlinks[]}`
- `neighbors` — `{mode, file_path}` → outgoing wikilinks
- `related_to` — `{mode, from_kind, from_id}` → `{relations[]}`

Credential note: "Anon key works — reads only. Use the service key from `~/.claude/memory/projects/-Users-ivanmanfredi-Desktop-Ivan---Content-System/memory/supabase.md` for full access." (`:20` — NB this path string in the SKILL.md itself looks like a typo/older path; the actual key file found on disk is `/Users/ivanmanfredi/.claude/projects/-Users-ivanmanfredi-Desktop-Ivan---Content-System/memory/supabase.md`, no `memory/projects/` segment — UNVERIFIED whether the doc path is stale or intentional, but the live key clearly resolves via `identify_client.py:read_supa_key()`, see §2c.)

**Portability: portable-verbatim.** This is the most container-friendly piece of the whole system — it's a stateless HTTP contract, no filesystem, no git, no ClickUp. A remote container with `SUPABASE_URL` + a Supabase key can call every mode exactly as documented. (Confirmed live in §3 below.)

### 2c. Shared credential-lookup dependency: `identify_client.py`

File: `/Users/ivanmanfredi/.claude/hooks/lib/identify_client.py:1-176`. Used by both `inject-live-context.py` and `recall.py`.

- `read_supa_key()` (`:29-43`): scans, in order, `PROJECT_MEM_DIR/supabase.md`, `~/.claude/memory/global/supabase.md`, `~/.claude/memory/shared/supabase.md` for a regex `iat=1768305080\)?:\s*(eyJ[A-Za-z0-9._-]+)` — i.e. the Supabase JWT is stored as literal text inside a markdown memory file, tagged by its JWT `iat` claim, and extracted by regex. **Not-portable-verbatim**: this is the single most fragile piece for a remote port — it assumes a specific markdown file with a specific comment format exists on the local Mac disk. **Adaptation**: replace with `os.environ["SUPABASE_SERVICE_KEY"]` (the container per the task prompt already has this) — trivial one-line swap once the container is confirmed to export that env var.
- `load_registry()` (`:46-72`): `GET {SUPABASE_URL}/rest/v1/client_registry?select=...&is_active=eq.true`, cached at `/tmp/client-registry.json` (1h TTL). **Portable-verbatim** (pure Supabase REST call + `/tmp` cache).
- `load_path_map()` (`:75-84`): reads `~/.claude/memory/global/_client_paths.json` — explicit cwd→client_id overrides (`/Users/ivanmanfredi/.claude/memory/global/_client_paths.json` maps `/Users/ivanmanfredi/Desktop/{Ivan - Content System, personal-site, ivan-video-engine, claude-code-railway, ivan-recorder}` → `"ivan"`, and `/Users/ivanmanfredi/Desktop/Interlude` → `"interlude"`). **Not-portable**: keyed on literal Mac desktop paths that will never match a container cwd.
- `get_git_remote()` (`:98-110`) + `normalize_repo()` (`:87-95`): shells out to `git config --get remote.origin.url` in `cwd`, matches against `client_registry.github_repo`. **Not-portable** in a container with no local git checkout (per task framing), though harmless — it just returns `None` on non-repo dirs (`:99`, `Path(cwd, ".git").exists()` guard fails closed, not an error).
- `identify(cwd)` (`:113-168`): tries path-map → git-remote → alias-in-cwd-string, in that order. **Not-portable as designed for cwd-based resolution** — a headless remote container invoked for e.g. "brain query for client X" has no meaningful local `cwd` to identify from. **Adaptation**: the container should receive an explicit `client_id`/`CLIENT_ID` env var or request parameter instead of relying on `identify(cwd)` at all; `identify()` becomes dead code in the ported version, or is kept only for interactive/dev use.

---

## 3. `claude-brain-query` edge function — source, contract, deployment probe

### Source location on disk

**Not found as a live, git-tracked source file in any active repo** (searched `~/Desktop/personal-site`, `~/Desktop/ivan-listener`, `~/Desktop/resources`, `~/Desktop/Ivan - Content System`, and ~60 personal-site worktrees under `~/Desktop/ps-*-wt` / `~/Desktop/personal-site-*-wt` — none contain a `supabase/functions/claude-brain-query/` directory). Client-side *consumers* of the function do exist in the personal-site repo (`/Users/ivanmanfredi/Desktop/personal-site/hooks/useBrainStats.ts:1-241`, `/Users/ivanmanfredi/Desktop/personal-site/hooks/useBrainGraph.ts` — present across every personal-site worktree), confirming the function is called from the dashboard, but its own Deno source is not checked into any repo found on this machine.

The actual function source **was found in a snapshot backup**, not a live repo: `/Users/ivanmanfredi/.claude/backups/memory-efficiency-2026-07-25/claude-brain-query.v22.as-deployed.ts` (11541 bytes, labelled "as-deployed", dated 2026-07-26) and a prior `claude-brain-query.v19.pre-run.ts` in the same directory. Companion files in that backup dir: `claude-memory-recall.v18.pre-run.ts` (the sibling function `recall.py` calls for non-episodic recall, `RECALL_FN_URL`), `match_claude_memory.pre-run.sql` / `match_claude_memory.v22-era.as-deployed.sql` (the underlying RPC), `ddl1-kind-column.applied.sql`, `ddl3-constraint-swap.applied.sql`, `memory-compactor.py.pre-run`, `recall.py.pre-run`, `compactor-plist.sha.pre-run`.

**Implication for the port**: there is currently **no canonical git home** for this edge function's source — it lives only as a dated backup snapshot on Ivan's laptop plus whatever is live in the Supabase project itself. Any remote-container port plan needs to either (a) pull the function source down fresh via `supabase functions download claude-brain-query` from the live project, or (b) adopt this backup file as the new canonical source and commit it into a repo. This is itself a portability/durability gap independent of the container work.

### Contract (read from `claude-brain-query.v22.as-deployed.ts`)

- Runtime: Deno edge function (`import 'jsr:@supabase/functions-js/edge-runtime.d.ts'`, `:13`), uses `npm:@supabase/supabase-js@2` with a **service-role** client: `Deno.env.get('SUPABASE_URL')` + `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` (`:15-16`, `:102`). CORS wide open (`Access-Control-Allow-Origin: '*'`, `:19-24`).
- Auth model: the function itself doesn't check the caller's bearer token against anything — Supabase's gateway validates the JWT (anon or service) before invoking the function, then the function uses its OWN service-role key internally regardless of which key the caller presented. This matches the brain SKILL.md's claim that "anon key works — reads only" (`/Users/ivanmanfredi/.claude/skills/brain/SKILL.md:16`), because the function code has no additional row-level gating — all requests get full service-role read/write regardless of caller key. UNVERIFIED: whether Supabase project settings enforce `verify_jwt` on this function (would reject requests with no/garbage bearer token) — the probe below used a valid anon JWT so this wasn't tested.
- Six modes (`switch(mode)`, `:105-302`):
  1. `recall` / `episodic` (`:106-154`): requires `query`; optional `match_count` (capped 25), `client_ids[]`. Embeds the query via OpenAI `text-embedding-3-small` (dim 1536) using a key fetched through `sb.rpc('get_vault_secret', {p_name:'OPENAI_API_KEY'})` (`:34-40`) — embedding failure is swallowed (`catch {}`, `:118`) and the RPC still runs BM25-only. Calls `sb.rpc('match_claude_memory', {query_text, query_embedding, client_ids, match_count, p_kind})` (`:119-125`) — the RPC (full SQL at `/Users/ivanmanfredi/.claude/backups/memory-efficiency-2026-07-25/match_claude_memory.v22-era.as-deployed.sql:1-56`) does BM25 (`ts_rank_cd` over a `tsv` column, `plainto_tsquery('english', query_text)`) + vector similarity (`1 - (embedding <=> query_embedding)`) fused via reciprocal-rank-fusion (`1/(60+rank)` summed per source, `:33-41` of the SQL) over `public.claude_memory`, filtered by `kind` (`'semantic'` vs `'episodic'`) and optional `client_ids`. Computes a `low_confidence` flag server-side (`VEC_FLOOR=0.40`; low-confidence when zero BM25 hits AND best vector similarity ≤ 0.40, `:130-133`). Response: `{mode, query, used_vector, low_confidence, results:[{client_id, file_path, summary, rrf, vec, bm25, updated_at, stale_wip}]}`.
  2. `client_proposals` (`:155-217`): requires `client_slug`. Queries `claude_memory_relations` for `from_kind='proposal', to_kind='client', relation='proposal_for', to_id ilike <slug>`, joins a second lookup for `relation='tracked_in', to_kind='clickup'` to attach ClickUp task ids, sums `metadata.amount` per currency. Returns `{mode, client, count, totals, proposals[], note?}`.
  3. `connections` (`:218-240`): requires `target_kind`, `target_value`; optional `limit` (capped 100). Calls `sb.rpc('backlinks_for_target', {p_target_kind, p_target_value, p_client_ids:null, p_limit})`. Returns `{mode, target_kind, target_value, count, backlinks}`.
  4. `neighbors` (`:241-267`): requires `file_path`. Looks up the row id in `claude_memory` by `file_path` (most-recent by `updated_at`), then `sb.rpc('neighbors_of_file', {p_from_id})`. Returns `{mode, file_path, count, neighbors}`.
  5. `related_to` (`:268-289`): requires `from_kind`, `from_id`. Calls `sb.rpc('relations_from', {p_kind, p_id, p_client_ids:null, p_limit:100})`. Returns `{mode, from_kind, from_id, count, relations}`.
  6. default/unknown mode → 400 with `valid_modes` list (`:290-301`).
- Error handling: any thrown error anywhere → `500 {error: message}` (`:303-307`); invalid JSON body → `400` (`:94-101`); non-POST/non-OPTIONS → `405`.

### Deployment probe (live, run during this research)

```bash
ANON="<VITE_SUPABASE_ANON_KEY from /Users/ivanmanfredi/Desktop/ivan-inbox/.env.local>"
curl -sS -i -X POST "https://bjbvqvzbzczjbatgmccb.supabase.co/functions/v1/claude-brain-query" \
  -H "Authorization: Bearer $ANON" -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d '{"mode":"recall","query":"test portability probe","client_ids":["global"],"match_count":1}' \
  --max-time 15
```

Raw response: `HTTP/2 200`, headers included `sb-project-ref: bjbvqvzbzczjbatgmccb`, `x-served-by: supabase-edge-runtime`, `x-sb-edge-region: eu-central-1`, `sb-gateway-version: 1`. Body:

```json
{"mode":"recall","query":"test portability probe","used_vector":true,"low_confidence":true,"results":[{"client_id":"global","file_path":"global/feedback-browser-tool.md","summary":"Three browser tools, three lanes:","rrf":0.016,"vec":0.34,"bm25":0,"updated_at":"2026-05-10T09:57:44.727782+00:00","stale_wip":false}]}
```

A follow-up `OPTIONS` request returned `HTTP/2 204` with the expected CORS headers. **Conclusion: the function is confirmed DEPLOYED and LIVE** (not a 404), reachable with the anon key found in `/Users/ivanmanfredi/Desktop/ivan-inbox/.env.local:2` (`VITE_SUPABASE_ANON_KEY`, JWT `iat=1768305080`), and its live behavior (returning `used_vector`, `low_confidence`, `stale_wip` fields) matches the v22-as-deployed source exactly — confirming that backup file is (or is functionally identical to) the currently-live version.

---

## 4. Memory tier layout on disk

| Tier | Path | File count | Notes |
|---|---|---|---|
| Global | `/Users/ivanmanfredi/.claude/memory/global/` | 32 entries (`ls | wc -l`, includes `_SCHEMA.md`, `_client_paths.json`, `_compaction-review.md` + 29 topic `.md` files) | Loaded every session regardless of cwd. Mirrored to Supabase `claude_memory` with `client_id='global'` (`/Users/ivanmanfredi/.claude/memory/global/_SCHEMA.md:9`). |
| Shared-tech | `/Users/ivanmanfredi/.claude/memory/shared/` | 29 entries (`_SCHEMA.md`, `_compaction-review.md` + 27 topic `.md` files) | Cross-client stack knowledge (n8n/Supabase/Railway/Anthropic quirks). Mirrored with `client_id='shared-tech'` (`/Users/ivanmanfredi/.claude/memory/shared/_SCHEMA.md:9`). |
| Project (Ivan) | `/Users/ivanmanfredi/.claude/projects/-Users-ivanmanfredi-Desktop-Ivan---Content-System/memory/` | 603 top-level entries; 600 are `.md` files directly under the dir; plus subdirs `archive/` (7 `.md` files), `goal-runs/` (55 subdirectories, incl. this one), and a `.git` (the memory dir is itself a git repo) | Contains `MEMORY.md` (the always-loaded "hot" index, `/Users/ivanmanfredi/.claude/projects/.../memory/_SCHEMA.md:12`), `_SCHEMA.md`, `_compaction-review.md`, `_tier-migration-applied.md`, and ~600 dated topic files. |
| Other clients (same convention) | `/Users/ivanmanfredi/.claude/projects/<encoded-project-path>/memory/` | Interlude: 3 md; Lemonade: 1 md; SWPPP Doc System: 44 md; Agency Ops – PreDemo Agent: 6 md | Confirms the 3-tier pattern (global/shared/project) is per-tenant — each client gets its own `~/.claude/projects/<slug>/memory/` dir, resolved by `identify_client.py` via `_client_paths.json` / git-remote / alias match. |
| Grand total (all tiers, all clients) | — | 1655 `.md` files matching `*/memory/*.md` under `~/.claude/projects/` (`find ... | wc -l`) | Includes nested goal-run subfolders' memory-shaped output files, not just top-level topic files — this is an upper bound, not a clean topic-file count. |
| Loose top-level `~/.claude/memory/` | `/Users/ivanmanfredi/.claude/memory/` | Contains `global/`, `shared/`, `projects/` (redirect-ish — the real project tier lives under `~/.claude/projects/<slug>/memory/`, not `~/.claude/memory/projects/`), `session-summaries/` (1 file: `2026-06-16-nightly-scorer-permanent-fix.json`), and `intelligence-layer-session-summary.json` (a stray/legacy JSON summary, structure: `{topic, discussed[], decisions[], files_changed[]}`). | The `~/.claude/memory/projects/` path referenced in `brain/SKILL.md:20` ("service key from `~/.claude/memory/projects/.../memory/supabase.md`") does not match the actual on-disk path (`~/.claude/projects/.../memory/supabase.md`, no `memory/projects/` prefix) — UNVERIFIED whether this is stale doc or an intentional symlink not found; treated as a doc inaccuracy for this inventory. |

### `MEMORY.md` index convention

Per `/Users/ivanmanfredi/.claude/projects/-Users-ivanmanfredi-Desktop-Ivan---Content-System/memory/_SCHEMA.md:8-13`: three sub-tiers inside the project memory system —

- **Hot** = `MEMORY.md` itself — auto-loaded into every session, **truncated after 200 lines**, so entries must stay dense (one line per topic file, no frontmatter, per `_SCHEMA.md` "File format" section further down the same file).
- **Live** = the SessionStart hook output (`inject-live-context.py`) — n8nClaw summaries + 24h git/ClickUp deltas, cached 5 min.
- **Cold** = the individual topic `.md` files in the memory dir — loaded on demand via `Read`, each with frontmatter `name`/`description`/`type` (`type` ∈ `user | feedback | project | reference`).

Each topic file's frontmatter `description` field is what both `inject-live-context.py`'s `index_dir()` (`/Users/ivanmanfredi/.claude/hooks/inject-live-context.py:66-87`) and `recall.py` (`/Users/ivanmanfredi/.claude/skills/recall/recall.py:96-113`) parse to build compressed indexes — this is a load-bearing convention: files without a `description:` frontmatter field fall back to the first `# ` heading, but lose the intentional one-line summary a human curated.

Global/shared tiers use the same `_SCHEMA.md` + frontmatter convention (`/Users/ivanmanfredi/.claude/memory/global/_SCHEMA.md`, `/Users/ivanmanfredi/.claude/memory/shared/_SCHEMA.md`) but do NOT have their own `MEMORY.md` hot-index file the way the project tier does — they are indexed live, every session, by `inject-live-context.py`'s `build_global_index()`/`build_shared_index()` (`/Users/ivanmanfredi/.claude/hooks/inject-live-context.py:263-274`) rather than via a curated static index file. `recall.py`'s supersession-map builder (`build_supersession_map`, `/Users/ivanmanfredi/.claude/skills/recall/recall.py:180-196`) DOES look for a `MEMORY.md` in every tier dir including global/shared to harvest `SUPERSEDED→` hooks, so a `MEMORY.md` convention is at least partially expected/supported there too even if not universally populated — UNVERIFIED whether global/shared currently have a `MEMORY.md` (not found in the `ls` output at `/Users/ivanmanfredi/.claude/memory/global/` or `/shared/` above — apparently absent for those two tiers today).

---

## Cross-cutting notes for the porting spec

- Every credential this machinery uses (Supabase key, ClickUp key) is currently sourced by **regex-scraping local markdown memory files**, not env vars — `identify_client.py:read_supa_key()` (`/Users/ivanmanfredi/.claude/hooks/lib/identify_client.py:29-43`) and `inject-live-context.py:fetch_clickup_tasks()` (`:199-207`). This is the single biggest re-plumbing task for the port: swap both to `os.environ["SUPABASE_SERVICE_KEY"]` / `os.environ["CLICKUP_API_KEY"]`, which the task states the remote container already has (for Supabase at least).
- Client/tenant resolution (`identify(cwd)`) is fundamentally cwd-string-based and won't function in a container with no meaningful local cwd — needs to become an explicit parameter.
- The two Supabase-only blocks (`fetch_supabase_summaries`, `fetch_compiled_context` in the hook; the entire `claude-brain-query`/`claude-memory-recall` semantic-search path in `recall.py`; the entire `brain` skill) are the genuinely portable core — pure HTTP, no filesystem, no git, no ClickUp.
- The local-file-grep blocks (global/shared index, project `_compaction-review.md`, keyword `search_dir` in recall.py) require either syncing `~/.claude/memory/*` (and the relevant project memory dir) into the container filesystem, or dropping them in favor of Supabase-only equivalents (the mirror already exists in `claude_memory`, so a Supabase-only reimplementation of `index_dir`/`search_dir` is plausible and was not found already written).
- `fetch_git_log` (personal-site commits) and the git-remote branch of `identify()` are the only two blocks with a **hard, unconditional** dependency on a local git checkout; both fail closed (return `None`) rather than error when the checkout is absent, so the port can simply omit them without crashing anything — the live "commits" block would just never appear in `additionalContext`.
- The `claude-brain-query` edge function itself has **no canonical git-tracked source on this machine** — only a dated backup snapshot (`/Users/ivanmanfredi/.claude/backups/memory-efficiency-2026-07-25/claude-brain-query.v22.as-deployed.ts`). This is a pre-existing gap (not created by the container work) worth flagging to Ivan separately: if that Supabase project's function definition is ever lost/rolled back, this backup file is currently the only local recovery point.
