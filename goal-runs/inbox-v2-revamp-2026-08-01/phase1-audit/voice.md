# Phase 1(d) — Voice-mode UX audit + port spec

Run: `inbox-v2-revamp-2026-08-01`. Scope: the Railway `claude-code-railway/web-ui` voice
layer as the reference implementation, audited for weaknesses, then a concrete
improvement spec for porting voice mode into `ivan-inbox` (static Vite/GitHub Pages PWA,
iPhone-primary). Every claim below is grounded in file:line from the two repos read
directly for this audit, plus the real measured baseline in
`Ivan - Content System/goal-runs/voice-app-v2-2026-07-17/phase0-latency-ledger.md`
(prod logs + local OpenAI probes from the 2026-07-17 build of this same voice layer).

---

## PART 1 — Audit of the reference voice UX

### (a) Latency: serial legs, nothing spoken until the turn is fully done — CONFIRMED

The pipeline is strictly sequential and gated on full turn completion, not partial:

- `server.js:985,988` (warm-pool path) and `server.js:1218,1221` (cold path): `maybeSpeak()`
  is invoked *after* `safeSend(ws, { type: 'done', ... })` — i.e. only once the entire
  Claude turn (all `text` chunks) has finished streaming to the client. There is no
  hook that fires speech synthesis on a partial/early sentence.
- `server.js:778-830` `maybeSpeak()`: strips markdown (`stripForSpeech`, `lib/voice.js:112-125`),
  decides direct-speak vs LLM summary (`SPEAK_DIRECT_MAX = 280` chars, `lib/voice.js:129`),
  then calls `summarizeForSpeech()` (a second LLM round-trip, `lib/voice.js:77-107`,
  `gpt-4.1-nano`) if the reply is long, then TTS (`synthesizeSpeechStream`, `lib/voice.js:156-227`).
  Three network hops after the primary Claude turn (STT already happened before the turn
  started) — STT → full Claude turn → summary LLM → TTS TTFB — confirmed as designed, not
  a bug introduced later.
- No barge-in: the client cannot interrupt Claude's *text* generation with speech (nothing
  listens for a new utterance until the assistant is literally speaking or done — hands-free
  loop only re-arms on `speak-end`, `ChatArea.tsx:983-986`). The user can only skip the
  *TTS playback* once it starts (`ChatArea.tsx:1459-1461`, `stopSpeaking()`), not shorten or
  redirect the underlying turn.
- **What is NOT true of the current code**: the lead described "no partial speech" as if the
  system were fully unstreamed. In fact TTS audio itself IS streamed once synthesis starts
  (`synthesizeSpeechStream`, PCM over binary WS frames scheduled sample-accurately,
  `voice.ts:219-262`) — so audio starts at TTS time-to-first-byte, not after the full clip
  renders. The serial-legs weakness is real, but it's "3 legs before ANY audio starts," not
  "no streaming at all." **Severity: High** — every voice turn pays STT+turn+summary+TTS-TTFB
  before the user hears a syllable, and the reference's own measured numbers (see below) show
  this was ~4.3-5.0s of dead air before optimization.

### (b) VAD is a fixed level threshold; no echoCancellation config — CONFIRMED

- `voice.ts:428-433`: `recordUntilSilence()` defaults — `silenceMs = 1800`, `noSpeechMs = 8000`,
  `maxMs = 90000`, `speechThreshold = 0.06`. This is a flat RMS-ish level gate
  (`VoiceRecorder.level()`, `voice.ts:337-344`, average byte-frequency-data / 255) polled every
  100ms (`voice.ts:466`). No spectral/noise-floor adaptation, no calibration step.
- `voice.ts:307`: `navigator.mediaDevices.getUserMedia({ audio: true })` — a bare boolean
  constraint. No `echoCancellation`, `noiseSuppression`, or `autoGainControl` keys are set
  anywhere in the file (confirmed by grep across `voice.ts`; this is the only `getUserMedia`
  call in the module). On a phone with speaker playback active (hands-free mode plays TTS
  through the device speaker while the mic stays reachable for the *next* listen cycle),
  a fixed 0.06 threshold with no AEC is exactly the shape of bug that self-triggers on TTS
  echo or ambient noise. **Severity: High for hands-free specifically** — the reference
  mitigates this by not listening *while* `speak-start`→`speak-end` is active
  (`hfGenRef` incremented + `hfAbortRef.current?.abort()` on `onSpeakStart`, `ChatArea.tsx:974-982`),
  so echo-during-TTS-playback is actually prevented at the state-machine level, not the VAD
  level. Residual risk is ambient noise/echo *after* TTS ends but before the user actually
  speaks (room echo tail, AC hum, TV) triggering a false "heard speech" and cutting a real
  utterance short via the 1800ms silence timer without ever calibrating to the room.

