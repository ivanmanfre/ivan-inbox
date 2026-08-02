# Phase 4 — Voice, measured

Mission target under test: **< 1.2 s from utterance end to first audible output for a short reply.**
No instrumentation existed. This document reports only numbers that were taken, and labels every
stub and proxy at the point of use.

Code under test (read in full before building anything):
`src/exp/v2c/chat/voice.ts` (reducer, 271 lines) · `src/exp/v2c/useVoice.ts` (hook, 293 lines) ·
`src/exp/v2c/VoiceControl.tsx` (UI, 155 lines) · consumer `src/exp/v2c/ChatPane.tsx:89-95`.

Harness, raw results and every probe transcript: `phase4-harness/` and `phase4-harness/raw/`.
Work was done in a throwaway detached worktree at `exp/brain`'s tip; the repo working tree and
the `exp/brain` ref were never modified, and the worktree has been removed.

---

## 1. Headline

| | |
|---|---|
| Working measurement path | **Real Google Chrome 150.0.7871.187, headed, real audio devices via a BlackHole 2ch loopback** |
| Turns attempted / completed | 41 / 36 (87.8 %) — *one-line-variant build* |
| WER (completed turns, macro-avg) | **38.6 %** (micro-avg 38.4 %) |
| WER counting failed turns as total deletion | 46.1 % |
| utterance-end → final recognition result | median **952 ms** (min 766, max 1706) |
| utterance-end → first audible *(proxy)* | median **980 ms**, mean 1037 (min 778, max 1793) |
| final result → speech starts | median **18 ms** (max 87) |
| **Verdict vs < 1.2 s** | **MET at the median (980 ms); NOT met as a bound — 6 / 36 turns (16.7 %) exceeded 1.2 s.** And this is a **local-only** number: the chat turn is stubbed at 0 ms. |
| **The app as written** | **Fails outright: 1 of 10 turns completed.** See §5. |

The decisive caveat: **~97 % of the measured latency is Chrome's endpointer waiting out the silence
after you stop talking.** The application's own code contributes ~18 ms of the ~980 ms. The target is
therefore not really a test of this codebase — it is a test of the Web Speech API, and the codebase
has almost no lever on it.

---

## 2. The hard-truth probe: what can and cannot transcribe here

This was determined empirically **before** anything elaborate was built, as required.

### 2.1 Bundled Chromium (playwright 1.61.1, HeadlessChrome/149) — CANNOT transcribe

`raw/probe-chromium-headless-16k-f1.json`, verbatim:

```
55  ctor {"SpeechRecognition":true,"webkitSpeechRecognition":true,"secureContext":true}
286 gum-ok {"tracks":["Fake Default Audio Input"]}
714 stream-peak {"peak":0.999969482421875}
715 start-called
   (nothing further — no result, no error, no end, until the 15 s timeout)
```

The constructor **exists** and the fake audio **is flowing** (peak 1.0 through an AnalyserNode), but
`start()` produces **no `start`, no `result`, no `error`, no `end` event at all**. It does not fail —
it silently does nothing. A feature-detection test (`sttSupported()`, voice.ts:220-222) therefore
returns **true** on a browser that cannot transcribe a single word. Anything built on
`sttSupported()` in CI would pass while measuring nothing.

### 2.2 Real Google Chrome + `--use-file-for-fake-audio-capture` — ALSO cannot transcribe

Chrome runs the recogniser properly (`onstart`, `onaudiostart`) and then returns
`error: no-speech` after ~8 s, with the fixture audio demonstrably playing. Two hypotheses — dead
backend, or fake device not reaching the recogniser — were separated by capturing Chrome's own
verbose log (`raw/probe-chrome-stderr-full.log`, 2 290 lines). Both are answered there:

**The speech backend is alive and reachable.** Chrome opened real requests to Google:

```
NotifyBeforeURLRequest: https://www.google.com/speech-api/full-duplex/v1/up?key=AIza…&lang=en-US&…&interim
NotifyBeforeURLRequest: https://www.google.com/speech-api/full-duplex/v1/down?key=AIza…
```

**The fake device never reaches the recogniser.** Tracing the recogniser's media request
(`label=bd82ffa5…`) shows it enumerate devices, obtain `MEDIA_DEVICE_ACCESS`, and then
`MSM::DeleteRequest` — it **never issues `AIDM::Open`**. The only `AIDM::Open` in the whole log is
our own `getUserMedia` (`Fake Default Audio Input`). Chrome's Web Speech recogniser opens the
**default hardware input directly**, bypassing the fake MediaStream device entirely.

