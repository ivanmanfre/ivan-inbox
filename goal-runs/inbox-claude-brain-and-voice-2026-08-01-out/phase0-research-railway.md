# Phase 0 research — claude-code-railway (Railway multi-client Claude Code proxy)

Repo: `/Users/ivanmanfredi/Desktop/claude-code-railway` (not a subdir of ivan-inbox; standalone git repo). READ-ONLY pass — nothing modified, nothing deployed.

## 6. Git state (read first, as instructed)

```
branch: main (up to date with origin/main)
HEAD:   2b1054fee0a93e4c47357336a41e474f00289432
        2026-07-31 02:55:54 +0200
        "fix(dtc-scan): split the reviews copy so 200+ reviews stops reading as thin"
```
Untracked (not staged, not touched by me): `skills/playwright-driver/pw-audit.js`, `test_lm_seed_helper.py`, `web-ui/v2_isolation_probe.mjs`, `web-ui/v2_stt_probe.mjs`, `web-ui/v2_voice_probe.mjs`, `web-ui/ws_latency_probe.mjs`. No staged or modified tracked files. Nothing cleaned or reset.

---

## 1. `main.py` — ChatRequest, model selection, append_system_prompt, /chat, /chat/stream, hardcoded key, skills/MCP passthrough

### ChatRequest model — full field list (`main.py:80-90`)
```python
class ChatRequest(BaseModel):
    """Request model for chat endpoint"""
    prompt: str                                    # 82
    session_id: Optional[str] = None               # 83
    client_id: Optional[str] = None                # 84 — client slug for multi-client mode
    permission_mode: str = "acceptEdits"            # 85 — acceptEdits | bypassPermissions
    allowed_tools: Optional[List[str]] = None       # 86
    output_format: str = "text"                     # 87 — text | json | stream-json
    max_turns: Optional[int] = None                 # 88
    append_system_prompt: Optional[str] = None      # 89
    working_directory: Optional[str] = None         # 90
```
**Confirmed: no `model` field.** `ChatResponse` (main.py:93-100) also has no model field — it returns `session_id`, `result`, `success`, `client_id`, `files_created`, `files_modified`.