### (c) Stall recovery is a stack of timeouts, not explicit states — CONFIRMED, enumerated

| # | Timer | Location | Bug it patches |
|---|---|---|---|
| 1 | `finally` block always sends `speak_end` | `server.js:816-820` | A mid-stream TTS error (OpenAI 5xx after `speak_start` already announced) would otherwise strand the client believing a stream is still open — hands-free never re-listens, "Speaking" hangs forever. |
| 2 | Drain watchdog, `remainingMs + 2500` | `voice.ts:268-276` (`endSpeakStream`) | iOS flips `AudioContext` to `'interrupted'` (calls/Siri) and `resume()` can fail (`voice.ts:88-93` comment), so scheduled `AudioBufferSourceNode`s never fire `onended` → `finishStream` never called without this fallback. |
| 3 | 8s post-turn fallback, `hfDoneFallbackRef` | `ChatArea.tsx:995-1007` | Turn finishes (`streaming` flips false) but no `speak_start`/`speak_end` ever arrives at all — voice disabled mid-session, summary/TTS threw before `announced` was ever set, or the WS message was dropped. Without this, hands-free sits in "Thinking" indefinitely. |
| 4 | Safari `onstop` fallback, `setTimeout(finish, 2000)` | `voice.ts:365-366` | `MediaRecorder.onstop` "occasionally never fires" on old Safari (comment at `voice.ts:10`) — without the timeout, `stop()`'s promise never resolves and the UI is stuck in "Transcribing." |
| 5 | Open-ended dictation cap, 10 min | `ChatArea.tsx:881` | Not a stall patch — a resource cap so a forgotten hot mic doesn't grow unbounded before the 15MB server limit (`server.js:720`). Listed because it's another ambient timer in the same system. |
| 6 | VAD's own three timers (`silenceMs`/`noSpeechMs`/`maxMs`) | `voice.ts:429-433,466-477` | These aren't stall-recovery patches, they're the VAD's actual logic — but they compound with #1-4: a hands-free session can be sitting inside up to 4 nested timeout races (VAD timer → transcribe → turn → speak-drain-watchdog) with no single state variable that says "what is this session doing right now and why." |

`hfStatus` (`ChatArea.tsx:797`: `'listening' | 'processing' | 'waiting' | 'speaking'`) is the
closest thing to an explicit state machine, but it is a *display* enum driven by these six
timers plus two event listeners (`speak-start`/`speak-end`) and a generation counter
(`hfGenRef`, incremented on every `hfListen()` and on late-arriving `speak-start` to invalidate
stale listens, `ChatArea.tsx:906-907,979`) rather than the reverse — the enum doesn't gate
the timers, the timers race to set the enum. **Severity: Medium-High** — it works (the
generation-counter pattern is a genuinely sound guard against double-fires), but every one of
the 4 real stall-recovery timers above is undocumented as a *state transition* anywhere in the
type system; a new engineer reading `ChatArea.tsx` has to reconstruct the state machine from
timer side-effects.

### (d) Error visibility is near-zero — CONFIRMED, exact strings quoted

User-facing strings, verbatim:

- `ChatArea.tsx:854`: `setAttachError(e instanceof Error ? e.message : 'Transcription failed')`
  — after `transcribeBlob()` throws, whatever `Error.message` the fetch layer produced is shown
  raw. `transcribeBlob()` (`voice.ts:395-409`) itself only distinguishes `res.json().error` if
  present, else `` `Transcription failed (${res.status})` ``. Server-side, EVERY transcription
  failure — no API key (`server.js:731`, 503), unsupported mime (`server.js:746`, 415), OpenAI
  502 (`lib/voice.js:69`, wrapped to generic 502 at `server.js:757`) — collapses to the single
  string `'Transcription failed'` at `server.js:757`: `res.status(...).json({ error: 'Transcription failed' })`.
  The specific OpenAI error body (`STT ${res.status}: ${body}`) is logged server-side
  (`server.js:756`, `log('warn', 'voice_transcribe_error', ...)`) but **never reaches the
  client** — the client cannot distinguish "you have no mic permission," "the server has no
  OpenAI key," and "OpenAI is down" from each other; all three can surface as the identical
  toast text "Transcription failed."
