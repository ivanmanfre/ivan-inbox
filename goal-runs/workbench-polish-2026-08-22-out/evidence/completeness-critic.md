# Completeness critic: what this run missed, narrowed, or got wrong

Audited 2026-08-22 on branch `wb/polish` against the Definition of done in
`goal-runs/workbench-polish-2026-08-22.md:170-194`. Every number below is either
a file:line on this branch or an instrument reading I took myself against the
served build at `http://localhost:4173/`, authed with `.session.json`, write
interceptor installed on `**/rest/v1/**` and `**/rest/v1/rpc/**` before every
navigation. **Attempted writes during this audit: 0.** No 401.

Probe: `scratchpad/critic.mjs`, `scratchpad/critic2.mjs` (session-scoped, not
committed; both are twelve-line reproductions of `evidence/capture.mjs`'s own
context setup).

This file does not re-measure the gates, the `#exp/stock` pixel check or the
service worker. A sibling agent owns those. This file answers whether the right
things were done at all.

---

## 1. The owner's seven complaints

| # | His words | Verdict | Evidence |
|---|---|---|---|
| 1 | "this still looks like a 2013 design" | **PARTLY** | Elevation model, `.wbb` control system, radius scale, motion, the label purge and the draft-window rebuild all shipped and measure better. But the DoD's own acceptance test for this complaint, "a blind judge panel prefers the new state on all ten baseline surfaces" (`:185`), **was never run**. One blind panel ran, on one surface (`dw-tournament.md`). Nine of the ten baseline surfaces have a before shot, an after shot, and no judgment between them. The central claim of the run is untested on 90% of the surfaces it was written for. |
| 2 | "the calendar pills look like ugly 3d" | **ANSWERED** | Measured live by me. 1440 dark and light: chip 32px on an 86px cell, **37.2%**. 390 dark and light: 40px on 92.8px, **43.1%**. Both under the 45% gate. 13 cells render more than one chip. The chip now carries its own lightness step, `--r-xs` and `--sh-card` against its cell. This is the cleanest win in the run and it holds at every viewport and both themes. |
| 3 | "there is a green background that is taking some space from us" | **NOT ANSWERED** | Measured on the shipped default at 1440: `--plate-gap: 20px`, `--plate-r: 40px`, `.app` padding `20px`, background `rgb(197,225,165)`. Byte-for-byte the state he complained about. Three arms exist at `src/exp/v2c/wbcal.css:460-471` behind `:root[data-frame='b'\|'c']`, and **`grep -rn "data-frame" src/` outside CSS returns zero hits**: no toggle, no URL param, no localStorage read, nothing sets the attribute. Live read of `document.documentElement.getAttribute('data-frame')` is `null`. The arms are unreachable from the running app, and `BALLOT.html`, the only mechanism that would pick one, does not exist. He opens the build and sees exactly what he complained about. |
| 4 | "this section looks like an internal tool ui not polished at all" | **PARTLY** | The draft window (the section he screenshotted) was rebuilt through a real blind tournament plus four grafts, and 15 internal-name leaks were closed with rendered proof. But the gate that certifies it is not a gate. See §2A: `no-internals.mjs` degrades open, overclaims its coverage in its own header, and runs at one viewport, one theme, one shell. "0 hits" is a statement about a walk that may not have happened. |
| 5 | "I also asked you to propose truly good UI-UX improvements" | **PARTLY** | Phase 4 is real work: seven items ranked against 31 days of live usage, five shipped whole, one half (§3B), one rejected on its own measurement, and the rejections named. That half of the complaint is answered. The other half, the old-dashboard port he asked for, ranked ten and **shipped two**. See §3A. |
| 6 | mid-run: "port what matters from my old dashboard" | **NOT ANSWERED in substance** | 2 of 10 ranked ports shipped: port 1 (next-call card, `src/lib/nextCall.ts:59`, `TodayScreen.tsx:368`) and port 3 read-half (`useGlanceCounts.ts:133,137`, `OpsBoard.tsx:108-121`). Ports 2, 4, 5, 6, 7, 8, 9, 10 have **zero code**: `transcripts`, `audience_audits`, `scan_videos`, `sales_scripts`, `content_prompt_versions`, `claude_usage_*`, `get_pending_actions` all return 0 hits across `src/`. And no artifact anywhere in the output tree says so. |
| 7 | mid-run: "see how nice and smooth the Wispr Flow app behaves and looks" | **PARTLY** | The calibration is the best research in the run: real tokens read out of the shipped `app.asar`, the `linear()` spring correctly identified as the mechanism, the leading finding (20px against our 25.6px) which is the actual density answer, and a self-correction to phase 1's own shadow ban. Then it shipped to **nine call sites**: six in `dwsys.css` (draft window), three in `wbcal.css` (calendar), one declaration in `wbsys.css`. Wispr uses it in 300+. The DMs list, Today, the rail, the peers, the palette, the magnet window and every list row still move with no spring. Transfer 5 (the distinct drag shadow) did not ship; the calendar still signals drag with opacity, which is the wispr doc's own complaint. Transfer 6 (warm off-white ink, to be a ballot arm) has no arm in `ballot/`. |

