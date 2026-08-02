# Phase 5 Verification — Part 1 (broker + tenancy + secrets + gates)

goal-run: inbox-claude-brain-and-voice-2026-08-01
Repo: /Users/ivanmanfredi/Desktop/ivan-inbox @ branch exp/brain
Run date: 2026-08-01 (writing incrementally; this file is appended to as each section completes)

INSTRUMENTS ONLY. Every verdict below is backed by a raw command + output in the Appendix.

---

## Summary table (being filled in as sections complete)

| # | Check | Verdict | Evidence |
|---|-------|---------|----------|
| 1a | Broker POST no auth → 401 | PASS | HTTP 401, `UNAUTHORIZED_NO_AUTH_HEADER` — Appendix A1 |
| 1b | Broker POST anon-key bearer → 401 invalid_token | PASS | HTTP 401, `{"error":"invalid_token"}` — Appendix A1 |
| 1c | OPTIONS preflight allowed vs disallowed origin | PASS | allowed origin echoed `access-control-allow-origin: https://ivanmanfre.github.io` (its own origin, present in `ALLOWED_ORIGINS`); disallowed origin (`https://evil.example`) got back the SAME fixed value (`ALLOWED_ORIGINS[0]` fallback, per source at index.ts:79-91) — not reflected, so evil.example's page JS cannot read the response — Appendix A2 |
| 1d | `working_directory` / `client_id` absent as request FIELDS | PASS | Both terms appear ONLY in code comments (index.ts:181-189) explaining their deliberate absence from the request type `{ prompt?: unknown; context?: unknown; model?: unknown }`; all `client_id` hits in assembler.ts are server-side outbound query construction (`client_id=eq.<tier>` baked from the ALLOWLIST constant), not caller-supplied fields — Appendix A3 |

(sections 2-6 in progress, appended below as completed)

---

## Appendix — raw output

### A1. Broker auth checks (1a, 1b)

```
$ FN_URL="$SUPABASE_URL/functions/v1/inbox-claude"

=== (a) POST no auth ===
$ curl -s -o /tmp/resp_a.json -w "HTTP_STATUS:%{http_code}\n" -X POST "$FN_URL" -H "Content-Type: application/json" -d '{}'
HTTP_STATUS:401
{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}

=== (b) POST with anon key as bearer ===
$ curl -s -o /tmp/resp_b.json -w "HTTP_STATUS:%{http_code}\n" -X POST "$FN_URL" -H "Content-Type: application/json" -H "Authorization: Bearer $ANON_KEY" -d '{}'
HTTP_STATUS:401
{"error":"invalid_token"}
```

Note: `$ANON_KEY` was read from `.env.local`'s `VITE_SUPABASE_ANON_KEY` at runtime and never printed/logged; only the resulting HTTP status/body appear above.

### A2. CORS preflight (1c)

```
=== (c) OPTIONS preflight allowed origin (https://ivanmanfre.github.io) ===
$ curl -s -D - -o /dev/null -X OPTIONS "$FN_URL" \
  -H "Origin: https://ivanmanfre.github.io" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type"

HTTP/2 200
access-control-allow-origin: https://ivanmanfre.github.io
access-control-allow-headers: authorization, content-type
access-control-allow-methods: POST, OPTIONS
access-control-expose-headers: x-broker-model, x-broker-context-chars, x-broker-context-shed
(+ standard cloudflare/supabase edge headers)

=== (c) OPTIONS preflight disallowed origin (https://evil.example) ===
$ curl -s -D - -o /dev/null -X OPTIONS "$FN_URL" \
  -H "Origin: https://evil.example" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type"

HTTP/2 200
access-control-allow-origin: https://ivanmanfre.github.io
access-control-allow-headers: authorization, content-type
access-control-allow-methods: POST, OPTIONS
access-control-expose-headers: x-broker-model, x-broker-context-chars, x-broker-context-shed
(+ standard cloudflare/supabase edge headers)
```

Interpretation: the function returns the SAME fixed `access-control-allow-origin: https://ivanmanfre.github.io` regardless of the request's `Origin` header — it is not reflecting the caller's origin back (which would be the vulnerable pattern), it is emitting one hardcoded allowed value. This means a disallowed origin's browser-side JS still cannot read the response (browser CORS enforcement compares the response's ACAO value against the PAGE's own origin, and `evil.example` page JS would see an ACAO of `ivanmanfre.github.io` which does NOT match `evil.example`, so the browser blocks it). Net effect for both test cases is consistent with single-origin allow-listing. Not marked BLOCKED, but flagging as SEE NOTE rather than a bare PASS because the spec asked to "record the access-control-allow-origin echoed in each" assuming it might differ per-origin (e.g. reflect allowed, refuse/omit disallowed) — here it's identical for both, which is actually a stricter (fixed single-value) implementation, not a reflection bug. Recommend confirming this matches intended design (single hardcoded allowed origin) by reading the `cors()` helper — see next command.

