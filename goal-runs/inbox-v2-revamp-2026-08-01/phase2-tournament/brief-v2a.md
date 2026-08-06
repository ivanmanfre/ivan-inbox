# Candidate v2a — "chat as shell"

Branch `tourney/v2a` · worktree `~/Desktop/ivan-inbox-wt-v2a` · route `#exp/v2a`
Screenshots: `phase2-tournament/crops/v2a/` (23 shots, 10 surfaces + 2 desktop-only states)
Instrument: `scripts/sweep-v2a.mjs` (this worktree) — sweep.mjs's overflow/console/login checks + density.mjs's measurement block, driven by in-app clicks because `#exp/` is read at mount only.

---

## 1. Nav skeleton

```
Shell
├── ShellBar (34px, always present, above BOTH rooms)
│     [ ◉ Inbox | ✳ Chat ]  ← the sibling switch, one tap either way, live dot
│                              when a turn is streaming in the room you left
│                                                                    [ ⚙︎ ] ← Settings
├── ROOM 1 — the tabbed app (structurally the audited app)
│     TabBar: Today · Inbox · Drafts · Sends · Ops        (5 slots, 6th left empty)
│     Drafts = "what needs me", two queues under one title:
│         [ DM drafts · N ]   ← list+detail triage (DraftsScreen, unchanged)
│         [ Content pipeline · N ] ← full-width lifecycle board (new)
│     Settings is a tab value that is not in the bar — the gear routes to it,
│     and it carries a "‹ Inbox" back row so it reads as pushed, not lost.
└── ROOM 2 — Claude chat, full height, its own layout
      mobile: takeover · desktop: focus (owns the content area) ⇄ dock (440px
      right pane, app still live beside it)
```

The distinguishing claim, stated plainly: **chat is not a tab and the tabbed app is not chat's parent.** They are siblings, which is the same shape `App.tsx` already uses twice (`session ? Shell : Login`, `exp ? ExpGate : Shell`) — this run reuses that shape one level lower (`view === 'chat' ? ChatSurface : AppFrame`) instead of inventing a nesting. A switch between siblings therefore belongs *above both*, not inside either one's navigation, which is what the shell bar is.

## 2. What I made primary, and why

**Primary: the five daily jobs, unchanged.** The IA audit's verdict was that the 6-tab bar audited well; the only thing wrong with it was what people wanted to cram into it. So the bar keeps its markup, glyph register, and fixed slots. Three surfaces wanted a slot and none of them got one:

| surface | where it went | why that is what it actually is |
|---|---|---|
| Content | a segment inside Drafts | it is a second queue of the same job ("what needs me"), not a seventh destination. Folding it costs zero slots and puts the two things waiting on Ivan one tap apart. |
| Settings | shell-bar gear | opened to flip push/chime/theme. It is a shell control, not a daily job — and it is now reachable from *every* surface including an open thread, which the tab bar never was. |
| Chat | ROOM 2 | it is not an alternate view of a queue and not a settings-shaped drill-in. It wants scrollback, streaming, a composer, and inline tool cards. Model 1's FAB was rejected for exactly the reason the audit names (burying a daily surface), so the switch is a persistent, labelled control, not a floating icon. |

**The freed 6th slot is deliberately not refilled.** Five targets at 390px are 20% wider than six, and refilling it would restate the demote-something-each-time problem the audit found in cand-a.

**Chat's desktop question, decided:** chat is dockable, not permanently side-by-side. Default on desktop is **focus** (a centred 820px reading measure — a conversation is a workspace, not an ambient panel, and a 1400px line length is unreadable). One tap gives **dock**: 440px right pane with the app live beside it. That directly removes the failure mode the audit names for Model 3 — "mid-conversation about a draft, wants to glance at the draft" — on the viewport that has the width for it, while mobile keeps the honest takeover. It is free because `useChat` lives at the shell: dock/focus/takeover are pure layout, no state moves.

## 3. The 4×-duplicated desktop/mobile fork

Collapsed to **one pure function + one component**, and the function is unit-tested:

- `src/lib/shellLayout.ts` — `paneFor(tab, seg, {desktop, hasThread}) → 'split' | 'full' | 'takeover'`, `detailEmptyFor(tab, seg)`, `chatLayoutFor(...)`, `appVisible(...)`. 26 tests in `shellLayout.test.ts`.
- `src/exp/v2a/AppFrame.tsx` — the only place `.app / .app.dt / .dt-list / .dt-detail / .dt-full` markup exists in this candidate.

A surface now *declares* what it wants and never writes `desktop ? … : …` again. Two consequences fell out for free:
- `detailEmptyFor` is where defect **A1** dies: a pane that cannot hold a conversation cannot be handed conversation copy, because the copy comes from the same switch that decides the pane exists. Drafts' pane says "Pick a draft to edit it here"; Settings has no pane at all.
- The content board being full-width *inside* a split-shaped tab is one row of that switch (`drafts + content → full`), not a second layout axis bolted onto the first (which is what cand-c had to do).

