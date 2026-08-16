# Phase 5 — Voice, rebuilt server-side

**Date:** 2026-08-02 · **Scope:** the service + gate half. Client wiring is the other half's.

---

## 1. Verdict

**THE GATE PASSES.** Not narrowly.

| gate condition | threshold | measured | margin |
|---|---|---|---|
| WER on a 20-utterance product-noun script | < 15 % | **1.11 %** (macro), 1.01 % (micro) | 13.5x under |
| p50 latency, audio-submit → text-back | < 2 000 ms | **957 ms** (wav) / 856 ms (webm/opus) | 2.1x under |

Both numbers are **end-to-end through the deployed edge function**, not direct-API: client → Supabase
edge runtime → vendor → back, with a real user JWT through the real allowlist. The direct-API numbers
(§3) are faster and are reported only for engine comparison; they are not what the gate was decided on.

**Winner: ElevenLabs `scribe_v2` with `keyterms` biasing.** Deployed, live, and the function points at it.

For scale, the browser path this replaces measured **38.6 % WER** on the same script
(`goal-runs/inbox-claude-brain-and-voice-2026-08-01-out/phase4-voice.md`). This is a **35x** reduction
in word error rate, and the audio now goes to a vendor under contract instead of to Google's
`speech-api` as an undisclosed side effect.

**What this does NOT decide.** The gate was on transcription quality and latency, and transcription
quality and latency are what passed. Whether the mic comes back is still a product call that belongs
to whoever owns the UI: this measured a synthetic voice on clean fixtures (§7), not Ivan into a phone
mic on a train. The honest claim is *"the server path is good enough that transcription is no longer
the reason to keep the mic hidden."*

---

## 2. Per-utterance results — the deployed winner vs the field

`scribe_v2+kt` and `e2e ms` are through the deployed function (wav transport). The other three
columns are direct-API, each in its own best configuration, so the comparison is best-vs-best.
Rows 21–22 are the noisy variants, excluded from the headline 20-utterance figure and reported anyway.

| # | fixture | reference | **scribe_v2+kt** | e2e ms | gpt-4o-mini+prompt | whisper-1+prompt | scribe_v1 |
|---|---------|-----------|------------------|--------|--------------------|------------------|-----------|
| 1 | `f1` | Approve the top draft in the queue | **0.0 %** | 2162 | 0.0 % | 0.0 % | 0.0 % |
| 2 | `f2` | What failed in n8n overnight | **0.0 %** | 1651 | 0.0 % | 0.0 % | 40.0 % |
| 3 | `f3` | Check the Supabase scheduled posts table for stuck rows | **0.0 %** | 957 | 0.0 % | 0.0 % | 0.0 % |
| 4 | `f4` | Move the ClickUp task to done and refresh the board | **0.0 %** | 1082 | 0.0 % | 0.0 % | 0.0 % |
| 5 | `f5` | Did UniPile hit the read ceiling on Mattan's seat | **11.1 %** | 1486 | 11.1 % | 11.1 % | 33.3 % |
| 6 | `f6` | Render the hyperframes video for the carousel draft | **0.0 %** | 1092 | 0.0 % | 0.0 % | 0.0 % |
| 7 | `f7` | Pause the Smartlead cold email lane until Monday | **0.0 %** | 868 | 0.0 % | 0.0 % | 0.0 % |
| 8 | `f8` | Show me the RISE DTC board visibility for this week | **0.0 %** | 871 | 0.0 % | 0.0 % | 10.0 % |
| 9 | `f9_clean` | Check the Supabase scheduled posts table for stuck rows | **0.0 %** | 842 | 0.0 % | 0.0 % | 0.0 % |
| 10 | `f10_fast` | What failed in n8n overnight and did the carousel publisher run | **0.0 %** | 837 | 0.0 % | 18.2 % | 0.0 % |
| 11 | `f11` | Push the carousel render service to Railway and check the edge function logs | **0.0 %** | 959 | 0.0 % | 0.0 % | 0.0 % |
| 12 | `f12` | Did Smartlead flag a duplicate on the cold email lane | **0.0 %** | 1063 | 10.0 % | 0.0 % | 10.0 % |
| 13 | `f13` | Query PostgREST for the rows where the RLS policy blocks the anon role | **0.0 %** | 951 | 7.7 % | 15.4 % | 15.4 % |
| 14 | `f14` | Send Mattan the weekly board link before the standup | **0.0 %** | 1126 | 22.2 % | 22.2 % | 22.2 % |
| 15 | `f15` | Regenerate the lead magnet page on ivanmanfredi dot com | **11.1 %** | 972 | 11.1 % | 11.1 % | 11.1 % |
| 16 | `f16` | Check the OAuth token on the UniPile seat before the sync | **0.0 %** | 917 | 0.0 % | 0.0 % | 0.0 % |
| 17 | `f17` | Open the worktree and run the QA verdict on the DM drafts | **0.0 %** | 862 | 0.0 % | 0.0 % | 16.7 % |
| 18 | `f18` | The ClickUp list for RISE DTC needs a new content pillar field | **0.0 %** | 949 | 0.0 % | 0.0 % | 0.0 % |
| 19 | `f19` | Deploy the inbox STT edge function to Supabase and verify the JWT | **0.0 %** | 964 | 0.0 % | 8.3 % | 0.0 % |
| 20 | `f20_fast` | Check Smartlead PostgREST and the Railway edge function before the ClickUp sync | **0.0 %** | 922 | 16.7 % | 16.7 % | 25.0 % |
| 21 | `f9_noisy` | *(f3 text, + noise)* | **0.0 %** | 817 | 0.0 % | 0.0 % | 0.0 % |
| 22 | `f13_noisy` | *(f13 text, + noise)* | **0.0 %** | 997 | 7.7 % | 30.8 % | 15.4 % |

