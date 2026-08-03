# inbox-usability-and-voice-live-2026-08-03 — final report

Executed 2026-08-03, hours after the faithful-revamp deploy, from Ivan's own use of the live app.
Thirteen feedback items (10 in the launch spec, 3 added mid-run). Everything below is DEPLOYED:
`main` @ `a503f94` → GitHub Pages, verified live authenticated. Five deploy gates, one per phase,
instead of one big-bang merge.

The run survived six agent deaths (three account/model quota limits, two API connection drops, one
stalled builder). Commit-early + on-disk recovery carried it; the final verification below was
re-measured in the main loop rather than trusted from any builder's self-report.

## Ivan's complaints, before → after

| complaint (verbatim) | before | after (measured on the live deploy) |
|---|---|---|
| "the design is a complete old school mess nothing like the screenshot i showed u" | teal/blue TRIAD ladder, hairline austerity, edge-to-edge dark shell | The Nixtio "Check Box" skin: pistachio ground `rgb(197,225,165)`, floating charcoal plate at **40px radius**, rail pills, in-plate tab bar, lime `#B8FF66` / orange `#FF9B22` data marks, print capsules. Contract in `phase2-style-delta.md` (pixel-sampled from the reference, WCAG computed per pair) |
| "review every fucking section with screenshots and fix all spacings" | never done | **62/62 section screenshots viewed and judged** against the reference, defects coded F1–F19 in `phase2-review-ledger.md`, all fixed and re-shot, plus a taste move (peak mark). Blind seat: PASS |
| "lead magnets is on the same fucking window... make it another tab" | ResourceLane at the bottom of Content's scroll | **Magnets is its own rail job**, both lanes; Content's scroll ends at the roster |
| "when i open a content idea or review... make it like before, a window i can read... cover image should show above along with the html preview" | 420px side peer | **Takeover window `.wb-tk`: 960px at 1440, full-width at 390**, ✕ close. Verified live on an image draft: "COVER IMAGE" block renders the asset (400px) above the POST body. Preview frame only where the row's HTML is self-contained (a kit-CSS fragment would render as raw serif text; for image rows the cover IS the honest render) |
| "Ask Claude — why is that on the content drafts as well wtf" | `wb-ask` on draft detail | **Gone. Zero occurrences across 8 routes × 2 widths** |
| "also allow to edit the content" | read-only | **Edit** in the window, with a save path, plus **db 025 regen-clobber guard** applied to prod: a service_role write cannot overwrite a human-edited draft (3 paths verified; absence preserves, explicit false licenses) |
| "there is no delete option" | none | **Delete draft** (and idea delete) with confirm |
| "why it shows 56 on the bubble... seems to be logs from sends so inbox section isnt required" | opaque 56, send echoes filling the list | Badge counts only what waits on Ivan and **prints its arithmetic**: 28 to answer + 1 draft ready + 42 flagged needs-your-reply = 71. Separately shown, not counted: 65 waiting on them, 136 conversations total, "sends live in Sends". The rise 56→71 is 42 flagged conversations the old count hid |
| "in dms it's showing drafts that arent dm they are comment drafts... those go in Ops" | comment drafts in the DM lane | Routed by kind at the query source; DM lane holds DMs, comment cards stay in Ops |
| "in content the errors only show latest 48 hour errors" | "39 · 4 errored · 35 elsewhere" (all time) | 48h window, live now reads **"3 · 2 errored · 1 elsewhere"** |
| "i should see whats being spoke as i speak... start by pressing command D" | no mic | Realtime dictation, interim words landing in the composer as spoken; **⌘D** toggles |
| "you removed the live conversation... i want OpenAI-live-chat where I chat on a superfast model and when reasoning is needed it goes through the full pipeline" | removed | Live loop rebuilt: fast lane = `inbox-fast` edge fn relaying Anthropic SSE (**haiku-4-5**, TTFB 0.95–1.7s warm), TTS speaks it, and a turn needing real work escalates through the Railway pipeline |
| "missing all the cmds and skills... models that appear are older ones" | 4 static commands, 5 stale models | Palette carries the **container's probed truth: 19 skills + 62 commands**; picker offers only the **3 models that answered a live probe** |