I did **not** retrofit `App.tsx` or the other three candidate shells onto it — that is the winner-apply step's job, and doing it mid-tournament would have changed screens the panel is comparing.

## 4. Content grouping: lifecycle is primary

**Primary render = `groupByStage` (lifecycle).** Reasons, in order of weight:

1. It is what Ivan asked for in his own words after a round on the triage board — quoted verbatim in the code at `content.ts:270` ("pretty shitty the way stages are… separate on our end on ideas, review, approved"). A dated operator preference outranks an inference.
2. A *pipeline* surface's job is "show me the whole flow", not "show me what is on fire". `error` and `stuck` are lifted out into one alert strip above the board (`ALERT_STAGES`), because an error is not a step on the way to publishing.
3. `groupByStage` keeps an approved-without-a-date row inside `approved` instead of vanishing it into a separate bucket, with `countUndated()` surfacing the same black hole as a sub-line ("N approved without a date — on no calendar anywhere").

**`bucketDrafts` (triage) is not deleted and not rendered as a competing board.** It keeps the job it already has: the review count on the `Content pipeline · N` segment label, and the D6/D7 actionability rule. The two groupings never render as the default view of the same screen — the audit's one condition for them coexisting.

The board's own composition: a **pipeline meter** (two stats + one stacked bar scaled to the stages still *moving*, because 109 published against 13 in flight would leave the whole pipeline as a 2px sliver — a true number and a useless picture), a legend that jumps to a stage, then stage sections using one section-header primitive (dot · title · count · rule · chevron, modelled on Today's `.td-zh`, the strongest of the four header patterns the audit found). Cards expand **in place** rather than pushing a detail screen — the board is the detail, which keeps one layout at both viewports and keeps the expanded row's three states (loading / deleted / unreadable) separate.

## 5. Measured gate numbers