**18 of 20 utterances came back word-perfect.** The two that did not:

- **f5 → "Did UniPile hit the read ceiling on Mattan's C?"** — `seat` heard as `C`. A genuine miss, and
  the only semantic one in the set. Note it got `UniPile` and `Mattan` right, which is what the
  keyterms are for; it lost a common word instead.
- **f15 → "…on ivanmanfredi.com"** against the reference "…on ivanmanfredi dot com". This is a
  **scoring artefact, not an error** — the fixture was authored as spoken "dot com" and the engine
  wrote the domain the way a human would. It is scored as an error anyway, because silently
  hand-waving the one remaining miss is how a 1.1 % becomes an unearned 0.6 %.

Every one of the 20 clean fixtures cleared the 15 % bar individually. Worst single utterance: 11.1 %.

---

## 3. Engine comparison — all seven configurations measured

Direct-API, one request at a time (concurrency would inflate every latency), 22 requests per config,
zero errors in all seven. Macro-WER is the mean of per-utterance WER over the 20-utterance script;
micro-WER is total errors over total reference words.

| engine / config | macro WER | micro WER | p50 | p95 | silence behaviour | verdict |
|---|---|---|---|---|---|---|
| **`scribe_v2` + keyterms** | **1.67 %** | **1.51 %** | 653 ms | 1079 ms | `""` clean | **WINNER** |
| `gpt-4o-mini-transcribe` + vocab prompt | 3.94 % | 4.02 % | 708 ms | 942 ms | ⚠ **echoes the whole prompt** | passes, hazardous |
| `whisper-1` + vocab prompt | 5.15 % | 5.53 % | 1184 ms | 2029 ms | `""` clean | passes, slow |
| `scribe_v1` + `language_code=eng` | 9.19 % | 8.54 % | 631 ms | 1061 ms | `""` clean | passes |
| `scribe_v1` plain | 10.09 % | 9.55 % | 563 ms | 890 ms | ⚠ `"[pause]"` | passes |
| `scribe_v2` plain (no keyterms) | 11.21 % | 10.55 % | 630 ms | 954 ms | `""` clean | passes |
| `gpt-4o-mini-transcribe` plain | 11.50 % | 10.05 % | 540 ms | 753 ms | `""` clean | passes |
| `whisper-1` plain | 17.06 % | 17.09 % | 1176 ms | 1944 ms | `""` clean | **FAILS WER** |
| *(browser SpeechRecognition, 08-01)* | *38.6 %* | *38.4 %* | *952 ms* | — | lost finals | *dead* |

### The finding that decided it: vocabulary biasing is worth more than the engine choice

Every engine improved more from being told the product nouns than from being swapped for a better
engine. `whisper-1` went 17.06 → 5.15 %. `gpt-4o-mini` went 11.50 → 3.94 %. `scribe_v2` went
11.21 → 1.67 %. Untuned, the three engines sit within 6 points of each other; tuned, the spread is the
same size but every one of them is usable.

