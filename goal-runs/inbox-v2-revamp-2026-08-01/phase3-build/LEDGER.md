# Phase 3 — winner-apply build ledger

Branch `exp/v2`, worktree `../ivan-inbox-wt-v2`. Route: **`#exp/v2`** (`#exp/v2c` still
resolves so tournament-era ballot links do not 404; only `v2` is ever written back
to the address bar). Nothing merged, no default route touched, nothing armed.

Implementer→reviewer discipline: every packet below was re-opened after writing —
either as a rendered crop read with my own eyes, a probe against production, or a
test asserting the property rather than the code path. Where the review changed the
work, the row says so.

---

## Grafts

| # | Graft | What changed | Files | Verified |
|---|---|---|---|---|
| G1 | **v2b's single-ownership pattern** (named by BOTH ergonomics and IA seats) | Today's inline `Approve & send` on DM drafts is GONE. It acted on `brief.needs_you.dm_drafts` — the *cached* morning brief — which is the U1 replay landmine with a friendly button on it. All three pending classes on Today are now one `HandOff` primitive: count + preview + meta + **the owning surface named inline** + a way in. `DmRow` deleted. Drafts' own Ops strip got the same owner label. | `screens/TodayScreen.tsx`, `screens/DraftsScreen.tsx`, `styles.css` (`.td-qown`) | Crop `today-mobile.png`: the DM row reads `4 · DM drafts · live rows and Approve & send are in the DM queue — this list is the cached brief`, with a chevron and no button. Comment/feed rows carry v2b's exact owner lines. Reviewer pass caught the count badge centring against a now-taller row → `.td-qrow{align-items:flex-start}`. |
| G2 | **Honest empty-state copy** | The register applied across every empty surface, but only where it can be told **truthfully**: `verifiedAt` is a PROP on InboxScreen/DraftsScreen, supplied only by a host that has already established the fetch succeeded. A screen that cannot see its own fetch makes no claim. OpsScreen (default app) additionally gained the error branch it never had, which is what earns its empty state the right to speak. Sends/Overview reworded directly (they already distinguished three states). | `exp/v2c/OpsBoard.tsx`, `screens/InboxScreen.tsx`, `screens/DraftsScreen.tsx`, `screens/OpsScreen.tsx`, `screens/SendsScreen.tsx`, `screens/kpi/OverviewView.tsx`, `screens/TodayScreen.tsx`, `styles.css` (`.empty-f`) | Crop `ops-desktop.png`: *"Nothing waiting on you — and this is a live read, not a stall."* + `Checked 5s ago`. `state-failed-*` crops show the red `Failed` state instead, so empty and broken are now visibly different objects, not two renderings of one sentence. |
| G3 | **`approveDraft` guard on `send_blocked_reason IS NULL`** (non-negotiable) | `.eq(id).is('sent_at',null)` → `.is('sent_at',null).is('send_blocked_reason',null)`. The dispatcher's real predicate is `approved_at NOT NULL AND sent_at IS NULL` with no block check, so this is the only thing between a stale replay and a real send. Discard is now permanent AT THE WRITE, not by UI convention. | `lib/inbox.ts` | The single write path; `lib/inbox.test.ts` 19/19 still green. Belt-and-braces with G1: the surface that could replay it no longer has a button. |
| G4 | **Cockpit masthead arithmetic for Today** | `CountStrip` → `Masthead`: one 34px number defined as the **sum** of the three zone loads, over a stacked bar of those same three counts. New pure `todayLoad()` in `lib/today.ts` is the single derivation, and each zone's header count is now PASSED IN from it — so the headline is not a second reading of the data, it is the sum of theirs. Drift is arithmetic, not vigilance. Today's numbered/ruled/counted zone headers kept untouched. | `lib/today.ts`, `screens/TodayScreen.tsx`, `styles.css` (`.td-mast`) | Crop `today-mobile.png`: masthead `14` over `3 urgent · 11 to approve · 0 going out`; zone 01 reads `0/3 cleared`, zone 02 `0/11 cleared`. 4 new tests including a sum-property check over arbitrary inputs. `'–'` until the payload lands — an unverified zero is a lie on this screen. |
| G5 | **v2a's chat internals** | Cost-and-latency moved from the pane bottom (one line, newest turn only) ONTO each turn, with v2a's outcome dot and its latency bar against a fixed 10s scale (amber past 8s). `Turn` gained `costUsd`/`durationMs`; `turnOutcome()` makes the dot, the label and the retry affordance read one value. Tool-call cards and `Hands-free` as a labelled mode were already present in v2c and were kept. | `exp/v2c/ChatMessage.tsx` (`TurnMeta`), `chat/events.ts`, `useChat.ts`, `exp/v2c/styles.css` | Crop `chat-done-desktop.png` (mock driver, which is the only way to get a landed turn) shows `4.2s · $0.0412` + bar per turn. Against the real broker `costUsd` is **null** and only duration renders — the broker reports no cost and an estimated number on a telemetry line is worse than a missing one. |