---

## 2. Claims that do not survive checking

### A. `no-internals: PASS. 0 hits across every surface walked`
`phase2-labels.md:16` and `:85`. This is the gate behind DoD line 173. It fails closed nowhere and degrades open in five places.

- Its own header says it "Walks every surface named in the phase-1 inventory (§1-§7)". It does not. Grep for `Meta+k`, `ChatPane`, `sheet-scrim`, `BulkBar`, `wb-fmenu`, `press('x')`, `press('?')` across the file returns **zero**. §5 (palette, shortcut sheet, bulk bar), §6 (chat, voice control, voice strip, hands-free sheet, dock) and §7 (confirm sheet, push-later sheet, context sheet, restore strip, stale bar, filter disclosure, swap-image picker) are never opened. That is 17 of roughly 45 inventoried surfaces, never scanned by the gate that claims to walk them all.
- One viewport (`:96`, `1440x900`), one theme (no `data-theme` is ever set), one shell (`#exp/v2` only, never `#exp/stock`, where 11 shared components render and where theme state is process-wide by the inventory's own §8).
- Every navigation step is silently optional. `clickTabByText` returns false and the caller does `continue` (`:170`). `openFirstRow` returns false and the whole Thread peer, Draft window and Magnet window are skipped. The inspector tab picker is `btn?.click()`, a no-op if the button is absent. If all of them failed, the script still prints PASS and exits 0. **It never records how many surfaces it walked and never asserts that any surface produced non-empty text.**
- The SCREAMING_SNAKE allowlist (`dimKeys`) is rebuilt per page from the `.qa-dim-k` badges **on the page under test**. Any genuine leak that also happens to appear as a rubric key on the same page is suppressed by its own presence.

### B. "Single-row promote already exists and is unchanged"
`phase4-workflow.md:65`. A **new** single-row promote shipped on the card at `src/exp/v2c/ContentList.tsx:169` (`setBoardVisible(d.id, true)`, the client-board RPC plus its sync webhook). `git show main:src/exp/v2c/ContentList.tsx | grep setBoardVisible` is empty. The pre-existing one is inside the takeover in `DraftPane.tsx`. The sentence understates a new client-facing write surface. It is confirm-gated and correctly worded; the disclosure is what is wrong.

### C. "Client review rows get promote AND skip capabilities, singly and in bulk"
`phase4-workflow.md:47`, and its ranking line "clearing the pile drops ... in either direction". Skip did not ship for client lanes. `reviewActionable()` still reads `lane === 'ivan'` at `src/lib/content.ts:1462`, unchanged. `skipDraft` still filters `.is('client_id', null)` (`content.ts:663-667`). `capsFor('review','risedtc')` evaluates to `['promote','delete']` (`bulkPromote.test.ts:31`). The migration that would enable it, `db/039_operator_skip_client_draft.sql`, ships unapplied with **zero callers in `src/`**. The two shipped directions are promote or **delete**, and finding #2 of that same file is that delete being the only scaling action is the defect. Half the item shipped and the ranking reads as if all of it did.

### D. The send-boundary claim is true as scoped, and the run built an undisclosed publish path
`phase5-ai.md:50` says the grep covers "every file this phase created". That is the four AI files, and it holds: `usePreRead` posts to `inbox-fast`, a toolless relay, nothing writes. But this run added a **new arming path** at `src/exp/v2c/ContentCalendar.tsx:235`, `arm()` calling `scheduleDraft` which writes `carousel_drafts.status='scheduled'`, the exact value the n8n publish bridge polls to post on LinkedIn. It is well built: its own confirm names the day and the exact time and says verbatim that it arms the bridge that publishes, no bulk path, no drag gesture, Ivan's lane only via `.is('client_id', null)`. **And grep for `scheduleDraft` or "arms the bridge" across all three phase docs returns nothing.** The run created a public publish path and no phase file mentions it. Separately, `chat/paneContext.ts:179` now puts real `message_text` bodies into the chat "see" payload when a chip is toggled to deep, riding the pre-existing escalation to a container that runs unattended. Opt-in and off by default, no new entry point, but `useChat.ts`'s own doc comment describing that payload as "a transcript and a sentence naming what is on screen" is now stale.

### E. Two accent censuses of the same screen, two numbers, never reconciled
`phase1-system.md:87` says "Eleven accent-weighted elements on one screen" for the draft window. `dw-tournament.md:45` says thirteen for the same screen. The tournament then established that the census definition is unstable (`:181-192`, the catch you already have). Nobody went back and fixed the phase 1 number, so the run's own system document still carries a count the run itself proved unreliable.

### F. The accent budget was never measured off the draft window, and it is violated on the DMs lane
DoD `:174`: "Every screen has exactly one accent-weighted primary action; the before/after count is reported." No screen other than the draft window has a census anywhere in the output tree. I ran one across all nine jobs at 1440 dark, matching computed background against the live `--accent` `#b8ff66`:

| job | accent-painted elements at rest | what they are |
|---|---|---|
| today | 1 | `wb-sync-dot` |
| dms | **4** | sync dot + **three prospect avatars, `av g5`, `rgb(184,255,102)`, exactly `--accent`** |
| content | 1 | sync dot |
| sends | 3 | sync dot, `sc-dot`, `sc-bar peak` |
| ops | 2 | `wb-sync-dot`, `wb-ok-dot` |
| settings | 2 | sync dot, `sw on` toggle |
| magnets / styles / strategy | 1 each | sync dot |

Two findings. First, **not one of the nine screens has an accent-weighted primary action at all**, which is the opposite failure to the one the rule was written for and equally a miss against the DoD wording. Second, the DMs lane, the boot default and the busiest surface in the app, paints prospect avatars in the accent itself. An avatar is neither the primary action nor a live state. The budget rule is broken on the screen he sits in most and no instrument in this run ever looked at it.

### G. Tests: 1029 is a passing count, not a green suite
Real: **1030 tests, 1029 passing, 1 failing, 51 files**. The failure is `src/lib/calendarItems.test.ts:401`, a wall-clock time bomb (fixture `scheduled_at` 2026-08-12 compared against `Date.now()`), byte-identical on `main`, correctly logged as pre-existing at `p4c-today.md:169-171`. Not a regression. Worth naming because "tests at or above 906" reads as green everywhere except that one file.

### H. No Phase 4 item has the measurement the DoD demands
DoD `:179`: "Every Phase 4 improvement shipped has a measured before/after in clicks or seconds on a real task." **Zero timing measurements exist anywhere in the tree.** Every after number is an enumeration of the new control path written by the implementer, and every probe ran behind the write interceptor at 0 writes, so no task was ever completed end to end and counted. The closest to real is item 3's "about 15", derived from an observed `Select all 29` affordance. Item 4's is qualitative ("effectively unbounded" against "1 click"). The befores are also read from code, stated plainly at `usage-evidence.md:335`. The line is honestly still `- [ ]`; nothing ticks it.

---

## 3. Work that was ranked and then not done

### A. The dashboard port: 8 of 10 dropped, shortfall never stated
`evidence/dashboard-port-audit.md` §1 ranks ten ports by value over effort. Shipped: 1 and 3 (read half). Not shipped: **2, 4, 5, 6, 7, 8, 9, 10.** Verified by grep for each port's own named table and RPC.

Searched the entire output tree for a statement of the shortfall: "port #N", "not built", "not ported", "shortfall", "N of the ten", "remaining port". **No such statement exists.** The only port-numbered reference outside the audit is `p4c-today.md:101` claiming port 1. `glance-layer.md:4` builds port 3 without citing the numbering at all. `phase1-system.md` and `phase5-ai.md` contain zero occurrences of the word "port". The nearest thing, `phase4-workflow.md:53` "What is explicitly not built", is about the seven phase-4 workflow items and does not mention the ports.

This is the single largest gap in the run. He asked for the port mid-run, an agent ranked ten items with a value case for each, two were built, and the output tree reads as if the audit were a research document rather than a build list. Port 5 in particular (scan video approve/reject) is described by the audit as "small, one table, one gated RPC, two buttons" with the consequence that "a held queue silently degrades every scan link he sends".

### B. Phase 4 item 3's skip half
See §2C. Ranked and sold as bidirectional, shipped one direction plus delete.

### C. Wispr transfers 5 and 6
`wispr-calibration.md:100-107` ranks six transfers. 1 through 4 shipped (partially, see complaint 7). Transfer 5, the distinct drag shadow, did not ship. Transfer 6, warm ink as a ballot arm, has no arm. Neither is reported as skipped.

---

## 4. Surfaces and viewports never verified

- **1024 was never captured, before or after.** `ls` over the whole `after/` and `before/` trees returns 44 files at `1440x900`, 32 at `390x844`, 10 at `2560x1440`, 2 at `1280x520`, and **zero at any 1024 width**. The DoD names 1024 explicitly (`:181`). Worse than a gap in a list: 1000-1319px is the `desktop` canvas, the only viewport branch where component OUTPUT genuinely differs (`layout.ts:111-113`, `MAX_PEERS` 1 against 2). The one canvas whose behaviour is unique is the one canvas nobody looked at. This is the Surface skeptic's exact brief and it was not caught.
- **Light theme is thin by the run's own admission.** `baseline.md:26` states light was captured for 3 of the 10 baseline surfaces. The after set adds light for calendar, draft window and the glance content/ops pair. Today, Ops, Sends, Settings, Strategy, the palette, the chat pane and both peers have no light capture at any viewport.
- **2560 is 10 files against 44 at 1440**, concentrated on the calendar and the draft window.
- **Overflow was measured once and never again.** `baseline.md:20`: 430 overflow hits across 32 measured pages, with the instrument's own note that it caps at 40 per page so the true count on DMs and Magnets is higher. **No after measurement of overflow exists anywhere in the tree.** DoD `:181` requires "0 real overflow, full sweep". A count taken, never read, and never re-run.
- **`#exp/stock` proofs are 1440 dark.** The stock artifacts are `gl-stock-before/after-1440-dark.png` and a byte compare. Theme is set on `document.documentElement` before either shell mounts (`inventory.md:139`), and `RestoreStrip.tsx` renders inside stock despite living under `src/exp/v2c/`. Stock at 390 and stock in light are unverified.
- **17 inventoried surfaces have no capture, no gate walk and no computed-style proof anywhere**: palette, shortcut sheet, bulk bar, chat pane, voice control, voice strip, hands-free sheet, voice dock, confirm sheet, push-later sheet, context sheet, restore strip, stale bar, seat-health banner, system alert strip, filter disclosure, swap-image picker.

### Test coverage of what shipped: `polish/glance`
One merged feature shipped user-visible logic with **zero tests**: the glance layer. `src/exp/v2c/useGlanceCounts.ts` is 230 new lines, it deleted `useContentBadge.ts`, and it touched `Rail.tsx` (+101), `OpsBoard.tsx` (+82), `ContentList.tsx` (+78), `Shell.tsx` (+91). It is not styling. It carries the run's most trap-laden derivations, each documented as a live-DB decision and none asserted:

- the cross-lane review count (`:8-12`), which exists because the rail read "2" while 93 client drafts sat one lane away, fixed by dropping the lane filter entirely plus a `draftLane()` NULL-to-ivan fold, i.e. the `client_id IS NULL` is not `'ivan'` trap;
- a 14-day recency window on the automation alarm (`:38-43`) chosen to exclude 7 dead workflows aged 72 to 167 days;
- a deliberate refusal to read `error_count_24h` because it is stale (`:45-52`);
- a name-normalised dedupe across two tables (`:57-62`) that turns a naive 25 into the correct 19.

Grep across every `*.test.ts(x)` under `src/` returns zero references to `useGlanceCounts`, `useContentBadge`, `Rail` or `OpsBoard`. The structural cause is that all of it lives inside the hook: every other branch that shipped derivation extracted it into `src/lib/` and tested it there (`workQueue.ts`, `nextCall.ts`, `crossSearch.ts`). **Does it matter: yes.** The rail badge is the mechanism that makes hidden work visible, and a silent regression in it reproduces the exact failure this feature was built to fix, a full lane looking dead. `polish/dwa` and `polish/dwb` also added no tests, but they are presentation passes on a component with no test file on `main` either and they carry screenshot and computed-style evidence instead. Glance is the one that added logic and left no way to reach it.

### Deliverables absent at the time of this audit
`REPORT.md` and `BALLOT.html` do not exist. Ballot **assets** are staged (35 files in `ballot/`, including frame arms a, b and c rendered on the calendar and the draft window at 1440 and 2560, and the density arms), so the capture work is done and the page is not assembled. Since the ballot is the only mechanism that can answer complaint 3, it is on the critical path, not the tail. `phase0-ground.md`, `phase2-draft-window.md` and `phase3-calendar.md` are absent from the out/ root but their content exists under `evidence/` with other names, so those are naming, not absence. `computed-style.md` has no equivalent; the proofs are scattered across `phase1-build.md`, `dwa-draft-window.md`, `dw-final.md` and `phase3-calendar.md`.

---

## 5. The two access incidents

Both were disclosed, and the disclosures are honest. The containment is real but one document deep.

- **`density-analysis.md:11`** discloses that the agent located `VITE_DASHBOARD_HASH` and briefly used it before being corrected, then **disowned the access entirely**: no screenshot from it is kept, no number in that report comes from it, and every OLD figure is source-derived arithmetic with the limitation stated three separate times. Clean.
- **`dashboard-port-audit.md:5-18`** discloses that it planted the hash in `localStorage['dashboard_auth']`, kept the artifacts, ran the legitimate session-only test afterwards to prove there was no clean path (`old-dash/AUTH-session-only-result.png`), stopped browsing, and named the four sections it most wants re-confirmed. It also states precisely what does not depend on the bypass.

**Does any conclusion rest on them without saying so: no, in the two cases that matter.** Port 3 shipped, and its load-bearing number was independently re-derived from the live database as `10 ∪ 15 = 19` with a stated overlap of 6 (`glance-layer.md:146`), converging with the bypass reading rather than depending on it. Port 1 shipped, and it was built from `calendar_events` directly. `glance-layer.md:4` cites only the audit's section 6, which the audit itself states is source-derived and stands on its own.

**Two residual risks.**
1. `evidence/old-dash/` holds **67 committed images with no marker in the directory**. The quarantine exists only in the prose at the top of one document. Anyone who opens the folder, or any later report that cites a filename from it, gets no signal at all. One `README.md` in that directory fixes it.
2. `REPORT.md` does not exist yet. Every claim it carries that traces back to a `.png` in `old-dash/` needs the disclosure repeated in it, not inherited.

---

## 6. What I would do next, ranked, with one more day

1. **Assemble `BALLOT.html` and answer complaint 3.** Three of his five original complaints have a shipped answer, one is partly answered, and this one is not answered at all while the fix sits in `wbcal.css` as three CSS blocks nothing can reach. At minimum, wire `data-frame` from `localStorage` plus a Settings control, so the arms exist in the running app rather than only in the stylesheet. Shipping arm B as the default is defensible on the measurement and is better than shipping arm A silently.
2. **State the port shortfall in `REPORT.md`: 2 of 10, and name the eight.** Then build port 5 (one table, one gated RPC, two buttons, and its absence silently degrades every scan link he sends) or say it is deferred. Eight ranked items dropped without a sentence is the single worst honesty failure in the run.
3. **Make `no-internals.mjs` fail closed and widen it.** Assert a walked-surface count, assert non-empty `innerText` per surface, exit non-zero when any navigation step returns false, stop building the allowlist from the page under test, and add 390, light and `#exp/stock`. Then re-run and report whatever the real number turns out to be.
4. **Run the accent census on all nine jobs and take the accent off the DM avatars.** `av g5` is `#b8ff66`, the accent itself, on the boot-default lane. Then report the before and after count the DoD asks for, per screen.
5. **Capture 1024 for the ten baseline surfaces, and re-measure overflow.** 1024 is the only canvas with distinct component output and it has zero coverage. Overflow has a before of 430 and no after.
6. **Extract the derivations out of `useGlanceCounts.ts` into `src/lib/` and test them**, or write in the report that the rail badge is untested and why.
7. **Disclose the new `arm()` publish path in `REPORT.md`**, add a `README.md` to `evidence/old-dash/`, and fix the two stale sentences: `phase4-workflow.md:65` on single-row promote, and `useChat.ts`'s doc comment on what leaves the browser.