- `ChatArea.tsx:871`: `setAttachError('Microphone unavailable — check permission')` — this is
  the ONE distinct, actionable string in the whole system, fired when `rec.start()` throws
  (permission denied or no device). Good example of what the rest should look like.
  **Severity: this is the exception, not the norm.**
- `ChatArea.tsx:928`: `setHfHint('No speech detected — tap the circle to listen again')` —
  fires after 3 consecutive no-speech VAD rounds (`hfNoSpeechRoundsRef.current >= 3`,
  `ChatArea.tsx:927`). Reasonably actionable but conflates "you didn't say anything" with
  "the mic level threshold never tripped" (could be a hardware/AEC issue, not silence).
- `ChatArea.tsx:944`: `setHfHint('Transcription failed — listening again')` — server voice
  transcription error inside the hands-free loop. Auto-recovers (calls `hfListen()` again)
  but gives the user zero information about *why* (network, key, OpenAI outage) and will loop
  silently retrying against a dead backend indefinitely (no backoff, no give-up threshold —
  contrast with the 3-round give-up on no-speech).
- Server-side voice errors are swallowed entirely for the *speak* (TTS) path: `server.js:827-829`,
  `catch (e) { log('warn', 'voice_speak_error', ...); }` — no client message at all. If TTS
  fails, the user just... never hears anything, with no toast, no hint, nothing. The 8s
  fallback (row 3 in the table above) silently drops back to listening with zero indication a
  spoken reply was attempted and failed.

**Severity: High.** The single collapsed "Transcription failed" string covering
missing-key/bad-mic/OpenAI-down is the clearest instance of the lead's claim; the silent TTS
failure path is arguably worse because there's no string at all.

### (e) Single global utterance + iOS AudioContext 'interrupted' — CONFIRMED

- `voice.ts:179`: `let activeStream: ActiveSpeakStream | null = null` — module-level singleton,
  not per-tab/per-session. `beginSpeakStream()` (`voice.ts:201-217`) calls `stopSpeaking()`
  first (`voice.ts:202`), which tears down any prior stream unconditionally — confirmed by
  the isolation probe design itself (`v2_isolation_probe.mjs`) which exists specifically to
  prove socket B gets zero frames from socket A's turn, i.e. the *server* fans out per-socket
  correctly, but the *client's* playback state is one global object regardless of how many
  chat tabs/sessions exist client-side. If the inbox port ever opens two chat surfaces in one
  page (e.g. a persistent mini-player + a full chat view), the second `speak_start` would kill
  the first mid-sentence with no queue, no per-surface isolation.
- iOS `'interrupted'` handling exists in two places with near-duplicate logic:
  `voice.ts:88-93` (playback context) and `voice.ts:320-327` (recording context) — both attach
  `onstatechange` and call `resume()` on any non-`'running'`/non-`'closed'` state, "best-effort"
  (comment, both sites). Neither logs nor surfaces a failure to the UI if `resume()` rejects —
  it's a silent retry with no user-visible fallback, which is why watchdog #2 in the table
  above exists as a backstop specifically for this failure mode (comment at `voice.ts:265-267`
  says as much: "a silent stall here would kill the hands-free loop permanently").
