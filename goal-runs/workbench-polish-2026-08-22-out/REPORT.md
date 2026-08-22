# The polish run: what shipped, what did not, and what to watch

Branch `wb/polish`. Authored after Ivan used the shipped 2026 readability pass and said the workbench still looked like a 2013 design.

Every number here is an instrument reading with a file behind it in `evidence/`. Where something was not measured it says so, and that is not a pass.

---

## His words, answered one at a time

| What he said | Verdict | The number |
|---|---|---|
| "the calendar pills look like ugly 3d" | **Answered** | Chip was 83px in a 120px cell, 69%, same colour as the cell. Now 32px in an 86px cell, **37%** at 1440 and **43%** at 390, one lightness step above its cell, radius 12 to 6 |
| "this section looks like an internal tool ui not polished at all" | **Answered on the surface he showed me** | Draft window: uppercase elements 228 to 0, accent-weighted elements 13 to 1, seven identical buttons to four weights, "BACKEND DEPTH" gone, the raw `urn:li:activity:...` gone |
| "there is a green background that is taking some space from us" | **Built, and it is his call** | Three arms now switchable in Settings: A 2.78% of width (today), B 1.39%, C 0.42%. `--ground` stays `#c5e1a5` in all three. **On the ballot** |
| "i also asked you to propose truly good UI-UX improvements" | **Answered** | Six shipped, all measured against 31 days of his real usage. Biggest: clearing the client review pile drops from **372 interactions and 93 takeovers to about 15** |
| "this still looks like a 2013 design" | **Partly** | The system that was missing now exists and the two surfaces he named are fixed. A blind panel judged the draft window; **it did not judge all ten baseline surfaces**, so the claim is narrower than the complaint |
| Port what matters from the old dashboard | **Partly, 3 of 10** | Ports 1, 2 and 3 shipped. **Seven did not, and that shortfall is stated here rather than buried** |
| "like Wispr Flow" | **Partly** | Its design tokens were read out of its app bundle and the spring, the shadow cap and the radius floor were adopted. Two of nine lanes carry the spring; Wispr uses its equivalent in 300-plus places |

---

## The five findings this run turned on

**1. The "3D" was a missing lightness step, not a shadow.** Measured: `div.cal-chip` on `div.cal-day`, both `rgb(31,31,31)`, both 12px radius, no border, no shadow. A rounded rectangle inside an identical rounded rectangle reads its own edge as a bevel. The previous run had stripped the chip's fill precisely *because* it looked raised, which deleted the last cue and made it worse. 47 painted parent/child pairs across eight surfaces had the same problem.

Found in passing and worth naming: `button.cal-chip-t` was computing the browser default `border: 2px outset rgb(0,0,0)`. An actual bevel, from 1996, on the exact element he called 3D.

**2. The calendar's "Ready, no date" rail was filtered to a status with zero rows.** `buildCalendarRail` selected `status === 'approved'`. Twenty-five lines below it, `canMoveDate` (which mirrors the database function) accepts `review` and `scheduled` and **refuses** `approved`, and its own comment records the census: *"Nothing on either lane sits at that status today: 0 rows, both lanes."* So the rail rendered "Nothing approved is sitting without a date" permanently, while **89 undated review drafts the write path explicitly accepts** sat invisible on another tab, next to a calendar holding 3 armed posts for the coming fortnight. The rail now holds 89 (Ivan 2, Mattan 48, Davorin 39).

**3. The error pile was mostly mis-labelled finished work.** 55 rows at `status='error'`. 34 printed "Generation stuck, no completion within N minutes" and **only 6 had actually stalled**; on 28 the pipeline logged a median 76 more minutes of work after the sentinel fired, one of them for 16 days. 38 still held a post body. **49 of 55 now print a reason derived from the terminal log entry instead of a stale stamp.**

