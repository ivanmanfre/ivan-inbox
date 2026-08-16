# Candidate v2b — "cockpit + command bar"

Route `#exp/v2b` (gate regex `src/exp/index.tsx:14`). Branch `tourney/v2b`, worktree
`~/Desktop/ivan-inbox-wt-v2b`. Screenshots + measurements: `crops/v2b/` (24 shots, `sweep.json`).

## Nav skeleton

```
TAB BAR (4)          Home · Inbox · Content · Sends
COMMAND BAR          pinned above the tab bar on EVERY surface
                     collapsed → one input affordance ("Ask Claude about <surface>")
                     expanded  → mobile: sheet over the surface · desktop: 420px right rail
ENTERED, NOT NAVIGATED   Drafts  ← Home zone 02 "Queue"
                         Ops     ← Home zone 05 "Queue"
                         Settings← gear (cockpit header on mobile, rail foot on desktop)
DETAIL                   thread  ← Inbox row (desktop: split pane · mobile: takeover)

HOME = the cockpit
  masthead   one 38/44px number = Σ of the four zone loads + a stacked bar of the same counts
  01 Waiting on you     replies, each row carrying its wait age as a bar
  02 Approvals          DM drafts (the one actionable class) + counted hand-offs
  03 Content            pipeline rail + alert strip + what goes out today
  04 Campaign health    3 tiles + honest over-cap gauge + lane bars
  05 Ops                pending/working/blocked rail  (folded in from its own tab)
```

Desktop cockpit is a **three**-column grid (act / pipeline / metrics), dropping to two when the
chat rail is open. Two columns is what the live Today screen uses and it is exactly why its left
column strands black under a short Urgent zone (aesthetics §2, §7.6): with two columns the
unevenness has nowhere to go. Three columns of structurally different natural height distribute
it, and the shortest column carries Health (tiles + lanes + Ops), which is never short.

## What I made primary, and why

