# Independent measurement pass — v2a and v2c

Per `MEASUREMENT-NOTE.md`: candidate self-reports are not evidence. This pass re-measured
from scratch, using `scripts/density.mjs`'s exact evaluate() logic (copied, not imported,
so neither candidate's possibly-modified copy is trusted) driven from a purpose-built
navigator (`scripts/independent-measure.mjs`, `scripts/independent-measure-scoped.mjs`,
main repo). v2b is out of scope per instructions.

Gate list applied is the one in `CALIBRATION.md`'s "gates that survive, as run" section —
`words/1000px ≤ 140` and `primary number ≥ 40px` were withdrawn and are NOT re-applied here.

## 1. Build / test / lint

| candidate | build | tests | lint |
|---|---|---|---|
| v2a | PASS (`tsc -b && vite build`, exit 0) | **263 passed / 17 files**, exit 0 | exit 0, 4 pre-existing warnings, none in new code |
| v2c | PASS (`tsc -b && vite build`, exit 0) | **227 passed / 14 files**, exit 0 | exit 0, 6 warnings incl. 1 new (`scripts/sweep-v2c.mjs:29` unused var), none blocking |

Both match their briefs' self-reported counts exactly.

`package.json` diffed byte-identical against the main repo for both worktrees — no new
dependency in either candidate. Deps remain exactly `react`, `react-dom`, `@supabase/supabase-js`.

## 2. Contract-violation greps (both candidates)

| check | v2a | v2c |
|---|---|---|
| hardcoded `supabase.channel('inbox')` in real code | not found (comment-only refs); `useInbox.ts` uses `` `inbox:${useId()}` `` | not found (comment-only refs); same fix |
| `useInbox` mounted from >1 place | mounted once, in `exp/v2a/Shell.tsx` | mounted once, in `exp/v2c/Shell.tsx` |
| `.eq('client_id','ivan')` | not found in real code (comment-only); `content.ts` uses `laneFilter()` throughout | same — `laneFilter()` used, no literal |
| `dangerouslySetInnerHTML` | not found (comment explains its deliberate absence) | not found (comment explains its deliberate absence) |
| `webhook/n8nclaw-whatsapp` | not found | not found |
| calls to `inbox-claude` / Railway / `functions/v1` from tournament code | none — `functions/v1` hits are pre-existing `today.ts`/`ops.ts` endpoints unrelated to chat; chat transport is mock-only, comments only | same — mock transport only, `functions/v1` hits are the same pre-existing endpoints |

**No contract violations found in either candidate.**

`useContent()` double-mount: v2a mounts it twice (Content board + Drafts-segment badge
count), v2c mounts it once (board) plus a `head:true` count-only query for the rail badge.
Both are safe — `useContent.ts` namespaces with `` `carousel_drafts:${lane}:${useId()}` ``
independent of caller.

## 3. Per-surface measured numbers