- **Severity: Medium.** Single-utterance-only is a reasonable simplification for a 1:1 chat UI
  (matches the mission's "no barge-in" reality) and is arguably *correct* behavior, not a bug —
  flagged here because the port must decide deliberately whether to keep it (recommend: keep,
  see Part 2).

### What the probes actually measure, and the real baseline

- **`v2_voice_probe.mjs`** (`v2_voice_probe.mjs:1-56`): opens a WS chat turn with
  `voice:{enabled:true, stream:true}`, times `t0` (send) → `doneAt` (`done` frame) →
  `speakStartAt` (`speak_start` frame, i.e. summary text ready + TTS announced) →
  `firstChunkAt` (first binary PCM frame). Logs `done->summary`, `speak_start->chunk` (TTS
  TTFB portion), `done->first_chunk` (**the number that matters** — silence duration the user
  actually experiences), and `done->end` (full utterance duration). Also validates the legacy
  non-streaming `stream:false` path still emits one base64 `speak` frame.
- **`v2_stt_probe.mjs`** (`v2_stt_probe.mjs:1-57`): synthesizes 3 jargon fixtures via TTS, POSTs
  them to `/api/voice/transcribe` via both the binary v2 path and the legacy base64 JSON path,
  measures round-trip ms for each, and scores transcript accuracy via token-overlap against the
  known fixture text. Also asserts the error contract: unauthenticated → 401, unsupported mime
  → 415.
- **`v2_isolation_probe.mjs`** (`v2_isolation_probe.mjs:1-35`): not a latency probe — opens two
  WS sockets, drives a chat+voice turn on socket A, asserts socket B receives zero
  `speak`/`speak_start`/`speak_end`/binary frames. Proves server-side per-connection isolation
  (this is what makes lead (e)'s single-utterance finding a *client-only* limitation, not a
  cross-session leak).
- **Real baseline that exists** (`Ivan - Content System/goal-runs/voice-app-v2-2026-07-17/phase0-latency-ledger.md`,
  measured from Ivan's actual failed live test + prod logs + local OpenAI probes, this exact
  code): **v1 done→first-audio was 4.3-5.0s of dead air** (serial summary-LLM + full non-streaming
  TTS render + single base64 blob). The v2 rebuild documented in this same file (streamed
  WAV→PCM, `gpt-4.1-nano` summary, ≤280-char direct-speak fast path — i.e. exactly the code
  audited above) shipped same-day and was **prod-measured at 0.86s for short replies / 2.0s for
  long replies** (per the project memory file `voice-claude-code-app-goalrun-2026-07-17.md:12`).
  STT mic-release→text was measured at **~2.0-3.5s felt total** (813-1783ms OpenAI STT call
  itself, `phase0-latency-ledger.md:11`, plus record-flush + upload overhead). This is the
  number a fresh v3/port effort should beat, not guess at from scratch.

---

## PART 2 — Improvement spec for the ivan-inbox port

### Constraints restated (from the goal-run's own Phase 0, already decided — this spec follows it)

Per `goal-runs/inbox-v2-revamp-2026-08-01/phase0-scope.md:38`, the credential branch is
**already resolved**, not re-litigated here: primary = a new `inbox-voice` Supabase edge
function brokering OpenAI if `OPENAI_API_KEY` exists in the project vault (same pattern as
`inbox-claude`, `phase0-scope.md:25-30`, and the sibling reference at
`personal-site/supabase/functions/blueprint-publish/index.ts:4`); fallback = on-device
`webkitSpeechRecognition`/`SpeechRecognition`, zero keys, zero spend, mirroring the reference's
own existing degrade path (`ChatArea.tsx:524-530`, confirmed live: `getSpeechRecognitionCtor()`
checks `window.SpeechRecognition || window.webkitSpeechRecognition`). This spec details BOTH
branches concretely below.

### State machine (named states, real transitions — replaces the 6-timer stack in 1(c))

A single `voiceState` enum drives everything; timers become *entries/exits* of states, not
races that set a display label after the fact.

```
IDLE
  → (tap mic)              → ARMING
ARMING            (unlocks audio in-gesture, requests getUserMedia)
  → (stream granted)       → LISTENING
  → (permission denied)    → ERROR('mic-denied')
LISTENING          (VAD or hold-to-talk active; mic level drives UI pulse)
  → (silence timeout heard speech)   → TRANSCRIBING
  → (hold released, <400ms = tap-toggle, stays LISTENING)
  → (noSpeechMs elapsed, 3rd round)  → PAUSED('no-speech')
  → (user taps stop)                 → TRANSCRIBING (flush, keep audio)
  → (user taps cancel)               → IDLE
PAUSED('no-speech')
  → (tap to resume)         → LISTENING
  → (exit)                  → IDLE
TRANSCRIBING        (POST to broker or on-device recognition running)
  → (text returned, non-empty)   → SENDING
  → (text returned, empty)       → LISTENING
  → (network/5xx/timeout)        → ERROR('stt-failed', retryable)
SENDING              (handed to the existing chat send path; this state is the
                      chat turn itself — text streams in as normal chat UI, unrelated
                      to voice-specific state)
  → (turn text 'done' event)     → SPEAKING  (only if spoken-reply pref is on AND
                                              broker branch is active; on-device-only
                                              branch skips straight to LISTENING)
  → (turn text 'done', voice off)→ IDLE or LISTENING (hands-free continues loop)
SPEAKING             (TTS audio scheduled/playing; mic explicitly NOT armed — kills
                      the AEC-less-echo risk from audit (b) by construction, same
                      as the reference's hfGenRef-abort-on-speak-start pattern)
  → (audio drained / speak_end)  → LISTENING (hands-free) | IDLE (single-shot)
  → (tap to skip)                → LISTENING
  → (TTS broker error)           → ERROR('tts-failed', non-blocking — falls to
                                    LISTENING immediately, turn text already
                                    delivered so nothing is lost)
ERROR(reason, retryable)
  → (auto, retryable, hands-free active) → LISTENING (after visible toast, not silent)
  → (tap dismiss)                        → IDLE
```

Key differences from the reference: (1) every timeout in table 1(c) becomes a **named
transition out of a named state** with a single owner (no more "8s fallback" racing a
"drain watchdog" racing a "generation counter" independently — there is exactly one active
state at a time, held in one ref/store); (2) `ERROR` is a first-class state with a `reason`
field instead of a string dumped into a shared `attachError`/`hfHint` slot, so distinct
failure copy (Part 2 below) is a lookup, not ad-hoc string literals scattered across the
component; (3) `SPEAKING` structurally forbids listening (mic never armed while state is
`SPEAKING`), which is a stronger guarantee than the reference's abort-based approach — it
can't regress because there's no mic-arm code path reachable from that state at all.

### Barge-in / partial speech, given the Deno edge function constraint

Full mid-turn barge-in (stop Claude generation the instant the user starts talking) is out of
scope for a v1 port — the reference doesn't have it either (confirmed in 1(a)), and building it
requires a duplex channel the edge function's request/response model doesn't give for free.
What IS achievable within a Deno edge function and is worth speccing:

1. **Streamed TTS TTFB, kept from the reference.** The `inbox-voice` function should relay
   OpenAI's TTS response the same way `synthesizeSpeechStream` does (`lib/voice.js:156-227`) —
   read the WAV stream, walk the RIFF header, forward PCM as it arrives — via a Deno
   `ReadableStream` response the client consumes progressively. Supabase edge functions support
   streaming responses (Deno's `Response(stream)`), so this ports directly; no new architecture
   needed, same TTFB math applies (audio starts as soon as OpenAI emits first bytes, not after
   full render).
2. **Short-reply fast path, kept from the reference.** `SPEAK_DIRECT_MAX` (`lib/voice.js:129`)
   avoids the summary LLM call entirely for replies ≤280 chars — this alone is roughly a full
   LLM round-trip removed (881-1046ms per the ledger, `phase0-latency-ledger.md:31`). Port this
   verbatim; it's the single highest-value/lowest-risk latency win in the reference.
3. **"Partial speech" substitute: speak the FIRST sentence as soon as it's punctuation-complete,
   not the whole turn.** Rather than true barge-in, the broker can start `summarizeForSpeech`-
   equivalent work (or skip straight to TTS on the direct-speak path) the moment the underlying
   chat stream emits a sentence-ending token, instead of waiting for the whole-turn `done` event
   the reference gates on (`server.js:985,988`). This requires the edge function to see
   incremental chat tokens, which the Phase 0 broker design (`inbox-claude`, SSE per
   `phase0-scope.md:30`) already receives — `inbox-voice` can consume the same incremental
   stream and fire TTS on the first complete sentence rather than only at end-of-turn. This is
   a real, buildable latency win distinct from the reference's architecture (which never tries
   it), flagged here as the one concrete improvement beyond "port the v2 numbers as-is."
4. **User-side interrupt = "stop and re-listen," not "cancel the model."** The `SPEAKING` state's
   tap-to-skip (kept from `ChatArea.tsx:1459-1461`) is the practical barge-in surface: the user
   can always cut off playback and start a new utterance immediately. This is not true barge-in
   into an in-flight Claude turn, but it is the same ceiling the reference ships today, honestly
   named rather than silently implied to be more.

### Mic interaction model on touch (iPhone Safari PWA)

The reference's unified tap/hold model (`ChatArea.tsx:884-900`: tap toggles, hold >400ms
records-while-held) is sound and should port, with one iOS-specific hardening:

- **Tap-to-arm, not press-and-hold-only.** Hold gestures on iOS Safari inside a PWA can be
  intercepted by system gestures (text selection, long-press context menu) if the mic button
  sits over text-selectable content — `ChatArea.tsx`'s hold model works because the mic button
  is a dedicated `<button>` with no ambient text under the touch point. Port the same
  constraint: the mic control must be a non-selectable, `user-select:none` circular hit target
  (matches existing inbox canon at `styles.css:131`, `.qc{...user-select:none}` — same
  defensive pattern already used elsewhere in this app for swipeable cards).
- **iOS audio unlock MUST happen synchronously inside the tap handler**, not after an `await`.
  The reference gets this right (`unlockAudio()` called synchronously at the top of
  `startWhisperRecording`, `ChatArea.tsx:865`, *before* the `await rec.start()`) and again on
  `pointerup` (`ChatArea.tsx:895`, comment: "pointerup carries real user activation on iOS").
  Port both call sites verbatim — this is the single most iOS-specific correctness requirement
  in the whole system and the reference already solved it twice (record button + hands-free
  overlay button, `ChatArea.tsx:1452`).
  For the inbox port specifically: `unlockAudio()` must run in the `onPointerDown`/`onClick`
  handler of the SAME tap that arms `LISTENING`, using the module-scoped shared
  `AudioContext`+silent-mp3-element pattern (`voice.ts:106-115`) — do not defer it into an
  async state-transition function.