This nearly went unmeasured. The run spec named `scribe_v1`, which has **no** biasing parameter, and
on `scribe_v1` ElevenLabs looked like a mid-table option that OpenAI beat. The `keyterms` array
turned up on ElevenLabs' *pricing* page while costing the run — listed as a +20 % add-on — and only
then in the API reference, on `scribe_v2`. Benchmarking exactly the model named in the spec would
have shipped the second-best engine carrying a hazard the best one does not have.

### The hazard that disqualified the runner-up

`gpt-4o-mini-transcribe` + vocabulary prompt scored 3.94 % — second-best in the field. Handed **three
seconds of digital silence**, it returned:

```
Supabase, n8n, UniPile, Smartlead, PostgREST, ClickUp, RLS, OAuth, Railway, edge function,
worktree, carousel, hyperframes, lead magnet, DM, LinkedIn, RISE DTC, Mattan, ivanmanfredi.com,
QA verdict, JWT, STT.
```

…the entire prompt, as if spoken. On room tone it returned the same thing wrapped in OpenAI's own
internal template scaffold, `context: ###\n<prompt>\n###`. That string is non-empty, so an
`if (!text)` check does not catch it: mic opened by accident in a quiet room, and the operator's
composer fills with a command naming every live system in the stack, which they then send.

Both ElevenLabs configurations returned `""` on the same two clips. That is the difference between an
engine that is quiet when there is nothing to say and one that fills the silence, and it is worth more
than 2.3 points of WER.

A deterministic echo guard **was** built and measured before ElevenLabs won, because a 3.94 % engine
was worth trying to save. It survives in the deployed function as the control governing the OpenAI
alternates (§5), and its separation is clean: over 25 real utterances the vocabulary-token overlap
never exceeded **19 %**; on both silence clips it was **100 %**; the threshold sits at 60 %.

---

## 4. Cost

Public list pricing, fetched 2026-08-02. Projection is **50 utterances/day × 8 s = 6.67 min/day
= 200 min/month**.

| engine | list rate | per minute | **projected / month** | notes |
|---|---|---|---|---|
| **`scribe_v2` + keyterms (deployed)** | $0.22/hr + $0.05/hr | $0.0045 | **$0.90** | keyterms is a +20 % add-on |
| `scribe_v2` plain | $0.22/hr | $0.0037 | $0.73 | |
| `gpt-4o-mini-transcribe` | $0.003/min | $0.0030 | $0.60 | prompt biasing is free |
| `whisper-1` | $0.006/min | $0.0060 | $1.20 | |
| `scribe_v1` | $0.40/hr | $0.0067 | $1.33 | launch price; the API pricing page now lists only v2 |
| *browser SpeechRecognition* | $0 | $0 | *$0* | *and 38.6 % WER* |

**Cost is not a decision input here and should not be presented as one.** The entire spread across
every engine is **73 cents a month**. Choosing the cheapest option would have saved $0.30/month and
cost 2.3 points of WER plus a hallucination mode. At this volume, pick on quality; revisit only if
usage grows by ~1000x.

Two caveats: ElevenLabs bills per audio-minute and rounding on very short clips may make real spend
exceed this projection (50 clips/day of 8 s is 6.67 minutes of audio but 50 billing events); and the
$0.22/hr API rate applies to USD API billing, not the UI credit system (~330 credits/min).

---

## 5. The edge function

**Path:** `supabase/functions/inbox-stt/index.ts` — **NEW, UNTRACKED, NOT COMMITTED.**
**Deployed:** yes, `supabase functions deploy inbox-stt --project-ref bjbvqvzbzczjbatgmccb`
(no `--no-verify-jwt`, mirroring `inbox-claude`, which has no `supabase/config.toml` in this repo).

### Auth
Copied from `inbox-claude/index.ts`, because the same facts hold — static bundle on public GitHub
Pages, one human allowed to spend the credential:

- `Authorization: Bearer <user JWT>`, verified with `supabase.auth.getUser(jwt)` (server-side signature
  + expiry). The payload is **never** manually decoded.
- `user.id` compared against `INBOX_STT_ALLOWED_USER_ID ?? INBOX_CLAUDE_ALLOWED_USER_ID`. Never email
  (mutable), never role alone (every signed-in user is `authenticated`).
