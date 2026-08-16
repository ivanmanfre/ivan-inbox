# Phase 0 — Scope, central risk, surface inventory

Run: `inbox-v2-revamp-2026-08-01` · orchestrator Fable · tier **T2 create-new-born-dead**
Evidence: two parallel inventory scouts (ivan-inbox surfaces, claude-code-railway anatomy) + direct probes. Every row below carries a file:line or a probe result.

## Liveness probes (run 2026-08-01, this session)

| Probe | Result |
|---|---|
| `GET ivanmanfre.github.io/ivan-inbox/` | `200` |
| `GET claude-code-railway-production.up.railway.app/` | `302` (up; web-UI login redirect) |
| `~/Desktop/ivan-inbox` git state | clean at `7c9ea96`, only untracked 07-31 tournament PNGs |
| `ivanmanfre/claude-code-railway` visibility | **PRIVATE** (`gh repo view`) |

## The single central risk

**Secret leak through a static public bundle.** The inbox is a Vite build deployed by `.github/workflows/deploy.yml:2` on every push to `main`, served from GitHub Pages with no test or lint gate — any push is instantly live. Its only build-time env vars are `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY` (`deploy.yml:11-15`), all of which are safe to ship. The Railway chat API authenticates with a single shared secret in an `X-API-Key` header (`main.py:73-77`), so any design that lets the browser call Railway directly would bake that secret into a public bundle.

**How this run neutralizes it:** the browser never holds a Railway credential. All Claude traffic goes through a new Supabase edge function that verifies the caller's Supabase JWT and holds the Railway key as a project secret. DoD greps the built `dist/` and the full git history for key material.

**A second, independent leak already exists and is out of this run's scope to fix** (carried to watch-first, flagged to Ivan in REPORT.md): a full-length `sk-ant-api03-…` Anthropic key is committed and tracked in `claude-code-railway/.env.example:5`, present in history (`git log` shows `8ce4323`, `df6801e`). The repo is private, which caps severity, but the key should be rotated and the file scrubbed. That is a different repo under a production fence; this run does not touch it.

## Broker architecture — decision and rejected alternatives

**DECIDED: a new Supabase edge function `inbox-claude` in `ivan-inbox/supabase/functions/`,** following the shape already proven in this repo (`supabase/functions/inbox-push/index.ts`). Properties, all enforced server-side:

- **Caller auth = Supabase JWT.** The function reads the `Authorization: Bearer` header, resolves the user via the Supabase client, and rejects anyone who is not Ivan's user id (single-id allowlist held as a secret, not in code). Anon and wrong-user must get 401/403. This matches how the app already authenticates edge calls (`src/lib/ops.ts:154-156`, `src/lib/today.ts:292-295`).
- **Railway key held as an edge secret** (`RAILWAY_CLAUDE_API_KEY`), sent as `X-API-Key` from the function to Railway. Never reaches the client.
- **Instance scoping is a refusal, not a default.** The function builds the upstream body itself from a fixed template and forwards ONLY the prompt text plus an opaque session id. `working_directory` and `client_id` are never read from the caller and never forwarded. This is the load-bearing control: `ChatRequest.working_directory` is used raw as cwd (`main.py:89`, `:656`) with no allowlist, and `client_id` triggers `get_client_config()` which clones that client's repo and injects that client's n8n credentials (`main.py:256-270`). Forwarding either field would hand the inbox a cross-tenant primitive.
- **Upstream endpoint:** `POST /chat/stream` (`main.py:773`, SSE over `--output-format stream-json`) with `/chat` (`main.py:617`) as the non-streaming fallback. Both are `X-API-Key`-gated. Nothing else from the Railway API is reachable through the broker: no `/clients` (`main.py:1086`), no `/workspace/*` (`main.py:1017`, path-traversal-prone), no `/skills/upload` (`main.py:924`, zip-slip).

**Rejected — browser calls Railway directly:** would require the `X-API-Key` value in the bundle. Instant, permanent leak on a public Pages deploy. Rejected outright by the fence.

**Rejected — reuse the Railway web-UI WebSocket** (`web-ui/server.js`, chat over WS with a bcrypt-password JWT cookie): the cookie is `sameSite:'none'` and its CSP allows framing from `*.ivanmanfredi.com` (`server.js:376-382`, `:230-234`), so embedding is technically possible. Rejected for three reasons: it authenticates with a shared password rather than Ivan's Supabase identity; `GET /api/sessions/:id/transcript` is unscoped across every client (`server.js:573-622`) and `GET /api/sessions?workspace=ALL` hands out ids across clients (`server.js:501`), so a session inside that UI can read other clients' conversations; and its chat frame accepts a `workspace` field, making instance scoping a UI convention instead of a server rule. Embedding it would import the exact multi-tenant exposure the mission forbids.