> **Consequence for anyone writing CI later:** `--use-file-for-fake-audio-capture` **cannot** be used
> to test `webkitSpeechRecognition`. It works for `getUserMedia` and nothing else. This is the single
> most useful negative result in this phase.

Both 44.1 kHz and 16 kHz mono WAVs were tried (`phase4-fixtures/16k/`, converted with
`ffmpeg -ar 16000 -ac 1`); the sample rate was never the issue, so **neither format "worked"** on
the fake-device path and the 16 kHz set is what the working path uses.

### 2.3 The path that works — real devices via BlackHole 2ch

BlackHole 2ch (a virtual loopback driver) is installed on this Mac, and `com.google.Chrome` already
holds microphone TCC permission. So:

- `ffmpeg … -f audiotoolbox -audio_device_index 1` plays the fixture into **BlackHole's output**;
- BlackHole loops it to **BlackHole's input**;
- BlackHole is made the **system default input** for the run, so Chrome's recogniser hears it.

Device index 1 was established by a loopback sweep, not assumed (`raw/device-index-sweep.txt`:
idx 1 = −3.2 dB, every other index = −91 dB silence). First confirmation
(`raw/probe-blackhole-f1.json`): `onspeechstart` followed by real interim results `"approve" →
"approve the top"`. The system default **output** is deliberately left alone — see §7.1 for the
contamination that taught me that.

The default input/output are saved and restored on every exit path, including `SIGINT` and
uncaught exceptions; both were verified back to `MacBook Pro Microphone` / `MacBook Pro Speakers`
after the final run.

---

## 3. What is REAL and what is STUBBED

| Leg | Status |
|---|---|
| Audio into the recogniser | **REAL** — a real CoreAudio input device carrying the fixture |
| `webkitSpeechRecognition` + Google speech backend | **REAL** (network round trip included) |
| The reducer, `speakableText`, `sttErrorReason`, `unlockAudio` | **REAL** — `src/exp/v2c/chat/voice.ts` compiled by `tsc` and imported by the harness page (`phase4-harness/build/voice.js`). It has zero imports, so it transpiles verbatim with no bundler. |
| The hook's wiring | **RE-IMPLEMENTED, line-for-line**, in `phase4-harness/build/harness.html`, with `useVoice.ts` line numbers cited at each mirrored block. The app itself needs auth + a live broker to reach a voice turn; the reducer and its event wiring do not. |
| `speechSynthesis` output | **REAL** (180 voices, ~3.4 s utterances) |
| utterance-end timestamp | **REAL, acoustic** — see §4 |
| **The chat turn (`SENDING` → `turn-done`)** | **STUBBED at 0 ms.** |
| **first-audible timestamp** | **PROXY** — see §4 |

**Why the turn is stubbed, and whether a real one was possible.** `src/exp/v2c/chat/transport.ts:19`
states it directly: *"The broker ships UNARMED on purpose: `RAILWAY_CLAUDE_API_KEY` is unset."*
Arming it requires one `supabase secrets set`, which is Ivan's call and not obtainable without him.
**No real authed upstream turn was attempted and none is reported.** Every latency in this document
is therefore **local-only**, and a real turn's time-to-first-token adds to it **directly and in
full** — the reducer enters `SPEAKING` only after `turn-done` (voice.ts:100-105), and nothing is
spoken before then. With a median local figure of 980 ms against a 1 200 ms target, **the real-world
budget left for the entire broker round trip is ~220 ms at the median and negative at the tail.**

---

## 4. How each timestamp was obtained

**utterance-end — REAL, acoustic, and validated.** The page opens its own `getUserMedia` with
`echoCancellation / noiseSuppression / autoGainControl` all **false** and runs a 512-sample
ScriptProcessor (10.7 ms resolution at 48 kHz) over the same audio the recogniser is hearing. Speech
segments are gated at `max(8 × noise floor, 0.006 RMS)`, requiring ≥3 blocks to open a segment and
≥15 blocks (~160 ms) of quiet to close one, so inter-word stops do not read as utterance ends.

That detector was **validated against the source files** rather than trusted. Detected speech
duration vs the span `ffmpeg silencedetect` finds in the WAV:

| | f1 | f3 | f4 | f5 | f6 | f7 | f8 | f9_noisy |
|---|---|---|---|---|---|---|---|---|
| acoustic (ms) | 1600 | 3109 | 2571 | 2613 | 2805 | 2517 | 3040 | 3115 |
| file (ms) | 1612 | 3123 | 2579 | 2667 | 2916 | 2524 | 3116 | 3162 |
| error | −0.7 % | −0.4 % | −0.3 % | −2.0 % | −3.8 % | −0.3 % | −2.4 % | −1.5 % |

