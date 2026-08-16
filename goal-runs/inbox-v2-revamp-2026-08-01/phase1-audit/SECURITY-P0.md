# Security findings — Railway Claude service

**STATUS: the original P0 in this file was WRONG and is retracted below.** The retraction is kept in full, with the evidence that produced the false alarm and the evidence that killed it, because the failure mode is instructive: I generalized from a single endpoint to a shared dependency without testing a second endpoint.

---

## RETRACTED — "the service is serving unauthenticated in production"

**What I claimed (2026-08-01, mid-Phase-1):** that `API_KEY` was unset, that `verify_api_key` was therefore failing open (`main.py:37`, `:73-77`), and that every key-gated endpoint — `/chat`, `/workspace`, `/clients`, `/skills/upload` — was open to anyone who knew the URL. I labelled it P0 and wrote a remediation plan around it.

**The evidence I had:** `GET /v1/models` returned `200` with no `X-API-Key` header, and `200` again with a deliberately wrong key. The surface inventory listed that endpoint as key-gated (`main.py:1959`). A wrong key returning 200 on a gated endpoint can only happen if the comparison never runs, so I inferred an empty `API_KEY` and a systemic fail-open.

**What refuted it:** the broker's first real round-trip returned `502` wrapping an upstream `401 {"detail":"Invalid or missing API key"}` from `/chat/stream`. Auth is enforced. Per-endpoint probes with no key:

| endpoint | no-key status |
|---|---|
| `GET /v1/models` | **200** |
| `GET /skills` | **401** |
| `GET /workspace` | **401** |
| `GET /clients` | **401** |
| `POST /chat` | **401** |

And the code says why:

```python
# main.py:1959 — a plain unused parameter, NOT Depends(verify_api_key)
@app.get("/v1/models")
async def list_models(x_api_key: Optional[str] = Header(None)):
```

`/v1/models` never calls `verify_api_key` at all. It is unauthenticated **by omission on that one route**, not because the shared gate is broken. `API_KEY` is set and every other endpoint enforces it correctly.

**My error, named plainly:** I picked `/v1/models` as the probe *because* the inventory called it key-gated, then treated its behaviour as proof about the shared dependency. One more probe against any second endpoint would have killed the claim in seconds. A systemic claim needs more than one observation of one route.

---

## What actually stands

### 1. A live `service_role` key is hardcoded in tracked source — real, worth fixing, **not** remotely reachable

`claude-code-railway/main.py:46`

```python
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "<a service_role JWT>")
```

Verified by decoding only the public payload: `role=service_role`, `ref=bjbvqvzbzczjbatgmccb` (**the same project ivan-inbox uses**), `iat=1768305080` (Jan 2026), `exp=2083881080` (**2036**). Confirmed **live**: one read-only `HEAD` against `system_settings` with it returned `200`. It is *newer* than the key recorded as dead in memory (`iat=1738702127`), so that note does not cover this one. The file is git-tracked (`git ls-files main.py`).

**Severity, corrected.** With auth enforced on `/chat`, the "anyone can run Bash and `cat main.py`" path is gone. Exposure is now limited to whoever can read the private repo, anyone with the container, and any future leak of either. A ten-year, RLS-bypassing credential for Ivan's primary database sitting in tracked source is still worth removing on its own merits — it just is not an open door.

**Fix, in this order:** remove the hardcoded default so the app fails fast when the env var is absent; then rotate the key in a planned pass (it is referenced from n8n credentials, edge functions and scripts, so rotating carelessly breaks live automation).

### 2. `/v1/models` is unauthenticated — trivial

It returns a static model list. No data, no side effects. Add `Depends(verify_api_key)` if you want consistency; the actual risk is close to nil. `/health` and `/resources` are also unauthenticated **by design** (`main.py:406`, `:458`) and do disclose more: `claude_version`, `anthropic_key_set`, `oauth_credentials_set`, fork-watchdog state. Worth gating `/resources` at least.

### 3. Fail-open remains a latent design flaw, even though it is not currently firing

`verify_api_key` returns `True` for everyone whenever `API_KEY` is empty (`main.py:37`, `:73-77`). Today the variable is set, so the door is shut — but a botched deploy, a cleared variable or a fresh environment silently reopens every endpoint with no signal. Add a boot assertion that refuses to serve on a missing `API_KEY`, mirroring `assertConfig()` in `web-ui/server.js:237-250`. **This one is cheap and it is the difference between "safe" and "safe by luck".**

### 4. Still open, unchanged by the retraction

- **Anthropic key in `.env.example:5`** — a live-format `sk-ant-api03-…`, tracked, present in history (`8ce4323`, `df6801e`). Rotate and scrub.
- **`GET /api/sessions/:id/transcript` is unscoped across clients** (`web-ui/server.js:573-622`): validates only the UUID shape, then searches all of `~/.claude/projects/*` and falls back to resolving `client_id` from Supabase and pulling that client's JSONL from Storage. Any authenticated web-UI user can read any client's conversation, and `GET /api/sessions?workspace=ALL` (`:501`) hands out the ids. This one is a genuine cross-tenant read behind a single shared password.
- **`working_directory` and `client_id` on `/chat`** remain a cross-tenant primitive for any authenticated caller (`main.py:89`, `:656`, `:256-270`). Allowlist or drop them.

---

## Effect on this run

- **The broker design is unchanged and validated.** It refuses to forward `working_directory`/`client_id`, holds the credential server-side, and allowlists Ivan's user id. Its first real call surfaced the upstream's 401 as a structured `{"error":"upstream_error","detail":"status 401 …"}` — which is exactly the error-visibility the voice/chat audit demanded, proven in production rather than asserted.
- **The chat round-trip cannot be completed by this run.** `/chat/stream` requires `API_KEY`, the value is not obtainable non-interactively (Railway CLI is unauthorized on this machine, the value is absent from `system_settings` and from every local env file), and it must not be guessed. The broker ships **born-dead by missing credential** — the correct T2 end state. Arming is one command Ivan runs:
  ```
  supabase secrets set RAILWAY_CLAUDE_API_KEY=<the API_KEY value from the Railway service>
  ```
  After that, chat works with no code change. Recorded as a DoD deviation in `REPORT.md` and as the first watch-first item.
- **The skeptic's blunt point survives the retraction and matters more now:** the broker's workspace pinning is *mostly theatre* against the threat that counts. Nothing sandboxes `Bash` to a cwd, so an authorized chat turn can read any client's credentials from `/workspaces-config/*/.mcp.json` (`entrypoint.sh:358-440`) regardless of where the workspace points. The JWT allowlist is the only real containment. The honest description of this surface is **"a remote shell into Ivan's own container"**, not "a sandboxed assistant" — and it should be described that way to whoever uses it.