**Accepted-and-named residual risk:** Railway runs the Claude Agent SDK with `permissionMode:'bypassPermissions'` and `Bash`/`Write`/`Edit` enabled (`server.js:1143-1150`), and the FastAPI path unsets `ANTHROPIC_API_KEY` so the CLI uses OAuth credentials on disk (`main.py:244-254`). Brokering chat therefore gives the inbox real shell reach on that container. That is inherent to "bring the Claude Code connection into the inbox" and is what Ivan asked for; the mitigation is that only Ivan's authed JWT can reach it and the workspace is fixed server-side. Named here so it is a decision, not an accident.

**Voice credential path (resolved in Phase 3 by probing the vault, both branches pre-specced):** Railway's voice is server-brokered OpenAI, not Web Speech (`web-ui/lib/voice.js:12-14`: STT `gpt-4o-mini-transcribe`, TTS `gpt-4o-mini-tts`, summary `gpt-4.1-nano`), and its client already degrades to `webkitSpeechRecognition` when the server has no key (`ChatArea.tsx:524-530`). Primary branch: an `inbox-voice` edge function brokering OpenAI STT if an `OPENAI_API_KEY` exists in the project vault (a sibling project function references one — `personal-site/supabase/functions/blueprint-publish/index.ts:4`). Fallback branch: on-device `webkitSpeechRecognition`, zero keys, zero spend. Either way no key reaches the bundle, and "no new spending" holds because both reuse existing credentials.

## Surface inventory — every surface the revamp must land on

Per-surface verification is required in Phase 4; the right-hand column is filled there. Two prior runs shipped to one of two live surfaces and called it done, which is why this table exists.

### Routes (parser `src/lib/route.ts:1-32`; gate `src/exp/index.tsx:14-22`)

| Route | Renders | Notes |
|---|---|---|
| `#today` | `TodayScreen` (616 LOC) | 4 zones `#td-z1..z4`; desktop 2-col masonry `styles.css:602-627` |
| `#inbox` | `InboxScreen` (136) + `ThreadScreen` (233) in detail pane | default tab |
| `#drafts` | `DraftsScreen` (312) | pointer-swipe approve/discard |
| `#sends` | `SendsScreen` (338) + `kpi/OverviewView` (696) | 3 views overview/lanes/log |
| `#ops` | `OpsScreen` (379) | comment-reply queue, 2 edge fns |
| `#settings` | `SettingsScreen` (149) | push, chime, theme, sign out |
| `#thread/<id>` | forces inbox + opens thread | `App.tsx:82-85` |
| `#exp/a`,`b`,`c`,`off` | `ExpGate` → lazy shells | **`#exp/c` still routable though C was eliminated 07-31** (`src/exp/index.tsx:26`) |
| `#exp/v2` | *this run's build target* | must be added to the gate regex |

Load-time-only hash read: `getExpVariant()` runs at mount (`src/exp/index.tsx:14`), sticky via `sessionStorage['exp_variant']`. Every probe of an `#exp/` route needs a fresh page load.

### Viewport branches — one breakpoint, forked in 4 places

`useDesktop()` is the only JS viewport source: `matchMedia('(min-width: 1000px)')` (`src/hooks/useDesktop.ts:4`). No Tailwind, no `innerWidth`, no `ResizeObserver`.

| File | Fork |
|---|---|
| `src/App.tsx:148-192` | whole-tree: desktop rail+list+detail vs mobile takeover; `:152` sends/ops/today escape to `.dt-full` |
| `src/exp/cand-a/Shell.tsx:42,85,118,138,142` | byte-near copy of the same fork |
| `src/exp/cand-b/Shell.tsx:34,72,102,121,125` | same |
| `src/exp/cand-c/Shell.tsx:53,86,116,139-142` | same |
| `src/styles.css:451-463` | Overview grid at ≥1000px |
| `src/styles.css:602-627` | Today masonry at ≥1000px |
| `src/styles.css:283-300` | `.app.dt` class rules (JS-driven, not a media query) |
| `src/styles.css:200` | `@media (hover:hover)` hover affordances |
| `src/styles.css:28` vs `:284` | mobile canvas cap `max-width:480px`, lifted on desktop |
| `src/hooks/usePullToRefresh.ts:53-56` | touch-only → absent on desktop |

**The duplicated fork is a build-order finding:** any layout change lands in 4 files unless the fork is extracted first. Phase 2 candidates that restructure navigation must state how they handle it.

### Other surfaces