Consistently a slight **undershoot** (the gate clips low-energy tails), so
utterance-end is detected marginally *early*, which makes the reported latencies marginally
**conservative** — they err against the target, not for it.

Cross-check: the recogniser's own `speechend` event lands **1.3–17 ms *after* the final result**
(median −2.7 ms, i.e. the final arrives just before `speechend`), so Chrome's endpointer decision and
its final result are effectively simultaneous. Both anchors agree.

**first-audible — PROXY, stated plainly.** The number reported is the `start` event on the
`SpeechSynthesisUtterance` (instrumented at the `u.onstart` mirroring useVoice.ts:181). **This is not
an acoustic measurement.** It is the moment Chrome reports the synthesiser began producing output;
true emission from a speaker follows by roughly one output buffer. Measured context for the size of
that gap: `speechSynthesis.speak()` → `start` event is a median of **15.9 ms**, and the
AudioContext reports `baseLatency` 5.3 ms / `outputLatency` 0. So the proxy plausibly **understates**
true first-audible by ~5–25 ms. An acoustic measurement was attempted and abandoned for a good
reason — §7.1.

**Net measurement uncertainty on the headline figure: roughly ±30 ms**, from the acoustic gate's
early cut (conservative) and the proxy's early report (optimistic), partially offsetting.

---

## 5. THE FINDING: the app as written does not complete a voice turn

`useVoice.ts:118` sets `r.continuous = false`. On the working path, that configuration **almost never
produces a final result** — and the reducer's only exit from `LISTENING` toward a turn is gated on
`final.trim()` (useVoice.ts:140-147).

Isolated in `raw/diag-final-configs.json` by running the *same audio* through four recogniser
configurations back to back:

| configuration | final result |
|---|---|
| **`continuous=false, interim=true`  ← the app** | **none** — last interim `"approve the top"`, then `end` |
| `continuous=false, interim=false` | **none** — no results at all |
| `continuous=true, interim=true` | `"approve the top draft in the queue"` ✅ |
| `continuous=true, interim=false` | `"approve the top draft in the queue"` ✅ |

Reproduced identically on digital-silence padding **and** on fixtures with −56 dB pink room tone
(`raw/diag-final-configs-roomtone.json`), so it is not an artefact of unnaturally clean silence —
that control was run specifically to try to break the finding.

Over the full fixture set, **app as written: 1 of 10 turns completed** (only f8). The one-line
variant: **36 of 41**. The reducer, the copy table and the error mapping are all fine; the recogniser
is configured in a mode that does not deliver.

**What the user sees when this happens** (this is the part that matters): no final → `r.onend` fires
with `heard === ''` → `no-speech` (useVoice.ts:163-166) → the reducer keeps `LISTENING`
(voice.ts:84-86, round 1 < 3). Nothing re-arms the recogniser, because `startRecognition()` is only
called on entry to `ARMING` (useVoice.ts:238). So the machine **sits in `LISTENING` with a dead
recogniser, indefinitely**, and since `micIsLive(LISTENING)` is true (voice.ts:177-179) the UI keeps
showing a live pulsing mic and the word "Listening" forever.

Measured directly (`raw/run-nospeech-appdefault-*.json`), final state `{"s":"LISTENING","level":0}`:

```
2125 arm-click        2183 rec:start → state ARMING→LISTENING
2416 rec:audiostart
10315 rec:audioend    10316 rec:error {"error":"no-speech"}    10316 rec:end {"heard":""}
   (no further state change — LISTENING, recogniser dead)
```

### 5.1 `PAUSED` is unreachable, and `rounds` double-counts

Two related defects fall out of the same run:

1. **`NO_SPEECH_ROUNDS = 3` (voice.ts:62) can never be reached from a single arm.** One recognition
   session yields at most one `end`. `ChatPane.tsx:89-95` never calls the exposed `voice.noSpeech()`
   (useVoice.ts:290) and never re-arms. So the `PAUSED` state, its copy ("didn't catch anything, tap
   the mic to try again", VoiceControl.tsx:108) and its `resume` transition are **dead code on the
   device driver**. They are reachable only in the mock driver, which re-arms on a timer
   (useVoice.ts:211).
2. **`rounds` increments twice per session.** `r.onerror('no-speech')` (useVoice.ts:152-154) *and*
   `r.onend` with no result (useVoice.ts:163-166) both fire and both increment. Measured
   `rounds: 2` after a single silent listen. So the "3 consecutive empty listens" threshold would in
   practice trip after ~1.5 listens if anything ever did re-arm.

### 5.2 The error path is correct

The one state-machine path that behaves exactly as designed. Forcing a backend failure
(`--host-resolver-rules=MAP www.google.com 127.0.0.1`), `raw/run-error-appdefault-*.json`:

```
2174 arm-click → ARMING → 2221 LISTENING → 2502 rec:error {"error":"network"}
2502 state LISTENING→ERROR {"reason":"stt-network","retryable":true}
```

328 ms from arm to a typed, retryable error carrying its own remedy copy
("Dictation lost its connection — check your network and try again.", voice.ts:147) and a "Try
again" button (VoiceControl.tsx:96-98). `sttErrorReason` maps correctly and `voiceSeverity` rates it
urgent. This is the design working.

### 5.3 A documented claim that is false

`useVoice.ts:11-13` states: *"Input is webkitSpeechRecognition, output is speechSynthesis, and
**nothing leaves the browser for either**."* `voice.ts:186-191` builds on it: *"it removes two network
legs … and **cannot miss the 1.2 s first-audible target because nothing leaves the device to be
transcribed**."*

Both are **false on Chrome/macOS**, and this phase disproves them twice over: the netlog shows the
captured audio being streamed to `https://www.google.com/speech-api/full-duplex/v1/up`, and killing
DNS for `www.google.com` kills dictation instantly (§5.2). Recognition is a **cloud** service here.
`voice.ts:145-147` already half-admits it ("the browser's engine still calls home on most
platforms") — the two stronger comments contradict it and should go. The correctness consequences
are real: **operator commands naming clients and internal systems are being sent to Google**, and the
latency argument resting on "nothing leaves the device" has no basis — the network round trip is
inside the 952 ms measured below.

---

## 6. Per-fixture results

Configuration measured: the **one-line variant** (`continuous = true`), because the app as written
does not produce enough completed turns to measure (§5). Normalisation for WER: lowercase, strip
every character that is not a letter/digit/apostrophe, collapse whitespace — so casing and
punctuation never count as errors, and `n8n` survives as a token. WER is
Levenshtein-over-words with backtraced S/I/D, implemented in `measure-voice.mjs:normalize/wer`.

n = 4 runs per fixture (5 for f1). WER and S/I/D are means over **completed** turns; latencies are
medians. Fresh browser per turn.

| fixture | ref words | completed | WER % | S | I | D | uEnd→final (ms) | uEnd→first-audible *(proxy)* (ms) | verdict vs 1.2 s |
|---|---|---|---|---|---|---|---|---|---|
| f1 | 7 | 5/5 | **0.0** | 0 | 0 | 0 | 961 | **989** | ✅ |
| f2 | 5 | 3/4 | 53.3 | 1.7 | 1 | 0 | 1077 | **1092** | ✅ |
| f3 | 9 | 4/4 | 55.6 | 4 | 1 | 0 | 968 | **991** | ✅ |
| f4 | 10 | 4/4 | 20.0 | 1 | 1 | 0 | 970 | **988** | ✅ |
| f5 | 9 | 4/4 | 66.7 | 4 | 2 | 0 | 928 | **961** | ✅ |
| f6 | 8 | 4/4 | 18.8 | 0.8 | 0.8 | 0 | 1041 | **1085** | ✅ |
| f7 | 8 | 4/4 | 75.0 | 0 | 0 | 6 | 844 | **858** | ✅ |
| f8 | 10 | 4/4 | 10.0 | 1 | 0 | 0 | 913 | **930** | ✅ |
| f9_noisy | 9 | 4/4 | 61.1 | 2.5 | 0.5 | 2.5 | 882 | **897** | ✅ |
| f10_fast | 11 | **0/4** | — (100 by deletion) | — | — | — | — | — | ❌ never completed |

**Aggregate (36 completed turns):** WER **38.6 %** macro / 38.4 % micro; 46.1 % counting failed turns
as total deletion. utterance-end → first audible: **median 980 ms, mean 1037 ms, min 778 ms,
max 1793 ms**; **30 / 36 turns (83.3 %) under 1 200 ms.** final → speech start: median **18 ms**,
max 87 ms.

### What the recogniser actually heard

Every product noun in the fixtures is a failure mode:

| ref | heard |
|---|---|
| Approve the top draft in the queue | approve the top draft in the queue ✅ |
| What failed in **n8n** overnight | what failed **in any then** overnight / what failed **an NA done** overnight |
| Check the **Supabase** scheduled posts table for **stuck rows** | check the **super base** scheduled post table for **stud Rose** |
| Move the **ClickUp** task to done and refresh the board | move the **click up** task to done and refresh the board |
| Did **UniPile** hit the **read** ceiling on **Mattan's seat** | did **you need Kyle** hit the **Reed** ceiling on **Madden seed** |
| Render the **hyperframes** video for the carousel draft | render the hyperframes ✅ / **hyper frames** / **high performance** |
| Pause the **Smartlead** cold email lane until Monday | **until Monday** (6 words deleted) |
| Show me the **RISE DTC** board visibility for this week | show me the **rice** DTC board visibility for this week |

f7 deserves care, because it looks like an app bug and is not one. The interims got as far as
`"cold email Lane until Monday"`, and the final was only `"until Monday"`. `useVoice.ts:127-132`
accumulates only from `e.resultIndex`, so I instrumented **every** finalised segment from index 0 as
a separate observation to see whether the hook was discarding earlier segments. It was not:
`{"text":"until Monday","n":1,"resultIndex":0}` — Chrome's results array held exactly **one** result.
The backend discarded its own interim content at finalisation. `transcriptAllSegments` equals
`transcript` in **all 36** completed turns, so the `resultIndex` accumulation is never the culprit.

f10_fast (280 wpm) failed 4/4: one interim (`"what's"`), then `speechend` **17 s** after the audio
actually ended, and no final. Fast speech does not degrade here — it collapses.

f9_noisy vs its clean twin f3: 61.1 % vs 55.6 %. Pink noise costs relatively little; the jargon is
what costs.

---

## 7. Honesty notes

### 7.1 The acoustic first-audible measurement I did not ship

I first set BlackHole as the default **output** too, so TTS would loop back and first-audible could
be measured acoustically rather than by proxy. It was invalidated by contamination: with output on
BlackHole, **every** sound on the machine enters the loopback, and Music.app was playing. The
"silence" floor rose to ~0.05 RMS against a TTS body of ~0.10–0.24 — under 2× separation, not enough
to gate on (`raw/diag-tts-trace.json`, `raw/diag-tts.json`). Rather than tune a threshold until it
produced a number, I reverted to leaving the default output untouched — which also makes the
recognition path clean — and reported first-audible as the **proxy** it is. Stopping Ivan's music to
buy a cleaner number was not mine to do.

### 7.2 Scope of the `continuous=false` finding

It reproduced on **every** attempt across two silence conditions and 10 fixtures (1/10 completions vs
36/41), on real Chrome with real device audio. What I have **not** done is reproduce it with a human
speaking into a physical microphone. I cannot fully exclude that something about a virtual loopback
input (e.g. its perfectly clean device-level characteristics) interacts with Chrome's single-utterance
endpointer. Before this is called a shipping bug it deserves the 60-second manual check in §9.
The direction of the risk is worth stating: if it *is* rig-specific, the app is fine and the
measured latencies still stand; if it is not, voice does not work at all.

### 7.3 Other limits

- **One machine, one browser, one network.** Chrome 150.0.7871.187 / macOS 15 (Darwin 25.0.0). The
  recogniser is a cloud service, so these latencies are partly a measurement of this network on this
  afternoon. No claim is made about Safari, Firefox, or iOS — and `sttSupported()` is browser-specific.
- **The reducer is exercised through a faithful re-implementation of the hook, not through the
  running app.** Every mirrored block cites its `useVoice.ts` line. The reducer module itself is the
  real compiled source.
- **Synthetic fixtures, one voice.** WER here is not a claim about Ivan's voice, only about this
  vocabulary.
- **`f9_noisy`'s reference is the f3 sentence**, per the fixture spec, and is scored as such.
- The `--continuous` runs number 41, not 40, because f1 includes an extra smoke run; it is included
  rather than discarded, and f1's row reads 5/5.

---

## 8. Verdict

**On the mission target — MET at the median, NOT met as a bound, and only in a build that does not
exist yet.**

1. With the one-line change, utterance-end → first audible is **980 ms median (proxy)** against a
   1 200 ms target, but **1 turn in 6 exceeds it** (max 1793 ms). A target phrased as an absolute
   ("< 1.2 s") is not met by a distribution with a 17 % tail over it.
2. **This is local-only.** The chat turn is stubbed at 0 ms and the broker is unarmed by design
   (`transport.ts:19`). A real turn adds its full time-to-first-token on top, leaving ~220 ms of
   headroom at the median and none at the tail. **The target is effectively already spent before the
   broker is armed.**
3. **On the code as it stands the target is not measurable at all**, because 9 turns in 10 never
   produce a transcript (§5).
4. The app's own contribution is **~18 ms**. The remaining ~960 ms is Chrome's endpointer silence
   timeout. **No amount of work in this repo moves the headline number**; the only levers are a
   different recognition engine or an explicit end-of-utterance signal (push-to-talk release) rather
   than waiting for the endpointer.
5. **WER 38.6 % makes the feature unusable for operator commands regardless of latency.** Every
   product name in the vocabulary — Supabase, UniPile, Smartlead, n8n, RISE — is mis-transcribed.
   "Check the Supabase scheduled posts table for stuck rows" arriving as "check the super base
   scheduled post table for stud Rose" is not a near miss; it is a command that cannot be routed. The
   Web Speech API offers no vocabulary hinting to fix this.

**Recommendation: do not treat < 1.2 s as the gate for this feature.** The latency is adequate and
mostly outside the app's control; the *accuracy* is the blocker, and it is a property of the chosen
engine. If voice ships on `webkitSpeechRecognition`, it should be scoped to dictation-into-a-text-box
where the operator can see and correct the text before it is sent — never to a hands-free loop that
acts on what it thinks it heard. Note that hands-free mode as designed (`ctx.handsFree`,
voice.ts:103/112) does exactly that.

---

## 9. What a human must do on a real device

Three checks that this rig cannot make. About ten minutes total.

1. **Settle §7.2 (60 seconds, do this first — it gates everything else).** Open the app on a Mac with
   a real microphone, click the mic, say "approve the top draft in the queue", stop. If the strip
   goes `Listening → Transcribing → Thinking`, `continuous=false` is fine and the finding is
   rig-specific. If it **stays on "Listening" with a pulsing mic and never advances**, §5 is
   confirmed on real hardware and voice is broken for every user. To A/B it in one sitting, flip
   `useVoice.ts:118` to `r.continuous = true`, reload, repeat.
2. **Confirm first-audible acoustically** (replaces the §4 proxy). Record the room with a phone while
   doing the turn above, then in the recording measure from the end of your own last word to the
   first sample of Claude's reply. Compare to 980 ms. This is the only way to close the ~5–25 ms
   proxy gap and to include real speaker output latency.
3. **Re-measure with the broker armed.** After `supabase secrets set RAILWAY_CLAUDE_API_KEY=…`, redo
   check 2. The delta over 980 ms is the broker's time-to-first-token, and it is the number that
   actually decides whether < 1.2 s is reachable at all.

To re-run everything here after a code change:

```
cd goal-runs/inbox-claude-brain-and-voice-2026-08-01-out/phase4-harness
node measure-voice.mjs --continuous      # all 10 fixtures, working config
node measure-voice.mjs                   # all 10 fixtures, app as written
node measure-voice.mjs f1 --nospeech     # the no-speech / PAUSED path
node measure-voice.mjs f1 --error        # the ERROR path
node aggregate.mjs                       # table + verdict → raw/aggregate.json
```

Requires: BlackHole 2ch, `SwitchAudioSource`, `ffmpeg`, and Google Chrome with microphone
permission. The scripts save and restore the system default audio devices themselves. They are
deliberately **outside** the repo source tree and touch no application file.

### Harness inventory

| file | what it is |
|---|---|
| `probe.mjs` | the §2.1/2.2 hard-truth probe (chromium vs chrome, headless vs headed) |
| `probe-logs.mjs` | spawns Chrome directly to capture its verbose log — the §2.2 evidence |
| `probe-blackhole.mjs` | first proof that the loopback path transcribes |
| `diag-final.mjs` | the 4-config comparison behind §5 |
| `diag-tts.mjs` | TTS reachability + the proxy-gap measurement in §4 |
| `measure-voice.mjs` | the harness: WER, acoustic segmentation, latency decomposition |
| `aggregate.mjs` | per-fixture table, aggregate, acoustic-detector validation |
| `build/harness.html` | the page: the real reducer + `useVoice.ts` wiring mirrored with line citations |
| `build/voice.ts`, `build/voice.js` | the real `src/exp/v2c/chat/voice.ts` and its `tsc` output |
| `raw/` | every run, every probe, Chrome's stderr log, `aggregate.json` |