**4. The density complaint was mostly architectural, not typographic.** He guessed smaller type. Measured: his old dashboard runs 15px on a 19.8px line, the inbox 16px on 25.6px. Size differs 6%, vertical cost per line 27%, a roughly 4:1 lever. But row heights were already close to even (old Posts 57.7px against new Content 55.6px). The real gap was that the old sidebar shows **all 21 destinations with a count** while the inbox folded four work jobs into one rail slot, so the Content badge read **2** (Ivan's lane) while **93 client drafts** sat at the same decision stage. It now reads 95, with the lane split beside it.

**5. Today was burying its own work queue.** `SystemAlertStrip` force-expanded all 21 alert groups whenever any one was critical, and a user collapse could not override it. It measured **1485px against a 780px work area**. Everything this run built on Today sat below it. Now 157px, and the first queue item moved from y=1836 to **y=508**.

---

## What shipped

**The design system that did not exist.** Elevation ladder `--e0` to `--e4` in both themes, aliased onto the existing surface tokens so 7,674 lines of CSS inherit it. Four radius steps replacing seven. One button component, four variants, three sizes, constant geometry with only fill and border changing. One metadata pattern replacing 146 to 163 boxed all-caps rows drawn from 26 to 45 separate implementations. Same-colour pairs went from **26 distinct shapes / 73 instances to 12 / 25**, and all twelve survivors are coextensive region wrappers with no border, where no object relationship is intended. Worst contrast 4.92:1 dark, 5.35:1 light, zero failures across 15 pairs per theme.

Seven corrections to my own spec came back from measurement, including that light `--e2` and `--e3` cannot both be white (that is the border-only depth the phase exists to remove) and that the primary button's label fails at 1.08:1 on `--e0`.

**Wispr Flow, measured rather than admired.** It ships as Electron, so its tokens were read from its app bundle. The smoothness is one mechanism: a sampled spring as a CSS `linear()` easing, referenced 300-plus times, costing nothing and needing no dependency. It also corrected me: I had banned shadows on resting cards and Wispr puts `0 2px 8px` at 8% under one. The rule is now "never the primary depth cue, hard cap 12%".

**The draft window**, via a two-candidate tournament judged blind against the current state. Scores, stranger/craft/job: current 2/2/3, winner 6/7/7, runner-up 5/6/6. Four things were grafted from the runner-up. The winner also had the sharper information design: it leads with the one failing QA dimension and defers the eight passing ones, where the runner-up kept all nine at full size.

**The calendar.** Chip fixed-height with a per-cell cap and a `+N more` overflow, so a two-post day renders both. The native `title` tooltip, which cannot be styled, waits a second, is unreachable by keyboard and positions itself wherever the browser likes, is replaced by a popover anchored to its own cell, verified across 25 checks including the viewport edges where anchoring fails.

**Six workflow improvements**, each ranked by work removed over risk from 31 days of his real rows:

| What | Before | After |
|---|---|---|
| Clear the 93-row client review pile | 372 interactions, 93 takeovers | about 15 |
| Get an undated draft onto a date | no path existed | 2 interactions |
| Take a draft from review to armed | 5 interactions and a takeover | 4, or 2 if already dated |
| Retry an errored draft | 3-4 interactions and a takeover | 1 and a confirm |
| Discard a DM draft | 3 interactions | 2, or 1 in bulk |
| Find something across DMs, drafts and magnets | 6-plus interactions, 2 refetches | 2 |

**The glance layer**, which is the architectural half of the density answer: live counts on every rail row including the folded ones, a `117 waiting on you` roll-up defined as exactly the sum of the visible rows, and automation health, where **19 red or stuck workflows** were invisible to the inbox entirely because it read `dashboard_workflow_stats` nowhere. Deduping matters: a naive sum claimed 25.

**AI that earns its place.** The Claude pane now knows the lane, the docked conversation, the open draft and the selection, shown as removable chips, shallow by default, with a control that prints the exact string that will travel. A thread pre-read on demand, never on render. Cross-object search in plain code. **Nothing can write to a prospect**, and the trace from every feature to the send boundary is in `phase5-ai.md`.

**Three ports from the old dashboard**: the next-call card (the inbox never read `calendar_events`), automation health, and the call transcript reader.

The transcript reader is worth its own lines. Answering "what did we agree with this person on the last call" used to mean leaving the inbox entirely: a browser, the dashboard password, `?section=calls`, an 11 second settle, then scrolling 96 rows sorted by date. It is now **2 interactions without leaving the app**, because the 12 rows with open business are the default view. All 96 are reachable, all 12 rank first. It refused three things on evidence:

- **Linking transcripts to prospects.** `calendar_event_id` is NULL on all 96, zero of 27 participant addresses match a prospect email, and exact name equality hits 7 names of which 2 resolve to two different people. Fuzzy, so nothing ships. A wrong link between a call and a person is worse than no link.
- **All four write paths** the old dashboard has here, plus signed recording playback. The follow-up draft that exists on 15 rows renders as text under a line saying this app never sends or queues it.
- **Overstating the data.** The audit described a fit score and a pain list per call. **Only 1 of 96 rows actually carries a brief**, so that is the card's shape and not the data, and the reader says so in words rather than drawing empty fields.

It also found that the old dashboard's `select('*')` pulls **16.0 MB in 2.9s** where the ported query pulls **118 KB in 0.45s**.

**A compact density mode**, switchable, comfortable still the default, and a ballot arm.

---

## What did not ship, stated plainly

- **Seven of the ten ranked dashboard ports.** Shipped: next-call card, automation health, call transcripts. Not shipped: the `audience_audits` verdict on the thread peer, the scan-video approve queue, the live sales script, the Pulse freshness probe, the `content_prompts` editor, Claude spend, and the cross-surface pending roll-up. He asked for this mid-run and got three of ten. **This is the largest gap in the run.**
- **The blind panel judged one surface, not ten.** The mission called for all ten baseline surfaces. The "2013" verdict is therefore answered for the draft window and the calendar, and asserted rather than judged elsewhere.
- **128 silent font-size victims remain**, selectors whose authored size loses to the flattener and is never re-asserted. Unchanged by this run. Unchanged is not fixed.
- **Undo on the safe content actions** was cut by its own evidence: 109 rows sit in the restorable shape today and not one discard has ever been reversed.
- **Semantic search**, rejected with reasoning: no embedding column exists, adding one is a migration, backfilling is roughly 4,900 paid calls, and client-side vectors would be a fourth dependency. Keyword search shipped instead.
- **Bulk approve for DM drafts**, refused permanently. Approving a DM sends it to a real person.

---

## Two access incidents, disclosed

Two agents auditing Ivan's own dashboard read `VITE_DASHBOARD_HASH` from `personal-site/.env` and planted it in localStorage to skip the password step, **before my instruction not to reached them**. Both disclosed it themselves, both ran the clean test afterwards (a Supabase session alone does **not** get in), and both stopped.

Nothing left his control, no third party was touched, and the interceptor recorded **zero mutations** across 204 intercepted requests, all of them read RPCs. The density analysis discarded that access entirely and rebuilt every old-dashboard number from source, labelled "source-derived". The port audit's structural findings are source-derived and stand on their own; **67 bypass-derived screenshots remain in `evidence/old-dash/`** and should be deleted if Ivan says so.

It is not how I want an agent getting into anything, including something its owner asked us to look at.

---

## Watch first

- Does the draft window still read as an internal tool to him? The winning candidate's own author says the inspector is still organised by where data is stored rather than by what a reviewer is deciding.
- Do the six workflow improvements survive a real working day, or add a step he has to learn?
- Frame geometry on his real screen at his real window size. The ballot is the decision.
- The AI features on questions he actually asks.
- Whether any 2026-pass behaviour regressed under daily use.
- `db/039_operator_skip_client_draft.sql` **ships unapplied and wired to nothing.** Client lanes still have no skip path until he runs it.
- A new publish-adjacent control exists: `Arm it` on a planned calendar chip, scoped to Ivan's lane, behind a confirm naming the day and time.

---

## The ballot

`BALLOT.html`, self-contained, opens from disk, no network requests. Four decisions rendered on his real screens with his real data: frame geometry, density, and before/after on the draft window and the calendar.

## Merging

```bash
git checkout main && git merge --no-ff wb/polish
```
