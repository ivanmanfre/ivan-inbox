# Phase 3 latency ledger — voice (run/voice-p3, measured 2026-08-03)

All numbers measured by THIS run (builder resumed after the prior builder died;
its uncommitted claims were re-verified, not trusted). Benches:
`scripts/p3-rt-stt-bench.mjs`, `p3-variant.mjs`, `p3-tts-bench.mjs`,
`p3-e2e.mjs` (built app on `vite preview :4173`, authed via .session.json,
Chromium fake mic playing 16k PCM16 WAVs — flags are `--use-fake-device-for-media-stream`
[SINGULAR — the plural spelling is silently ignored] + `%noloop` on the capture file).

## Infrastructure
| thing | measured |
|---|---|
| inbox-rt-token mint RTT | 0.53–1.7s (10 mints: 534/588/598/604/626/677/710/726/745/766/981/1747ms — median ~0.7s) |
| STT WS open (wss …/speech-to-text/realtime) | 243–417ms, median ~260ms |
| TTS WS open (wss …/text-to-speech/…/stream-input) | 78–144ms |
| inbox-fast TTFB (first text delta) | 950–1726ms warm (6 probes: 950/1160/1282/1289/1363/1443/1620/1726), 2648ms cold-boot after deploy |
| inbox-fast full reply stream | 1.2–4.3s (typ. 1.4–2.3s for 1–3 sentence replies) |
| model served (X-Fast-Model header) | `claude-haiku-4-5` on every call |
| edge gateway | intermittent 502s (HTML, no CORS headers → browser reports them as CORS errors). Retry succeeds. |

## STT — ElevenLabs scribe_v2_realtime (22 keyterms, manual commit, pcm_16000)
- **WER, realtime finals**: **0.00%** — 5/5 keyterm sentences EXACT, in BOTH runs
  (prior builder's 01:48 run and this run's re-bench; wavs + truth.json in scratchpad/wavs).
  GATE «realtime ≤ batch+2pts»: **PASS** (batch scribe_v2 measured 1.6% in the phase-2 bench;
  0% cannot lose). **Realtime finals ship directly — the hybrid path was NOT needed.**
- **First partial**: 2208–2442ms from speech start (bench, audio paced at realtime).
  GATE «< 1.0s»: **MISSED — vendor server floor.** Invariant probe (`p3-variant.mjs`):
  chunk 50ms → 2309ms, 200ms → 2581ms, 500ms → 2327ms; subsequent partials ~1/s.
  Nothing client-side moves it. In-app (mic-press → interim tail visible): 3440ms
  (mint+WS setup runs in parallel with capture; pre-session audio is buffered so no words are lost).
- **Commit→final**: 167–827ms, median ~210ms.
- **commit_strategy=vad REJECTED**: returned an EMPTY committed transcript on a clip
  manual transcribed exactly (reproduced this run). End-of-utterance stays a client decision.
- **Silence honesty**: bench — zero partials, empty commit, `""`; app E2E (12s silence WAV) —
  composer value `""`, placeholder "Didn't catch that.", nothing inserted. GATE: **PASS**.
- Harness note: after a `%noloop` capture file ends, Chrome's fake device emits junk that
  scribe transcribes (e.g. trailing `{Neutral`). True zeros commit clean (probed) — artifact
  of the test harness, not of the app.

## TTS — first-audible, both engines
| engine | first-audible | verdict |
|---|---|---|
| speechSynthesis (macOS, 180 voices) | speak()→onstart 18ms headless / 35ms headed; in-app utter-start 12–18ms (one 490ms first-of-session outlier) | **PRIMARY — picked by numbers** |
| ElevenLabs Flash v2.5 (WS stream-input, voice Daniel) | text-send→first audio chunk 415/486/1105ms (median 486ms) | ships as FALLBACK (auto on speechSynthesis absence/failure; force via localStorage `wb-live-tts`='el') |

## Live conversation loop (built app E2E, 1440×900 and 390×844)
- Arm → Listening: 999–1164ms (mint + WS in parallel with mic; words spoken while arming
  are buffered and flushed on session start — without this the first utterance measured
  losing its opening ~1.2s: "Check the Supabase…" arrived as "Supabase Q and the…").