- **Hold threshold stays 400ms** (`ChatArea.tsx:897`, the only tuned constant in the gesture
  model) — no evidence in either codebase that this needs to change; keep as measured.
- **No separate hands-free "mode" toggle buried in settings** — the inbox's existing IA
  (`TabBar.tsx`, `#settings` route per `phase0-scope.md:53`) favors a full-screen overlay
  entered directly from the chat composer's mic button (long-press or a dedicated
  hands-free glyph next to it), matching the reference's `enterHandsFree` overlay
  (`ChatArea.tsx:1431-1511`) rather than inventing a new pattern — reuse the existing sheet/scrim
  visual language already in `styles.css:207-221` (`.sheet-scrim`, `.sheet`) instead of the
  reference's bespoke full-bg-blur overlay, so it matches the 6-keyframe budget (see below).

### Distinct, actionable failure copy (replacing the collapsed strings in 1(d))

| `ERROR` reason | User sees | Why distinct (vs reference's collapse) |
|---|---|---|
| `mic-denied` | "Mic access is off. Enable it in Settings → [App name] → Microphone." | Reference already gets this one right (`ChatArea.tsx:871`) — keep, just relocate into the state machine. |
| `no-key-broker` (edge function returns 503, mirrors `server.js:731`) | "Voice needs setup — falling back to on-device dictation." + auto-transition to the `webkitSpeechRecognition` branch, not a dead end. | Reference's server 503 today just becomes generic "Transcription failed" client-side (`server.js:757` collapses everything to one string) — the port's edge function must forward a distinguishable `{error:'no_key'}` body specifically so the client can branch to on-device instead of just failing. |
| `stt-network` (fetch threw / timeout) | "Couldn't reach the transcription service — check your connection and try again." | Currently indistinguishable from every other STT failure per audit (d). |
| `stt-upstream` (broker got a non-2xx from OpenAI, mirrors `lib/voice.js:69`) | "Transcription service is having trouble right now — try again in a moment." | Same — today this is also just "Transcription failed." |
| `tts-failed` (broker TTS error, mirrors `server.js:827-829`) | No blocking error at all (this one stays silent-by-design, matching the reference) — but the state machine explicitly transitions `SPEAKING(error) → LISTENING` rather than leaving `hfStatus` racing three timers to notice. A single, one-time toast: "Couldn't read that reply aloud." (never shown by the reference today — dead silence, per audit (d)). | Adds the ONE piece of visibility the reference is missing entirely for this path. |
| `on-device-unsupported` (no `webkitSpeechRecognition` AND no broker key) | "Voice input isn't available in this browser." Mic control hides/disables rather than showing a control that always errors. | Reference shows a mic button whenever `micSupported` (`ChatArea.tsx:821`) which already correctly hides it in this case — keep that gate, just make the disabled-state message this explicit if the control shows dimmed rather than vanishing. |
| `no-speech` | "Didn't catch anything — tap to try again." | Kept near-verbatim from `ChatArea.tsx:928`, already reasonably actionable. |

The load-bearing change versus the reference is **the edge function returning a typed error
reason** (`{error: 'no_key' | 'upstream_5xx' | 'bad_mime' | ...}`) instead of the reference's
flat `{error: 'Transcription failed'}` (`server.js:757`) — this is a ~5-line server-side change
(swap the generic 502 body for a reason code) that unlocks all of the distinct client copy
above without which the client is guessing regardless of how good the UI copy is.

### Visual fit (no monospace, 6 keyframes, iOS-dark tokens)

- Use `--accent:#10A37F` for the "listening" mic pulse and `--blue:#0A84FF` is unused here
  intentionally (that's reserved for other severity/action meaning per
  `phase0-scope.md:87`'s stated 3-tier system: accent=clear, `#FF9F0A`=attention,
  `#FF453A`=urgent) — so `ERROR` states render in `#FF453A`/`#FF9F0A` per existing severity
  convention (e.g. `.stalebar`/`.td-err` classes already in `styles.css:266-270,544`), not a
  new voice-specific color.
- No new keyframes required. The reference's mic-level pulse (`ChatArea.tsx:1470-1476`, a
  `boxShadow` computed inline from `micLevel`) is not a CSS `@keyframes` animation at all — it's
  a per-frame inline style recompute, which fits the app's "0 new keyframes" budget for free.
  The existing `.sk-sh`/`sk-shimmer` skeleton pulse (`styles.css:230-232`) is the only
  "breathing" animation pattern in the app; reuse its shimmer rhythm (1.3s ease-in-out) for the
  `TRANSCRIBING`/`ARMING` spinner states instead of inventing a 7th keyframe.
