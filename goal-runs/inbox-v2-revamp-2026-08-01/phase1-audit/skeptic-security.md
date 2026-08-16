# Skeptic — cross-tenant / secret-leak, inbox-v2-revamp-2026-08-01

Role: default to "unsafe" on thin evidence; a control counts only if I can point at the mechanism enforcing it. Read `phase0-scope.md` (locked architecture) and `SECURITY-P0.md` (unauthenticated-upstream finding) first, then read the actual code the design depends on: `.github/workflows/deploy.yml`, `vite.config.ts`, `src/lib/agent.ts`, the precedent edge functions in `ivan-listener/supabase/functions/{rise-comment-reply,get-morning-brief}` (the functions phase0-scope.md cites as the shape to follow), and `claude-code-railway/{main.py,entrypoint.sh}`. Ran live probes against the anon key and against the two precedent functions' auth pattern.

## 1. Is instance-scoping theatre?

**Mostly yes, for the threat it's actually facing.** The broker's refusal to forward `working_directory`/`client_id` is real and closes exactly one vector: a caller *asking the upstream, via a request field, to run as a different client*. That vector is the one demonstrated live in SECURITY-P0 (`GET /v1/models` open, `client_id` triggers `get_client_config()` which clones that client's repo and injects that client's n8n key, `main.py:256-270`).

It closes nothing else, because nothing on the container enforces the boundary at the filesystem/process level:

- `entrypoint.sh:358-440` writes **every active client's** n8n key + Supabase **service-role** key to `/workspaces-config/<client_id>/.mcp.json` (mode 0600) at container boot, regardless of which client's session is running. All of them sit on the same filesystem, owned by the same OS user the Claude Code process runs as.
- The upstream runs with `permissionMode:'bypassPermissions'` and `Bash`/`Write`/`Edit` enabled (`web-ui/server.js:1143-1150`), confirmed in `phase0-scope.md:36`. Bash has no chroot, no per-client namespace, no ACL beyond the 0600 file mode — which the process's own UID satisfies for every client's file, not just its own.
- So fixing `cwd` to Ivan's own workspace stops the *parameter-based* cross-tenant request. It does **not** stop a single Bash turn — `cat /workspaces-config/*/.mcp.json` — from reading every other client's n8n key and Supabase service-role key, from *any* cwd. The broker never has to forward `client_id` for this to work; the attacker just asks the model to read a path.
- Worse than the design assumes: `claude-code-railway/main.py:46` hardcodes a **live-looking Supabase `service_role` JWT** as the literal default for `SUPABASE_SERVICE_KEY` (decoded payload: `{"ref":"bjbvqvzbzczjbatgmccb","role":"service_role","iat":1768305080,"exp":2083881080}` — same project ref as ivan-inbox, `iat` in 2026, i.e. current-looking, not the dead 2025 key noted in memory). `env` or `cat main.py` from any Bash-capable turn hands out a credential that bypasses **every RLS policy in Ivan's own primary project**, not just other clients' data. This means even a *perfectly* scoped, single-allowlisted-caller broker still gives its one legitimate caller (Ivan, via the inbox) a one-command path to a credential that defeats the RLS-closure work item 4 below just verified. Introduced in commit `69d7e40` ("Add Supabase credentials as defaults for multi-client support"), still at HEAD.

**What would genuinely contain this:** removing Bash/Write/Edit from broker-triggered sessions (a restricted tool profile for the inbox chat specifically), or real per-client OS isolation (separate containers/users, no shared visibility into `/workspaces-config`), or moving those credentials out of the filesystem into an on-demand, per-session-scoped fetch instead of pre-materializing all clients' secrets at boot. None of these exist today. Fixing the hardcoded default in `main.py:46` and rotating that key is necessary but not sufficient — it removes one specific leaked value, not the general "Bash can read anything on this host" property.

**State it plainly:** instance scoping protects against a cooperative caller filling in the wrong request field. It provides no protection against an adversarial prompt once Bash is in the loop, which it is by design. The only thing actually standing between the inbox and cross-tenant/cross-privilege data right now is *who is allowed to call the broker at all* (the JWT allowlist, item 2) — not the workspace fix.

## 2. JWT verification — enumerated failure modes and what Phase 3 must require

The repo already has a live precedent for "verify a JWT in an edge function," and phase0-scope.md points at it (`src/lib/ops.ts:154-156`, `src/lib/today.ts:292-295` are the *caller* side; the *function* side lives in `ivan-listener/supabase/functions/{get-morning-brief,rise-comment-reply}/index.ts`). That precedent has exactly the first two failure modes below, live, today:

```ts
// get-morning-brief/index.ts:28-34, rise-comment-reply/index.ts:56-63 — CURRENT PATTERN
const callerRole = (() => {
  try {
    const tok = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.role ?? "anon";
  } catch { return "anon"; }
})();
if (role !== "authenticated" && role !== "service_role") return json({ error: "auth" }, 401);
```