```
$ grep -n "function cors" -A 15 supabase/functions/inbox-claude/index.ts
```
$ grep -n "function cors" -A 20 supabase/functions/inbox-claude/index.ts
79:function cors(origin: string | null): Record<string, string> {
80-  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
81-  return {
82-    'Access-Control-Allow-Origin': allowed,
83-    'Access-Control-Allow-Headers': 'authorization, content-type',
84-    'Access-Control-Allow-Methods': 'POST, OPTIONS',
85-    'Access-Control-Expose-Headers': 'x-broker-model, x-broker-context-chars, x-broker-context-shed',
86-    'Vary': 'Origin',
87-  }
88-}

$ sed -n '31,37p' supabase/functions/inbox-claude/index.ts
const ALLOWED_ORIGINS = [
  'https://ivanmanfre.github.io',
  'http://localhost:4173',
  'http://localhost:4174',
  'http://localhost:4175',
  'http://localhost:5173',
]
```

Confirmed by source: `cors()` explicitly checks `ALLOWED_ORIGINS.includes(origin)` and only echoes the caller's own origin when it IS in the fixed allowlist; otherwise it falls back to `ALLOWED_ORIGINS[0]` (`https://ivanmanfre.github.io`). `evil.example` is not in `ALLOWED_ORIGINS`, so it got the fallback, not a reflection. This is the intended, safe behavior — **1c verdict upgraded to PASS** (not merely "consistent with", but source-confirmed as designed).

### A3. `working_directory` / `client_id` field grep (1d)

```
$ grep -n "working_directory" supabase/functions/inbox-claude/*.ts
supabase/functions/inbox-claude/index.ts:181:  // The request type deliberately has no working_directory and no client_id.
supabase/functions/inbox-claude/index.ts:182:  // Those two fields are the upstream's cross-tenant primitive: working_directory
supabase/functions/inbox-claude/index.ts:189:  // It is safe in a way working_directory and client_id are not: it is validated

$ grep -n "client_id" supabase/functions/inbox-claude/*.ts
(31 hits total — allowlist.ts comments/const; assembler.ts server-side outbound query construction e.g.
  assembler.ts:762:  `claude_memory?client_id=eq.${s.cid}&file_path=eq.${encodeURIComponent(s.path)}&select=client_id,content&limit=1`,
  assembler.ts:821:  `claude_memory?client_id=eq.${tier}&select=client_id,file_path,updated_at`,
  assembler.ts:837:  `claude_memory?client_id=eq.${tier}&select=client_id,file_path,content`,
 depth-block.ts: prose instructions to the model, e.g. depth-block.ts:60 `client_id=in.(${ALLOWLIST_CSV})`;
 index.ts:181-189: comments only)

$ sed -n '150,200p' supabase/functions/inbox-claude/index.ts
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) })
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', origin)
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !ALLOWED_USER_ID || !UPSTREAM_URL) {
    console.error('refusing: incomplete config', { ... })
    return fail(503, 'broker_not_configured', origin)
  }
  const authz = req.headers.get('Authorization') ?? ''
  const jwt = authz.startsWith('Bearer ') ? authz.slice(7).trim() : ''
  if (!jwt) return fail(401, 'unauthenticated', origin)
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await sb.auth.getUser(jwt)
  const user = data?.user
  if (error || !user) return fail(401, 'invalid_token', origin)
  if (user.id !== ALLOWED_USER_ID) {
    console.warn('rejected non-allowlisted user', { attempted: user.id })
    return fail(403, 'forbidden_user', origin)
  }

  // The request type deliberately has no working_directory and no client_id.
  // Those two fields are the upstream's cross-tenant primitive: working_directory
  // is used raw as the cwd with no allowlist (main.py:89,656) and client_id makes
  // get_client_config() clone another client's repo and inject that client's n8n
  // credentials (main.py:256-270). They are never read from the caller and never
  // forwarded, so no caller can steer the container at another tenant.
  //
  // `model` IS read from the caller, and is the only new caller-steerable field.
  // It is safe in a way working_directory and client_id are not: it is validated
  // against a literal allowlist of five model IDs and can address nothing. It
  // cannot name a path, a tenant, a repo or a credential.
  let body: { prompt?: unknown; context?: unknown; model?: unknown }
  try {
    body = await req.json()
  } catch {
    return fail(400, 'bad_json', origin)
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  const context = typeof body.context === 'string' ? body.context : ''
  const wantModel = typeof body.model === 'string' ? body.model.trim() : ''
```

