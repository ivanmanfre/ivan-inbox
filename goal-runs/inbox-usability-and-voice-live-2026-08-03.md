# inbox-usability-and-voice-live — Ivan's post-deploy feedback, all of it

Authored 2026-08-03 ~00:25, minutes after the faithful-revamp deploy went live and Ivan used it for
real. Three rapid messages of feedback. This spec is the complete list — nothing else from those
messages exists outside this file.

## What Ivan said (verbatim intent, the run's ground truth)

1. **"the design is a complete old school mess nothing like the screenshot i showed u… all shitty
   disgusting and unusable"** — the deployed workbench look FAILS his reference. The blind seats and
   censuses passed; the owner's taste did not. The reference screenshot he showed is the target.
2. **"lead magnets is on the same fucking window just make it another tab because i have to scroll
   down till the end otherwise"** — Lead Magnets must be its own rail tab, not a section at the
   bottom of Content's scroll.
3. **"when i open a content idea or review do not just open it on the side its literally impossible
   to read… make it like before on the interface that opens a window so i can properly read… and
   cover image should show above along with the html preview"** — draft/idea detail must open as a
   proper window/takeover (like the pre-revamp shell's DraftDetail), NOT the narrow side peer. Cover
   image at the top, along with the rendered preview.
4. **Voice, the whole point**: (a) words must appear in the chat AS he speaks (live interim
   transcript, not blob-then-text); (b) **⌘D** starts/stops speaking; (c) the LIVE CONVERSATION mode
   the old stack had (hands-free loop, agent talks back) was removed — "wtf". What he wants:
   **OpenAI-live-chat style** — converse with a superfast model with near-zero latency, and when
   real reasoning/work is needed the turn escalates through the full Railway Claude Code pipeline.
5. **"missing like all the cmds and skills i see from here"** — the pane's command palette only has
   /model /retry /stop /clear. He wants the commands + skills his real Claude Code sessions have —
   i.e. what the Railway container can actually run.
6. **"the models that appear are older ones"** — CLAUDE_MODELS (src/lib/claude.ts) + ALLOWED_MODELS
   (inbox-claude fn) still offer opus-4-8/4-7/4-6, sonnet-4-6, haiku-4-5. Refresh to the Claude 5
   family — but PROBE what the container accepts, don't assume.

## Mission

Make the deployed inbox (https://ivanmanfre.github.io/ivan-inbox/) something Ivan opens and does not
screenshot at us: his reference look, readable detail windows, LM tab, and a voice mode he can hold a
live conversation with. Ship incrementally — the app is live, so each phase that passes its gate
DEPLOYS (merge main → push → Pages) instead of hoarding a big bang.

## Non-negotiables (violating any of these is a failed run)

- Repo: `~/Desktop/ivan-inbox`, work on a branch off `main`, merge+push main only at phase gates.
  NEVER `git add -A` (foreign untracked dirs). NEVER touch `:root` in src/styles.css:1-16.
  `#exp/stock` (old shell) keeps working. PWA is autoUpdate — deploys self-propagate.
- The mic NEVER returns on the browser SpeechRecognition API (38.6% WER, standing ban). Input =
  server-side/provider engines only. `speechSynthesis` OUTPUT is not banned but must be beaten or
  chosen deliberately (measure vs ElevenLabs TTS).
- No secret ever in the bundle/dist. Edge functions are T2 (smallest diff, never touch RLS/other
  tenants). Railway claude-code is T3-EXTERNAL and multi-client: any main.py change is a one-change
  grant with rollback recorded — and check first whether the need is servable WITHOUT touching it.
- No new npm dependency without naming it in the report. No webfonts/serif. Tests + tsc + build green
  at every deploy gate. `npm test` currently 426/426.
- Known traps that WILL bite: StrictMode alive-flag shape (set true in effect body); CLI stream
  frames nest `message.content[]`; OpenAI STT echoes its vocab prompt on silence (non-empty!);
  ElevenLabs returns "" on silence; refresh tokens ROTATE — never two concurrent refreshes;
  `.session.json` in the repo root is the auth for probes; playwright via
  NODE_PATH=~/.claude/skills/playwright-driver/node_modules; macOS has no `timeout` cmd;
  `railway` CLI only works from ~/Desktop/claude-code-railway.
- Never ask Ivan questions mid-run EXCEPT the one licensed below (reference screenshot). Do not
  report back until the definition of done is met.

## The one licensed question

Phase 2 (design) needs **the reference screenshot Ivan showed** ("nothing like the screenshot i
showed u"). If it is not attached to the launch message and cannot be found in
`goal-runs/*/` reference material within 15 minutes of looking: ask Ivan ONCE for it ("drop the
screenshot of the look you want"), continue Phases 1/3/4/5 while waiting, and block only Phase 2 on
the answer. His answer outranks everything: **the spine contract's mechanical floors (contrast, tap
targets, density, zero console errors) still bind, but the LOOK — type scale, chrome, color
temperature, ornament — follows his reference, not the spine's taste.**

## Model routing

Orchestrate on the session default. Builders: default tier. Blind judges + the design-translation
agent (reference screenshot → concrete style delta): highest available. Mechanical sweeps: low
effort. Commit every 10-15 min; a builder's numbers are never accepted without independent
re-measurement (this caught the orchestrator twice last run).

## Phases

### Phase 1 — P0 usability (deploy at gate)
- **Lead Magnets tab**: add job `magnets` (layout.ts JOBS drives route validation automatically —
  route.ts parses any JOBS member). Move ResourceLane (+ its ideas split + LM chart) out of BOTH
  lanes' Content scroll into the new surface, with the same Ivan/Mattan lane toggle. Check the
  mobile tab bar survives an 8th item at 390 (measure; if it crowds, group Settings behind overflow
  — measure first, decide from numbers). Content's own scroll must end at StyleRoster/Summaries.
- **Detail as a window**: draft/idea/review detail opens as a TAKEOVER (the pre-revamp shell's
  DraftDetail register: full-width reading surface, comfortable measure, real close affordance),
  not the 420px side peer. Desktop AND mobile. **Cover image renders at the top, alongside the
  rendered HTML/preview of the post as it will appear** (LM rows: their landing-page artifact).
  The chat peer stays a peer; this change is about READING surfaces.
- **CapsuleChart blob**: linear height scale with a 109-count outlier renders a monster balloon
  (live screenshot in Ivan's message). Sqrt-scale the height, cap ~72px, keep printed values; a
  zero-stub stays a stub. Re-check both lanes + LM chart at live data.
- Gate: censuses (contrast/overflow/console/density) green on touched routes at 1440+390, tests
  green, then MERGE + DEPLOY + live-verify authenticated.

### Phase 2 — the look (blocked on reference screenshot; deploy at gate)
- One agent translates the reference screenshot into a concrete style delta against the live app:
  what specifically reads "old school mess" (type scale? the display-serif CONTENT masthead? chrome
  density? capsule ornament? dark ladder temperature?) — named deltas with px/token values, not
  vibes.
- Restyle to the reference across all surfaces (workbench only; stock shell untouched). Keep
  mechanical floors. Blind seat verdict at both widths against the REFERENCE (not the spine):
  "does this read as the same family as the screenshot?" Fix loop ≤2.
- Gate: blind seat pass + censuses + tests → MERGE + DEPLOY.

### Phase 3 — voice: live words + ⌘D + the conversation loop
- **Interim transcript**: streaming STT with partial results rendering into the composer as words
  are spoken. Engine candidates: ElevenLabs realtime/scribe streaming (keyterm support = the thing
  that won last time — verify it exists in the streaming API), Deepgram streaming, OpenAI realtime
  transcription. Broker: a WS relay edge fn or short-lived scoped token minted server-side — the
  provider key NEVER reaches the browser. If no streaming engine passes the accuracy bar, hybrid is
  licensed: stream interims for display, send the recorded blob to the PROVEN batch inbox-stt
  (WER 1.11%) for the final text.
- **⌘D** toggles the mic globally in the workbench (preventDefault — it's Chrome's bookmark key;
  document the collision, it's what he asked for). Push-to-talk stays tap-able.
- **Live conversation mode** (the removed thing, rebuilt properly): reuse the tested state machine
  in src/exp/v2c/chat/voice.ts (LISTENING → SENDING → SPEAKING → re-arm; SPEAKING never arms the
  mic — keep that invariant and its tests). New drivers: streaming STT in, TTS out (measure
  ElevenLabs flash vs speechSynthesis on first-audible latency + quality; pick from numbers).
  **Two-lane brain**: fast lane = superfast model (probe: haiku-4-5 or newer) called DIRECTLY
  (proxy-first single-shot routing per proxy-first-api-fallback-routing-2026-07-30 — NOT a CLI
  container spawn; the loop needs sub-second, and CLI turns cost ~$1.17 cache-write each). The fast
  lane holds the conversation and DECIDES when a turn needs the full pipeline (tool call /
  explicit "let me work on that") → that turn dispatches through the existing inbox-claude broker →
  Railway CLI, progress streams into the chat, and the fast lane speaks a summary when it lands.
- Gates (all measured, latency ledger in the -out dir): first interim word < 1.0s from speech
  start; fast-lane reply first-audible < 2.5s from end of speech; escalation round-trip visible in
  chat within 1s of dispatch; silence never inserts text; WER of finals ≤ batch path + 2pts.

### Phase 4 — palette truth + models
- **Commands/skills**: inventory what the Railway container ACTUALLY exposes (its workspace
  .claude/skills + CLI built-ins) — probe, don't copy the local ~/.claude list (local-only skills
  the container lacks must NOT appear). Palette lists them with one-line descriptions; unknown
  slash-input still warns before sending as literal text.
- **Models**: probe the container per candidate id (fable-5? opus-5? sonnet-5? haiku-4-5 — the
  canonical-claude-models memory names the lineup; the container's account decides). Update
  CLAUDE_MODELS + broker ALLOWED_MODELS (T2 deploy) to exactly the probed-working set, newest
  first. A model that fails the probe does not ship in the picker.
- Gate: every palette entry executes a real turn successfully in the deployed app.

### Phase 5 — verify + close
- Full pass on the final deploy: authenticated live checks at 1440+390 on every route, zero console
  errors, latency ledger re-run, one blind seat on the NEW detail window + LM tab + voice flow.
- REPORT.md in `goal-runs/inbox-usability-and-voice-live-2026-08-03-out/`: per-complaint
  before→after with measurements, external changes with rollbacks, residuals named.
- Memory writeback: update inbox-faithful-revamp topic file (voice section superseded AGAIN — say
  so), new topic file for this run, MEMORY.md index lines. Convert relative dates to absolute.

## Definition of done

All six feedback items closed with evidence, each phase's gate met, final state DEPLOYED to Pages
and live-verified, REPORT.md complete, memory written. Ivan opens the live app on desktop and phone
and finds: his look, an LM tab, readable detail windows with cover+preview, words appearing as he
speaks, ⌘D, a live conversation that escalates to the real pipeline, true commands, current models.

## Resume rule

If the session dies mid-run: read this file + the -out dir + `git log` on the branch, trust only
on-disk/committed state, re-measure any number a dead agent claimed, and continue from the first
unmet gate. Commit early, commit often.