- No monospace anywhere (`styles.css` uses only the system sans stack, `styles.css:23`) — the
  reference's hands-free overlay uses no monospace either, so this is a non-issue for direct
  port, but any new instrument-style latency debug readout (if built for internal QA) must NOT
  use a mono font per house rule (`phase0-scope.md:87`).
- Voice overlay reuses `.sheet-scrim`/`.sheet-card` (`styles.css:207-217`) rather than a new
  full-bleed blur surface, so it inherits the existing 4 keyframes (`scrim-in/out`,
  `sheet-up/down`) instead of adding new ones.

### Measurable acceptance target

**Target: utterance-end (last VAD/hold-release sample) → first audible TTS sample < 2.5s for
a long reply, < 1.2s for a short (≤280-char) reply, measured on the deployed `inbox-voice` edge
function against a live OpenAI backend.**

Justification, built from the ledger, not guessed:

- The reference's OWN shipped v2 (same architecture this spec proposes reusing: streamed WAV→PCM,
  `gpt-4.1-nano` summary, ≤280-char direct-speak fast path) was **prod-measured at 0.86s
  (short) / 2.0s (long)**, done→first-audio (`voice-claude-code-app-goalrun-2026-07-17.md:12`).
  That is the number this port is reusing the architecture *from*, on a warm Railway container
  with a persistent WS. A Deno edge function is a cold-start-prone, per-request environment —
  budget +200-500ms of edge-function cold-start/invoke overhead over the Railway baseline for a
  fair target, hence 1.2s/2.5s rather than repeating 0.86s/2.0s outright.
- This does NOT include STT (mic-release→text-in-box) or the chat turn itself — those are
  separate, already-tracked stages. STT alone was measured at ~2.0-3.5s felt total on the
  reference (`phase0-latency-ledger.md:5-13`); the port's binary-body-upload STT change (kept
  from the reference's own v2 win, `lib/voice.js`'s comment block lines 9-11) should hit the
  same ballpark and is a SEPARATE acceptance line, not folded into the speak-latency number
  above (folding STT and TTS into one number, as the original lead loosely implied, would hide
  which leg regressed if the target is missed).