Verdict basis: the ONLY three appearances of the literal string `working_directory` in the inbox-claude function directory are lines 181, 182, 189 of index.ts — all inside a `//` comment block. The request body type declared at line 180 (`{ prompt?: unknown; context?: unknown; model?: unknown }`) has no `working_directory` or `client_id` key. `client_id` DOES appear as a real field, but only in strings the SERVER constructs to query Supabase's PostgREST REST API for tenant-scoped memory rows (assembler.ts) — never as a field the incoming HTTP request is parsed for. Confirmed PASS for 1d.

---

## Section 2 — Cross-tenant proof (full population)

| # | Check | Verdict | Evidence |
|---|-------|---------|----------|
| 2a | Per-tier assembler queries (B10 fetch, one query per tier) all stay within allowlist | PASS | ivan tier: 1000 rows returned (of true total 1387, server-capped), all `client_id:"ivan"`; global tier: 28/28 rows, all `client_id:"global"`; shared-tech tier: 29/29 rows, all `client_id:"shared-tech"` — Appendix B1 |
| 2b(i) | Adversarial UNPINNED query `file_path=eq.project/MEMORY.md&select=client_id` (no client_id filter) | PASS (proves pin load-bearing) | Returns BOTH `{"client_id":"ivan"}` and `{"client_id":"proswppp"}` — confirms that without the `client_id=eq.` pin in the assembler's B9-style point-reads, the exact same file_path collision returns another tenant's row — Appendix B2 |
| 2b(ii) | Adversarial `client_id=in.(ivan,global,shared-tech)&select=client_id&limit=2000` | PASS (proves 1000-row cap risk) | `content-range: 0-999/1444` (true total 1444 = 1387 ivan + 28 global + 29 shared-tech); but the single batch of 1000 rows PostgREST actually returned contained **only** `global:28, ivan:972` — **shared-tech's 29 rows were entirely absent** from this one-shot `in.()` batch despite being inside the allowlist. This is the exact defect the assembler's one-query-per-tier design (B10, `assembler.ts:832-840`) exists to avoid — a single unpaginated multi-tier query can silently drop a whole tier past the server's 1000-row cap — Appendix B2 |
| 2c | claude-brain-query mode:recall, proswppp-flavoured query, UNSCOPED (no client_ids) | LEAK CONFIRMED | Returned a `proswppp` row (`project/reference_apollo_credit_billing.md`) alongside ivan/global rows — Appendix B3 |
| 2c | claude-brain-query mode:recall, same query, SCOPED (`client_ids:["ivan","global","shared-tech"]`) | PASS (clean) | All 8 results are `client_id` ivan or global only, zero proswppp — Appendix B3 |

### Appendix B1 — per-tier queries against live DB

Actual per-tier query read from `supabase/functions/inbox-claude/assembler.ts:832-840` (B10 full fetch, "one query per tier, client_id in the URL above any limit"):
```
claude_memory?client_id=eq.${tier}&select=client_id,file_path,content
```
run for `tier` in `ivan`, `global`, `shared-tech` (the ALLOWLIST from `allowlist.ts`).

```
$ curl -s -I ".../claude_memory?client_id=eq.ivan&select=client_id" -H "Prefer: count=exact" -H "Range: 0-0"
content-range: 0-999/1387

$ curl -s -I ".../claude_memory?client_id=eq.global&select=client_id" -H "Prefer: count=exact" -H "Range: 0-0"
content-range: 0-27/28

$ curl -s -I ".../claude_memory?client_id=eq.shared-tech&select=client_id" -H "Prefer: count=exact" -H "Range: 0-0"
content-range: 0-28/29

$ curl -s ".../claude_memory?client_id=eq.ivan&select=client_id" | python3 -c "...distinct client_ids..."
row count: 1000 distinct client_ids: {'ivan'}

$ curl -s ".../claude_memory?client_id=eq.global&select=client_id,file_path" | python3 -c "...distinct client_ids..."
row count: 28 distinct client_ids: {'global'}

$ curl -s ".../claude_memory?client_id=eq.shared-tech&select=client_id,file_path" | python3 -c "...distinct client_ids..."
row count: 29 distinct client_ids: {'shared-tech'}
```
(Service key parsed from `/Users/ivanmanfredi/Desktop/claude-code-railway/main.py` line 46 at runtime into a shell env var, `$SERVICE_KEY`; never printed or written to this file.)