## Must-fixes

| # | Must-fix | What changed | Files | Verified |
|---|---|---|---|---|
| MF1 | **Doubled Ops render — and the whole CLASS** | Ops is no longer a wrapped production screen at all: `OpsBoard` owns the frame and imports `PendingCard` + a new exported `OpsGroups` from `OpsScreen`, so there is one header, one empty state, one approve path and one `useOps` mount. Then **every other wrapped screen was audited**: the only remaining wraps that supply their own header are the two `wb-stalewrap` stale-rows blocks, and a general `.wb-hidenav .nav{display:none}` primitive now covers them. Sends / Today / Settings / Drafts / Content each render exactly one `.nav`. | `exp/v2c/OpsBoard.tsx` (new), `exp/v2c/Shell.tsx`, `screens/OpsScreen.tsx`, `exp/v2c/styles.css` | Measured, not eyeballed: `document.querySelectorAll('h2')` on `#exp/v2/ops` returns **exactly one** `["Ops"]` at both 390 and 1440, and `.wb-empty-l,.empty` returns exactly one line. Third half of the defect also fixed: `.app.dt .ops-sechdr{max-width:720px;margin:auto}` resolved both side margins to 0 inside a 620px region, which is why `DONE · 2` sat flush at the column edge — gutter restored at every width, not just wide ones. |
| MF2 | **Ops at 1440, unsolved by all three** | A real design, not a wrapper tweak. (a) A **state band**: four counts as 26–30px numbers with a stacked bar of the same four. (b) A **freshness signal** for finding A5 — new pure `freshness.ts` grading the read live / quiet / stalled in the app's existing 3 tiers, with `stalled` saying *"this may be a stalled feed, not an empty queue"* in words. (c) **Two columns** above 1000px when both halves have content — queue left, read-only history right — collapsing to one when the region is sharing width with a peer (620px does not divide into two columns). (d) When the queue is clear the history groups open by default, so the region carries real rows instead of black. | `exp/v2c/OpsBoard.tsx`, `exp/v2c/freshness.ts` (new), `screens/OpsScreen.tsx`, `exp/v2c/styles.css` | Three crops read in sequence, and the first two were rejected by my own review: pass 1 still had ~700px of black (the two-column rule excluded the peer-docked case correctly, but the content was too short); pass 2 stranded the empty queue beside five history rows — the exact column-stranding the panel marked as v2b's weakness. Pass 3 (`ops-desktop.png`, `crops/ops-*`) fills the region: band full width, 5 real rows, no hole. 12 tests on the freshness grading. |
| MF3 | **Content taught two models across viewports** | One model, chosen because it is the one the phone's six slots can hold: **Drafts and Content are two lanes of one job.** The lane switch moved OUT of the mobile ribbon into the working surface as a shared `WorkSegment`, rendered identically on both canvases, and the desktop rail now nests the same two lanes under one `WORK` label instead of spelling them as unrelated top-level rows. Content stays one click away on the canvas that has room for it. | `exp/v2c/Rail.tsx`, `exp/v2c/Shell.tsx`, `exp/v2c/styles.css` | Crops `content-desktop.png` and `content-mobile.png` side by side: both read `WORK · [DMs | Content 11]` in the same position with the same control. The rail's `WORK` group with `DMs`/`Content` indented under it agrees with the phone's `Work` tab. |
| MF4 | **Freehand compose sent with zero confirmation** | `onSend` now routes through the existing `ConfirmSheet` — same sheet, same register as the approve path, because the freehand message is the one **nothing has read**. Copy names that explicitly: *"Your own words, not a reviewed draft."* Enter-to-send goes through the same gate. | `screens/ThreadScreen.tsx` | `composeReply` has exactly one caller (grepped); it is now unreachable without settling the sheet. Approving a reviewed draft and sending an unreviewed one finally behave the same way round. |