- Fails **closed** on missing config → `503 stt_not_configured`. An unset allowlist refuses to serve;
  it never falls through to "no allowlist means everyone".
- Platform `verify_jwt` is *also* on (a `GET` with no auth returns platform-level 401), so the
  function's own check is defence in depth rather than the only layer — same posture as `inbox-claude`.

### CORS
`inbox-claude`'s list, plus the port this phase's client half runs on:
`https://ivanmanfre.github.io`, `http://localhost:4173`, `:4174`, `:4175`, `:5173`, **`:5431`**.
Unknown origins get the prod origin echoed back (so the browser blocks them), never `*`.
Exposed headers: `x-stt-engine`, `x-stt-ms`.

### Limits
| control | value | why |
|---|---|---|
| `MAX_AUDIO_BYTES` | 10 MB | ~10 min opus; hard ceiling on one request at a metered vendor |
| `MIN_AUDIO_BYTES` | 512 B | an empty blob is a UI bug (mic released before data), not speech |
| `VENDOR_TIMEOUT_MS` | 30 s | measured p95 is 1.7 s; past 30 s tell the operator, don't spin |
| base64 body cap | `MAX_AUDIO_BYTES × 1.4` | bound the string *before* decoding it |
| MIME allowlist | webm, ogg, wav, mp4, m4a, mpeg, flac | what MediaRecorder emits on Chrome and Safari |

### Privacy
**Audio bytes and transcript text are never logged.** Error paths log engine, byte count, MIME and
duration only. The echo-suppression path logs the overlap score and character count — deliberately not
the text, since a false positive there would be real dictated speech.

### Engine selection
Default `scribe_v2`. `INBOX_STT_ENGINE` can move it to `scribe_v1`, `whisper-1` or
`gpt-4o-mini-transcribe` — but only to a name in the table, and only if that engine's key is present;
otherwise `503`, never a silent substitution. The OpenAI paths carry the vocabulary prompt **and** the
echo guard; the ElevenLabs paths carry `keyterms`, `language_code=eng`, and `tag_audio_events=false`
(with events on, room tone transcribes as the literal string `"[pause]"` — non-empty, so it would
reach the composer as text).

### Secrets
- `ELEVENLABS_API_KEY` — already existed. Verified byte-identical to the local key used for
  benchmarking (sha256 `278ac8af…` matches the deployed secret digest exactly), so §3's direct-API
  numbers were taken on the same credential the function uses.
- `OPENAI_API_KEY` — set this run via `supabase secrets set`, sourced server-side from the Railway
  service. Needed only for the alternates; the deployed default does not use it.
- No key appears in any file under `src/`, in the worktree, or anywhere a bundle could see.

---

## 6. Endpoint contract — what the client-wiring half needs

```
POST https://bjbvqvzbzczjbatgmccb.supabase.co/functions/v1/inbox-stt
Authorization: Bearer <supabase user JWT>     // same token as inbox-claude; no apikey header
```

**Body — either:**
- `multipart/form-data` with a single `file` part (a MediaRecorder `Blob` + `FormData`; do **not** set
  `Content-Type` yourself, let fetch set the boundary), **or**
- `application/json` with `{ "audio_base64": "<b64>", "mime": "audio/webm" }`

**200:**
```json
{ "text": "Send Mattan the weekly board link before the standup",
  "engine": "scribe_v2", "ms": 505 }
```
Also on headers: `X-Stt-Engine`, `X-Stt-Ms`. `ms` is vendor round-trip only; the client should measure
its own wall-clock for anything user-facing (median gap measured: ~430 ms).

**Errors** — all `{ "error": "<code>", "detail": "…" }`, every one verified against the deployed function:

| status | code | meaning for the UI |
|---|---|---|
| 401 | *(platform)* / `invalid_token` | not signed in → re-auth |
| 403 | `forbidden_user` | signed in, not the allowlisted operator |
| 400 | `audio_too_short` | mic released before data — retry, don't show an error page |
| 400 | `no_audio` / `bad_body` | client bug |
| 413 | `audio_too_large` | recording too long — cap the recorder client-side |
| 415 | `unsupported_content_type` / `unsupported_audio_type` | wrong MIME |
| **422** | **`no_speech_detected`** | **silence. Show "didn't catch that", never an empty composer.** |
| 502 / 504 | `stt_upstream_error` / `stt_timeout` | vendor down or slow |
| 503 | `stt_not_configured` / `stt_key_missing` / `stt_engine_unknown` | server misconfigured |