- Explicitly OUT of target: total round-trip including the Claude turn itself, which is
  unbounded by design (a long agentic turn should not be penalized against a voice latency SLO)
  — the target is scoped to done→first-audio exactly as `v2_voice_probe.mjs` measures it
  (`FIRST_AUDIO: done->first_chunk`), so the existing probe's metric is reused unchanged, only
  the harness moves to Playwright/Deno.

### Testable probe design (this app's harness)

Following the `scripts/shot.mjs` pattern (session injected via `.session.json` + admin
`generate_link`, per `phase0-scope.md:90`), a new `scripts/voice-probe.mjs`:

1. **Setup** (mirrors `shot.mjs:1-18`): load `.session.json`, launch Chromium with
   `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` (grants mic permission
   headlessly, standard Playwright/Chromium flag pattern) and inject the auth token via
   `page.addInitScript`.
2. **Fixture audio, not a live human voice**: synthesize a known jargon fixture via the SAME
   OpenAI TTS call the reference's `v2_stt_probe.mjs` uses (`v2_stt_probe.mjs:20-26`), save as a
   WAV, and feed it into Chromium via `--use-file-for-fake-audio-capture=<path>` so the probe is
   deterministic and free of ambient-mic flakiness — this reuses the reference's own fixture
   generation code path rather than inventing new audio.
3. **Drive the state machine, not the DOM guess-and-check**: `page.click('[data-voice-state]')`
   to arm `LISTENING`, wait for the fake audio device to finish playing into the mic (fixed
   duration, known from the WAV), assert the UI reaches `TRANSCRIBING` then `SENDING` (poll a
   `data-voice-state` attribute the component exposes specifically for test hooks — cheap to add
   given the state machine above already centralizes state in one variable).
4. **Timing instrumentation**: hook `page.on('websocket')` (or fetch/stream events for the edge
   function's `ReadableStream` response) to timestamp: utterance-end (last audio frame written to
   the fake device) → first PCM byte received client-side → first `AudioBufferSourceNode.start()`
   call (patched via `page.addInitScript` to wrap `AudioContext.prototype.createBufferSource`
   and log to `window.__voiceProbe`). This is the direct equivalent of `v2_voice_probe.mjs`'s
   `firstChunkAt` instrumentation, ported from a raw WS client to an in-page hook because the
   probe now drives a real browser rather than opening its own WS.
5. **Assertions**: reason-coded error path (deny mic permission via a second Chromium context
   with permissions NOT granted → assert `ERROR('mic-denied')` reaches the DOM with the exact
   copy from the table above, not a generic string); short-reply fast path fires without a
   summary-LLM round-trip (assert via a server-side log line or a response header the edge
   function sets, e.g. `X-Voice-Path: direct` vs `summary`); acceptance-target assertion
   (`firstAudioMs < 1200` for the short fixture, `< 2500` for a long one) fails the script
   non-zero so it's CI-usable even though this app currently has no CI test gate
   (`phase0-scope.md:90`, "CI has no test or lint step" — this probe is a manual/pre-ship gate,
   same tier as `scripts/shot*.mjs` today, not a claim that it runs automatically).
6. **Isolation check, ported from `v2_isolation_probe.mjs`**: open two authed tabs, fire voice
   on tab A, assert tab B's `AudioContext` never receives a `speak_start`-equivalent event —
   directly relevant here because the port's `activeStream`-style singleton (kept per audit (e))
   must not leak across the inbox's multiple screens if a chat surface is ever mounted twice
   (e.g. a mini-player).

---

## Summary of severities

| Finding | Severity | Confirmed/Refuted |
|---|---|---|
| (a) 3-4 serial legs before any audio | High | Confirmed — but TTS itself streams once started, not a fully blocking blob |
| (b) fixed-threshold VAD, no AEC config | High (hands-free specifically) | Confirmed; partially mitigated by mic-off-during-speak state design |
| (c) timeout-stack stall recovery | Medium-High | Confirmed, 4 real stall-recovery timers + VAD's own 3 enumerated |
| (d) collapsed error strings | High | Confirmed; STT collapses 3+ distinct failures to one string; TTS failures are silent |
| (e) single global utterance + iOS interrupted handling | Medium | Confirmed; likely correct-by-design for 1:1 chat, flagged for deliberate port decision |