| # | Failure mode | Present in precedent? | Concrete code shape REQUIRED in Phase 3 |
|---|---|---|---|
| a | Trusting an unverified `atob` decode of the payload (no signature check in-function) | **Yes, live, both functions.** The comment says "the gateway already validated the signature" — an assumption, not an assertion. `verify_jwt` is a platform toggle, not tracked in any `config.toml` in either repo (none found), so it is unpinned and could be silently flipped off on a redeploy. | Call `supabase.auth.getUser(callerJwt)` on a client built with the **anon** key, passing the caller's token explicitly. This cryptographically verifies signature + expiry via the library, not via comment. Never hand-decode the payload for anything security-relevant. |
| b | Anon-key client silently returning null instead of erroring | Not observed in precedent (they don't call `getUser()` at all), but a real trap for Phase 3: `createClient(url, ANON_KEY).auth.getUser()` with **no token argument** reads the client's own (empty) session and returns `{data:{user:null}, error:null}` — no error, just null. | Always pass the token explicitly: `sb.auth.getUser(jwt)`. Treat **any** of `error` or `!data.user` as 401. Never branch on `data.user == null ? "treat as pass"`. |
| c | Checking `email` instead of `id` | Not present (precedent checks `role`, not identity, at all — see (f)) | Compare `data.user.id` (uuid) against the allowlisted id. Email is mutable and can be reassigned; id is not. |
| d | Allowlist check missing/no-op when the env var is unset (fail-open) | **This is the exact shape of the P0 bug** (`main.py:73-77`: `if (API_KEY && x_api_key !== API_KEY)` — empty `API_KEY` makes the condition vacuously false for every caller). | `const ALLOWED_ID = Deno.env.get("IVAN_USER_ID"); if (!ALLOWED_ID) return json({error:"misconfigured"}, 500)` — **before** the comparison, unconditionally. A missing secret must refuse to serve, never serve openly. Assert this once at module load, not per-request, so a broken deploy fails immediately and visibly rather than silently authorizing everyone. |
| e | Relying on `verify_jwt` platform setting alone, or in-code check alone | Ambiguous today — no repo evidence of which mode `get-morning-brief`/`rise-comment-reply` deploy under | Require **both** layers for `inbox-claude`: confirm `verify_jwt=true` is actually set post-deploy (probe with a garbage-signature-but-valid-shape token and expect the platform to 401 before function code runs at all), **and** do the in-code `getUser()` + id-allowlist check regardless. Do not treat either layer as sufficient alone. |
| f | Checking `role` (`authenticated`/`service_role`) instead of a specific user id | **Yes, this is literally the precedent pattern.** It authorizes *any* signed-up Supabase user in the project, not just Ivan. Fine for those two functions (single-tenant assumption holds today), **not fine** for `inbox-claude`, which phase0-scope.md explicitly requires to allowlist one id. Copying the precedent verbatim silently drops the allowlist requirement. | The id-allowlist check in (c)/(d) is mandatory and must not be replaced by a role check. Role check may run additionally, never instead. |

## 3. Secret reachable from the browser

- `deploy.yml:11-15` injects exactly three named secrets (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`) into the build env — no blanket `secrets` copy, no `toJSON(secrets)` pattern. A new secret only reaches the bundle if someone adds a fourth line to this file naming it `VITE_*`.
- `vite.config.ts` has no plugin or `define` block that would embed a broader env object; base config only (`react`, `VitePWA`).
- Vite's own behavior is the residual risk: any `process.env.VITE_*` var present at build time becomes available via `import.meta.env`, and if code ever does a **whole-object** reference (`import.meta.env` spread/dump, e.g. a stray debug `console.log(import.meta.env)`), every matched `VITE_*` var ships verbatim regardless of whether it's individually referenced. Grepped `src/` for whole-object references — **none found today** (`grep -rn "import.meta.env\b" src/` returns only `import.meta.env.<KEY>` accesses). This is a "currently clean, structurally fragile" state, not an enforced one: CI has **no lint or test step at all** (confirmed, `phase0-scope.md:90`), so nothing would catch a future debug dump or a future `VITE_RAILWAY_*` secret added to `deploy.yml` by mistake.
- `dist/` is **not** committed: `git ls-files dist` returns nothing, and `.gitignore` excludes both `dist` and `*.local` (covers `.env.local`). The "locally-built bundle with a baked secret gets committed" path does not exist today.
- Required: the DoD grep-the-dist-and-history step Phase 4 already plans is necessary but is a one-off. Recommend a **permanent** CI grep step added in the same PR that ships `inbox-claude`, scanning `dist/assets/*.js` for known secret shapes (`sk-ant-`, a `service_role` JWT payload, the literal string `RAILWAY_CLAUDE_API_KEY`) on every future push — since `deploy.yml` currently ships instantly on any push with zero gates.

## 4. Anon-key path — live probes

Ran real `GET` requests against `https://bjbvqvzbzczjbatgmccb.supabase.co/rest/v1/<table>` using the anon key from `.env.local` (`VITE_SUPABASE_ANON_KEY`), read-only, no writes attempted:

| Table | HTTP status | Rows returned | Verdict |
|---|---|---|---|
| `carousel_drafts` | 200 | 0 | RLS closed — fine |
| `content_prompts` | 200 | 0 | RLS closed — fine |
| `lm_drafts_v2` | 200 | 0 | RLS closed — fine |
| `n8nclaw_chat_messages` | 200 | 0 | RLS closed — fine |

No leak observed on any of the four tables the new Content/chat surface will use. This confirms the post-07-19 RLS closure holds for anon on these specific tables as of this probe. Note this only covers `SELECT`; it does not probe `INSERT`/`UPDATE`/`DELETE` policies, which Phase 3 should probe separately if any new surface writes directly via PostgREST rather than through an RPC.

## 5. `dashboard_action` RPC reach

Read `src/lib/agent.ts:157-235` in full. The hard-coding is **structural within this file, conventional at the RPC boundary**:

- `dashboardAction(table, id, field, value)` (`agent.ts:174`) is **not exported** — no `export` keyword. Only `ackAlert(id)` and `ackReminder(id, status)` are exported, and both call `dashboardAction` with literal consts (`ALERT_TABLE`/`ALERT_FIELD`, `REMINDER_TABLE`/`REMINDER_FIELD`) — a caller of this module's public API today cannot influence table or field. That part is genuinely structural: there is no code path from an importer to an arbitrary field.
- But the true authority boundary is the **Postgres-side `SECURITY DEFINER` function itself**, not this TS wrapper. `supabase.rpc('dashboard_action', {p_table, p_id, p_field, p_value})` is callable by name+args from **any** authenticated client — nothing stops a *different* file from calling it directly with arbitrary strings, bypassing `agent.ts` entirely. Per the comment at `agent.ts:174-177`, that RPC's own allowlist already reaches `outreach_campaigns.is_active` and `outreach_prospects.stage` — i.e. the ability to arm/disarm outreach campaigns sits behind the same generic RPC a new chat or Content surface might be tempted to call directly for a quick ack-style action.

**Required for Phase 3:** any new surface needing a `dashboard_action`-style ack must go through a new **named export added to `agent.ts`** with hard-coded table/field consts, exactly like `ackAlert`/`ackReminder` — never call `supabase.rpc('dashboard_action', ...)` from a new file with table/field sourced from props, state, or a chat-parsed argument. This is a convention Phase 3 must not break, not a boundary the client code enforces on its own. Flag to Ivan (not this run's fix): the actual fix belongs in the Postgres function's own allowlist — a TS-side convention is not a security boundary for a caller who doesn't follow it.

## 6. Other findings

- **Hardcoded live-looking `service_role` key in `claude-code-railway/main.py:46`** (detailed in §1) — new finding, not previously listed in `SECURITY-P0.md`. Recommend adding it there as an addendum with the same "report, don't fix — separate repo, production fence" treatment as the already-flagged Anthropic key, but flagged **more urgently**: this key is same-project as ivan-inbox and fully bypasses the RLS closure the anon-probe (§4) just verified. Concrete fix mirrors the `API_KEY` fail-fast recommendation already in `SECURITY-P0.md`: drop the hardcoded default, assert non-empty `SUPABASE_SERVICE_KEY` at boot, rotate the key.
- **Wildcard CORS on the precedent functions** (`Access-Control-Allow-Origin: "*"` in both `rise-comment-reply` and `get-morning-brief`). Copying this into `inbox-claude` would mean: given a valid bearer token (e.g. lifted via an XSS in the SPA or a malicious browser extension reading `sessionStorage`), a request from *any* origin can replay it against the broker. The blast radius behind `inbox-claude` (bypassPermissions Bash on a multi-tenant container) is categorically higher than behind `rise-comment-reply` (post one LinkedIn comment) or `get-morning-brief` (read a digest) — the precedent's CORS choice does not automatically transfer. Recommend scoping `Access-Control-Allow-Origin` to the known Pages origin for `inbox-claude` specifically.
- **The P0 hole makes the broker's gate a second door, not the only door, today.** `SECURITY-P0.md` already flags this as needing Ivan's decision, but it's directly load-bearing for this architecture's central claim ("only Ivan's JWT reaches Railway"): as long as `API_KEY` is unset on Railway, anyone who has the plain hostname reaches `/chat/stream` with zero auth, identically to going through `inbox-claude`. The broker adds a locked door next to a door that's already open. This must close before (or at the moment) `inbox-claude` ships, or the phrase "the browser never holds a Railway credential, only Ivan's JWT reaches it" is false in practice even though it's true of the code being written.

## Required-controls list (testable assertions Phase 3 must satisfy)

1. `POST inbox-claude` with no `Authorization` header → `401`. Probe it.
2. `POST inbox-claude` with `Authorization: Bearer <structurally-valid-but-wrong-signature JWT>` → `401` (proves signature is actually checked, not just decoded). Probe it.
3. `POST inbox-claude` with a **valid, currently-signed-in Supabase session token for a user that is not Ivan's allowlisted id** → `403`. (Requires a second real test user or a forged-but-correctly-signed token via the project's own signing key in a controlled test — do not skip this case as "there's only one user.")
4. `POST inbox-claude` with `IVAN_USER_ID` (or equivalent allowlist secret) **unset** in the function's env → function refuses to serve (500/401 at cold start), never silently authorizes. Probe by temporarily unsetting in a preview/staging deploy if one exists, else code-review-assert the guard runs before any comparison.
5. Auth check uses `supabase.auth.getUser(jwt)` (library-verified) — grep the deployed function source, confirm no `atob`/manual JWT payload decode is used for the authorization decision.
6. Auth check compares `data.user.id`, never `data.user.email` or `payload.role` alone — grep confirm.
7. `working_directory` and `client_id` are absent from the function's request-body type entirely (not merely unused) — grep confirm no field of either name exists in the Deno function source.
8. `Access-Control-Allow-Origin` on `inbox-claude` is the specific Pages origin, not `*` — grep confirm.
9. `dist/assets/*.js` in the deployed build contains none of: `sk-ant-`, `RAILWAY_CLAUDE_API_KEY`, any `service_role` JWT payload, `X-API-Key`-adjacent literal secret strings. Grep post-build, every deploy (not just this run's one-off DoD check).
10. Anon-key `GET` against `carousel_drafts`, `content_prompts`, `lm_drafts_v2`, `n8nclaw_chat_messages` returns `200` with `0` rows — re-probe at Phase 4/ship time, not just now (RLS policies can drift).
11. No file outside `src/lib/agent.ts` calls `supabase.rpc('dashboard_action', ...)` directly — grep confirm across any new chat/Content surface files added by this run.
12. Railway `API_KEY` is set (non-empty) and `inbox-claude` sends `X-API-Key` on every upstream call regardless — this is Ivan's decision per `SECURITY-P0.md`, but `inbox-claude` must not ship (or must be treated as non-load-bearing) until it's true, since until then the broker is an additional locked door next to one left open.
13. `claude-code-railway/main.py:46`'s hardcoded `SUPABASE_SERVICE_KEY` default is removed and the key rotated — reported to Ivan as an addendum to `SECURITY-P0.md`, same "separate repo, production fence, not this run's fix" treatment, flagged more urgently than the existing Anthropic-key item because it's same-project as ivan-inbox and defeats the RLS-closure comfort in item 10.

## Verdict

**The locked broker architecture (Supabase-JWT-gated edge function, Railway key as edge secret, no `working_directory`/`client_id` forwarding) is the right shape and should not be redesigned.** But it is not sound to build as-is, for three concrete reasons, all fixable without changing the shape:

1. **The JWT-check code this repo already has as a precedent is insufficient for this function's stated requirement** (role-check instead of id-allowlist, unverified payload decode instead of `getUser()`) — Phase 3 must diverge from the copy-paste path, not follow it. This is the single highest-value amendment: get this wrong and the "only Ivan reaches it" claim silently becomes "any signed-up user reaches it," which hands out bypassPermissions Bash on a multi-tenant container.
2. **Instance scoping is a real but narrow control** — it stops the parameter-based cross-tenant request the P0 finding demonstrated, and nothing else, because Bash is unconfined on that host. The design's own "accepted residual risk" framing (`phase0-scope.md:36`) should be read as "the allowlist gate is the *only* containing control," not as "instance scoping plus the allowlist gate together contain this" — and the newly-found hardcoded service-role key in `main.py:46` shows the residual risk reaches further than named (Ivan's own project, not just other clients').
3. **The architecture's central claim is not true yet in production** — until Railway's `API_KEY` is set (SECURITY-P0, Ivan's open decision), `inbox-claude`'s JWT gate is a second door next to one that's unlocked. Ship order matters: closing the Railway hole should happen at or before `inbox-claude` goes live, not after.

None of these require touching the broker's shape — they're implementation-detail amendments (correct JWT code, scoped CORS, a permanent bundle-secret-grep in CI, closing the already-known P0 hole, and reporting the new `main.py:46` key) that Phase 3 must carry as explicit acceptance criteria, not incidental cleanup.