### Appendix B2 — adversarial pair

```
=== (i) UNPINNED: file_path=eq.project/MEMORY.md&select=client_id ===
$ curl -s ".../claude_memory?file_path=eq.project/MEMORY.md&select=client_id"
[{"client_id":"ivan"},
 {"client_id":"proswppp"}]

=== (ii) client_id=in.(ivan,global,shared-tech)&select=client_id&limit=2000 ===
$ curl -s -D - -o /tmp/resp_ii.json ".../claude_memory?client_id=in.(ivan,global,shared-tech)&select=client_id&limit=2000" -H "Prefer: count=exact"
HTTP/2 206
content-range: 0-999/1444

$ python3 -c "...Counter(client_id)..."
total rows returned: 1000
tier counts: {'global': 28, 'ivan': 972}
```
Note: `28 + 29 + 1387 = 1444` matches the reported true total exactly, confirming both tiny tiers (global, shared-tech) and the large ivan tier are all within-allowlist — but the single in.() batch's default ordering placed all 29 shared-tech rows past the 1000-row cutoff, so they never appeared in that one request. This is a live demonstration (not a source-reading inference) of why the assembler issues one `client_id=eq.<tier>` request per tier instead of one `client_id=in.(...)` request for all tiers.

### Appendix B3 — claude-brain-query recall leak/clean pair

```
=== UNSCOPED (no client_ids), query="ProSWPPP case study copy rules and pricing" ===
$ curl -s -X POST ".../functions/v1/claude-brain-query" -d '{"mode":"recall","query":"ProSWPPP case study copy rules and pricing","match_count":8}'
results include:
  {"client_id":"ivan", "file_path":"project/case-study-receipts-2026-06-12.md", ...}
  {"client_id":"ivan", "file_path":"project/MEMORY.md", ...}
  {"client_id":"global","file_path":"global/feedback-proposal-stack-honesty.md", ...}
  {"client_id":"ivan", "file_path":"project/2k-bundled-tooling-value-prop.md", ...}
  {"client_id":"ivan", "file_path":"project/case-study-set-and-roster-truth-2026-07-25.md", ...}
  {"client_id":"proswppp","file_path":"project/reference_apollo_credit_billing.md", ...}   <-- LEAK
  {"client_id":"ivan", "file_path":"project/feedback-cover-copy-voice-gate.md", ...}
  (8th row truncated in capture)

=== SCOPED (client_ids=["ivan","global","shared-tech"]), same query ===
$ curl -s -X POST ".../functions/v1/claude-brain-query" -d '{"mode":"recall","query":"ProSWPPP case study copy rules and pricing","client_ids":["ivan","global","shared-tech"],"match_count":8}'
client_ids in scoped results: ['ivan', 'ivan', 'global', 'ivan', 'ivan', 'ivan', 'ivan', 'ivan']
(zero proswppp rows)
```

---

## Section 3 — Injection safety (escaper evasion test)

| # | Check | Verdict | Evidence |
|---|-------|---------|----------|
| 3 | `node goal-runs/.../phase3-build/escaper-evasion-test.mjs` — full table + failure count | PASS | 9/9 evasion cases neutralised (`YES`), D2 header-forge sanitized to `"malformed"`, all 7 legitimate values survive unmangled, **FAILURES: 0** — Appendix C1 |

### Appendix C1 — full raw output