## Wiring and voice

| Packet | What changed | Files | Verified |
|---|---|---|---|
| **Real Claude transport** | v2c's mock transport module swapped for `sendToClaude`, event shape unchanged (`status \| text \| tool \| done \| error`). New pure `toChatEvent()` maps broker → client events; a small `bridge()` turns the callback sender into the generator the hook consumes without dropping buffered deltas. `context` carries the transcript + a prose "the operator is looking at…" line, because the upstream never passes `--resume` — bounded to 6 turns since a replay is billed. No workspace picker, no `working_directory`, no `client_id`, no direct Railway call. The pane header stopped saying "no session yet" (which implies one is coming) and says *"a fresh session every turn"*. | `exp/v2c/chat/transport.ts`, `chat/events.ts`, `useChat.ts`, `ChatPane.tsx` | **Probed production, not inferred.** With Ivan's refreshed JWT from the allowed origin, a real turn returns `HTTP 502 {"error":"upstream_error","detail":"status 401 {…Invalid or missing API key}"}`. `classify()` maps that to `upstream_not_armed`, and the UI renders *"Claude is not armed yet: the container key is not set on the broker."* with **zero Retry buttons** — verified by feeding the app those exact captured bytes (`crops/chat-unarmed-*.png`). `RAILWAY_CLAUDE_API_KEY` untouched. Also confirmed the broker's CORS is correctly scoped to `https://ivanmanfre.github.io`, which is why a localhost preview cannot reach it and why the sweep stubs that one route with production's own response. |
| **On-device voice** | `webkitSpeechRecognition` in, `speechSynthesis` out. The reducer did not change — which was the point of having one: the events driving it went from timers to a live recogniser without a new state. `SPEAKING` still has no transition that arms the mic, and on entry the recogniser is also physically aborted. Four distinct failures with four remedies: refused permission, **no microphone** (new reason — the reference collapsed it with the refusal), network, browser-unsupported; `no-speech` stays silence and routes to `PAUSED`, never to an error. `unlockAudio()` runs on `pointerdown`, synchronously, before any transition. New `speakableText()` announces a code block instead of reciting it. | `exp/v2c/useVoice.ts`, `chat/voice.ts`, `VoiceControl.tsx`, `ChatPane.tsx` | Feature detection is a **behaviour, not copy**: with the constructors deleted before load (Firefox, Safari with dictation off) the mic and the state strip render **0 times** with 0 console errors — `crops/voice-noengine-{mobile,desktop}.png`. 11 new tests on the error mapping and the speakable transform. Working states captured through the named `?wbmock=voice:on` driver, because headless Chromium exposes the constructor but cannot capture. |
| **Route** | `#exp/v2` added to the gate regex (`v2c` before `v2` — ordered alternation, so the shorter id cannot eat the longer one's prefix). `v2c` kept as a read-only alias. | `exp/index.tsx`, `exp/v2c/route.ts` | 9 tests including the alias and the round-trip. v2a/v2b shells are on their own branches and are not in this tree, so the ballot must link their own deploys. |
| **Instruments** | `scripts/sweep-v2.mjs` (from `sweep-v2c.mjs`, per-region measurement for this app's inner scrollers) stubs the one broker route with production's captured bytes, and separates browser resource-status noise from app console errors — an unarmed broker legitimately answers 502 and the UI legitimately names it, so conflating the two would make the gate useless. `scripts/density.mjs` gained the **calibrated** gate set alongside the contract's original one: the two withdrawn gates are reported, never enforced, and the stat-number gate only judges surfaces that are actually trying to present a hero figure (largest number ≥20px). | `scripts/sweep-v2.mjs`, `scripts/density.mjs` | Stat-tile detector re-calibrated against the same controls as the rest of the list: live sends 28px judged, live inbox 13px and empty ops 0px exempt, strawman 0px exempt. |

## Canon check

- **No new npm dependency** — `package.json` byte-identical to the main repo's (`diff` clean).
- **No monospace** — nothing added a `font-family`; the code block keeps the system stack.
- **Severity still 3-tier** — `#10A37F` / `#FF9F0A` / `#FF453A`. The new freshness grades and the turn-outcome dot reuse those three; no fourth tier.
- **Stat numbers inside 26–38px** — 34px masthead, 30px Ops hero, 26px Ops tiles.
- **Glyph icons only** — no icon set, no SVG sprite added.
- **Keyframes** — none added. The mic pulse is an inline `box-shadow` recomputed from the level; the latency bar is a width.

## Not done / open

- The unarmed state is verified against **captured production bytes**, not against a live browser round-trip from the Pages origin — the broker's CORS fence (a control the security audit required) makes that impossible from a localhost preview. The mapping is asserted by test; the end-to-end browser leg from the real origin remains unexercised until this is deployed.
- Real on-device dictation is verified by unit test and by the unsupported-browser path. **A human still has to speak into it once** on real Safari/Chrome: headless Chromium exposes `webkitSpeechRecognition` but cannot capture audio, so the happy path's audio leg is untested by machine.
- Dead CSS left in place deliberately: `.td-sum`/`.td-sm`/`.td-sdot` and `.td-dm*` are now unreferenced after G1/G4. Removing shared selectors is a bigger diff than this phase should carry; flagged rather than swept.
- `inbox` prose share is 87–90%, above the 80% ceiling. Pre-classified true-positive exemption (1,354 unvirtualized rows of message snippets) per `CALIBRATION.md`; the row windowing keeps the DOM cost down but not the word count.

---

## The MF1 audit, run as a measurement

"Audit EVERY wrapped production screen for the same doubled header — the bug is a
class, not an instance." Run as a query rather than a reading, over 7 surfaces ×
{390, 1440} × {healthy, `?wbmock=fetch-error`} — counting *visible* `.nav`, visible
`h2`, and visible empty-state lines inside the working region:

```
today/inbox/drafts/content/sends/ops/settings   navs=1  h2=[one]  empties<=1
inbox+fail / ops+fail / content+fail / drafts+fail (both widths)   navs=1  h2=[one]
```

Then the same diff run **inside the context peers**, looking for duplicated visible
text rather than duplicated tags — which is what found a **second instance nobody
had flagged**:

- **`DraftPane` printed the draft's title twice** — once in `.wb-pane-h`, once in the
  body's `.dd-title` two rows below. Fixed: the body wins the title (a draft title is
  a whole sentence and a header can only ellipsize it to one line), the header says
  what kind of thing this is (`Content draft · Ivan · Text`). Re-measured: title
  appears exactly once, 0 duplicated leaves besides four independent `Show more`
  toggles and two date rows that genuinely share a clock minute.
- **`ThreadPeer`'s two bars are NOT a doubled header** and were left alone: the pane
  bar carries the pipeline ladder + Ask Claude, `t-nav` carries the identity and opens
  the context sheet. Measured 0 duplicated text leaves. Recorded so the next reader
  knows it was checked rather than missed.

## Two more defects the crops found that nobody had flagged

Recorded because both are the same lesson: they look intentional in the source and
only show up when you measure the rendered artifact.

| Defect | Why it was invisible | Fix |
|---|---|---|
| **Monospace was live in the chat pane.** `.wb-code` sets `font-family:inherit` on the `<pre>` — but the `<code>` INSIDE it carries the UA stylesheet's own `monospace` default, so the locked house rule leaked back in through a stylesheet nobody edited. The file's comment even says "the contract locks no monospace anywhere and the contract wins" while the render disagreed. | A monospaced code block looks *deliberate*. Only a computed-style query finds it. | `.wb-code code,.wb-tool-in code{font-family:inherit}`. Re-measured: **0 monospaced elements** across all 7 surfaces × 2 widths, and 0 in a landed chat turn. |
| **The rail's sync dot inflated into a ~26px green blob when the fetch failed** — and stayed green. `Rail.tsx` added `.stale`, which is a SHARED class (`styles.css:266`, the "you already replied" card) whose padding/border/font-size leak into a 7px dot; `.wb-sync-dot.bad` was the intended red. The workbench's own CSS carries a comment warning about this exact trap, and the markup was doing it anyway. | Only reachable under `?wbmock=fetch-error`, so it never appeared in a healthy crop. | Use `.bad`. Re-measured: 7×7px, `rgb(255,69,58)`, at both widths. |

## Measured gate table

`scripts/sweep-v2.mjs` — 44 shots, 25 distinct surfaces/states × {390, 1440},
per-region (this app scrolls inner containers, so a document measurement reports
852px for everything). Crops in `crops/`, raw in `crops/sweep.json`.

| Gate (as calibrated, `CALIBRATION.md`) | Result |
|---|---|
| `scrollWidth === clientWidth` at 390px, every surface | **PASS** — 0 of 44 shots overflow, at either width |
| No hard-clipped text leaf (the `.ov-over-lbl` class of bug) | **PASS** — 0 |
| Zero console errors | **PASS** — 0 app errors on all 44. 2 browser resource-status lines (`Failed to load resource: 502`) on the two chat-send shots, classified as transport noise: the unarmed broker legitimately answers 502 and the UI legitimately names it |
| Three visibly distinct data states | **PASS** — `ops`/`inbox`/`content` (empty, stamped) vs `state-failed-*` (red, named, retry, stale rows dimmed) vs skeletons |
| `totalWords > 100 → encodings ≥ 1` | **PASS** — 0 failures. Settings (60–143 words) is under the threshold; every content-bearing region carries marks |
| `prose share ≤ 80%` | **PASS with the pre-classified exemptions.** 19 regions exceed it and every one is either the Inbox list (81.7–90%, 1,354 unvirtualized snippet rows) or the content draft-body pane (86%). Both named as true-positive exemptions in `CALIBRATION.md` / SPEC |
| Stat surfaces: largest number ≥ 26px | **PASS** — today 34, content 32, ops 30, sends 28. No surface lands in the 20–25px dead zone. Inbox 13 / drafts 11 / settings 10–11.5 have no stat tile and are exempt |
| `npm run build` | **clean** |
| `npx vitest run` | **19 files, 288 tests, all passing** (was 15/240 at branch point: +4 files, +48 tests) |
| `npm run lint` | **exit 0** — 8 pre-existing warnings, 0 errors |
| No new npm dependency | **PASS** — `package.json` byte-identical to the main repo |
| No monospace | **PASS** — 0 monospaced computed styles, measured (see the defect above) |
| Severity 3-tier | **PASS** — `#10A37F` / `#FF9F0A` / `#FF453A`, no fourth |

### Per-surface numbers (`scripts/density.mjs`, calibrated verdict; raw in `density-v2.json`)

| surface | width | height px | words | words/1000px | prose % | max number | encodings | verdict |
|---|---|---|---|---|---|---|---|---|
| today | 390 | 1,729 | 409 | 236.5 | 53.3 | 34px | 12 | PASS |
| today | 1440 | 1,690 | 479 | 283.4 | 49.3 | 34px | 14 | PASS |
| inbox | 390 | 83,173 | 871 | 10.5 | 88.6 | 13px | 7 | prose (exempt) |
| inbox | 1440 | 83,166 | 967 | 11.6 | 81.7 | 13px | 8 | prose (exempt) |
| drafts | 390 | 852 | 27 | 31.7 | 0 | 11px | 2 | PASS |
| drafts | 1440 | 852 | 97 | 113.8 | 18.6 | 11.5px | 4 | PASS |
| content | 390 | 2,629 | 287 | 109.2 | 54.0 | 32px | 17 | PASS |
| content | 1440 | 2,403 | 355 | 147.7 | 48.7 | 32px | 19 | PASS |
| sends | 390 | 1,997 | 274 | 137.2 | 21.5 | 28px | 74 | PASS |
| sends | 1440 | 2,119 | 342 | 161.4 | 22.5 | 28px | 33 | PASS |
| ops | 390 | 940 | 157 | 167.0 | 42.0 | 30px | 6 | PASS |
| ops | 1440 | 852 | 230 | 270.0 | 36.5 | 30px | 8 | PASS |
| settings | 390 | 852 | 74 | 86.9 | 50.0 | 10px | 1 | PASS |
| settings | 1440 | 852 | 143 | 167.8 | 38.5 | 11.5px | 3 | PASS |

Reported, not gated (both withdrawn in calibration): `words/1000px` and the 40px
primary-number rule. For comparison against the baseline, Ops went from **0
encodings and 30.5 words/1000px** (an empty screen with nothing on it) to **6–8
encodings at 167–270 words/1000px** — the region is doing work now.