1. **Home, not Inbox.** The default tab moves from Inbox to the cockpit. The usability audit
   timed the three daily jobs and found the full picture costs a minimum of two tab visits with
   no cross-link between them (Job C: "nothing on either screen tells the operator the other
   exists"). Aggregating means the common morning is one screen and zero navigation; the four
   remaining tabs exist for the case where the cockpit's count is not enough.
2. **One number, and it is a sum.** The masthead is the only place in the app with a headline
   count, and it is defined as `urgent + approvals + content + ops` (`cockpitLoad`, unit-tested).
   Every zone's own header count is a term of that sum, so the headline and the breakdown cannot
   disagree — which is the failure mode an aggregating home invites.
3. **Claude is a control, not a place.** It never took a tab slot, so the 7-surfaces-into-6-slots
   pressure the IA audit found in all three previous candidates ("every candidate's answer to one
   more surface was to spend an existing slot") does not recur here. The bar is mounted once,
   outside the viewport fork, and composes on top of whatever is showing.

## Single-source-of-truth rule for a pending item

> **One pending item has one owning surface, and the cockpit owns exactly one class of item.**
> DM drafts are rendered and actioned in the cockpit **off `useInbox()`'s live realtime array** —
> the same array Inbox and Drafts render — never off the morning brief's cached
> `needs_you.dm_drafts`. Every other pending class (ops cards, comment drafts, feed drafts,
> content review) appears as a **count plus a way in**, with no mutating affordance.

Implementation (`src/exp/v2b/cockpitLoad.ts`, `Cockpit.tsx`):

- `cockpitDmDrafts(threads, scope)` derives from `useInbox().threads` and re-applies `isDraft()`,
  so a discard — which only stamps `send_blocked_reason` — removes the row from all three
  surfaces in the same tick. Tested (`v2b.test.ts`, "a discarded draft is gone in the same tick").
- The stale-vs-fresh order is the same order Drafts uses, so the two surfaces can never present
  one queue two ways.
- Belt to those braces: **`approveDraft` now guards `.is('send_blocked_reason', null)`** as well as
  `sent_at` (`src/lib/inbox.ts`). This is the U1 fix at the database, not by UI convention: a
  stale tab that replays an approve gets a zero-row update instead of sending a killed message.
- Zone 02 counts only its own classes; Ops cards are zone 05's load. No double counting.

## The 4×-duplicated desktop/mobile fork

Extracted, not copied. `src/exp/v2b/layout.ts` holds one pure `layoutFor(surface, desktop) →
'split' | 'full' | 'stack'`, and `Shell.tsx` holds one `<Frame>` that consumes it. There is no
`desktop ? … : …` anywhere else in the candidate — including the command bar, which is why adding
Chat's own responsive behaviour (sheet on mobile, rail on desktop) cost zero new branches. The IA
audit's build-order warning was that bolting a new surface onto four duplicated copies guarantees
a fifth; this candidate is not the fifth.

`layoutFor` also **is** the A1 fix: `split` is returned only for `inbox`, so the
"Select a conversation" branch is unreachable for any surface without a conversation. It cannot
regress, because there is no code path to it. (The live `App.tsx` got the same fix directly:
`tab !== 'inbox'` instead of a three-name allowlist, plus Drafts/Settings rendered full-width.)

## Content grouping: lifecycle (`groupByStage`) is primary

`groupByStage`, with `error`/`stuck` lifted out into an alert strip per `ALERT_STAGES`. Reasons,
in the order they matter:

1. Ivan asked for it, verbatim and dated, after using the triage board for a round
   (`content.ts:270`). That is an operator preference, not an inference.
2. Triage's question — "what is on fire" — is already answered on the cockpit, in one line, by
   zone 03's count and alert strip. Rendering a `bucketDrafts` board here would be the second
   full-board render the audit warns about.
3. `groupByStage` keeps an approved-without-a-date row visibly inside Approved with
   `countUndated()` as a sub-line, instead of dropping it into a separate bucket. No post falls
   out of the flow.

`bucketDrafts` is still the engine behind the Drafts queue's triage-shaped affordances and behind
derived counts. It is never rendered as a competing board.

Two content decisions worth naming:
- **Share bars are computed over the ACTIVE pipeline, excluding published.** With 109 published
  rows in the 60-day window, 11 in review renders as 9% and the funnel's shape vanishes. Over the
  active pipeline it reads 85%, which is the true statement. Published shows as `history` with a
  muted bar.
- Desktop keeps the lifecycle in **one** ordered column and spends the width on a **sticky
  pipeline rail**. A two-column stage board looked balanced until 11 rows landed in review and 0
  everywhere else — at which point the second column stranded, reproducing the exact defect this
  candidate is supposed to fix. A sticky rail is short by construction and cannot strand.

## Chat + voice

- **Transport is a single swappable module** (`chat/transport.ts`, typed `ChatTransport`). The mock
  emits the real frame sequence — `session → status → tool_use × n → text deltas → done`, plus an
  `error` path reachable on purpose (any prompt containing fail/error/break, or the
  "simulate a broker error" chip). Phase 3 replaces one function; no component changes.
  Nothing here touches Railway, an edge function, or a Supabase function.
- Zero new dependencies. The markdown subset (`chat/render.ts`, ~110 lines, 8 tests) emits typed
  data that the component maps to React elements — no HTML string, no `dangerouslySetInnerHTML`,
  therefore no sanitizer. Cut: `marked`, `dompurify`, `highlight.js`, `katex`, `mermaid`.
- **Deliberate deviation from `ia-and-chat-port.md` §2.6:** that spec granted code blocks a scoped
  monospace exception. CONTRACT.md lists "no monospace anywhere" as locked and non-negotiable, and
  the contract wins. `<pre>`/`<code>` are pinned back to the system stack with
  `font-variant-numeric:tabular-nums` and preserved whitespace.
- Consecutive tool calls collapse into one strip (`groupBlocks`), tap to expand pretty-printed
  input. No output panel — `/chat/stream` forwards `tool_use` without `tool_result`, so there is
  nothing honest to show there.
- Turn state lives in `useChat()` at shell altitude, so collapsing the bar or changing surface
  never tears down an in-flight turn. Deltas are rAF-coalesced (one render per frame) and flushed
  synchronously on `done`/`error`. Composer draft text survives an error, per §2.3.
- Voice is `useVoice()`, the state machine from `phase1-audit/voice.md` implemented as **one**
  state — `IDLE → ARMING → LISTENING → TRANSCRIBING → SENDING → SPEAKING`, `PAUSED('no-speech')`,
  `ERROR(reason, retryable)`. Every timer is a named transition owned by that state and guarded by
  a generation counter, inverting the reference's six-timers-race-to-set-a-display-enum. `SPEAKING`
  cannot arm the mic because no mic-arm path is reachable from it. Four distinct error strings
  (`VOICE_COPY`) replace the reference's single collapsed "Transcription failed". Rendered as real
  UI: mic ring, live level waveform, transcript echo, hands-free latch on hold. No audio captured.

## Measured gate numbers

Instrument: `scripts/sweep-v2b.mjs` (fresh `#exp/v2b` load + a `data-nav` click sequence per
surface; measurement is `sweep.mjs`'s plus `density.mjs`'s inner-scroller height fix). Gate list
per `CALIBRATION.md`: density and the ≥40px number are **withdrawn and reported only**.

| surface | vp | overflow | console err | encodings | prose % | biggest num | words/1000px |
|---|---|---|---|---|---|---|---|
| home | 390 | false | 0 | 32 | 35.6 | 38px | 157.1 |
| home | 1440 | false | 0 | 33 | 35.3 | 44px | 264.4 |
| inbox | 390 | false | 0 | 5 | 71.4 | 13px | 334.6 |
| inbox | 1440 | false | 0 | 5 | 71.4 | 38px | 339.9 |
| thread | 390 | false | 0 | 2 | 62.3 | — | 81.0 |
| thread | 1440 | false | 0 | 7 | 71.0 | 13px | 355.5 |
| content | 390 | false | 0 | 20 | 52.8 | 19px | 248.3 |
| content | 1440 | false | 0 | 28 | 50.1 | 19px | 289.3 |
| sends | 390 | false | 0 | 72 | 21.7 | 28px | 138.6 |
| sends | 1440 | false | 0 | 29 | 21.5 | 28px | 190.4 |
| drafts | 390 | false | 0 | 0 | 0 | — | 32.9 |
| drafts | 1440 | false | 0 | 0 | 0 | — | 32.2 |
| ops | 390 | false | 0 | 0 | 0 | — | 31.7 |
| ops | 1440 | false | 0 | 0 | 0 | — | 31.1 |
| settings | 390 | false | 0 | 0 | 50.7 | — | 85.7 |
| settings | 1440 | false | 0 | 0 | 50.0 | — | 82.2 |
| chat (zero) | 390 | false | 0 | 33 | 29.6 | 38px | 189.0 |
| chat (zero) | 1440 | false | 0 | 34 | 29.4 | 44px | 248.1 |
| chat (streamed turn) | 390 | false | 0 | 33 | 33.5 | 38px | 216.3 |
| chat (streamed turn) | 1440 | false | 0 | 34 | 33.3 | 44px | 283.7 |
| chat (error + retry) | 390 | false | 0 | 33 | 31.2 | 38px | 179.0 |
| chat (error + retry) | 1440 | false | 0 | 34 | 31.0 | 44px | 235.1 |
| chat (voice LISTENING) | 390 | false | 0 | 33 | 29.5 | 38px | 189.7 |
| chat (voice LISTENING) | 1440 | false | 0 | 34 | 29.3 | 44px | 249.0 |

Gate verdicts:

1. **Zero horizontal overflow at 390px** — pass on all 12 mobile shots (`scrollWidth === clientWidth === 390`).
   The `% of cap` clip is fixed (`.ov-tile-sub .ov-over-lbl` drops to its own line and wraps).
   One further internal clip was found and fixed during verification: the expanded bar's modifier
   class was also the collapsed bar's *button* class, so `white-space:nowrap` inherited into every
   paragraph of the transcript and clipped each to one line — invisible to an overflow check
   because the document never scrolls. Renamed `cb-open` → `cb-full`.
2. **Zero console errors** — pass, 0 across all 24 shots (also 0 `pageerror`).
3. **≥1 visual encoding on any surface with >100 words** — pass. Every content-bearing surface
   encodes; the four 0-encoding rows are Drafts (28 words), Ops (27) and Settings (73), all under
   the threshold, and all three are genuine zero/list states.
4. **Prose share ≤80%** — pass, max 71.4% (Inbox). Inbox needed real work to get there: see below.
5. **Stat-tile surfaces ≥26px** — pass. Home 38px mobile / 44px desktop, Sends 28px. Nothing was
   inflated to 40px; the locked scale is intact.
6. **Three distinct data states** — pass. New `FetchFail` strip (urgent tier, always with a retry)
   wired to `useInbox`/`useOps`/`useContent`/`useStyles` errors on Inbox, Drafts, Ops, Content and
   all five cockpit zones; loading is the existing skeletons plus per-zone copy; empty keeps the
   existing terse voice. The cockpit adds a shared `freshnessOf()` → live / stale / failed /
   loading marker, which is the freshness signal Ops never had.
7. `npm run build` clean, `npm test` **215 passed / 11 files** (45 new), `npx oxlint` 0 errors
   (4 pre-existing warnings, untouched).

**Density is reported, not gated** (withdrawn per CALIBRATION.md). For context: the live Today
screen measures 277 and Sends 142.5. The cockpit measures **157.1 at 390px** — i.e. it aggregates
five zones into *less* density than the screen it replaces, because the zones are mostly
encodings and numerals rather than sentences.

**Inbox, honestly:** the 71.4% prose share and 334 words/1000px are the residue of U6. Two render
fixes landed (the fetch half stays out of scope): a 40-row page window with an explicit
"N older threads — load 40 more" control, and a 120-character DOM clamp on the row snippet. Those
took the inbox from **83,453px / 49,585 words** to **3,201px / 1,071 words** — a 96% reduction in
rendered height and 98% in DOM words — and added an `inbox-pulse` strip (unread / drafted / total
as a stacked bar) so a 1,100-thread list has a shape before you scroll.

## What I deliberately did NOT do

- **No real chat transport.** No Railway call, no edge function, no Supabase function, no
  `inbox-claude`. Mock only, behind one typed module.
- **No real audio.** No `getUserMedia`, no `MediaRecorder`, no TTS. The voice state machine and
  every one of its transitions are real UI driven by a mock; nothing records.
- **Did not fix U6's fetch half.** `fetchMessages` still pages up to 20k rows on mount, on every
  unfiltered realtime event and on every focus. Debouncing plus a `created_at` cursor is a
  data-layer change with its own test surface; the render half was in scope, the fetch half is a
  Phase 3 item.
- **Did not touch `App.tsx`'s or `cand-a/b/c`'s copies of the viewport fork** beyond the A1 fix
  and the two error-prop pass-throughs. Extracting the shared fork across four files mid-tournament
  would have made the candidates non-comparable; the extraction exists inside v2b as the pattern to
  apply on winner-apply.
- **Did not rebuild the content or styles data layer.** `content.ts`, `styles.ts`, `useContent`,
  `useStyles` are consumed as shipped, and `cand-a/ReviewActions` is reused rather than reimplemented.
- **No write affordance on Resources**, no schedule/publish/delete on Content, no
  `webhook/n8nclaw-whatsapp` fallback, no `dashboard_action` wrapper taking table/field, no
  `functions.invoke()`. Rise lane stays read-only.
- **Did not touch U4, U7, U9, U10, U11, U12, U14, U15.** Freehand-compose confirmation (U4) is a
  one-line change but it edits the live send path, which belongs in the winner's diff and not in a
  tournament candidate.
- **Did not add a 4th severity colour, a 7th radius, an icon library, an animation library, or a
  webfont.** Two new keyframes total (`cb-rail`, `cb-pulse`, plus `cb-rise` on the expanded bar);
  radii were consolidated from six to three tokens and the 6-vs-7px label split collapsed to 6.
- **`#exp/c` still routes** despite C being eliminated on 07-31. Deleting it is the winner-apply
  step's job (phase0 open item 1), not a candidate's.