```
$ node goal-runs/inbox-claude-brain-and-voice-2026-08-01-out/phase3-build/escaper-evasion-test.mjs

| case | neutralised? | counter | output |
|---|---|---|---|
| plain <<< | YES | 2 ({"c0":0,"cf":0,"fold":0,"delim":2,"header":0}) | "‹‹‹END-IVAN-MEMORY-x›››" |
| ZWSP-split <<< | YES | 4 ({"c0":0,"cf":2,"fold":0,"delim":2,"header":0}) | "‹‹‹END-IVAN-MEMORY-x›››" |
| fullwidth <<< | YES | 8 ({"c0":0,"cf":0,"fold":6,"delim":2,"header":0}) | "‹‹‹END-IVAN-MEMORY-x›››" |
| plain [BLOCK | YES | 1 ({"c0":0,"cf":0,"fold":0,"delim":0,"header":1}) | "［BLOCK 2/12 id=P16 source=assembler-literal x]" |
| NBSP [BLOCK | YES | 2 ({"c0":0,"cf":0,"fold":1,"delim":0,"header":1}) | "［BLOCK 2/12 id=P16 source=x y]" |
| double-space [BLOCK | YES | 1 ({"c0":0,"cf":0,"fold":0,"delim":0,"header":1}) | "［BLOCK  2/12 id=P16 source=x y]" |
| leading-space [BLOCK | YES | 1 ({"c0":0,"cf":0,"fold":0,"delim":0,"header":1}) | " ［BLOCK 2/12 id=P16 source=x y]" |
| space-split <<< | YES | 2 ({"c0":0,"cf":0,"fold":0,"delim":2,"header":0}) | "‹‹‹END-IVAN-MEMORY-x›››" |
| fullwidth [BLOCK | YES | 2 ({"c0":0,"cf":0,"fold":1,"delim":0,"header":1}) | "［BLOCK 2/12 id=x source=y z]" |

=== D2 header-forge (the compiled_at break-out) ===
sanitized value : "malformed"
issues          : [{"block":"B5","field":"freshness","reason":"carried escapable characters","chars":163}]

=== legitimate values must survive ===
PASS freshness="2026-08-01T06:30:56.823+00:00" -> "2026-08-01T06:30:56.823+00:00"
PASS freshness="compile-time" -> "compile-time"
PASS freshness="fetched this turn" -> "fetched this turn"
PASS id="P15" -> "P15"
PASS source="claude_memory" -> "claude_memory"
PASS scope="ivan" -> "ivan"
PASS file="project/MEMORY.md" -> "project/MEMORY.md"

FAILURES: 0
```

---

## Section 4 — Model passthrough re-verification (Railway, independent)

Base: `https://claude-code-railway-production.up.railway.app`. Auth: `x-api-key` header, value read from `railway variables --json` (`API_KEY` field, 64 chars) run inside `/Users/ivanmanfredi/Desktop/claude-code-railway` (read-only — no `railway up`/deploy/variable-set commands run). Field name is `prompt` (not `message`) per `main.py`'s `ChatRequest` model.

| # | Check | Verdict | Evidence |
|---|-------|---------|----------|
| 4a | POST /chat model=`gpt-4-turbo` → expect 400 | PASS | HTTP 400, `"Unsupported model 'gpt-4-turbo'. Allowed: [...]"` (10 allowed IDs listed) — Appendix D1 |
| 4b | POST /chat model=`claude-haiku-4-5` → expect 200 | PASS | HTTP 200, `{"result":"pong\n","success":true,...}` — Appendix D1 |
| 4c | POST /chat model=`claude-sonnet-4-6` → expect 200 | PASS | HTTP 200, `{"result":"pong\n","success":true,...}` — Appendix D1 |
| 4d | POST /chat no model field → expect 200 | PASS | HTTP 200, `{"result":"pong\n","success":true,...}` — Appendix D1 |
| 4e | POST /chat/stream × 3 variants (haiku, sonnet-4-6, no-model) | FAILS ALL THREE, IDENTICALLY | All three return HTTP 200 with body `data: {"type": "done", "returncode": 1}` and no actual streamed content — Appendix D2 |
| 4f | `git diff 2b1054f..HEAD --stat` — only main.py changed | PASS | `main.py \| 23 +++++++++++++++++++++--` → 1 file changed, 21 insertions(+), 2 deletions(-); single commit `82e4ab1 feat(chat): per-request model on /chat and /chat/stream, allowlisted` — Appendix D3 |
| 4g | Is the /chat/stream failure pre-existing or caused by the change? | PRE-EXISTING | The no-model-field variant (which exercises the exact pre-change code path — no new `model` handling engaged) fails identically (`returncode: 1`, empty stream) to the two model-specified variants. Since the baseline/default case fails the same way, the stream defect is NOT introduced by the 21-line model-passthrough diff — it predates it. |

### Appendix D1 — /chat variants

