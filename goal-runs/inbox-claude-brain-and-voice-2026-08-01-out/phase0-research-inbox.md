# Phase 0 research — inbox-claude-brain-and-voice-2026-08-01

Repo: `/Users/ivanmanfredi/Desktop/ivan-inbox` (not a git submodule of anything; standalone repo). Working tree checked out on `main`. All exp/v2-branch citations below were read with `git show exp/v2:<path>` (never checked out).

## ⚠ Branch-location discrepancy (read this first)

`exp/v2` tip is `64e3b72` (`fix(freshness): a fresh read says 'Checked just now', not 'Checked now ago'`, 2026-08-01 04:04:42 +0200). On that tip:

- `src/exp/v2c/VoiceControl.tsx`, `src/exp/v2c/chat/*`, `src/lib/content.ts` **exist and are committed** — read via `git show exp/v2:<path>`, cited as such below.
- `supabase/functions/inbox-claude/index.ts`, `src/lib/claude.ts`, `src/lib/claude.test.ts`, `scripts/density.mjs`, `scripts/diffshots.mjs`, `scripts/sweep.mjs` **do NOT exist on `exp/v2`** (`git ls-tree -r exp/v2` has no hits). They exist only as **untracked files in the current working directory** (main checked out, `git status --short` shows them `??`). They are not on any branch — not `exp/v2`, not `main`, not even the most recent `wip/mac-20260801-124355` auto-checkpoint (04:04 UTC... 12:43:56 local — that checkpoint predates `inbox-claude/index.ts`'s creation, confirmed no diff for `src/lib/claude.ts` between that checkpoint and disk, but `supabase/functions/inbox-claude/index.ts` is absent even there).

Conclusion: an earlier phase of *this same goal-run* already built the broker, the real transport (`src/lib/claude.ts`), and the three instrument scripts, live on disk, but nothing has committed them to `exp/v2` yet. I read them straight off disk since that's the only place they exist. Flag this to whichever phase does the actual commit/branch hygiene — right now this work is one `rm -rf` away from gone (untracked, no stash, no branch).

---

## 1. `supabase/functions/inbox-claude/index.ts` (working tree, untracked — 188 lines)

**Auth flow:**
- Reads `Authorization: Bearer <jwt>` header (`index.ts:83-85`). Missing → `401 unauthenticated`.
- Verifies via `sb.auth.getUser(jwt)` using a **library call**, not manual JWT decode (`:87-93`) — comment explicitly warns against `atob`-decoding the payload, citing repo precedent that does this insecurely.
- Compares `user.id` (immutable) against `ALLOWED_USER_ID`, **never** email or role alone, since every signed-in user has `role: authenticated` (`:94-97`). Mismatch → `403 forbidden_user`.
- Env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `INBOX_CLAUDE_ALLOWED_USER_ID` (the allowlist — single user id, singular not plural), `RAILWAY_CLAUDE_URL`, `RAILWAY_CLAUDE_API_KEY` (`:19-25`).
- **Fail-closed on missing config**: if any of `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`ALLOWED_USER_ID`/`UPSTREAM_URL` is unset, returns `503 broker_not_configured` before even checking auth (`:75-81`) — explicit comment ties this to the upstream's own fail-open bug (main.py had no auth by default).

**Request body schema accepted** (`:105-116`):
```ts
{ prompt?: unknown; context?: unknown }
```
- `prompt`: must be a string, trimmed, non-empty, ≤ `MAX_PROMPT_CHARS` (12,000 chars) → else `400 empty_prompt` / `413 prompt_too_long`.
- `context`: optional string, ≤ `MAX_CONTEXT_CHARS` (24,000 chars) → else `413 context_too_long`.
- Nothing else is read from the body at all — no `model`, no `session_id`, no `working_directory`, no `client_id`.

**What it forwards upstream** (`:117-137`):
- `POST ${UPSTREAM_URL}/chat/stream`
- Body: `{ prompt: context ? "${context}\n\n---\n\n${prompt}" : prompt, stream: true }` — context and prompt are concatenated into ONE prose string field; there is no separate context parameter upstream.
- Headers: `Content-Type: application/json`, and `X-API-Key: <RAILWAY_CLAUDE_API_KEY>` **only if set** (sent unconditionally when present — comment notes upstream doesn't currently enforce it, so this is forward-compatible for whenever Ivan sets `API_KEY` on Railway).

**Deliberately NOT forwarded** (`:99-104`, explicit comment block):
- No `model` field at all — model is not in the accepted body schema, not forwarded, not even parsed.
- No `working_directory` — cited as the upstream's cross-tenant primitive (`main.py:89,656`, used raw as cwd with no allowlist).
- No `client_id` — cited as the other cross-tenant primitive (`main.py:256-270`, `get_client_config()` would clone another client's repo and inject that client's n8n creds).
- No `session_id`/resume — noted that upstream's `/chat/stream` never reads `session_id` anyway (`main.py:773-866`), so every turn is a fresh CLI session; the only continuity is the transcript the **client** replays via `context`.

**CORS** (`:29-35, 48-56`): allowlist, not `*`:
```
https://ivanmanfre.github.io
http://localhost:4173/4174/4175/5173
```
`Access-Control-Allow-Origin` echoes the origin only if it's in the list, else defaults to the first entry; `Vary: Origin` set; headers allowed = `authorization, content-type`; methods = `POST, OPTIONS`.

**Size/time limits:** `MAX_PROMPT_CHARS=12_000`, `MAX_CONTEXT_CHARS=24_000`, `UPSTREAM_TIMEOUT_MS=240_000` (4 min) — comment notes upstream hard-caps at 900s and dies past it, so the broker aborts well under that so the client gets a structured `504 upstream_timeout` instead of a dropped socket.

**Error responses** — all via `fail(status, code, origin, detail?)` → `{ error: code, detail }` JSON:
| status | code | trigger |
|---|---|---|
| 503 | `broker_not_configured` | missing env var |
| 401 | `unauthenticated` | no bearer token |
| 401 | `invalid_token` | `getUser()` failed |
| 403 | `forbidden_user` | user.id not allowlisted |
| 400 | `bad_json` | body isn't parseable JSON |
| 400 | `empty_prompt` | prompt empty after trim |
| 413 | `prompt_too_long` / `context_too_long` | over char caps |
| 504 | `upstream_timeout` | fetch aborted by the 240s timer |
| 502 | `upstream_unreachable` | fetch threw (not abort) |
| 502 | `upstream_error` | upstream responded but `!ok` or no body; detail = `status ${code} ${first 300 chars of body}` |

There is **no distinct `upstream_not_armed` code emitted by the broker itself** — that's a client-side reclassification. See `src/lib/claude.ts:75`: `classify()` checks `raw === 'upstream_error' && detail?.includes('401')` and remaps it to `upstream_not_armed`. So the actual mechanism: broker forwards to Railway, Railway (with no `API_KEY` configured / rejecting the request) returns 401, broker relays that as `502 upstream_error` with `detail: "status 401 ..."`, and the **client** (`src/lib/claude.ts`) is what turns that into the human-legible "Claude is not armed yet" state. The broker itself has no `upstream_not_armed` string anywhere in it.

**Streaming passthrough mechanics** (`:151-187`): a `ReadableStream` reads the upstream body reader in a loop and `controller.enqueue`s raw chunks — a byte-for-byte SSE relay, not re-parsed/re-framed. On a relay-side read failure, it synthesizes one extra SSE frame: `event: error\ndata: {"error":"relay_broken","detail":...}\n\n` before closing. On stream `cancel()` (client aborts the fetch reader), it calls `ctl.abort()` on the upstream `AbortController` — this is what makes the UI's Stop button real: cancelling client-side actually kills the upstream fetch, and the comment states the upstream then kills its process group on disconnect. Response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`.

## 2. Live broker probe (read-only, no real turn attempted)

Anon key pulled from `.env.local`: `VITE_SUPABASE_URL=https://bjbvqvzbzczjbatgmccb.supabase.co`.

**(a) POST with no auth header:**
```
HTTP/2 401
sb-error-code: UNAUTHORIZED_NO_AUTH_HEADER
{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}
```
This is the **Supabase platform gateway** rejecting the request before the function code runs at all (no `access-control-allow-origin` echo of a specific origin — it's `*`, a gateway default, not the function's CORS logic). Confirms `verify_jwt` is on at the platform level for this function.

**(b) POST with anon key as Bearer token:**
```
HTTP/2 401
access-control-allow-origin: https://ivanmanfre.github.io   ← the function's OWN cors() ran, so this request reached the function code
{"error":"invalid_token"}
```
The anon key is a syntactically valid JWT (per standing memory trap: "anon key IS a valid JWT so platform verify_jwt is not auth"), so it clears the platform gate and reaches the function. Inside the function, `sb.auth.getUser(jwt)` correctly identifies it as not a real user session and the function's own `fail(401, 'invalid_token', origin)` fires — this is an exact match to `index.ts:93` in the file I read.

**Conclusion:** the deployed broker is live, reachable, and its auth-rejection behavior matches the `index.ts` I read almost exactly (down to the specific error string `invalid_token` and the origin-echo CORS behavior) — strong evidence the deployed version is this file or a near-identical ancestor. I did **not** attempt an authed turn (per instructions), so whether `RAILWAY_CLAUDE_URL`/`RAILWAY_CLAUDE_API_KEY` are actually set on the deployed function (i.e. whether it would 503 `broker_not_configured` or actually reach Railway) was **not** tested and remains unknown from this probe alone.

## 3. `src/exp/v2c/VoiceControl.tsx` (exp/v2, 154 lines) + backing state machine

`VoiceControl.tsx` itself is pure render (three exported components: `VoiceControl` the mic button, `VoiceStrip` the status line above the composer, `HandsFreeSheet` the takeover modal) — it holds no state itself, it renders `VoiceState` from `src/exp/v2c/chat/voice.ts` (the reducer) and `src/exp/v2c/useVoice.ts` (the hook that drives it).

**State machine (`chat/voice.ts`, pure reducer `voiceReduce`)** — exactly one state at a time, so illegal transitions are structurally impossible rather than policed by convention:
```
IDLE → ARMING → LISTENING → TRANSCRIBING → SENDING → SPEAKING → (back to LISTENING if handsFree, else IDLE)
                    ↳ PAUSED (3x no-speech) ⟲ ARMING (resume)
any state → ERROR{reason, retryable} on 'fail'  (global transition, always wins)
```
- `SPEAKING` has **no reachable transition that re-arms the mic** — commented as closing off the reference implementation's AEC-less-echo bug (mic re-opening while Claude is still talking) at the type level, not just by discipline.
- `ERROR` carries a typed `reason: VoiceErrorReason` (`mic-denied | no-mic | no-key-broker | stt-network | stt-upstream | tts-failed | unsupported`) + `retryable: boolean`, each with distinct copy in `VOICE_COPY` and severity (`attention` vs `urgent`) via `voiceSeverity()` — contrasted explicitly against a "reference implementation" that collapsed every failure into one "Transcription failed" string.
- `NO_SPEECH_ROUNDS = 3`: three consecutive empty listens before giving up (→ `PAUSED`), same as the reference's give-up threshold.

**Speech APIs used (`useVoice.ts`)** — **fully on-device, no network leg for voice at all**:
- STT: `webkitSpeechRecognition`/`SpeechRecognition` (`recognitionCtor()` feature-detects both). `continuous=false`, `interimResults=true`, `maxAlternatives=1`, `lang='en-US'`. One utterance per turn — the recognizer finalizing IS the end-of-speech signal (no invented silence timer). Comment: the Supabase vault has no `OPENAI_API_KEY`, so the audit's originally-planned edge-brokered STT branch doesn't exist and on-device becomes the actual design, argued as *better* not just cheaper — removes 2 of 4 network legs (capture→upload→transcribe→send collapses to just the chat turn).
- TTS: `window.speechSynthesis` / `SpeechSynthesisUtterance`, rate `1.04`.
- `unlockAudio()` (`chat/voice.ts` bottom) primes `speechSynthesis` **synchronously inside the mic button's `onPointerDown`**, before any `await` — iOS drops an utterance not primed inside a real, still-live gesture, so this must never move behind an await.
- No amplitude API exists for `SpeechRecognition`, so the 8-bar level meter is driven by **speech-activity proxy**: `level = min(1, 0.25 + (interim word count % 7)/8)` while interim results arrive — answers "is it hearing me" without pretending to be a real VU meter.

**How replies are spoken:** `useVoice`'s `SENDING` state ends when the *chat* hook's own state machine reports `turnDone` (read, not raced against a competing fallback timer — explicit contrast with the reference's `hfDoneFallbackRef`). On entering `SPEAKING`, `speak(replyText)` runs `speakableText()` (`chat/voice.ts`) first, which strips markdown for TTS: fenced code blocks become "— there is a code block on screen —", backticks/bold/italic/links stripped, list markers stripped, and text is cut at a sentence boundary within `maxChars=700` rather than mid-word.

**Error paths:** every `SpeechRecognition.onerror` code is mapped via `sttErrorReason()`: `not-allowed`/`service-not-allowed` → `mic-denied` (not retryable — a refused permission won't un-refuse on retry), `audio-capture` → `no-mic` (not retryable), `network` → `stt-network` (retryable), `language-not-supported` → `unsupported` (not retryable), everything else → `stt-upstream` (retryable). `no-speech` is explicitly **not** an error — it routes to the `PAUSED` state via a round counter, not `ERROR`.

**Latency instrumentation present:** `useChat.ts` has a client-side "slow" timer (`SLOW_MS = 4000`, `:setSlow(true)` after 4s with no response) to avoid a silent spinner, and each landed turn carries `costUsd`/`durationMs` on the turn object (`landed?.durationMs`, measured as `now - startedAt` in `transport.ts:toChatEvent`, `case 'done'`). **I found no dedicated voice-latency instrumentation** (no first-audible timer, no STT word-error-rate measurement) inside `VoiceControl.tsx`, `chat/voice.ts`, or `useVoice.ts` — comments reference target numbers from a "phase0-latency-ledger" (`T.arming=260, T.listen=2400, T.transcribe=900, T.speak=1900` — these are **mock-mode** cadences only, chosen "near the measured reference numbers," not live measurements) and cite a `<1.2s` target and "0.86s short / 2.0s long" from that ledger, but the actual measurement artifact (`phase0-latency-ledger`) was not found under `goal-runs/` in this repo — only referenced in code comments, not present as a file I could locate. **This directly matches Phase 2's mission-stated job**: "measure voice properly: real latency numbers and a real transcription word-error rate... so the <1.2s target is either met or disproved with evidence" — as of this read, that measurement does not yet exist in code.

## 4. Chat surface calling the broker

**Files:** `src/lib/claude.ts` (working tree, untracked — the real transport, 194 lines) → `src/exp/v2c/chat/transport.ts` (exp/v2, committed) → `src/exp/v2c/useChat.ts` (exp/v2, committed) → rendered by `ChatPane.tsx`/`ChatMessage.tsx`/`Shell.tsx` (not read in full for this pass, but wired via `useChat`).

**How a turn is sent:**
1. `useChat.send(prompt, about?)` (`useChat.ts:69`) builds `context` via `buildContext(turns, about)` — the **last `CONTEXT_TURNS=6`** turns, each truncated to `CONTEXT_CHARS=1200` chars, formatted as `"Ivan: ...\n\nYou: ..."` prose, plus an optional `"The operator is looking at: <about>"` line. This transcript replay is the **only continuity** — the upstream is stateless per turn (no `--resume`), documented at both `useChat.ts:16-24` and `claude.ts:11-15`.
2. `getTransport()()` (`transport.ts:203`) picks `httpTransport` unless a `?wbmock=chat:...` URL flag is present (`transportIsMock()`), in which case `mockTransport` runs a scripted 3-reply demo with injectable failure modes (`error-cold`, `error-mid`) — used to reach states a healthy backend can't produce on demand, for review/screenshot purposes.
3. `httpTransport` → `httpStream()` → `bridge()` (an async-generator adapter with its own backpressure buffer) → `sendToClaude(prompt, {context, signal, onEvent})` in `claude.ts:96`.
4. `sendToClaude` reads the **live Supabase session token** via `supabase.auth.getSession()` (not a stored copy — re-read each send), and does a **bare `fetch()`**, never `supabase.functions.invoke()` — comment explains `invoke()` adds an `X-Client-Info` header that fails CORS preflight on this project's functions (cross-referenced to a prior scar at `src/lib/today.ts:6-8`). POST body: `{ prompt, ...(context ? {context} : {}) }`. No `model` field sent from the client either — matches the broker's silence on model.

**How streaming is rendered:** the broker relays raw SSE bytes; `claude.ts`'s reader buffers on `\n\n` frame boundaries (keeping a trailing partial frame across `read()` calls) and `emit()` maps each frame's `data:` payload into one of `{status, text, tool, done, error}` `ClaudeEvent`s by inspecting the Claude-Code-CLI's own `stream-json` `type` field (`assistant`/`text`→text delta, `tool_use`→tool, `system`/`status`→status, `result`→done). `transport.ts:toChatEvent` maps each `ClaudeEvent` to the UI's `ChatEvent` union, and text deltas are fed through `chat/pacer.ts`'s `createPacer` (not read in full this pass) which controls perceived typing speed independent of network chunking — the accumulated text (`acc`) is what's committed to the transcript so a turn that ends mid-pacer never loses characters.

**Where a model picker would slot in:** there is currently **no model field anywhere in this path** — not in the broker's accepted body, not in `claude.ts`'s `SendOptions`, not in `useChat`'s `send()` signature. `useChat` does track and expose a `model: string | null` state (`setModel(ev.model)`, set from a `session` event) but that's **read-only telemetry of what model responded**, sourced from the (currently mock-only) `session` event type in `transport.ts`'s `mockStream` (`yield { type: 'session', ..., model: 'claude-opus-5' }`) — the real `httpTransport`/`claude.ts` path has **no code path that ever emits a `session` event with a model**, since the broker forwards no model info back. A model picker would need: (1) a new field in the broker's accepted body schema + forwarded upstream body (currently just `{prompt, stream}`), (2) a corresponding parameter in `sendToClaude`'s `SendOptions`, (3) UI state in `useChat`/`ChatPane` to hold and send the selection — none of which exists yet.

**Existing settings UI:** `SettingsScreen.tsx` exists as a top-level job/tab (`JOB_LABEL.settings = 'Settings'`, `JOB_ICON.settings = '⚙︎'`) but was not read in full this pass; not established that it has any Claude-specific settings (model, voice on/off, etc.) — flagged as a follow-up read for whichever phase designs the model picker, since `settings` is the natural existing surface to extend rather than invent a new one.

## 5. `src/lib/content.ts` (exp/v2, 536 lines) — export inventory + used/unused

**Export count:** 43 total named exports = **14 pure `type` aliases** + **29 value-level exports** (9 consts + 14 sync functions + 6 async functions). The mission doc's "29 exports" figure matches exactly **only if counting value-level exports** (types excluded) — confirmed by direct count, not assumed.

**All 29 value exports, one line each:**

| # | Export | Kind | One-line purpose |
|---|---|---|---|
| 1 | `ACTIVE_STATUSES` | const | statuses treated as "in flight" regardless of age (`review,error,generating,approved,scheduled`) |
| 2 | `RECENT_DAYS` | const | 60 — recency window for the queue fetch |
| 3 | `ARCHIVED_STATUSES` | const | `disqualified, skipped` |
| 4 | `laneFilter` | fn | `ContentLane → LaneFilter` descriptor (`is null` for ivan, `eq 'risedtc'`) |
| 5 | `draftLane` | fn | coalesce `client_id` → `'ivan'` at consumption layer, matching every other screen's convention |
| 6 | `bucketDrafts` | fn | groups rows into 9 **triage** buckets (review/error/stuckScheduled/approvedUnscheduled/generating/scheduled/published/archived/unknown) |
| 7 | `isStuckScheduled` | fn | a `scheduled` row past its time with no `source_post_id` |
| 8 | `QUEUE_STATUSES` | const | `pending,queued_v2,posting,posted,failed,cancelled` — the separate `scheduled_posts` vocabulary |
| 9 | `SKIP_STATUS` | const | `'disqualified'` — the durable equivalent of the dashboard's session-local "skip" |
| 10 | `reviewActionable` | fn | gate: only `status==='review' && lane==='ivan'` shows a mutating affordance |
| 11 | `PIPELINE_STAGES` | const | `['ideas','generating','review','approved','scheduled','published']` — render order for the lifecycle view |
| 12 | `ALERT_STAGES` | const | `['error','stuck']` — lifted out of the flow as an alert strip |
| 13 | `STAGE_LABEL` | const | display label per `ContentStage` |
| 14 | `stageOf` | fn | one row → one lifecycle stage |
| 15 | `groupByStage` | fn | groups rows by `stageOf` |
| 16 | `countUndated` | fn | count of rows with no `scheduled_at` (the approved-black-hole counter) |
| 17 | `countBoardVisible` | fn | count where `board_visible===true` (strict, NULL≠visible) |
| 18 | `normalizeAgentLog` | fn | any shape (array/string/JSON-string/null) → `AgentLogEntry[]`, sorted if fully-timestamped, never throws |
| 19 | `normalizeQa` | fn | qa jsonb/string → `QaSummary`, `pass` strictly `verdict==='PASS'` |
| 20 | `TAXONOMY_KEYS` | const | `source,pillar,hook_type,structure_used,image_style,arm` |
| 21 | `taxonomyFields` | fn | taxonomy jsonb-or-bare-string → flat label/value map, handles the `before-after` bare-string-as-`structure_used` collision |
| 22 | `normalizeKeyPoints` | fn | key_points any-shape → `string[]` |
| 23 | `normalizeImageUrls` | fn | image_urls any-shape (incl. single string) → `string[]` |
| 24 | `fetchContentDrafts` | async fn | lane-scoped `carousel_drafts` list read, recency-OR-active filter, `.limit(1000)`, exact count |
| 25 | `fetchScheduledQueue` | async fn | reads `scheduled_posts` across both lanes (no lane scoping — shared queue) |
| 26 | `fetchLaneProbe` | async fn | `{scoped, total}` row counts to distinguish "empty lane" from "filter ate everything" |
| 27 | `approveDraft` | async fn | `status='approved'`, scoped `.is('client_id', null)` — Ivan-lane only |
| 28 | `skipDraft` | async fn | `status='disqualified'`, same Ivan-lane scoping |
| 29 | `fetchDraftDetail` | async fn | `select('*')` one row by id, `maybeSingle()` |

**Used by the shipped v2c UI** (grepped `import ... from '../../lib/content'` / `'../lib/content'` across `src/exp/v2c/*` and `src/hooks/*`; each verified with a targeted `git grep` — **zero hits** for every export listed as unused, confirmed, not assumed):

**USED (19 of 29):** `bucketDrafts`, `groupByStage`, `fetchContentDrafts`, `fetchDraftDetail`, `fetchLaneProbe` (all via `src/hooks/useContent.ts`) · `ALERT_STAGES`, `PIPELINE_STAGES`, `STAGE_LABEL`, `countBoardVisible`, `countUndated`, `reviewActionable` (via `ContentList.tsx`) · `normalizeAgentLog`, `normalizeImageUrls`, `normalizeKeyPoints`, `normalizeQa`, `stageOf`, `taxonomyFields` (via `DraftPane.tsx`, in addition to `reviewActionable` reused there) · `approveDraft`, `skipDraft` (via `ReviewActions.tsx`).

**UNUSED (10 of 29), confirmed zero references outside `content.ts` itself:** `laneFilter`, `draftLane`, `ACTIVE_STATUSES`, `RECENT_DAYS`, `ARCHIVED_STATUSES`, `isStuckScheduled`, `QUEUE_STATUSES`, `SKIP_STATUS`, `TAXONOMY_KEYS`, `fetchScheduledQueue`.

**⚠ Correction to the mission brief:** the goal-run spec (and the phase1b brief it's drawn from) states "the UI consumes 11" of 29. The actual current count, verified live against the shipped v2c build, is **19 used / 10 unused** — `DraftPane.tsx` already consumes the full agent-log/QA/taxonomy normalizer set (`normalizeAgentLog`, `normalizeQa`, `taxonomyFields`, `normalizeKeyPoints`, `normalizeImageUrls`, `stageOf`) that the mission's Phase 1B explicitly asks to be built ("Agent / generation logs in full," "Content type tags in full" — both described as *currently thin/truncated* in the mission text). This strongly suggests **Phase 1B's build has already landed on disk/exp-v2** ahead of this Phase 0 read (consistent with the branch-location discrepancy in the header above — this goal-run is further along than a fresh Phase 0 would expect). Of the still-genuinely-unused 10: `laneFilter`/`draftLane`/`ACTIVE_STATUSES`/`ARCHIVED_STATUSES`/`isStuckScheduled` are consumed **internally by content.ts's own functions** (e.g. `bucketDrafts` calls `isStuckScheduled` directly, not via import) so they're "unused by UI" but not dead code; `QUEUE_STATUSES`/`fetchScheduledQueue`/`SKIP_STATUS`(only referenced as a literal, not the const, in `ReviewActions`)/`TAXONOMY_KEYS` are genuinely unconsumed — `fetchScheduledQueue` in particular means the **152 `scheduled_posts` rows the mission calls out are not yet read anywhere in the UI**, confirming that specific gap is still open.

## 6. Routes/nav on exp/v2

**Two independent routers stack:**
1. **`src/exp/index.tsx`** (top-level experiment gate) — reads `location.hash` **once at mount** against `/^#exp\/(v2c|v2|a|b|c|off)\b/`, persists the choice to `sessionStorage['exp_variant']` so in-app navigation doesn't need the hash present every time. `#exp/off` clears it. Four lazy-loaded shells: `ShellA`/`ShellB`/`ShellC` (the earlier content-hub tournament, `cand-a/b/c`) and `ShellV2` (serves **both** `v2` and `v2c` ids — `v2c` is kept only so old tournament ballot links don't 404; the canonical id the router itself writes is `v2`).
2. **`src/exp/v2c/route.ts`** (inner workbench router, only active once `ShellV2` is mounted) — a **second-level hash format**, `#exp/v2(c)?/<job>/<focus>`, e.g. `#exp/v2/content`, `#exp/v2/inbox/chat`. Regex: `/^#exp\/v2c?(?:\/([^/]*))?(?:\/([^/]*))?/`. Only `focus==='chat'` is addressable by URL (a thread/draft peer key is a DB id and would 404 if "restored" from a stale URL). `wbHash()` always **writes back** `#exp/v2/<job>` (never `v2c`) regardless of which alias is currently active.

**Base app routing (outside `#exp/`)**, `src/App.tsx` (exp/v2, matches main's shape): a hand-rolled `Tab` state (`'inbox'|'drafts'|'sends'|'ops'|'settings'|'today'`) plus its own `parseHash()`-based mini-router (not read in full this pass) — this is the **production, non-experimental app** that ships to `ivanmanfre.github.io` by default. **There is no `'content'` tab in the base app** — Content only exists inside the `#exp/` gated variants.

**Top-level destinations (job rail, `src/exp/v2c/layout.ts`):**
```
JOBS = ['today', 'inbox', 'drafts', 'content', 'sends', 'ops', 'settings']
```
`today ☼ · inbox ◉ · drafts ✦ · content ▤ · sends ↑ · ops ◈ · settings ⚙︎`. `inbox/drafts/content` are "list jobs" (`LIST_JOBS`) that can hand a row to a context peer (`thread`/`draft`/`chat`); the rest are whole-canvas surfaces. **Claude/chat is deliberately not a job** — it's a `Peer` (`{kind:'chat'}`), docked alongside the working list rather than tabbed, per `layout.ts`'s comment "Claude last — it is deliberately NOT a job."

**Where Content lives:** `src/exp/v2c/ContentList.tsx` (the list) + `src/exp/v2c/DraftPane.tsx` (the detail peer), reached at `#exp/v2/content` (or by clicking the rail tab once inside `#exp/v2`).

**AgentOps destination: confirmed none exists**, consistent with the mission's explicit instruction "there is no separate AgentOps destination" — `JOBS` has no `agent`/`ops-agent` entry; the only `ops`-named job (`◈`) is the existing Ops surface (`OpsBoard.tsx`), unrelated to the `AgentRebuilt.tsx` dashboard surface the mission references as a separate, not-yet-folded-in source.

## 7. Instruments — `sweep.mjs`, `density.mjs`, `diffshots.mjs`

All three exist as **untracked files on disk** (not on `exp/v2` — see header discrepancy), under `/Users/ivanmanfredi/Desktop/ivan-inbox/scripts/`. **Not wired into `package.json`'s `scripts` block** (`{dev, build, lint, preview, test}` only) — invoked directly with `node`.

| Script | Measures | Invocation |
|---|---|---|
| `scripts/sweep.mjs` (3781 bytes) | Captures every route at mobile (390×852) + desktop (1440×900), `deviceScaleFactor:2`, console/pageerrors, `scrollWidth>clientWidth` overflow, word/text-node counts, full-page PNG per route×width | `node scripts/sweep.mjs <outDir> [baseUrl] [routes.csv]`, e.g. `node scripts/sweep.mjs goal-runs/.../baseline https://ivanmanfre.github.io/ivan-inbox/`. Injects `.session.json` (repo root, present, 1930 bytes) into `localStorage['sb-bjbvqvzbzczjbatgmccb-auth-token']` before load so it doesn't just screenshot the login screen. Default routes: `today,inbox,drafts,sends,ops,settings` (the **base app** tabs, not `#exp/` routes — caller must pass `#exp/v2/...` explicitly via the routes arg to sweep the workbench). |
| `scripts/density.mjs` (5622 bytes) | The 5 density gates from `phase2-tournament/CONTRACT.md`: words/1000px ≤140, prose-share ≤30%, every stat panel's primary number ≥40px, per-row metrics ≥18px, every section visually-encodes something (not text-only) | `node scripts/density.mjs <url> <label> [width] [--json out.json]`, e.g. `node scripts/density.mjs http://localhost:4173/#exp/v2a v2a-inbox 390`. Also reads `.session.json` if present. Measures against the tallest actually-scrolling element (not `documentElement.scrollHeight`, which the comment notes is pinned to viewport since this app scrolls an inner container). |
| `scripts/diffshots.mjs` (3136 bytes) | Byte-identity (sha256 of PNG) + geometry-equality (`scrollWidth/scrollHeight/words`) between two prior `sweep.mjs` runs, verdicts: `IDENTICAL` / `PIXELS_DIFFER_GEOMETRY_SAME` (antialiasing, look at it) / `GEOMETRY_MOVED` (real regression) / `MISSING_AFTER` | `node scripts/diffshots.mjs <baselineDir> <afterDir>` — reads `<dir>/sweep.json` (written by `sweep.mjs`) from each. |

**Prior baselines on disk** (`sweep.json` present, confirmed by find):
- `goal-runs/inbox-v2-revamp-2026-08-01/baseline/sweep.json` — the pre-run baseline for the base app's 6 default routes.
- `goal-runs/inbox-v2-revamp-2026-08-01/phase3-build/crops/sweep.json` — post-build sweep.
- `goal-runs/inbox-v2-revamp-2026-08-01/phase2-tournament/crops/{v2a,v2b,v2c}/sweep.json` — one per tournament candidate.

No `sweep.json` yet exists under the current goal-run's own output directory (`goal-runs/inbox-claude-brain-and-voice-2026-08-01-out/`) — a fresh baseline/after pair for **this** run has not been captured yet.

## 8. The 16 (actually 65-line-diff / ~20 distinct-file) shared production files exp/v2 changes outside `src/exp/`

`git diff main...exp/v2 --name-only | grep -v '^src/exp/'` returns **65 lines**, but the bulk (46 of them) are **goal-run artifact files** from the prior tournament (`goal-runs/inbox-v2-revamp-2026-08-01/phase2-tournament/{brief-v2c.md, crops/v2c/*.png, crops/v2c/sweep.json}`) — screenshots and a brief, not production code. The mission's "16 shared production files" claim refers to the **actual code files**, which are:

```
scripts/density.mjs
scripts/diffshots.mjs
scripts/sweep-v2.mjs
scripts/sweep-v2c.mjs
scripts/sweep.mjs
src/hooks/useContent.ts
src/hooks/useInbox.ts
src/hooks/useOps.ts
src/lib/claude.test.ts
src/lib/claude.ts
src/lib/inbox.ts
src/lib/today.test.ts
src/lib/today.ts
src/screens/DraftsScreen.tsx
src/screens/InboxScreen.tsx
src/screens/OpsScreen.tsx
src/screens/SendsScreen.tsx
src/screens/ThreadScreen.tsx
src/screens/TodayScreen.tsx
src/screens/kpi/OverviewView.tsx
src/styles.css
```
That's **20 code files**, not 16 — the extra 4 beyond the mission's count are `scripts/density.mjs`, `scripts/diffshots.mjs`, `src/lib/claude.ts`, `src/lib/claude.test.ts`, which per the branch-location discrepancy above **exist only in the untracked working tree today, not actually committed to `exp/v2` yet** — `git diff main...exp/v2` cannot see them at all (they aren't in either branch's tree). This diff was run against the **committed `exp/v2` tip**, so those files did not contribute to this 20-file count; the count of 20 committed shared files is real and independent of the working-tree state. (Restated: the mission's "16" was written before some of these landed, or is scoped differently — e.g. excluding `scripts/*` and `*.test.ts` as non-production. Either way, the concrete, current, verified list of committed non-`src/exp/` files touched by `exp/v2` is the 20 above.)

---

## Files referenced (all citations file:line above are against these)
- `/Users/ivanmanfredi/Desktop/ivan-inbox/supabase/functions/inbox-claude/index.ts` (working tree, untracked, 188 lines)
- `/Users/ivanmanfredi/Desktop/ivan-inbox/src/lib/claude.ts` (working tree, untracked, 194 lines)
- exp/v2: `src/exp/v2c/VoiceControl.tsx`, `src/exp/v2c/chat/voice.ts`, `src/exp/v2c/useVoice.ts`, `src/exp/v2c/chat/transport.ts`, `src/exp/v2c/useChat.ts`, `src/exp/v2c/route.ts`, `src/exp/v2c/layout.ts`, `src/lib/content.ts`, `src/hooks/useContent.ts`, `src/exp/v2c/ContentList.tsx`, `src/exp/v2c/DraftPane.tsx`, `src/exp/v2c/Shell.tsx`, `src/exp/v2c/ReviewActions.tsx`, `src/exp/index.tsx`, `src/App.tsx`
- working tree: `scripts/sweep.mjs`, `scripts/density.mjs`, `scripts/diffshots.mjs`, `.env.local`, `.session.json`, `package.json`