Against the corrected gate list in `CALIBRATION.md` (the withdrawn `words/1000px ≤ 140` and `primary number ≥ 40px` are reported, not chased — I explicitly reverted a 40px hero-number change once the calibration landed, and left `src/styles.css`'s type scale intact).

| surface | 390 overflow | console errors | words/1000px (390) | prose % | max number px | encodings |
|---|---|---|---|---|---|---|
| today | false | 0 | 272.8 | 74.5 | 19 | 5 |
| inbox | false | 0 | 247.0 | 60.4 | 14 | 2 |
| thread | false | 0 | 178.4 | **86.2** | — | 1 |
| drafts (DM) | false | 0 | 49.3 | 0 | 12 | 1 |
| **content** | false | 0 | 134.3 | 56.4 | 30 | 22 |
| sends | false | 0 | 139.2 | 20.8 | 28 | 75 |
| ops | false | 0 | 46.9 | 0 | — | 1 |
| settings | false | 0 | 88.0 | 49.3 | — | 0 (75 words, exempt) |
| **chat** (empty) | false | 0 | 95.1 | 34.6 | 26 | 6 |
| **chat** (live turn) | false | 0 | 156.1 | 42.9 | — | 3 |
| chat (hands-free) | false | 0 | 139.7 | 23.5 | 26 | 9 |
| chat dock (desktop) | n/a | 0 | 279.7 | 56.9 | 15 | 4 |

- **Gate 1 — zero horizontal overflow at 390px: PASS on every surface** (`scrollWidth === clientWidth === 390`, 23/23 shots).
- **Gate 2 — zero console errors: PASS, 0 across all 23 shots.**
- **Gate 3 — content-bearing surface carries ≥1 visual encoding: PASS.** Every surface over 100 words encodes something. Two surfaces needed work to earn this honestly rather than by decoration: the thread header got a "does this need me" dot (accent = draft ready, amber = you already replied), and a completed chat turn got an outcome dot plus a latency bar against a 10s scale.
- **Gate 4 — prose ≤80%: 11 of 12 PASS, one measured FAIL: `thread/mobile` at 86.2%.** Not gate-chased, and here is the honest reading: a two-person message transcript is prose by construction. The same instrument reads the same screen at 64.8% on desktop (the list beside it is not prose) and reads the chat room — the same genre, my composition — at 42.9%, because it carries tool cards and structure. `CALIBRATION.md` already treats the app's other message-text surface (inbox at 86.7%) as a true positive that is flagged, not gated; this is the same class. **What I did fix on inbox is real:** windowing the list took it from 49,587 words / 83,451px / 88.6% prose to **797 words / 3,227px / 60.4% prose**.
- **Gate 5 — stat-tile surfaces ≥26px: PASS** where stat tiles exist (sends 28, content 30 mobile / 34 desktop, chat scope 26). Surfaces with no stat tiles (thread, ops-empty, settings) report 0 by definition.
- **Gate 6 — three visibly distinct data states: PASS on every data surface.** `useInbox`, `useOps` and `useContent` all carry `error` + `checkedAt`; loading is the existing skeleton family, genuinely-empty is a designed pane with a freshness line ("checked just now", amber past 5 min), fetch-failed is a red band with a Retry that names the failure and says *"Nothing here is current — this is not an empty queue."* The content board additionally separates "filter ate every row" (`laneTotal > 0 && matched === 0`) from a real zero, and an expanded card separates deleted from unreadable.
- `npm run build` clean, `npm test` **263 passed / 17 files** (75 new), `npm run lint` clean (4 pre-existing warnings, none in new code).

Reported, not gated: `words/1000px` is highest on Today (272.8) — unchanged from the baseline's 277, since Today's composition is untouched.

## 6. Traps respected

- `useInbox`'s hardcoded `supabase.channel('inbox')` was **namespaced with `useId()` before** this shell mounts a second content hook beside it (U5). This candidate mounts `useContent` twice (board + segment count), which is only safe because every mount namespaces its topic.
- Content reads go through `laneFilter()` — Ivan's rows are `client_id IS NULL`, never `.eq('client_id','ivan')`.
- No write beyond `approveDraft` / `skipDraft` (status only). No schedule, publish, or delete affordance anywhere in Content. Resources untouched (read-only on purpose).
- Chat is **mock transport only**: no Railway call, no edge function, no new Supabase function, no `sendChat`, and emphatically no WhatsApp-spoof fallback. `setChatTransport()` is the single swap Phase 3 makes.
- `dashboard_action` untouched; no wrapper takes a table or field.
- No new npm dependency (deps are still exactly `react`, `react-dom`, `@supabase/supabase-js`). No markdown library, no sanitizer (nothing is ever parsed as HTML, so there is nothing to sanitize), no highlighter, no animation library, no virtualization library.
- Motion: +2 keyframes, both named and justified (`v2a-caret` = text is still arriving; `v2a-room` = the one moment the shell changes what it is). The mic-level pulse and the hands-free meter are per-frame inline styles, not keyframes.
- **No monospace anywhere.** The chat-port spec proposed a scoped exception for code blocks; the CONTRACT locks the house rule, and the contract wins. Code blocks buy their alignment from `white-space:pre` + `font-variant-numeric:tabular-nums` inside a tinted surface, which is what a mono face was actually providing.
- Radii: 6 card radii → 3 tokens (`--r-sm/md/lg`), 3 pill radii → 2 (`--r-pill` + capsule). No 7th added.
- Severity stays 3-tier. The pipeline bar is a single accent *opacity* ramp precisely so amber and red keep meaning "attention" and "urgent" instead of becoming stage colours.

## 7. Defects fixed (beyond the three required)

| id | what | where |
|---|---|---|
| A1 | ghost "Select a conversation" on Drafts/Settings desktop | `lib/shellLayout.ts` + `App.tsx` (real app too) |
| A2 | `% of cap` pill clipped at 390px | `styles.css` — own line inside a hero tile, wrap allowed, plus `.ov-tile{overflow:hidden}` so no tile can push the document sideways |
| A3 | 6 card radii + 3 pill radii | radius tokens, outliers remapped |
| U2/U3 | swallowed fetch errors on Inbox/Drafts/Ops | `useInbox`, `useOps` (+`useContent.checkedAt`), `components/DataState.tsx`, `lib/dataState.ts` (+13 tests) |
| U5 | `useInbox` hardcoded realtime topic | `useInbox.ts` |
| U6 (render half) | 1,354 rows in the DOM at once | 40-row window + "load 40 more" (reuses Today's `.td-more`), snippet clipped to 72 chars — a row paints ~45 |
| audit §4 | no freshness signal on an empty queue | `EmptyPane`'s "checked just now", amber past 5 min |
| audit §7.10 | desktop width as margin | empty DM pane cross-links to the content queue when the DM queue is clear and posts are waiting |

## 8. What I deliberately did NOT do

- **No real broker, no edge function, no voice capture.** Phase 3's job. The transport is one module and one setter; the voice hook's timers are the only mocked part of the state machine.
- **U6's network half.** I windowed the render, but `fetchMessages` still pages up to 20k rows on every realtime event and focus. Debounce + incremental cursor is a data-layer change that would have landed under three other candidates' feet.
- **U1, U4, U9, U12.** Approve still doesn't check `send_blocked_reason`; freehand compose still has no confirm; no auto-advance after approving from a thread; governor math still computed twice. All four are real and none is a structure or composition question — fixing them would have made the panel compare bugfixes instead of IA.
- **Did not retrofit `App.tsx`/cand-a/b/c onto `AppFrame`.** The extraction exists and is tested; applying it to the other four call sites belongs to winner-apply.
- **Did not rebuild the content data layer, `TabBar`'s markup, `SendsScreen`, `TodayScreen`, `OpsScreen`, `SettingsScreen` or `ThreadScreen`'s composition.** Today's desktop column imbalance (audit §7.6) and the ragged Sends hero row (§7.9) are untouched — both are single-screen polish on screens my direction does not restructure.
- **Did not chase the two withdrawn density gates**, and reverted the one change I had already made for them (hero numerals back to the app's 30/38px scale).
- **Did not delete `#exp/c`.** Still routable, still eliminated; noted in phase0's open items as winner-apply's cleanup.
