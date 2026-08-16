# inbox-realtime-voice-and-mobile-ui — scope

Authored 2026-08-16. Supersedes the voice half of `inbox-usability-and-voice-live-2026-08-03`
(item 4) and builds on what `inbox-claude-brain-and-voice-2026-08-01` shipped.

Ivan's ask, verbatim intent: **"replicate exactly like claude or chat gpt"** voice, inside his own
web app, plus **"a good UI pass... its currently not as easy to use as vs code or it doesn't look
mobile friendly enough"**.

---

## 0. The finding that sets the architecture

**Anthropic ships no speech-to-speech model.** Claude's own consumer voice is push-to-talk: it
processes after the utterance completes, with no barge-in and no overlapping dialogue. So "like the
Claude app" is a *lower* bar than "like ChatGPT", and Claude can never be the conversation layer.
It can only be the worker behind one.

The current stack is a **cascade** — three vendors in series with client-side endpointing:

| Lane | Today | Cost of it |
|---|---|---|
| EARS | ElevenLabs `scribe_v2_realtime` over browser WS | one vendor hop |
| BRAIN | `inbox-fast` → Anthropic SSE (Haiku), 1.0-1.3s first delta | second hop |
| MOUTH | `speechSynthesis` (8-21ms first audible) | third hop |
| TURN-TAKING | energy VAD `VAD_RMS = 0.015` + `EOU_SILENCE_MS` timer | **the clunk** |

`phase4-voice.md` measured the predecessor of this path: **WER 38.6%**, *"the app as written: fails
outright, 1 of 10 turns completed"*, and **~97% of latency was the endpointer waiting out silence**
while app code contributed ~18ms.

Silence-timer endpointing is the defect. You stop talking, then wait for a timer to agree. Realtime
speech-to-speech models do turn detection *semantically* on partial content, with native barge-in
and 300-500ms to first audio.