**The one the UI must handle properly is 422.** It is the *expected* outcome of tapping the mic and
not speaking, and it is the reason the audio path is safe: silence returns an error code, never an
empty string that renders as a blank composer or — on a prompted engine — as an invented command.

**Verified live** (deployed function, real JWT): silence → 422 · room tone → 422 · webm/opus → 200 ·
12 MB → 413 · `text/plain` part → 415 · anon key as bearer → 401 `invalid_token` · no auth → 401 ·
base64 JSON → 200 · preflight from `localhost:5431` → `access-control-allow-origin: http://localhost:5431` ·
preflight from `evil.example` → prod origin echoed (blocked).

**⚠ The file is UNTRACKED and awaiting commit by the orchestrator.** It is deployed and live, so the
running function and the repo currently disagree until that commit lands.

---

## 7. Method, and what these numbers do not cover

**Fixtures.** The 08-01 set (`phase4-fixtures/`, 10 utterances) was read, never modified. Ten more
were authored in the same register and synthesized the same way — macOS `say` → 22050 Hz aiff →
`afconvert` to 44.1 kHz mono Int16 wav → `ffmpeg -ar 16000` (sample rates confirmed with `afinfo`
against the originals first). `f20_fast` matches `f10_fast`'s 269 wpm. One noisy variant (`f13_noisy`)
mirrors how `f9_noisy` relates to `f9_clean`. The 20-item script contains 19 distinct texts —
`f9_clean` repeats `f3` by the original set's design; kept and flagged rather than silently swapped.

**Scorer.** `wer.mjs`, deliberately identical in normalisation and algorithm to the 08-01 harness
(`measure-voice.mjs:normalize/wer`) so these numbers are directly comparable to the 38.6 % baseline:
lowercase, strip everything that is not a letter/digit/apostrophe, collapse whitespace, then word-level
Levenshtein with backtraced S/I/D over reference length. Casing and punctuation never count as errors;
`n8n` survives as one token. It ships with a six-case self-test (`node wer.mjs`) that passes.

**Hold-out.** Because the vocabulary list contains the script's product nouns by construction, biasing
scored on that script alone is teaching to the test. Five extra utterances were authored using stack
nouns **deliberately absent** from the keyterm list (Fathom, Apify, Cloudflare, Playwright, Vercel,
Resend, Calendly, HubSpot, Loom, Firecrawl, Notion, Postmaster). `scribe_v2` + keyterms scored
**0.00 %** on them — biasing helps in-vocabulary and costs nothing outside it. On OpenAI the tuned and
untuned configs tied there (1.67 % both), i.e. its entire tuned gain came from words in the prompt.

**What is not covered, and should not be claimed:**
1. **One synthetic voice.** Every fixture is macOS `say`. This measures the engines on clean, evenly
   paced, accent-free speech. It is not a claim about Ivan's voice, a phone mic, a café, or a car.
2. **No real microphone or MediaRecorder.** The webm/opus transport was exercised (ffmpeg-encoded
   opus, 22 requests, same 1.11 % WER), but no browser produced the audio. Chrome's actual encoder
   settings, and Safari's mp4/aac path, are untested.
3. **n = 1 per fixture** for the deployed run. p50 rests on 20 samples; p95 on those same 20 and is
   correspondingly soft — the webm run's p95 of 3117 ms is one cold-start outlier, and the wav run's
   equivalent p95 was 1651 ms.
4. **No sustained-load or rate-limit testing.** One request at a time, sequential.
5. The gate measures transcription. It does not measure whether a transcribed command is a *good*
   thing to hand an agent that runs with bypassed permissions — that control lives in `inbox-claude`.

---

## 8. Evidence — scripts and raw data

All under `/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/40a160cc-d253-4d32-a586-b1dad7ce0fb2/scratchpad/phase5-stt/`
(scratch, deliberately outside the repo; nothing here is application code):

