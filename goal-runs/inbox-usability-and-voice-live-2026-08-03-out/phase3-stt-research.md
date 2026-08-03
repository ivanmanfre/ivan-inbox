# Phase 3 STT/TTS engine research (agent report, 2026-08-03)

## Verdict
- PRIMARY STT: ElevenLabs `scribe_v2_realtime` (GA 2026-01-06). Keyterm biasing EXISTS on the
  streaming API (`keyterms` query param, max 50 terms x 20 chars — our winning 22-term list fits
  verbatim, longest term 16 chars). ~150ms claimed partials. Auth: server mints
  `POST /v1/single-use-token/realtime_scribe` (single-use, 15-min expiry) -> browser connects
  `GET wss /v1/speech-to-text/realtime?token=...`. Price ~$0.44/hr incl. keyterm premium.
- FALLBACK STT: Deepgram Nova-3 streaming (`keyterm` params, 30s grant tokens, ~$0.46/hr, no
  prompt-echo hazard class). Needs WER re-bench before trust.
- REJECTED: OpenAI realtime transcription (gpt-live-transcribe) — $1.02/hr, "hints" biasing,
  inherits the prompt-echo-on-silence class we measured in batch; guarding streaming deltas is hard.
- TTS: ElevenLabs Flash v2.5 streaming; vendor claims 135ms e2e TTFB, independent bench 288ms P50
  TTFA; probe REST vs WS from Ivan's network (geography dominates). `tts_websocket` single-use token
  type exists — same broker pattern. speechSynthesis = zero-cost fallback only.
- Edge-fn WS relay is POSSIBLE (Deno.upgradeWebSocket) but token-mint is strictly better: browser WS
  can't send headers (relay would need --no-verify-jwt), duration caps kill long dictation, extra hop.

## Probe list before commit (Phase 3 gates)
1. Realtime keyterms WER vs batch (gate: finals <= batch + 2pts).
2. Realtime silence behavior on room tone (phantom partials?). Batch returns "" on silence.
3. Real first-interim latency from this network (gate < 1.0s).
4. Mint on mic-press (single-use per session; ~100-300ms mint kept off critical path).
5. Official pricing $0.39/hr + $0.05 keyterms (third parties cite $0.28 — official wins).
6. Housekeeping: inbox-stt's scribe_v1 alternate was deprecated for removal 2026-07-09 — drop when touched.

## Load-bearing citations
- https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime
- https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/batch/keyterm-prompting
- https://elevenlabs.io/docs/api-reference/tokens/create  (single-use token; also tts_websocket type)
- https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming
- https://elevenlabs.io/realtime-speech-to-text  (150ms claim)
- https://developers.deepgram.com/reference/speech-to-text/listen-streaming
- https://developers.deepgram.com/reference/auth/tokens/grant
- https://developers.openai.com/api/docs/guides/realtime-transcription
- https://gradium.ai/content/best-low-latency-tts-apis-2026  (288ms P50 TTFA)

## Fast-lane latency evidence (orchestrator, measured 2026-08-03 00:5x)
- Railway proxy /v1/messages, claude-haiku-4-5, trivial 1-line turn: 4.14s wall (CLI spawn per call).
  FAILS the <2.5s first-audible gate before TTS is even added -> fast lane = direct Anthropic API
  streaming via new T2 edge fn (ANTHROPIC_API_KEY already a project secret). Proxy-first ruling
  tension documented: Ivan's own latency demand is the overriding constraint here.
- Railway /v1/models: opus-4-8/4-7/4-6, sonnet-4-6, haiku-4-5 (same five; CLI aliases decide the
  real underlying model — Phase 4 probes deeper).

## Empirical probe 1 (orchestrator, 2026-08-03 ~01:30, real Chromium page)
- POST /v1/single-use-token/realtime_scribe with xi-api-key -> 200 {token: sutkn_...} (key: ivan-listener/.env)
- wss /v1/speech-to-text/realtime?token=...&model_id=scribe_v2_realtime&audio_format=pcm_16000&keyterms=... :
  OPEN at 309ms, session_started at 312ms (session config echoed: sample_rate 16000, word timestamps).
  8 keyterms accepted without error.
- Sending {"type":"audio","audio_chunk":b64} -> input_error "Message must be a valid protocol message"
  -> the audio frame schema differs; builder must use the documented protocol message shape.
- Tokens are SINGLE-USE: mint per session, on mic-press.