### Where the model is actually chosen
- `main.py:41`: `CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-opus-4-7")` — a **module-level env var read once at process start**, not per-request.
- `/chat` (main.py:677) and `/chat/stream` (main.py:807) both hardcode `"--model", CLAUDE_MODEL` into the `claude` CLI invocation. There is no per-request override anywhere in these two paths — every `/chat` and `/chat/stream` call for every client uses whatever `CLAUDE_MODEL` was at container boot.
- No `ANTHROPIC_MODEL` env var is read anywhere in `main.py` or `entrypoint.sh` (grepped, zero hits). No `model` key in the `~/.claude/settings.json` written by `entrypoint.sh:206-273` either — that file only sets `permissions`, `hooks`, `enableAllProjectMcpServers`, `effortLevel`, `autoMemoryEnabled`, `autoDreamEnabled`. So the *only* model-selection lever for `/chat`/`/chat/stream` is the `CLAUDE_MODEL` Railway env var (not visible in the repo — it's a Railway dashboard/CLI secret) falling back to the literal default `"claude-opus-4-7"` in code.
- **By contrast**, `/v1/messages` (the Anthropic-Messages-compatible endpoint) and `/v1/vision-qa` **do** accept a real `model` field already, independently of `ChatRequest`:
  - `main.py:1424`: `model = request.get("model", "claude-sonnet-4-6")` (raw dict, not a Pydantic field — this endpoint parses `await raw_request.json()` directly, main.py:1400).
  - `main.py:1456`: `cli_model = MODEL_MAP.get(model, "sonnet")` — mapped through the `MODEL_MAP` dict (main.py:1232-1244) which maps Anthropic model IDs (`claude-opus-4-8/7/6`, various `claude-sonnet-4-*`, `claude-haiku-4-5*`) → the CLI's short names `opus`/`sonnet`/`haiku`.
  - `/v1/vision-qa` does the identical `model`/`cli_model` pattern at main.py:1866 area (confirmed `model = request.get("model", "claude-sonnet-4-6")` / `cli_model = MODEL_MAP.get(model, "sonnet")` inside its handler, used at main.py:1930 `"--model", cli_model`).
  - So the CLI invocation demonstrably **supports `--model`** taking either a full model ID or the short alias `opus`/`sonnet`/`haiku` — this is proven working code already in the same file, just not wired to `ChatRequest`.

### `append_system_prompt` handling
- Field: `ChatRequest.append_system_prompt: Optional[str] = None` (main.py:89).
- `/chat` (main.py:697-698): `if request.append_system_prompt: cmd.extend(["--append-system-prompt", request.append_system_prompt])`.
- `/chat/stream` (main.py:817-818): identical pattern.
- `/v1/messages` and `/v1/vision-qa` do NOT forward a caller-supplied system prompt this way — they **construct their own fixed `append_prompt`** (main.py:1462-1478 for `/v1/messages`, similar block ~1917-1923 for vision-qa) that tells the CLI "you are being used as a direct completion API, don't use tools, don't mention Claude Code" etc., and pass `request.get("system","")` instead into `format_messages_as_prompt()` (main.py:1285-1321) as part of the assembled prompt body (wrapped in `<system_instructions>...</system_instructions>`), not as `--append-system-prompt`.
- Net: `append_system_prompt` is a `/chat`+`/chat/stream`-only passthrough field; it flows verbatim, unsanitized, straight onto the CLI argv.

### `/chat` endpoint (main.py:617-770) — full flow
1. `verify_api_key(x_api_key)` (626) — see below.
2. Auth precondition (629-631): requires either `ANTHROPIC_API_KEY` env or `/home/appuser/.claude/.credentials.json` (OAuth) to exist, else 500.
3. Session key = `client_id` or `"__default__"` (634); per-session-key `asyncio.Lock` via `get_client_lock` (636-637, def at 66-70) serializes concurrent requests for the same client to avoid resume races.
4. Session id resolution (638-644): explicit `request.session_id` > last-known session in `CLIENT_SESSIONS` dict (auto-resume, logged) > fresh `uuid4()`.
5. Client resolution (646-659): if `client_id` given, `get_client_config()` (Supabase `client_registry` lookup, main.py:105-124ish) → `ensure_client_repo()` (clones/pulls the client's GitHub repo into `/workspaces/{client_id}`, main.py:126-212, also checks a `wip_branches` Supabase table for newer unmerged WIP branches and checks them out, and lazily runs `n8nac init-auth`/`init-project` once per client) → `build_client_env()` (injects `N8N_API_KEY`/`N8N_API_URL` + any `extra_env` from the registry row, main.py:256-270). If no `client_id`, uses `WORKSPACE_DIR` (default `/workspaces/ivan`) and `build_base_env()` (244-253, OAuth-first / API-key-fallback env).
6. If `request.session_id` was given, best-effort `ensure_session_jsonl_current()` pulls the session's JSONL down from Supabase if the remote copy is newer (661-670).
7. Builds `cmd = ["claude", "-p", "--permission-mode", request.permission_mode, "--model", CLAUDE_MODEL]` (673-678), then conditionally appends `--resume <session_id>` (681-682), `--output-format` (685-686 — only if json/stream-json), `--allowedTools` (689-690), `--max-turns` (693-694), `--append-system-prompt` (697-698). No `--mcp-config` override here, so the CLI's own `.mcp.json`-in-cwd + `enableAllProjectMcpServers: true` settings auto-load the client's per-workspace MCP servers.
8. Executes via `asyncio.to_thread(_run_blocking_claude, cmd, working_dir, env, request.prompt, 900)` (700-718) inside an `acquire_claude_slot()` semaphore gate (max concurrent CLI procs, env `CLAUDE_SEMAPHORE`, default 5). `_run_blocking_claude` (main.py:1552+) pipes the prompt via **stdin** (not argv, to dodge E2BIG), runs in its own process group, SIGKILLs the whole group on timeout.
9. Diffs the workspace file tree before/after to compute `files_created` (files_modified is always `[]` — never actually populated).
10. On `"No conversation found"` stderr (expired session), retries once without `--resume` using a fresh session id.
11. On success, stores `session_id` in the in-memory `CLIENT_SESSIONS` dict for future auto-resume.
12. Returns `ChatResponse`.

### `/chat/stream` endpoint (main.py:773-865)
Same auth + client-resolution + cmd-building logic (minus the retry-on-expired-session and file-diff logic), but forces `--output-format stream-json` (808) and spawns via `asyncio.create_subprocess_exec` directly (823-831, own process group). The prompt is written to the child's stdin then stdin is closed (834-837). Response is a `StreamingResponse` with `media_type="text/event-stream"`:
- **SSE event shape**: each stdout line from the CLI's own `stream-json` output is forwarded almost verbatim as `data: {line}\n\n` (839-840) — i.e. the CLI's native stream-json envelope (`type: "system"|"assistant"|"user"|"result"` etc., whatever `claude --output-format stream-json` itself emits) is what a consumer actually parses; the proxy does not reshape it.
- On completion: one extra synthetic event `data: {"type": "done", "returncode": <n>}\n\n` (843).
- On exception mid-stream: `data: {"type": "error", "message": "..."}\n\n` (846).
- `finally` block (847-860): if the process is still alive when the generator exits (dropped SSE client / error), kills the whole process group (`os.killpg`) to prevent MCP-child-process leaks — explicitly called out in a comment as "the /chat-path fork leak" fix.

### `verify_api_key` (main.py:73-77)
```python
def verify_api_key(x_api_key: Optional[str] = Header(None)):
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")
    return True
```
Reads `x-api-key` header; compares against module-level `API_KEY = os.environ.get("API_KEY", "")` (main.py:39). **If `API_KEY` env is unset/empty, auth is a no-op (any/no key passes)** — but the live probe below confirms it IS set on the deployed instance (401 with no key). `/v1/messages` additionally accepts the key via `Authorization: Bearer <key>` header as a fallback (main.py:1391-1394) before calling the same `verify_api_key`.

### `main.py:46` hardcoded Supabase key (report only, not touched)
```python
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "eyJhbGciOiJIUzI1NiIs...")
```
The literal default decodes (per prior run's audit, `inbox-v2-revamp-2026-08-01/phase1-audit/skeptic-security.md:14`) to a **live-looking `service_role` JWT** for Supabase project `bjbvqvzbzczjbatgmccb` — the same project ref as ivan-inbox itself — `iat` 1768305080 (2026), `exp` 2083881080. A service_role key bypasses all RLS. This is a hardcoded fallback baked into tracked source (introduced in commit `69d7e40` per that prior audit), not gated behind the env var actually being unset in production (Railway does set the real env var; the hardcoded string is what ships to anyone who reads the file or reads `env`/`os.environ` from inside a `/chat` session with Bash access). I did not rotate or touch anything — report only, per task 1.

### How SKILLS_DIR / MCP configs reach the Claude Code process
- `SKILLS_DIR = os.environ.get("SKILLS_DIR", "/home/appuser/.claude/skills")` (main.py:43), used **only** by the `/skills` management endpoints (list/get/upload/delete, main.py:868-983) to read/write skill folders on disk. It is never passed as a CLI flag or into `build_base_env()`/`build_client_env()` — the `claude` CLI itself natively discovers skills from `~/.claude/skills` (global skills dir) once `entrypoint.sh` has populated it (see §2 below), so the wiring is "shared filesystem convention," not an explicit flag/env passed at invocation time.
- MCP servers reach the process via a **per-client `.mcp.json` file in the working directory** (`cwd=working_dir` at the `subprocess`/`asyncio.create_subprocess_exec` call sites), auto-loaded by the CLI because `~/.claude/settings.json` sets `"enableAllProjectMcpServers": true` (entrypoint.sh:268). The `.mcp.json` itself is generated per-client by `entrypoint.sh` (§2 below), symlinked into each client workspace.
- `/v1/messages` and `/v1/vision-qa` deliberately **disable** that inherited MCP config for their stateless-completion use case, passing `"--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}'` explicitly (main.py:1496-1497, and the equivalent block ~1926-1929 in vision-qa) — comment at 1491-1495 explains this is to prevent orphaned n8n/supabase/clickup MCP child node processes from accumulating and eventually exhausting the container's fork table (EAGAIN). `/chat` and `/chat/stream` do NOT pass this override, so they get the full per-client MCP server set.

---

## 2. `entrypoint.sh` — memory restore, MCP materialization, ~/.claude / CLAUDE.md writes

### Memory restore (entrypoint.sh:274-296, "Restore memory from Supabase")
```python
resp = httpx.get(f'{SUPABASE_URL}/rest/v1/claude_memory?select=client_id,file_path,content', ...)
for row in rows:
    full_path = os.path.expanduser(row['file_path'])
    pathlib.Path(full_path).parent.mkdir(parents=True, exist_ok=True)
    pathlib.Path(full_path).write_text(row['content'])
```
**Confirmed: this query has NO `client_id` filter** — it fetches every row in the `claude_memory` table regardless of which client it belongs to, and writes each one to `os.path.expanduser(row['file_path'])`, i.e. an **arbitrary, attacker-or-bug-controlled filesystem path** (any `~/...` or absolute path stored in that column), with no allowlist of directories and no scoping to the client whose row it is. Any row in `claude_memory` — from any client — lands on every container boot, at whatever `file_path` that row specifies, visible to every client's session on that shared container. `client_id` is selected in the query but never used to filter or namespace the write. Matches memory note that only 2 of 400 rows have absolute `file_path`s — the other ~398 presumably resolve to relative/`~`-relative paths inside `/home/appuser/...`, but the code makes no distinction and would happily write outside that tree if a row's `file_path` were e.g. `/etc/...` or `../../...`.

### Per-client `.mcp.json` materialization (entrypoint.sh:356-460, "Per-workspace .mcp.json generation")
For each active row in Supabase `client_registry` (`client_id, n8n_url, n8n_api_key, supabase_url, supabase_service_key, extra_mcps`):
- Builds an `mcp["mcpServers"]` dict with, conditionally:
  - `n8n-mcp` (stdio, env `N8N_API_URL`/`N8N_API_KEY` from the client's own row) — entrypoint.sh:395-403.
  - `supabase` (`npx @supabase/mcp-server-supabase`, env `SUPABASE_URL` + **`SUPABASE_SERVICE_ROLE_KEY` = the client's own `supabase_service_key`**, i.e. that client's service-role key, not the proxy's) — entrypoint.sh:405-412.
  - `clickup` (`npx @taazkareem/clickup-mcp-server`, env `CLICKUP_API_KEY`/`CLICKUP_TEAM_ID`) sourced from a **shared** `system_settings` row (`clickup_team_id`/`clickup_api_key`), not per-client — entrypoint.sh:414-421, i.e. every client that gets a `.mcp.json` at all shares the same ClickUp credentials unless overridden.
  - `extra_mcps` (per-client custom dict merged in verbatim if it has a `command` key) — entrypoint.sh:423-428.
- Writes to **out-of-tree** `/workspaces-config/{cid}/.mcp.json`, `chmod 0600` (entrypoint.sh:431-435).
- Symlinks it into the client's actual workspace as `{workspace}/.mcp.json` (entrypoint.sh:438-442) — this is the file the CLI reads relative to `cwd` per `enableAllProjectMcpServers`.
- Adds `.mcp.json` to that workspace's `.gitignore` if missing (entrypoint.sh:444-450) so an errant `git add -A` can't commit client secrets into the client's own repo.
This runs unconditionally on every container boot for every active client row, before any request is served — i.e. secrets for ALL clients sit decrypted-at-rest (0600 but plaintext) in `/workspaces-config/*` and symlinked into `/workspaces/*` for the lifetime of the container.

### Other `~/.claude` / CLAUDE.md / memory writes on the container
- entrypoint.sh:9-14: restores bundled skills from `/app/skills` → `/home/appuser/.claude/skills` (`cp -rn`, non-destructive).
- entrypoint.sh:17-60ish: OAuth credentials self-heal — writes `~/.claude/.credentials.json` from `CLAUDE_OAUTH_CREDENTIALS` env (base64) then checks Supabase `system_settings.claude_oauth_credentials` for a fresher copy and overwrites if newer.
- entrypoint.sh:196-198: refreshes `~/.claude/hooks` from `/app/hooks` on every boot (`cp -r`, so this DOES overwrite hooks each boot — not additive like the skills copy).
- entrypoint.sh:202-203: refreshes `~/.claude/lib` from `/app/lib` similarly.
- entrypoint.sh:206-273: writes `~/.claude/settings.json` (global, single file, all clients share it) — permissions allowlist (`Bash(curl/python3/n8nac/git/npm/node:*)`, `mcp__*`), `SessionStart` hooks (`inject-live-context.py`, `restore-session-jsonl.py`), `Stop` hooks (`session-summarizer.py` async, `sync-session-jsonl.py`, `git-wip-checkpoint.py` async), `PostToolUse` hook (`sync-session-jsonl.py` on Bash/Edit/Write/MultiEdit/Agent/Task), plus `enableAllProjectMcpServers: true`, `effortLevel: "high"`, `autoMemoryEnabled: true`, `autoDreamEnabled: true`. No `model` key present.
- `AGENTS.md` is copied from `/app/AGENTS.md` into each client's repo dir at clone time and refreshed on every pre-warm boot pass (main.py:218-221, entrypoint.sh:378-380) — not `CLAUDE.md` specifically; I found no code path that writes a per-client `CLAUDE.md`.
- claude_memory restore (above) can, by construction, write to any path including hypothetically `~/.claude/CLAUDE.md` or similar if a row's `file_path` said so — but I found no evidence any current row targets that; not verified further (would require reading the actual `claude_memory` table content, out of scope for a code-only read-only pass).

---

## 3. Where injected-per-turn context would go / exact request→CLI field trace

For `/chat` and `/chat/stream`, the **only** caller-controlled channels that reach the `claude` CLI invocation are:
| ChatRequest field | Reaches CLI as | Line |
|---|---|---|
| `prompt` | stdin of the subprocess (not argv) | main.py:716 (`/chat`), 835 (`/chat/stream`) |
| `permission_mode` | `--permission-mode` | 676, 806 |
| `allowed_tools` | `--allowedTools` (comma-joined) | 689-690, 811-812 |
| `output_format` | `--output-format` (only if json/stream-json; `/chat/stream` always forces `stream-json`) | 685-686, 808 |
| `max_turns` | `--max-turns` | 693-694, 814-815 |
| `append_system_prompt` | `--append-system-prompt` | 697-698, 817-818 |
| `session_id` | `--resume <id>` (or auto-resume from `CLIENT_SESSIONS` if omitted) | 681-682 |
| `working_directory` | `cwd=` of the subprocess (only used when `client_id` is absent — client mode always uses the cloned client repo dir instead) | 658, 799 |
| `client_id` | Selects `working_dir` (cloned repo path) + `env` (via `build_client_env`) + Supabase `client_registry` lookup + session-lock key | 646-659, 788-800 |
| `model` | **does not exist** — not accepted, not forwarded; CLI always gets `CLAUDE_MODEL` env-var value | n/a |

There is **no generic "extra context" or "system append per-turn from elsewhere"** mechanism beyond `append_system_prompt` — that field is the single injection point for arbitrary per-turn instructions on `/chat`/`/chat/stream`. Any new "injected per-turn context" feature (e.g. a broker wanting to prepend live state) would have to either (a) reuse `append_system_prompt` (already free-form), or (b) prepend/append text onto `request.prompt` itself before sending — both already fully available to any caller today, no code change needed for pure text injection.

---

## 4. Model-allowlist groundwork (report only — no changes made)

To let `/chat`/`/chat/stream` accept a caller-supplied `model`, the two insertion points would be:
1. **`ChatRequest` class** (main.py:80-90): add a field, e.g. `model: Optional[str] = None`, mirroring the pattern already proven at `/v1/messages` (main.py:1424, dict-based) but as a typed Pydantic field here.
2. **Invocation sites**: main.py:677 (`/chat`) and main.py:807 (`/chat/stream`) currently hardcode `"--model", CLAUDE_MODEL` — each would become `"--model", MODEL_MAP.get(request.model, CLAUDE_MODEL) if request.model else CLAUDE_MODEL` (reusing the existing `MODEL_MAP` at main.py:1232-1244, which already sits below the `/chat` code and would need to move above it or be referenced — currently `MODEL_MAP` is defined at line 1232, *after* `/chat` at 617 and `/chat/stream` at 773, so a literal reuse would require moving the dict earlier in the file, a one-line relocation).
3. **CLI support for `--model` is already proven**: `/v1/messages` and `/v1/vision-qa` already pass `--model <opus|sonnet|haiku>` successfully in production (main.py:1498, 1930) — no CLI-side gap exists. The only gap is that `ChatRequest` doesn't expose the field and the two `/chat*` call sites don't consult it. This is groundwork documentation only; I made no edit.

---

## 5. Live probes (read-only, all GET/HEAD/OPTIONS/POST-with-no-body-executed-server-side-that-costs-nothing)

Deployed URL found via grep of `/Users/ivanmanfredi/Desktop/ivan-inbox` (not memory): `supabase/functions/inbox-claude/index.ts:24` reads `Deno.env.get('RAILWAY_CLAUDE_URL')`, and prior goal-run notes (`goal-runs/inbox-v2-revamp-2026-08-01/phase0-scope.md:11`) record the value as `https://claude-code-railway-production.up.railway.app/`.

Commands run 2026-08-01, from this session:
```
$ curl -sS -o /dev/null -w "HTTP %{http_code}\n" https://claude-code-railway-production.up.railway.app/ --max-time 15
HTTP 302

$ curl -sS https://claude-code-railway-production.up.railway.app/health --max-time 15
{"status":"healthy","build_marker":"ht-audience-audit-v2","score_pending_route":true,
 "extract_clips_route":true,"editorial_pending_route":true,"claude_cli_available":true,
 "claude_version":"2.1.161 (Claude Code)","subprocess_spawn_ok":true,"subprocess_spawn_error":null,
 "fork_watchdog":{"strikes":0,"last_ok":"2026-08-01T10:46:49.136920Z","last_error":null,"exits":0},
 "anthropic_key_set":true,"oauth_credentials_set":true,
 "workspace_dir":"/workspaces/ivan","skills_dir":"/home/appuser/.claude/skills"}

$ curl -sS https://claude-code-railway-production.up.railway.app/v1/models --max-time 15
{"data":[{"id":"claude-opus-4-8","type":"model"},{"id":"claude-opus-4-7","type":"model"},
 {"id":"claude-opus-4-6","type":"model"},{"id":"claude-sonnet-4-6","type":"model"},
 {"id":"claude-haiku-4-5","type":"model"}]}

$ curl -sS -o /dev/null -w "HTTP %{http_code}\n" -X POST https://claude-code-railway-production.up.railway.app/chat \
  -H "Content-Type: application/json" -d '{"prompt":"hi"}' --max-time 15
HTTP 401

$ curl -sS -o /dev/null -w "HTTP %{http_code}\n" -X POST https://claude-code-railway-production.up.railway.app/v1/messages \
  -H "Content-Type: application/json" -d '{"messages":[{"role":"user","content":"hi"}]}' --max-time 15
HTTP 401
```
Confirms: instance is up, OAuth+API-key both configured (`anthropic_key_set: true`, `oauth_credentials_set: true`), `claude` CLI version 2.1.161 available in-container, fork watchdog currently healthy (0 strikes), `/v1/models` is genuinely open (no auth check in that route — matches main.py:1959-1970, `list_models` never calls `verify_api_key` despite taking `x_api_key` as a parameter it never uses), and **both `/chat` and `/v1/messages` correctly 401 with no key** — API_KEY enforcement is live in production, consistent with the prior run's finding.

No destructive or write probes were sent; no valid API key was used or requested.