| file | what it is |
|---|---|
| `wer.mjs` | the scorer + its self-test |
| `make-fixtures.sh` | the 10 new fixtures, `say` → `afconvert` → 16 kHz |
| `make-holdout.sh` | the 5 hold-out utterances + silence/room-tone clips |
| `bench-direct.mjs` | direct-API bench, `--tuned` for best-config runs |
| `bench-scribe-v2.mjs` | `scribe_v2` ± keyterms, incl. hold-out and silence |
| `probe-safety.mjs` | the prompt-echo measurement and guard-separation check |
| `bench-deployed.mjs` | end-to-end through the deployed function, `--webm` for opus |
| `transcripts.json` | the extended 20-utterance reference script |
| `fixtures/`, `fixtures/16k/`, `fixtures/webm/` | new audio (originals untouched) |
| `raw/*.json` | every run's per-request rows and summary |

Repo files touched: **one**, `supabase/functions/inbox-stt/index.ts` — new, untracked, uncommitted.
No existing tracked file was modified. `.session.json` was refreshed (gitignored, untracked).

---

## 9. What the other half should know

1. **The mic can come back**, on transcription grounds. 1.11 % WER end-to-end, 957 ms p50.
2. **Handle 422 `no_speech_detected` explicitly.** It is the normal result of an accidental mic tap.
3. **Send webm/opus straight from MediaRecorder.** Measured identical WER to wav and slightly faster
   (856 ms p50). No client-side transcoding needed.
4. **Cap the recording client-side.** The server rejects >10 MB, but the operator should learn that
   from the UI, not a 413.
5. **The keyterm list is the accuracy.** `KEYTERMS` in the edge function took WER from 11.21 % to
   1.67 %. When the stack gains a product noun, add it there — and keep it nouns, never instructions.
6. **The function is deployed but uncommitted.** Deployed behaviour and repo state disagree until the
   orchestrator commits `supabase/functions/inbox-stt/index.ts`.

---

## Client half (orchestrator, in the main loop after the dispatched builder died to the session limit)

Commits `476a5a1` (the function source enters the repo — the service builder had left it untracked in
the main checkout, moved to the worktree and committed) and `2cafb67` (the mic itself).

**Built:**
- `src/exp/v2c/chat/useStt.ts` — push-to-talk hook: MediaRecorder (webm/opus) → multipart POST to
  `/functions/v1/inbox-stt` with the Supabase user JWT (mirrors the transport's bare-fetch pattern; no
  apikey header per the fn's contract). States idle → recording (250ms elapsed tick, 90s hard cap two
  orders of magnitude under the fn's 10MB limit) → transcribing → idle. Unmount mid-recording stops the
  hardware and drops the audio. `interpretSttResponse()` is the extracted pure branch: 422 and empty-200
  → silence ("Didn't catch that." as composer placeholder, never an error, never a blank insert); every
  error status carries its own sentence.
- `src/exp/v2c/ChatPane.tsx` — real `<button class="cmic">` in the composer row. Transcript is INSERTED
  into the composer (appended with a space, field focused), never auto-sent.
- `src/exp/v2c/faithful.css` — 38px visual to match `.csend`, `::after` inset extends the hit box to
  44×44 (verified at 390: box 38px + 3px inset each side); hover bg-shift at `--dur-hover`/`--ease`;
  recording = `--accent-soft` fill + 6px accent dot pulsing opacity-only (live-signal job, §5.1),
  disabled under `prefers-reduced-motion`.

**Flag semantics (asymmetric on purpose):** the NEW mic shows unless `wb-voice === 'off'`. The retired
browser-API stack (useVoice/VoiceControl/VoiceStrip/HandsFreeSheet) keeps its old gate — mounted only
when `wb-voice === 'on'` — and was not deleted this pass. Nobody sets 'on'; the standing decision
("never re-show the mic on the browser Speech API") holds because the two paths share no code.

**Verified live** (fake-device Playwright + deployed fn):
- fixture f3 through the deployed fn from node: `"Check the Supabase scheduled posts table for stuck
  rows"` — word-perfect vs transcripts.json, engine scribe_v2, vendor 648ms.
- pane loop at 1440: mic renders → click → `cmic-recording` class + elapsed counter → stop on the fake
  (silent) device → **422 → "Didn't catch that."** placeholder. Shots: `phase5-shots/mic-rest-1440.png`,
  `mic-recording-1440.png`, `mic-after-silence-1440.png`, `mic-390.png`.
- gates: `tsc --noEmit` clean · `npm test` **419/419** (7 new) · lint: no new warnings from touched
  files · mic hit box 44×44 at 390.