## Voice numbers (phase3-latency-ledger.md — every figure benched, twice where it mattered)

- **STT accuracy: 0.00% WER** on the keyterm set, both benches — realtime finals ship directly, the
  hybrid batch fallback was not needed (gate was "≤ batch + 2pts"; batch measured 1.6%).
- **First-audible reply: 2.29s warm** against the 2.5s gate (PASS, re-measured twice; EOU tuned to
  650ms to get there).
- **TTS picked by numbers**: speechSynthesis first-audible 12–18ms beats ElevenLabs Flash at 486ms
  median, so ElevenLabs ships as the automatic fallback.
- **Silence is honest**: zero partials, empty commit, composer stays empty, "Didn't catch that."
- **MISSED GATE, named**: first interim word 2.2–2.4s vs the <1.0s target. Probed as a vendor server
  floor (chunk size 50/200/500ms all land ~2.3s); nothing client-side moves it. Pre-session audio is
  buffered so no words are lost, but the words appear later than the spec wanted.

## Verification (re-measured in the main loop on the deployed build)

- **8 routes × 2 viewports on the live URL: 0 console errors, 0 horizontal overflow, 0 "Ask Claude",
  0 `#null`** (`phase5-verify.json`), plus 66 route screenshots in `phase5-final/`.
- `npm test` **493/493** (27 files) · `tsc --noEmit` clean · `npm run build` clean.
- Detail-window contract verified by interaction, not by claim (widths, cover block, Edit, Delete).

## External changes (with rollbacks)

| system | change | rollback |
|---|---|---|
| Supabase `inbox-rt-token` (NEW) | mints single-use ElevenLabs realtime tokens; key stays server-side | `supabase functions delete inbox-rt-token` |
| Supabase `inbox-fast` (NEW) | voice fast lane, direct Anthropic SSE relay | `supabase functions delete inbox-fast` |
| Supabase db migration `025` | regen-clobber guard on drafts | revert migration (SQL in `db/025_*.sql`) |
| GitHub Pages (`main`) | five phase deploys, `1318d43` → `a503f94` | `git revert` the phase commit; `#exp/stock` still serves the pre-revamp shell |

Railway `claude-code` was NOT touched this run — the Claude 5 ids need a one-line `MODEL_MAP`
extension there, and that decision is left to Ivan (see residuals).

## Open / residual

- **Claude 5 in the picker needs a T3 change.** Probed finding worth knowing: `/v1/messages` accepts
  `claude-fable-5` / `claude-opus-5` / `claude-sonnet-5` and **echoes the requested name back while
  silently running Sonnet** (`main.py` MODEL_MAP falls through to `"sonnet"`). Cosmetic echo, so any
  telemetry claiming Claude 5 ran on that container is wrong. The picker therefore lists only what
  truly runs. Fix = one additive line in MODEL_MAP + deploy + re-probe.
- **First-interim latency** sits at the vendor floor (above).
- **Edge gateway 502s**: intermittent, HTML body without CORS headers, so the browser reports them as
  CORS errors. Retry succeeds; worth a guard if they get frequent.
- Preview frame appears only for self-contained HTML rows (by design, documented above).
- The `$1.17/turn` cache-write economics on the Railway pane turn is still open from the prior run —
  the fast lane now absorbs conversational turns, which reduces how often it is paid, without fixing it.

## Where everything is

`phase1-regen-clobber-investigation.md` · `phase2-style-delta.md` + `phase2-review-ledger.md` ·
`phase3-stt-research.md` + `phase3-latency-ledger.md` · `phase4-model-probes.md` +
`phase4-container-skills.json` · `phase5-verify.json` · shots in `before/`, `phase1-shots/`,
`phase2-baseline|build-shots|sections|fixshots|final/`, `phase3-shots/`, `phase4-shots/`,
`phase5-final/` · reference in `reference-nixtio-full.png`.
