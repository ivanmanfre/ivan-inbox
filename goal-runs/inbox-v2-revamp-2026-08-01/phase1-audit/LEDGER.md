# Phase 1 findings ledger — skeptic-survived

Five auditors (usability, aesthetics, IA+chat-port, voice, plus the orchestrator's own probes) and two skeptics (correctness, cross-tenant/secret-leak). A finding appears here only with its verdict. Full reasoning in the sibling files.

**Mobile-regression skeptic seat: deliberately replaced by a deterministic instrument.** Per the gate-trust rule (prefer measurement over LLM judgment where the property is measurable), `scripts/sweep.mjs` checks `scrollWidth === clientWidth` per surface per viewport and counts console errors, which an LLM reviewer cannot do honestly. Baseline run: 12 shots, zero overflow, zero console errors, zero login leaks. Logged as a deviation in REPORT.md.

## Correctness

| id | Verdict | Finding | Evidence that decided it |
|---|---|---|---|
| **U1** | **CONFIRMED P1 — unfired landmine** | `approveDraft` never checks or clears `send_blocked_reason`, so a stale view can re-approve a draft Ivan already discarded, and the dispatcher would send it | The dispatcher's real pickup predicate is `approved_at NOT NULL AND sent_at IS NULL` with **no** `send_blocked_reason` check (`docs/send-path-verification.md`, live n8n probe). Live DB: **0** historical incidents, **0** rows currently armed. Real hazard, never yet fired. |
| **U2** | CONFIRMED | `useInbox` has no `error` field; a failed fetch renders identically to an empty inbox | `useInbox.ts:22` swallows; `InboxScreen.tsx` has zero error handling; `SeatHealthBanner` watches an unrelated table and swallows its own errors too, so no fallback exists |
| **U3** | CONFIRMED | Same in `useOps`; the screens' `error` state covers only approve/discard actions, never the fetch path | `useOps.ts:19` |
| **U4** | CONFIRMED P1 | Freehand `composeReply` sends with no confirmation, while approving a *reviewed* AI draft requires one — the riskiest action is the unconfirmed one | `ThreadScreen.tsx:117-124` vs the `ConfirmSheet` usage on approve |
| **U5** | **CONFIRMED mechanism** | `useInbox` hardcodes `supabase.channel('inbox')`; a second consumer breaks the app | realtime-js 2.109.0 source read directly: `channel(topic)` returns the same object and `.on()` **throws** if already joined/joining. No `ErrorBoundary` anywhere in `src/`, so the throw propagates to a blank tree. Matches the codebase's own rationale comment in `useOps.ts:8-15`. |
| **U6** | CONFIRMED mechanism, **magnitude DOWNGRADED** | `useInbox` refetches with no debounce on every mount, every unfiltered realtime event and every window focus | Live DB: `inbox_messages_v` = **2,139 rows / 1,354 threads**, so the paging loop makes **3** sequential requests per trigger, not the claimed "up to 20". The 20,000-row ceiling is a ceiling, not today's cost. Wasteful-refetch stands; the alarming number does not. |

**Correction recorded:** the audit's original U6 severity ("20,000 rows / 20 requests") was overstated. The measured 49,558-word inbox DOM at 390px is real and independently observed, and is explained by ~1,354 unvirtualized thread rows.

## Craft / aesthetics (all within the locked canon)

| id | Finding | Where |
|---|---|---|
| **A1** | Ghost "Select a conversation" pane renders on Drafts and Settings at ≥1000px, where no conversation can ever open. Desktop Inbox spends ~66% of a 1440px canvas on a glyph and that sentence. | `src/App.tsx:148-158` |
| **A2** | `% of cap` pill is clipped at 390px — `.ov-over-lbl` is `white-space:nowrap` inside a `flex-wrap` parent, so it overflows and an ancestor's `overflow:hidden` cuts it. Document-level overflow is false, which is why the sweep passed: the clipping is internal. | `src/styles.css:402` |
| **A3** | 6 different card radii (13/14/15/16/18/20px), 3 pill radii, and 4 different section-header patterns across Today/Sends/Ops/Settings | across screens |
| **A4** | Today's desktop 2-column zone grid strands dead black space under a short Urgent column beside a tall Approve column | `src/styles.css:602-627` |
| **A5** | Ops has no freshness signal, so an empty queue is indistinguishable from a stalled feed (same root as U3, felt visually) | `OpsScreen.tsx` |

**Must not lose** (the five craft decisions a revamp has to preserve): the honest over-cap gauge with its hatched overflow segment that never clamps; Today's numbered/ruled/counted zone header; the deliberate Today↔Sends tile-system mirroring; the terse human zero-state copy voice; the single shared tap-feedback rule (scale + brightness, 120-180ms) applied everywhere.

## Architecture

| id | Finding | Consequence |
|---|---|---|
| ~~P0~~ | **RETRACTED — my own false alarm.** I claimed the Railway service was serving unauthenticated, generalizing from `GET /v1/models` returning 200 with no key and with a wrong key. Refuted by the broker's first real call: `/chat/stream` returns `401 Invalid or missing API key`, and per-endpoint probes show `/skills`, `/workspace`, `/clients`, `/chat` all 401. `/v1/models` simply never declares the dependency (`main.py:1959` takes `x_api_key` as an unused parameter). `API_KEY` is set; auth is enforced. | Retraction with full evidence in `SECURITY-P0.md`. Lesson recorded: a systemic claim needs more than one observation of one route. |
| **S1** | A **live** `service_role` JWT for `bjbvqvzbzczjbatgmccb` (the inbox's own project) is hardcoded as a default in git-tracked source, `main.py:46`, `exp` 2036. Verified live via one read-only `HEAD` → 200. | Real and worth removing, but **not** remotely reachable now that auth is confirmed enforced. Remove the default, then rotate in a planned pass. |
| **S2** | `verify_api_key` still fails open whenever `API_KEY` is empty (`main.py:37`, `:73-77`) — not firing today, but a cleared variable silently reopens every endpoint with no signal. | Add a boot assertion that refuses to serve, mirroring `assertConfig()` (`web-ui/server.js:237-250`). Cheap; the difference between safe and safe-by-luck. |
| **S3** | `GET /api/sessions/:id/transcript` is unscoped across clients (`web-ui/server.js:573-622`), and `GET /api/sessions?workspace=ALL` (`:501`) hands out the ids. | Genuine cross-tenant read behind one shared password. Unchanged by the retraction. |
| **I1** | `POST /chat/stream` never reads `session_id`, never touches `CLIENT_SESSIONS`, never adds `--resume` (`main.py:773-866`). Only the blocking `/chat` has continuity. | **Invalidates a Phase 0 premise.** Streaming and conversation continuity are mutually exclusive upstream as built. Resolved in Phase 3: stream for responsiveness, carry a bounded client-held transcript as context, and document the limit. |
| **I2** | Content's two groupings: lifecycle `groupByStage` is primary (Ivan's own stated preference is quoted in `content.ts:270`, and it does not hide approved-undated rows the way `bucketDrafts` does); triage `bucketDrafts` stays as the engine behind badge counts and queue-card action rules. Safe only if never rendered as competing full-board views on one screen. | Binds every tournament candidate |
| **I3** | Chat needs no markdown dependency: a ~150-line allowlist parser emitting React elements directly, no `dangerouslySetInnerHTML`, no sanitizer. Code blocks are the one scoped exception to the no-monospace house rule. | Keeps the 2-dependency footprint |

## Voice

Reference implementation is server-brokered OpenAI (STT `gpt-4o-mini-transcribe`, TTS `gpt-4o-mini-tts`, summary `gpt-4.1-nano`), not Web Speech, and degrades to `webkitSpeechRecognition` when the server holds no key.

| id | Finding |
|---|---|
| **V1** | 3-4 serial legs gate any audio (STT → full turn → summary LLM → TTS TTFB); TTS streams once started but nothing is spoken until the turn fully completes. No partial speech, no barge-in. |
| **V2** | VAD is a flat 0.06 RMS threshold with no `echoCancellation` configured on `getUserMedia` — noise and echo can self-trigger. Partly mitigated by mic-off-during-speak. |
| **V3** | Stall recovery is 4 timeout patches (server `finally`-emit `speak_end`, client drain watchdog, 8s post-turn fallback, 2s Safari `onstop` fallback) plus VAD's own 3 timers, with no single owning state. |
| **V4** | Error visibility collapses missing-key / bad-mic / OpenAI-502 into one string `'Transcription failed'`; TTS failures are entirely silent. |
| **V5** | Single global `activeStream` singleton; iOS AudioContext `'interrupted'` handled by silent retry only. |

**Target state machine:** `IDLE → ARMING → LISTENING → (TRANSCRIBING | PAUSED) → SENDING → SPEAKING → LISTENING/IDLE`, with `ERROR(reason, retryable)` reachable from any state and the mic structurally un-armable while `SPEAKING` — replacing the timer-race approach with real states.

**Acceptance target:** utterance-end → first audible sample **< 1.2s** for a short reply (≤280 chars), **< 2.5s** for a long one. Derived from the reference's own prod-measured v2 numbers (0.86s / 2.0s on the same streamed-WAV+PCM architecture) plus 200-500ms for Deno edge invoke overhead. Credential branch: primary = `inbox-voice` edge function brokering OpenAI from the vault; fallback = on-device `webkitSpeechRecognition` at zero key and zero spend.