- Transcripts heard by the loop: EXACT on both test clips after the buffer fix.
- **End of speech → first audible reply** (speechSynthesis, sentence-streaming):
  **2731ms / 2733ms** measured (two independent turns).
  GATE «< 2.5s»: **MISSED by ~0.23s.** Components: 800ms EOU silence window (contract-named)
  + ~250ms commit→final (vendor) + ~1300ms fast-lane TTFB (vendor+edge) + ~300–450ms first
  sentence tail + ~20ms utterance start. The controllable part was already taken:
  the original full-reply-then-speak design measured **5556ms** — sentence-streaming TTS
  (speak each sentence as it completes in the SSE stream, `<<ESCALATE>>` span withheld)
  plus an inbox-fast prompt line ("open with a SHORT first sentence") brought it to 2.73s.
  Going under 2.5s requires shrinking the 800ms EOU window or a faster vendor TTFB.
  ElevenLabs-fallback engine composite: full-reply wait + ~490ms ≈ 4–6s (it is the fallback).
- **Escalation visible in chat**: chat pane's user turn appeared in the SAME 50ms
  observation tick as the loop's turn-done (1440: Δ=1ms between observations; 390: Δ=0ms).
  GATE «< 1s»: **PASS**.
- **Full round trip** (390 and 1440): spoke → `<<ESCALATE: …>>` detected → task dispatched
  through useChat.send → broker progress streamed in the chat pane ("Still starting up —
  the container was cold" visible in shots) → loop auto-paused after 3×8s no-speech rounds →
  **woke itself when the result landed** → fast lane spoke the summary 1.3s after feed.
- Caps verified: 3 no-speech rounds auto-pause observed at exactly 24s; 30-turn cap in code+tests.
- ⌘D: composer mic on/off verified E2E (`cmic-rt-listening` ↔ idle); in the live sheet it
  pauses/skips/resumes the loop. Chrome's bookmark shortcut is preventDefault-ed (documented).
- Exit is one tap: `sheetClosedByOneTap: true` at both widths. Screenshots in scratchpad
  (`p3-e2e-*.png`, `p3-orb-fixed.png`).

## Shipped vs fallback
- STT: scribe_v2_realtime interim+finals (0% WER) — batch useStt kept as fallback for
  browsers without AudioContext/WS capture. Hybrid interims+batch-final: not needed, not built.
- TTS: speechSynthesis primary, EL Flash WS fallback (loser by 400–1100ms).
- Fast lane: inbox-fast (direct Anthropic SSE) — redeployed this run with the
  short-first-sentence prompt line (escalation contract `<<ESCALATE: …>>` unchanged).

## Test/build gates
477 vitest tests green (26 prior files + live.test.ts: escalation detect, history trim,
result-feed cap, SSE frame parse/split, speechFrontier monotonicity, drainSentences edges),
`tsc --noEmit` clean, `vite build` clean. Commits on run/voice-p3: 5d96982, 60182aa, + final wiring commit.

## Orchestrator re-measure (2026-08-03 ~11:3x, post-merge 4b701bd, EOU 800->650)
- EOU_SILENCE_MS tuned 800->650 (live.ts:27) — the one client lever the builder named.
- live loop, warm, f1.wav x2: first-audible from end of speech **2288ms / 2289ms** -> GATE <2.5s **PASS**
  (cold first call still exceeds: fast-lane TTFB ~2.6s cold; warm is the operating regime of a loop).
- dictate f4.wav: final EXACT, interim tail live, first interim 2527ms from press (vendor-floor miss,
  unchanged: ElevenLabs realtime first-partial floor 2.2-2.4s; passing <1.0s needs an engine swap —
  Deepgram named as the candidate, no account today).
- silence12.wav: composer value "", placeholder "Didn't catch that.", zero interims -> PASS.
- escalation: chat-user-turn logged ~160ms after ack speech; broker turn streams in pane -> PASS.
- 493 tests green post-merge; tsc + build clean.