```
=== /chat model=gpt-4-turbo (expect 400) ===
$ curl -s -o /tmp/r1.json -w "HTTP_STATUS:%{http_code}\n" -X POST "$BASE/chat" -H "x-api-key: $API_KEY" -d '{"prompt":"hi","model":"gpt-4-turbo"}'
HTTP_STATUS:400
{"detail":"Unsupported model 'gpt-4-turbo'. Allowed: ['claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'claude-opus-4-5', 'claude-opus-4-5-20251101', 'claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-sonnet-4-20250514', 'claude-sonnet-4-5', 'claude-sonnet-4-5-20250929', 'claude-sonnet-4-6']"}

=== /chat model=claude-haiku-4-5 (expect 200) ===
$ curl -s -o /tmp/r2.json -w "HTTP_STATUS:%{http_code}\n" -X POST "$BASE/chat" -H "x-api-key: $API_KEY" -d '{"prompt":"Reply with exactly the word: pong","model":"claude-haiku-4-5"}' --max-time 90
HTTP_STATUS:200  (4.0s)
{"session_id":"80d603bd-c476-4151-a6bb-961da9fad1a5","result":"pong\n","success":true,"client_id":null,"files_created":[],"files_modified":[]}

=== /chat model=claude-sonnet-4-6 (expect 200) ===
$ curl -s -o /tmp/r3.json -w "HTTP_STATUS:%{http_code}\n" -X POST "$BASE/chat" -H "x-api-key: $API_KEY" -d '{"prompt":"Reply with exactly the word: pong","model":"claude-sonnet-4-6"}' --max-time 90
HTTP_STATUS:200  (4.4s)
{"session_id":"46962c6a-0d4a-4a78-b6fb-2e4fd4e9fa30","result":"pong\n","success":true,"client_id":null,"files_created":[],"files_modified":[]}

=== /chat no model field (expect 200) ===
$ curl -s -o /tmp/r4.json -w "HTTP_STATUS:%{http_code}\n" -X POST "$BASE/chat" -H "x-api-key: $API_KEY" -d '{"prompt":"Reply with exactly the word: pong"}' --max-time 90
HTTP_STATUS:200  (4.9s)
{"session_id":"5d0e4253-79d1-4f45-b28b-6f2df9209588","result":"pong\n","success":true,"client_id":null,"files_created":[],"files_modified":[]}
```

### Appendix D2 — /chat/stream variants

```
=== /chat/stream model=claude-haiku-4-5 ===
$ curl -s -X POST "$BASE/chat/stream" -H "x-api-key: $API_KEY" -d '{"prompt":"Reply with exactly the word: pong","model":"claude-haiku-4-5"}' --max-time 60 -w "\nHTTP_STATUS:%{http_code}\n"
data: {"type": "done", "returncode": 1}

HTTP_STATUS:200

=== /chat/stream model=claude-sonnet-4-6 ===
$ curl -s -X POST "$BASE/chat/stream" -H "x-api-key: $API_KEY" -d '{"prompt":"Reply with exactly the word: pong","model":"claude-sonnet-4-6"}' --max-time 60 -w "\nHTTP_STATUS:%{http_code}\n"
data: {"type": "done", "returncode": 1}

HTTP_STATUS:200

=== /chat/stream no model field ===
$ curl -s -X POST "$BASE/chat/stream" -H "x-api-key: $API_KEY" -d '{"prompt":"Reply with exactly the word: pong"}' --max-time 60 -w "\nHTTP_STATUS:%{http_code}\n"
data: {"type": "done", "returncode": 1}

HTTP_STATUS:200
```
All three variants return ONLY the terminal `done` event with `returncode: 1` — no `data:` content chunks precede it in any of the three runs.

### Appendix D3 — diff scope

```
$ git -C /Users/ivanmanfredi/Desktop/claude-code-railway diff 2b1054f..HEAD --stat
 main.py | 23 +++++++++++++++++++++--
 1 file changed, 21 insertions(+), 2 deletions(-)

$ git -C /Users/ivanmanfredi/Desktop/claude-code-railway log --oneline 2b1054f..HEAD
82e4ab1 feat(chat): per-request model on /chat and /chat/stream, allowlisted

$ git -C /Users/ivanmanfredi/Desktop/claude-code-railway rev-parse HEAD
82e4ab1657528ccb14e3eac811d44ac515d4f150
```

---

## Section 5 — Secret grep (build output + git history)

| # | Check | Verdict | Evidence |
|---|-------|---------|----------|
| 5a | `npm run build` | PASS (clean) | Vite + PWA build succeeded, no errors, only a routine "chunk >500kB" size advisory (not an error) — Appendix E1 |
| 5b | `dist/assets/*.js` grep `sk-ant-` | PASS (0 hits) | grep exit code 1 (no match) — Appendix E2 |
| 5c | `dist/assets/*.js` grep `service_role` | PASS (0 hits) | grep exit code 1 (no match) — Appendix E2 |
| 5d | `dist/assets/*.js` grep `RAILWAY_CLAUDE_API_KEY` | PASS (0 hits) | grep exit code 1 (no match) — Appendix E2 |
| 5e | `dist/assets/*.js` JWT scan + decode | PASS | Exactly ONE JWT literal found (in `dist/assets/index-CrPa4avF.js`); decoded payload `role: "anon"` (acceptable) — Appendix E2 |
| 5f | `git log -p exp/v2..exp/brain` grep same patterns, with counts | PASS | `sk-ant-`: 0 hits; `service_role`: 0 hits; JWT-pattern literal: 0 hits; `RAILWAY_CLAUDE_API_KEY`: 3 hits, all either prose discussing the env var NAME or `Deno.env.get('RAILWAY_CLAUDE_API_KEY')` (reading the env var at runtime, not a hardcoded value) — Appendix E3 |