- **Auth:** implicit flow, deliberately (`src/lib/supabase.ts:3-19` — PKCE breaks in the partitioned PWA storage). Email OTP + magic link (`LoginScreen.tsx`). Session revalidated on `visibilitychange` (`App.tsx:33-46`). The app never reads a user id anywhere; identity is the JWT plus RLS. **The broker needs a user id, so Phase 3 introduces the first user-identity read in the app.**
- **Service worker** `src/sw.ts` (18 lines): precache only, no runtime/API caching, push + notificationclick. `registerType:'autoUpdate'`. Must still install after the revamp.
- **Content data layer (REUSE, do not rebuild):** `src/lib/content.ts` (536), `styles.ts` (233), `agent.ts` (235) with 747 LOC of pure-function tests. Traps confirmed live in code: Ivan's `carousel_drafts.client_id` is NULL so the lane filter is `.is('client_id', null)` (`content.ts:56-60`); two style families collide on `before-after` so preview joins are family-keyed (`styles.ts:11-19`, `:165-172`); resources are read-only on purpose (`styles.ts:218-221`); `sendChat` is RPC-only via `n8nclaw_dashboard_send` (`agent.ts:157-162`) and the unauthenticated WhatsApp-spoof fallback is deliberately absent (`agent.ts:148-156`) — never port it.
- **Two competing groupings of the same content rows ship simultaneously and disagree on purpose:** triage `bucketDrafts` (`content.ts:100-128`) vs lifecycle `groupByStage` (`content.ts:339-343`), documented at `:264-277`. Phase 2 must pick one or keep both explicitly.
- **RPCs (only 4):** `n8nclaw_dashboard_send` (`agent.ts:160`), `dashboard_action` (`agent.ts:180`, private, allowlist reaches `outreach_campaigns.is_active` — wrappers hard-code table+field at `:174-177`), `inbox_range_kpis`, `inbox_governor` (`kpis.ts:54,60`).
- **Edge fns called with bare `fetch`, never `functions.invoke()`** (`today.ts:6-8` — invoke's `X-Client-Info` dies in that fn's CORS preflight): `rise-comment-reply`, `rise-comment-draft`, `get-morning-brief`. The broker follows the same bare-fetch rule.
- **Design tokens (the floor):** `src/styles.css:1-16`. Dark default `--bg:#000`, `--surface:#1C1C1E`, `--accent:#10A37F`, `--blue:#0A84FF`; light theme via `:root[data-theme='light']`. System font stack only, **no monospace anywhere** (house rule stated at `styles.css:471`). Severity is a consistent 3-tier system: `#10A37F` clear / `#FF9F0A` attention / `#FF453A` urgent (`styles.css:468-471`). Icons are Unicode glyphs, not an icon set (`TabBar.tsx:9-30`). 6 keyframes total, no animation library. Radii 6→22px plus `99px` pills.
- **Perf finding, dominant cost:** `useInbox` pages up to 20×1000 rows through `inbox_messages_v` on every refresh, every realtime event, and every window focus (`src/lib/inbox.ts:135-150`, `useInbox.ts:26-31`). It feeds InboxScreen, DraftsScreen and all three candidate shells.
- **Realtime channel-collision rule (load-bearing):** `supabase.channel()` returns the existing channel for a topic, so mounts namespace their topic with `useId()` (`useOps.ts:8-15`, `useContent.ts:28-35`, `useAgent.ts:21-26`). `useInbox` is the exception with a hardcoded `'inbox'` topic (`useInbox.ts:27`). New chat surfaces must follow the `useId` rule.
- **Test reality:** 10 test files / 1,647 LOC, all pure functions, node env, **zero rendering tests for any screen** (`vitest.config.ts:3-7`). Visual verification is only via `scripts/shot*.mjs` Playwright screenshotters; `scripts/dev-login.mjs` mints an authed session with admin `generate_link` + service key. CI has no test or lint step.

## What Phase 1 audits (derived from this inventory)

Auditors get: every screen at 390px and 1440px, the three daily jobs measured in taps, the duplicated-fork and 20k-row findings as pre-seeded leads to confirm or refute, the two-groupings decision, and the Railway voice weaknesses to check against a real session. Skeptic roles are assigned per the mission: secret-leak, dead-route, mobile-regression, cross-tenant.

## Open items carried forward

1. `#exp/c` is routable but eliminated — the winner-apply step should delete it (Phase 5 documents; not executed this run).
2. `dist/` is committed in the working tree — Phase 4's secret grep covers it, and the build must not introduce new env vars beyond the three `VITE_*`.
3. The Railway `.env.example` key exposure and the unscoped transcript endpoint go to Ivan in REPORT.md as findings from a neighbouring repo, not as work this run performs.