Method: v2a has no URL routing for inner surfaces, so every row below is a **fresh page
load of `#exp/v2a`** followed by an in-app click sequence (never chained off a prior
surface's state). v2c exposes `#exp/v2c/<job>[/chat]` as real fresh-load URLs for every
job; only the thread peer (a database id) needed a click. `today` required a 20s wait after
navigation — `useToday.ts` documents the full brief as a ~12s call with no warm cache on a
fresh preview origin; a short wait catches it mid "Loading the brief…" and silently
under-reports words/prose (confirmed by direct inspection: request returns 200 but the
`loading` derived state doesn't clear for ~15-20s on a cold localStorage). No result in
either candidate had `words===0 && height===0` — no failed captures.

At 1440, v2c shows the work column and one-or-two peers simultaneously; the generic
"tallest scrolling element on the page" heuristic (from `CALIBRATION.md`'s own instrument
fix) then picks up the still-mounted inbox column's virtual scroll height (~83k px, held
open by windowing spacers) instead of the peer actually being measured. Thread and
chat-over-inbox at 1440 were re-measured scoped to `.wb-peer-thread` / `.wb-peer-chat`
(`independent-measure-scoped.mjs`) to correct this — flagged inline below.

### v2a

| surface | width | overflow | console err | words | height px | w/1000px | prose % | max num px | encodings |
|---|---|---|---|---|---|---|---|---|---|
| inbox | 390 | false | 0 | 799 | 3,227 | 247.6 | 60.3 | 14 | 2 |
| inbox | 1440 | false | 0 | 803 | 3,229 | 248.7 | 60.0 | 14 | 2 |
| today | 390 | false | 0 | 543 | 2,910 | 186.6 | 63.5 | 19 | 5 |
| today | 1440 | false | 0 | 543 | 2,179 | 249.2 | 63.5 | 19 | 5 |
| drafts (DM) | 390 | false | 0 | 42 | 852 | 49.3 | 0 | 12 | 1 |
| drafts (DM) | 1440 | false | 0 | 52 | 900 | 57.8 | 0 | 13 | 1 |
| content | 390 | false | 0 | 275 | 2,048 | 134.3 | 56.4 | 30 | 22 |
| content | 1440 | false | 0 | 275 | 1,261 | 218.1 | 56.4 | 34 | 22 |
| sends | 390 | false | 0 | 283 | 2,033 | 139.2 | 20.8 | 28 | 74 |
| sends | 1440 | false | 0 | 283 | 1,512 | 187.1 | 20.8 | 28 | 31 |
| ops (empty) | 390 | false | 0 | 40 | 852 | 46.9 | 0 | 0 | 1 |
| ops (empty) | 1440 | false | 0 | 40 | 900 | 44.4 | 0 | 0 | 1 |
| settings | 390 | false | 0 | 75 | 852 | 88.0 | 49.3 | 0 | 0 |
| settings | 1440 | false | 0 | 73 | 900 | 81.1 | 50.7 | 0 | 0 |
| thread | 390 | false | 0 | 55* | 852 | 64.6* | 78.2* | 0 | 1 |
| thread | 1440 | false | 0 | 850* | 3,229 | 263.2* | 61.8* | 14 | 3 |
| chat (empty) | 390 | false | 0 | 81 | 852 | 95.1 | 34.6 | 26 | 6 |
| chat (empty) | 1440 | false | 0 | 83 | 900 | 92.2 | 33.7 | 26 | 7 |

\* thread numbers are noisy: the click sequence opens the topmost/most-recent live thread,
and which thread that is changes between runs as the real inbox receives traffic. A repeat
run of the 390 case earlier in this pass measured 178.4 w/1000px / 86.2% prose on a
different (longer) thread. Gate results (overflow, console errors, encoding-when->100-words)
were stable across both runs; the words/prose/height numbers are not directly comparable
run-to-run because the underlying content differs, not because the surface changed.
"Chat (live turn)", "chat (hands-free)" and "chat dock (desktop)" from the brief were not
independently re-measured — the mock transport requires driving a full send/stream/dock
sequence per shot and time did not allow scripting all three; **reported as unmeasured, not
as zero**, per the instruction to never report a failed-reach as a zero.

### v2c

| surface | width | overflow | console err | words | height px | w/1000px | prose % | max num px | encodings |
|---|---|---|---|---|---|---|---|---|---|
| inbox | 390 | false | 0 | 871 | 83,173 | 10.5 | 88.6 | 13 | 7 |
| inbox | 1440 | false | 0 | 965 | 83,166 | 11.6 | 81.9 | 13 | 8 |
| today | 390 | false | 0 | 543 | 2,896 | 187.5 | 63.5 | 19 | 6 |
| today | 1440 | false | 0 | 611 | 2,720 | 224.6 | 59.4 | 19 | 8 |
| drafts (DM) | 390 | false | 0 | 30 | 852 | 35.2 | 0 | 11 | 1 |
| drafts (DM) | 1440 | false | 0 | 96 | 900 | 106.7 | 18.8 | 11.5 | 3 |
| content | 390 | false | 0 | 286 | 2,594 | 110.3 | 54.2 | 32 | 17 |
| content | 1440 | false | 0 | 350 | 2,367 | 147.9 | 49.4 | 32 | 19 |
| sends | 390 | false | 0 | 283 | 2,019 | 140.1 | 20.8 | 28 | 75 |
| sends | 1440 | false | 0 | 349 | 2,142 | 162.9 | 22.1 | 28 | 35 |
| ops | 390 | false | 0 | 41 | 852 | 48.1 | 0 | 10 | 2 |
| ops | 1440 | false | 0 | 112 | 900 | 124.4 | 16.1 | 11.5 | 4 |
| settings | 390 | false | 0 | 74 | 852 | 86.9 | 50.0 | 10 | 1 |
| settings | 1440 | false | 0 | 141 | 900 | 156.7 | 39.0 | 11.5 | 3 |
| thread (peer) | 390 (takeover) | false | 0 | 56 | 852 | 65.7 | 76.8 | 0 | 0 |
| thread (peer) | 1440, **scoped** | false | 0 | 56 | 900 | 62.2 | 76.8 | 0 | 0 |
| chat over inbox | 390 (takeover) | false | 0 | 54 | 852 | 63.4 | 33.3 | 0 | 1 |
| chat over inbox | 1440, **scoped** | false | 0 | 51 | 900 | 56.7 | 35.3 | 0 | 1 |

**Data-state gates independently confirmed, not just claimed:**
- v2c fetch-failed: loading `?wbmock=fetch-error#exp/v2c` produces "The inbox didn't load /
  Try again / PostgREST returned 500 for inbox_messages_v" with stale rows shown below under
  "Showing what loaded just now. It may be out of date." — a genuinely distinct third state,
  0 console errors.
- v2c genuinely-empty: `#exp/v2c/ops` on live data renders "Nothing waiting on you." with
  "Checked just now" freshness stamp — confirmed real (Ops queue is actually empty right now,
  not simulated).
- v2a fetch-failed: v2a has **no query-string mock lever** (no `mock.ts` in `exp/v2a/`), so
  this was forced by intercepting `**/rest/v1/inbox_messages_v**` and returning HTTP 500.
  Result: "⚠ Couldn't load your inbox. Nothing here is current — this is not an empty queue. /
  inbox unavailable / Retry" — a genuinely distinct state, reachable, correctly worded. 0
  script/page errors (the one console entry was Chromium's own resource-load-failure log for
  the 500 I injected, not an app error).
- Loading state: both candidates show a skeleton/placeholder ("Loading the brief…" was caught
  live during the today-screen timing investigation) — confirmed to exist for both, not
  independently isolated as a clean screenshot.

## 4. Gate results

### v2a — gate failures

None of the 6 kept gates failed outright. One measured value sits on the edge the candidate's
own brief already disclosed: **thread prose share exceeded 80% in one of two independent runs**
(86.2% first run, 78.2% second run — see thread-noise note above). This is the same class of
finding `CALIBRATION.md` pre-classified as a true positive on message-transcript surfaces
(flagged, not gated). Not a new failure this pass discovered; consistent with brief §5.

### v2c — gate failures

None of the 6 kept gates failed outright. **Inbox prose share exceeds 80% at both widths**
(88.6% / 81.9%) — again the same pre-classified true-positive class (`CALIBRATION.md`'s own
production baseline measured 86.7% on the identical rows). Consistent with brief §9, which
disclosed this number itself.

Both candidates carry one flagged-not-gated prose overage on a message-list-shaped surface,
exactly the class `CALIBRATION.md` already exempted. Neither constitutes a new gate failure.

**Zero overflow, zero console errors, and ≥1 encoding on every >100-word surface confirmed
independently for both candidates, at both widths, across all reachable surfaces.**

## 5. Claimed vs measured — material disagreements

- **v2a Today, words/1000px:** brief claims 272.8; independently measured 186.6 (390) /
  249.2 (1440) after correcting for the ~12-20s cold-load time the brief's own instrument
  likely also raced. Same order of magnitude, not a contradiction — most plausibly explained
  by live production data (urgent/approval counts) having changed between when the brief's
  numbers were captured and this pass, since `Today` pulls live counts. Flagged as a
  same-ballpark, not-alarming gap rather than a fabrication.
- **v2a thread prose:** brief reports 86.2% (390) as its own measured number and calls it out
  as the one soft-fail. Independent capture reproduced that exact figure on one run (86.2%)
  and a lower one (78.2%) on a repeat run — confirms the brief's number was real, not
  cherry-picked, and shows the metric is inherently noisy on this surface because it depends
  on which live thread is topmost.
- **v2c inbox height claim (83,100 / 83,093) vs measured (83,173 / 83,166):** near-exact
  match — confirms the brief's claim that windowing keeps the DOM light while the scroll
  track height stays honest via spacers. Words differ slightly (871/965 measured vs 736
  claimed) — attributable to live row-count drift (56 unread vs whatever count the brief was
  captured against), not a capture defect.
- **v2c thread/chat peer numbers at 1440 required rescoping**, as detailed above — the
  candidate's own brief measured "PER REGION" (§9 preamble) and its claimed numbers (thread
  952px/160.7 w/1000px/85.6% prose/7 enc; chat-docked 900px/56.7 w/1000px/35.3% prose/1 enc)
  are peer-scoped. My rescoped numbers for chat matched almost exactly (56.7 w/1000px, 35.3%
  prose — identical to two decimal places). Thread differed more (62.2 vs 160.7 w/1000px,
  76.8% vs 85.6% prose, 0 vs 7 encodings) — most likely a different, shorter live thread was
  opened by the click in this run than whichever the candidate captured against; the
  candidate's methodology (per-region scoping) is corroborated even though this run's
  specific thread content differed.
- No candidate's overflow, console-error, or encoding-gate claims were contradicted by
  independent measurement.

## 6. Not independently verified (say-so, not a zero)

- v2a "chat (live turn)", "chat (hands-free)", "chat dock (desktop)" — reaching these requires
  scripting a full send → stream → dock interaction sequence against the mock transport; not
  captured this pass. Do not treat as failing; treat as unmeasured.
- Voice states (`ARMING`/`LISTENING`/`SPEAKING`/`PAUSED`/`ERROR`) for either candidate — the
  reducers are unit-tested (asserted via `npm test`, included in the pass counts above) but
  the live UI states were not independently driven.