**Decision taken (Ivan's money, recurring): `gpt-realtime-mini`,** ~$10/$20 per 1M audio tokens
against the full model's $32/$64. Roughly $30-60/mo at an hour of talking a day, versus $90-180.
Move up only if quality is provably the blocker. This is a live cost line while the Apify $199 cap
fight is open, so it ships behind a kill switch and a spend readout from day one.

---

## 1. Definition of done

1. Open the app on a phone, tap once, talk, get interrupted-able conversation at ChatGPT feel.
2. Ask for real work; it escalates to the Railway Claude Code pipeline, keeps talking while the
   work runs, and speaks the summary when it lands.
3. Same surface at desk, no separate desktop build, no keyboard requirement.
4. Installable to the iOS home screen and usable in standalone mode.
5. Every latency claim in this doc re-measured on real hardware, not asserted.

---

## 2. Part A — the voice swap

### A1. Session brokering (new)

New edge function `inbox-rt-session`, mirroring `inbox-rt-token/index.ts` **exactly** for auth
discipline: bearer verified via `supabase.auth.getUser` (never decode the payload manually), the
single-operator `ALLOWED_USER_ID` allowlist, the scoped `ALLOWED_ORIGINS` list, every control fails
closed. It mints an **ephemeral client secret** for a Realtime session; the provider key never
reaches the browser. `OPENAI_API_KEY` is already referenced in this project's functions.

`inbox-rt-token` stays until A2 is proven, then is retired with its ElevenLabs secret.

### A2. Replace three lanes with one session

In `src/exp/v2c/chat/useLive.ts` (614 lines), EARS + BRAIN + MOUTH collapse into a single WebRTC
`RealtimeSession`. What dies: the PCM framing (`floatToPcm16Base64`, `rtAudioFrame`,
`RT_SAMPLE_RATE`), the energy VAD constant, the manual commit path, the SSE splitter
(`splitSseBuffer`, `parseFastFrame`), the sentence drainer (`drainSentences`, `speechFrontier`).
The model owns audio in, audio out, and endpointing.

**🔴 The tested invariant inverts.** `voice.ts`'s reducer pins *"SPEAKING has no transition that
arms the mic"*, and `useLive` gates mic frames while SPEAKING so the model cannot hear itself.
**Barge-in requires the opposite**: the mic stays hot while the assistant speaks. That invariant and
its tests in `voice.test.ts` must be *deliberately* inverted with echo cancellation
(`echoCancellation: true` on `getUserMedia`, plus the model's own echo handling) carrying what the
gate used to carry. Do not delete the test; rewrite it to pin the new contract. Silently dropping it
is how this regresses into the model interrupting itself.

### A3. Keep the escalation contract, upgrade its transport

`<<ESCALATE: task>>` (`chat/live.ts:47-56`) is the genuinely hard, already-working part: it splits
the spoken acknowledgment from the dispatched task, hands the task to `useChat.send` →
`inbox-claude` → Railway CLI, and `feedResult()` speaks the summary when the turn lands.

Keep the behaviour, replace the regex with a **native Realtime function tool**
`escalate_to_workbench({ task })`. The Realtime API supports tool calls and remote MCP servers
inside voice sessions, so this becomes a first-class call rather than string-matching a reply.
`detectEscalation` and its tests in `live.test.ts` stay as the fallback path and the spec of intent.

**Trap:** the worst interruption case is the user talking while the agent sits silent waiting on a
tool. The session must speak a holding acknowledgment *before* dispatch and stay listening during
it. `busyWork` already models this state; it needs to survive the rewrite.

### A4. Gates (measured, on real hardware, real audio devices)

Reuse the `phase4-harness/` discipline, which caught that headless Chromium reports
`sttSupported() === true` on a browser that cannot transcribe a word. Any harness that cannot fail
is not a harness.

| Gate | Target | Today |
|---|---|---|
| Utterance end → first audible | **p50 < 500ms, p95 < 1.2s** | p50 980ms, 16.7% over 1.2s |
| Barge-in → assistant audio stops | **< 150ms** | does not exist |
| WER on Ivan's jargon set | **< 15%** | 38.6% |
| Turn completion rate | **> 95%** | 1 of 10 (app as written) |
| Cost per 10-min session | **logged, visible in UI** | n/a |

The jargon set already exists as `VOICEMODE_STT_PROMPT` in `~/.voicemode/voicemode.env` (n8n,
Supabase, PostgREST, Unipile, Apify, Fathom, ClickUp, Railway, picker, geo, carousel, Mattan,
Jekyll, edge function). Feed it to the session as vocabulary bias and score against it.

---

## 3. Part B — the UI pass

### B1. The modal takeover goes

`LiveSheet.tsx` is a `sheet-scrim` + `sheet-card` **takeover**: talking covers the app. That is the
"not as easy to use as VS Code" complaint stated precisely. VS Code's value is that you watch the
work happen while you direct it. A scrim makes the work invisible at exactly the moment you are
asking for it.

Replace with a **persistent voice dock**: a bottom-anchored bar that owns talk state, level, interim
words and turn count, over a live chat transcript that keeps streaming behind it. Conversation and
work visible at once, on one screen, at every width.

`LiveSheet`'s vocabulary is worth keeping: `VOICE_LABEL` / `VOICE_COPY` so a loop state and a
dictation state read as the same kind of object, the orb whose glyph encodes state, the level-driven
`box-shadow` (recomputed inline, adding zero keyframes), and the `interim` line showing words as
they are spoken.

**🔴 `⌘D pauses the mic` is the copy in the sheet today.** A keyboard shortcut is the entire control
surface for pause. On a phone that control does not exist. Every voice action needs a touch target
before any of this is mobile-usable.

### B2. Mobile-first, measured

Existing phone coverage is real but aimed elsewhere: the `max-width:430px` blocks in
`exp/v2c/styles.css` tune `.li-act`, `.dw-acts`, `.dw-key` — the draft window, not chat or voice.
The chat surface has no phone breakpoint of its own.

- Rebuild the chat + dock surface at **390 first**, then widen. Not a desktop layout with overrides.
- Touch targets ≥ 44px (the draft window already honours this; chat does not).
- Respect `viewport-fit=cover` (already set) with `env(safe-area-inset-bottom)` on the dock, or the
  home indicator eats the primary control.
- The composer must not be occluded by the iOS keyboard: use `dvh`, not `vh`.
- Screenshot every state at 390 and 1440 via `playwright-driver`, judged per state. No state ships
  unreviewed. This is the standard item 10 of the 08-03 spec set, and it was the item that spec says
  was failed before.

### B3. Verify the install, then fix only what is missing

**CORRECTED 2026-08-16.** An earlier draft of this section claimed there was no manifest and no
service-worker registration. That was wrong: it was grepped from `public/` and the source
`index.html` rather than from the build artifact. `vite.config.ts` runs `VitePWA` with
`strategies: 'injectManifest'`, which emits `dist/manifest.webmanifest`
(`display: standalone`, `start_url: './'`, both icons), links it into `dist/index.html`, and ships
`registerSW.js` + `sw.js` with `registerType: 'autoUpdate'`. **The app is installable today.**

`src/lib/supabase.ts` also shows the iOS PWA ground has been walked already: implicit auth flow
chosen deliberately because *"the installed PWA's storage is partitioned from Safari"*, plus
`navigator.storage.persist()` against Safari's 7-day ITP eviction.

So B3 shrinks to verification plus the gaps a manifest does not cover:

- Run the Phase 0 probe **installed to the home screen** and confirm standalone is detected.
- `apple-mobile-web-app-capable` / status-bar style are absent from `index.html`; add if the probe
  shows iOS chrome still stealing height.
- Decide `orientation` (currently unset) once the dock layout exists.
- The open question is not installability. It is whether a **live WebRTC session and an active
  microphone survive** in standalone mode, and across a screen lock. That is what the probe measures.

**⚠ Must verify, not assume:** microphone and WebRTC behaviour for an iOS **standalone** PWA, and
what happens to a live session when the app backgrounds or the screen locks. iOS has historically
been inconsistent here. If standalone mode breaks the mic, that finding kills B3 and the answer is a
Safari tab or a native shell. Probe this **before** building on top of it.

---

## 4. Phases

| # | Phase | Gate to pass before the next |
|---|---|---|
| 0 | Probe: iOS standalone PWA mic + WebRTC; realtime session smoke test | mic works in standalone, or B3 is redesigned |
| 1 | `inbox-rt-session` broker + auth parity with `inbox-rt-token` | ephemeral secret only, key never in browser |
| 2 | `useLive` swap to one session; invert the SPEAKING invariant | A4 latency + barge-in gates |
| 3 | `escalate_to_workbench` tool; `feedResult` summary path intact | escalation round-trips with speech during work |
| 4 | Voice dock replaces `LiveSheet`; mobile-first rebuild at 390 | per-state screenshots at 390 + 1440 |
| 5 | Installed-mode gaps only (apple meta, orientation) — manifest already ships | full loop works installed, on cellular |
| 6 | Cost readout + kill switch | spend visible; one toggle disables the lane |

---

## 5. Kept, not touched

- `<<ESCALATE>>` intent and `live.test.ts` (fallback + spec of intent)
- `inbox-claude` → Railway CLI pipeline, entirely
- `VOICE_LABEL` / `VOICE_COPY` vocabulary
- `useRtStt` / `useStt` dictation path — **dictation and conversation are different jobs**; typing
  by voice into the composer stays useful and stays working
- The `inbox-rt-token` auth pattern, copied verbatim into the new broker

## 6. Risks

1. **Cost is recurring and live.** Ships with a spend readout and a kill switch, phase 6.
2. **iOS standalone mic** may not survive. Phase 0 exists to find out cheaply.
3. **The inverted invariant** is the highest-risk code change; echo cancellation is now load-bearing
   where a state gate used to be.
4. **Vendor lock:** this puts the conversation layer on OpenAI while the work layer stays Claude.
   That is a deliberate consequence of Anthropic having no speech-to-speech model, and it should be
   revisited whenever that changes.
5. **`sttSupported()` lies** on browsers that cannot transcribe. Any new capability probe must be
   proven able to fail before its result is trusted.

---

## 7. RESULTS — phases 0-6 shipped 2026-08-16

Live at https://ivanmanfre.github.io/ivan-inbox/ (commits `b0fa6a9` … `b33b00c`).

### Gates, re-measured on the built app

| Gate | Target | Measured | |
|---|---|---|---|
| Barge-in → assistant stops | < 150ms | **6-11ms** | PASS |
| WER on the jargon set | < 15% | near-zero; 3/3 verbatim | PASS |
| Turn completion | > 95% | 7/7, 8/8, 3/3 | PASS |
| Utterance end → first audible | p50 < 500ms | **p50 1352ms** | **FAIL** |
| Cost per session | logged, visible | **$0.02 / 2.2min, on the state line** | PASS |

**The latency gate misses and reasoning is not why.** A/B on the same fixture,
8 turns each: `reasoning=low` 1352ms, `reasoning=off` 1189ms. Reasoning costs
~163ms (12%). Kept at `low` — 163ms is not worth degrading the escalate-vs-answer
decision, which is the thing stopping the model confabulating about his system.
It is an env knob (`INBOX_RT_REASONING`) if that trade is ever re-judged.
Both numbers come from a headless harness on a synthetic mic; the on-device
number is what `rt-probe.html` reports and it has not been read on his hardware.

### What the measurement caught that reading the code did not

1. **`session.update` silently replaces the session config.** Sending
   `{tools, tool_choice}` dropped the broker's `instructions`; `session.updated`
   acked, and the model then answered from its own weights instead of escalating.
   Tools moved to mint time.
2. **`input_audio_buffer.append` IS accepted over the WebRTC data channel** —
   contrary to the assumption that it is a WebSocket-only path. That is what
   made the pre-session buffer possible at all.
3. **Appends land at the END of the buffer**, so the live track must not be
   flowing yet: "Check my database and tell me how many content drafts are
   pending right now" came back as "Can't check my database and tell me how
   graphs are pending right now".
4. **Gating the outbound track with `track.enabled` costs ~0.5s** of speech when
   it flips back on. The gate is a `GainNode`; the encoder stays warm.
5. **`send()` only queues.** Opening the mic on the last queued append still
   races SCTP against RTP. The gate waits on `bufferedAmount === 0`.
6. **There are no audio deltas on this transport.** Over WebRTC the assistant's
   audio is on the RTP track and only transcript deltas reach the data channel,
   so `SPEAKING` never fired and tap-to-skip was unreachable by touch. Found by
   the per-state screenshot pass, not by reading.
7. **Transcription routinely completes AFTER `response.done`**, pairing an
   exchange with an empty `heard`.

### The harness was made able to fail

The first pre-session-buffer test passed with the buffer DISABLED — Chrome loops
the fake-audio file, so a later repetition supplied the sentence. Rebuilt with
one utterance at t=0 followed by 40s of silence. Control (flush off) loses the
opening: *"How many content drafts are pending right now?"*. Treatment returns it
verbatim, three runs running.

### The invariant did NOT invert

The scope expected `voice.ts`'s "SPEAKING never arms the mic" to be inverted. It
should not be: the reducer governs DICTATION (`useVoice`), where it is still
right, and the live loop never goes through it. `voice.test.ts` now pins the
split, including a source guard that `useRealtime` must never import
`voiceReduce` — doing so would silently delete barge-in while the UI kept
looking healthy.

### Still open

- **iPhone installed-PWA screen-lock survival.** Human-blocked. `rt-probe.html`
  logs `visibilitychange` with the pc and mic state; run it installed.
- **🔴 The escalated work cannot touch the database, and it is not a voice bug.**
  `inbox-claude` never sends `permission_mode`, so the container runs at
  `main.py:86`'s default `acceptEdits`, where every Bash call needs an approval
  nobody is there to give. Every escalation ends "approve the next Bash call".
  One line fixes it (`permission_mode: 'bypassPermissions'` in `upstreamBody`)
  and it is deliberately NOT taken here: this file's own header says the box
  holds every client's credentials on one filesystem and that pinning the
  workspace does not sandbox a Bash turn, so that flip lets a spoken sentence run
  unattended bash against all of them. Ivan's call.