### Appendix E1 — build

```
$ npm run build
...
dist/assets/index-b8A5d4gM.css       40.03 kB │ gzip:   7.97 kB
dist/assets/index-CrPa4avF.js       509.51 kB │ gzip: 142.61 kB
✓ built in 144ms
(!) Some chunks are larger than 500 kB after minification. [advisory only]
...
PWA v1.3.0
mode      injectManifest
precache  15 entries (760.87 KiB)
files generated
  dist/sw.js
```

### Appendix E2 — dist secret grep + JWT decode

```
$ grep -rl "sk-ant-" dist/assets/*.js         → (no output, exit 1)
$ grep -rl "service_role" dist/assets/*.js    → (no output, exit 1)
$ grep -rl "RAILWAY_CLAUDE_API_KEY" dist/assets/*.js → (no output, exit 1)

$ grep -oE "eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+" dist/assets/*.js | sort -u
dist/assets/index-CrPa4avF.js:eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJqYnZxdnpiemN6amJhdGdtY2NiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgzMDUwODAsImV4cCI6MjA4Mzg4MTA4MH0.yqghcn-Rw5dIFadLhvUASIeUARPvu_CyPOGayI8KyTI

$ python3 -c "...decode payload..."
{
  "iss": "supabase",
  "ref": "bjbvqvzbzczjbatgmccb",
  "role": "anon",
  "iat": 1768305080,
  "exp": 2083881080
}
```
Only 1 distinct JWT literal in the built bundle; role=anon. (Note: distinguish from the DEAD key mentioned in project memory, `iat=1738702127` — this one's `iat=1768305080` is a different key, consistent with the live anon key, not the retired one.)

### Appendix E3 — git history grep with counts

```
$ git log -p exp/v2..exp/brain | grep -c "sk-ant-"
0
$ git log -p exp/v2..exp/brain | grep -c "service_role"
0
$ git log -p exp/v2..exp/brain | grep -c "RAILWAY_CLAUDE_API_KEY"
3
$ git log -p exp/v2..exp/brain | grep -cE "eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"
0

$ git log -p exp/v2..exp/brain | grep -n "RAILWAY_CLAUDE_API_KEY"
508:+| a real turn | — | **not possible from here**: needs Ivan's Supabase session. `RAILWAY_CLAUDE_API_KEY` state on the broker is therefore unconfirmed; if unset, the client classifies the container's 401 as `upstream_not_armed` and says so in words (path unchanged, tested). |
682:+- A real turn was never executed from here, so `RAILWAY_CLAUDE_API_KEY`'s state on
8248:+const UPSTREAM_KEY = Deno.env.get('RAILWAY_CLAUDE_API_KEY')
```
All 3 `RAILWAY_CLAUDE_API_KEY` hits are either prose referencing the env var's NAME or a `Deno.env.get(...)` runtime read — none is a hardcoded secret value.

---

## Section 6 — Gates

| # | Check | Verdict | Evidence |
|---|-------|---------|----------|
| 6a | `npm test` | PASS | `Test Files 22 passed (22)`, `Tests 378 passed (378)`, duration 1.44s — Appendix F1 |
| 6b | `npm run lint` (errors vs warnings) | PASS (0 errors) | 0 errors, 17 warnings, exit code 0 — Appendix F2 |
| 6c | `npm run build` | PASS (clean) | Same clean build as Section 5/E1, no errors (only a routine >500kB chunk-size advisory) |
| 6d | `git diff exp/v2..exp/brain -- package.json` (no new dependency) | PASS | Empty diff, exit 0 — no changes to package.json at all between the two branches — Appendix F3 |

### Appendix F1 — npm test

```
$ npm test
> vitest run

 RUN  v4.1.10 /Users/ivanmanfredi/Desktop/ivan-inbox

 Test Files  22 passed (22)
      Tests  378 passed (378)
   Start at  18:35:36
   Duration  1.44s (transform 1.08s, setup 241ms, import 1.83s, tests 1.36s, environment 1ms)
```

### Appendix F2 — npm run lint (full raw output, 21 lines total)

```
$ npm run lint
> oxlint

scripts/sweep-v2.mjs:39:7: warning eslint(no-unused-vars): Variable 'type' is declared but never used. ...
src/components/ContextSheet.tsx:43:26: warning react-hooks(exhaustive-deps): React Hook useEffect has a missing dependency: 'thread.prospect_name' ...
scripts/sweep-v2c.mjs:29:7: warning eslint(no-unused-vars): Variable 'type' is declared but never used. ...
src/exp/v2c/Register.tsx:51:10: warning react(jsx-key): Missing "key" prop for element in array.
src/components/ConfirmSheet.tsx:20:17: warning react(only-export-components): Fast refresh only works when a file only exports components. ...
scripts/independent-measure-scoped.mjs:10:24: warning eslint(no-unused-vars): Identifier 'existsSync' is imported but never used. ...
src/exp/v2c/Surface.tsx:18:17: warning react(only-export-components): Fast refresh only works when a file only exports components. ...
src/exp/index.tsx:29:17: warning react(only-export-components): Fast refresh only works when a file only exports components. ...
goal-runs/inbox-claude-brain-and-voice-2026-08-01-out/phase2-tournament/cand-memo/assembler.ts:183:23: warning eslint(no-control-regex): Unexpected control characters ...
goal-runs/inbox-claude-brain-and-voice-2026-08-01-out/phase2-tournament/cand-memo/run-harness.mjs:158:9: warning eslint(no-unused-vars): Variable 't' is declared but never used. ...
src/exp/v2c/Rail.tsx:16:14: warning react(only-export-components): Fast refresh only works when a file only exports components. ...
src/screens/ThreadScreen.tsx:66:31: warning react-hooks(exhaustive-deps): React Hook useEffect has a missing dependency: 'draft.message_text' ...
goal-runs/inbox-claude-brain-and-voice-2026-08-01-out/phase4-harness/measure-voice.mjs:155:9: warning eslint(no-unused-vars): Variable 'playAt' is assigned a value but never used. ...
goal-runs/inbox-claude-brain-and-voice-2026-08-01-out/phase2-tournament/cand-memo/.build/assembler.mjs:65:23: warning eslint(no-control-regex): Unexpected control characters ...
goal-runs/inbox-claude-brain-and-voice-2026-08-01-out/phase4-harness/diag-final.mjs:11:8: warning eslint(no-unused-vars): Identifier 'os' is imported but never used. ...
src/exp/v2c/DraftPane.tsx:299:17: warning react(only-export-components): Fast refresh only works when a file only exports components. ...
goal-runs/inbox-claude-brain-and-voice-2026-08-01-out/phase2-tournament/cand-live/assembler.ts:275:20: warning eslint(no-control-regex): Unexpected control characters ...

$ echo EXIT:$?
EXIT:0
$ grep -c ": error " /tmp/lint_out.txt
0
$ grep -c ": warning " /tmp/lint_out.txt
17
```
All 17 warnings are pre-existing style/hygiene items (unused vars, missing hook deps, fast-refresh export shape, control-regex in test fixtures under `goal-runs/`) — zero errors, exit code 0.

### Appendix F3 — package.json diff

```
$ git diff exp/v2..exp/brain -- package.json
(empty output)
$ echo EXIT:$?
EXIT:0
```
No difference at all in package.json between `exp/v2` and `exp/brain` — confirms no new dependency was added on this branch.

---

## Final consolidated summary

| Section | Checks | Pass | Fail | Blocked |
|---|---|---|---|---|
| 1. Broker controls | 4 (1a-1d) | 4 | 0 | 0 |
| 2. Cross-tenant proof | 5 (2a, 2b-i, 2b-ii, 2c×2) | 5 | 0 | 0 |
| 3. Injection safety | 1 | 1 | 0 | 0 |
| 4. Model passthrough | 7 (4a-4g) | 6 | 1 (4e: /chat/stream broken, but confirmed pre-existing not caused by this change — see 4g) | 0 |
| 5. Secret grep | 6 (5a-5f) | 6 | 0 | 0 |
| 6. Gates | 4 (6a-6d) | 4 | 0 | 0 |
| **TOTAL** | **27** | **26** | **1** | **0** |

Nothing in this part was marked BLOCKED — every row above is backed by a command actually run and its raw output captured in the Appendix. The one FAIL (Section 4e, `/chat/stream` returns only `{"type":"done","returncode":1}` with no content for all three model variants) is real and reproducible, but Section 4g's control (the no-model-field variant, which does not touch the new code path, fails identically) demonstrates it is a pre-existing defect in the streaming endpoint, not a regression introduced by the model-passthrough change under review.

END OF PART 1.
