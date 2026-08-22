# P4A - scheduling. What shipped, and what it measured.

Branch `polish/p4a`, worktree `/Users/ivanmanfredi/Desktop/ivan-inbox-pw-a`.
Phase 4 item 1, item 2 (the planned/armed semantics), and the arming half of item 6.

Everything below is a measurement, taken through Ivan's own session against live rows,
GET only. **Writes that reached the database: 0.** See §6.

---

## 1. The defect, and what it cost

`src/lib/calendarItems.ts:421` filtered the rail on `d.status === 'approved' && !d.scheduled_at`.
`canMoveDate`, twenty-five lines below in the same file, is `operator_set_schedule_date`'s status
line verbatim (`status not in ('review','scheduled') -> bad_status`), and its own doc comment
records the census that proves the rail could never hold anything: *"Nothing on either lane sits at
that status today (live census 2026-08-07: 0 rows, both lanes)."*

So the one surface built to give undated posts a date was filtered to a status the database refuses
and that no row carries. It rendered *"Nothing approved is sitting without a date."* forever, while
the 89 undated `review` drafts the RPC does accept sat on a different tab.

`buildCalendarRail` now derives its predicate from `canMoveDate` rather than re-stating a status
list, so the rail and the per-row move control cannot drift apart again.

### Rail counts per lane, live 2026-08-22

Read through the app's own fetch shape: `laneFilter` + `order=updated_at.desc&limit=1000` + the
`operatorDeleted(taxonomy)` filter at `content.ts:319`.

| lane | rows loaded | rail BEFORE (`approved` + undated) | rail AFTER (`canMoveDate` + undated) | of which `review` | of which `scheduled` |
|---|---|---|---|---|---|
| ivan | 255 | **0** | **2** | 2 | 0 |
| risedtc | 151 | **0** | **48** | 48 | 0 |
| arch | 59 | **0** | **39** | 39 | 0 |
| **total** | 465 | **0** | **89** | 89 | 0 |

**One correction to the brief.** The brief says risedtc has 54. 54 is the lane's whole `review`
pile; **6 of them already carry a date**, so 48 reach the rail. Those 6 are the same six that turn
out to be the planned-versus-armed problem in §2, which is why the two numbers have to be separate.
Ivan 2 and arch 39 match the brief exactly. 2 + 48 + 39 = 89, which is the evidence file's own
"content drafts in review with no `scheduled_at`" figure.

Verified in the rendered UI: rail header reads `No date yet 48` on the Mattan lane, `2` on Ivan's.

### Every rail row has a working control

Asserted rather than observed. The rail's predicate **is** `canMoveDate`, and `canMoveDate` is what
decides whether `Give it a date` is drawn, so one function answers both questions and a row cannot
appear without a control. `calendarItems.test.ts` asserts it over the whole status vocabulary on
both lanes rather than over one fixture, and the browser probe counted 48 rows / 48 draggable /
48 move buttons on the Mattan lane and 2 / 2 / 2 on Ivan's.

The `cal-note` block that used to explain the button-less rows is gone with the status it described:
that set is now provably empty. The `r.movable` render guard stays as the cheap belt on the braces.

### Scannability, because the rail holds 48 now and was written for a handful

- **Oldest first**, by `created_at`. It is a backlog (median 7.6d, oldest 35.6d, 56 of 95 review
  rows older than a week). Newest-first is how a 35-day row got to 35 days. Rendered ages, top of
  the Mattan rail: `35d 35d 32d 29d`.
- **Age on every row**, so the ordering is legible rather than implicit.
- **Its own scroll region.** Measured at 1440: 2853px of rail content capped to 558px, and the grid
  keeps its full 830px. Without the cap the rail is a 2853px column beside a 830px grid and the grid
  sits in the top quarter of a page that scrolls past it. Capped against the viewport
  (`min(62vh,760px)`), so a 2560 canvas shows more rows (760px) than a 1440 one, which is the point
  of the canvas.
- **`Give it a date` floated out of flow**, revealed on hover, restored below 767px. In flow it took
  110px of the 264px rail, which was invisible while the rail held zero rows and clipped 48 real
  titles to about fifteen characters. Same trade `.cal-chip-mv` already makes one section up.

---

## 2. A dated review row is PLANNED, not ARMED

The n8n Bridge reads `status='scheduled'` + `scheduled_at`. A row at `review` carrying a
`scheduled_at` is a plan, and nothing fires it.

**Live 2026-08-22, the whole population of dated datable rows in the database:**

| lane | date | status | reads as |
|---|---|---|---|
| risedtc | 2026-08-24 | review | **planned** |
| risedtc | 2026-08-25 | review | **planned** |
| risedtc | 2026-08-26 | review | **planned** |
| risedtc | 2026-08-27 | review | **planned** |
| risedtc | 2026-08-28 | review | **planned** |
| risedtc | 2026-08-31 | review | **planned** |
| risedtc | 2026-09-01 | scheduled | armed |
| risedtc | 2026-09-07 | scheduled | armed |
| ivan | 2026-08-24 | scheduled | armed |

Six of the nine. Before this change all nine drew an identical chip, so six days of a paying
client's forward month read as coverage while nothing was going to go out on any of them. That was
already true; the rail fix is what makes it the central risk, because the rail now hands him 89 more
rows to date.

### What was built

- `armingOf(stage, source)` in `calendarItems.ts`, returning `armed | planned | out`, with
  `ARMING_LABEL` as the one place the words live. `stuck` is **armed and late**, never planned: on
  the draft side it is `status='scheduled'` past its time, on the queue side a failed or past-due
  queue row, and in both cases something *was* meant to fire it.
- **On the chip, in a word.** `Armed` / `Planned` beside the clock, plus `data-arm` alongside the
  existing `data-st`. Colour is the second cue, never the only one.
  `published` deliberately gets no word: at a 112px cell `08:14 Posted` truncates, which is the same
  measurement the existing ✓ marker exists because of, and a chip carrying a tick and a real posted
  time is not the ambiguous one.
- **In the month count, in words.** `N dated this month` counted a plan as coverage. It is now
  `N armed` and `M planned`, both drawn **even at zero** (a hidden `0 armed` beside `6 planned` is
  the same lie), with `posted` and `queue only` appearing when there is one.
- `data-st` is untouched and the chip's visual system is untouched. Phase 3 restyles `data-arm` and
  `.cal-chip-arm` without having to undo any of this.

### The proof, one month containing both

`after/p4a-1440-rise-sep.jpg` - **September 2026, Mattan lane, real rows, nothing written.**
Sep 1 2026 is a Tuesday, so the grid's leading week reaches back to Aug 31, and the two states sit
one cell apart:

- Aug 31 cell: `16:26 PLANNED` (amber), *ROAS vs cash conversion*
- Sep 1 cell: `17:00 ARMED` (green), *Carousel: She Fired The Agency*
- month bar: **`2 armed  1 planned`**

`after/p4a-2560-rise-aug.jpg` is the same proof at 2560 from the other side: five PLANNED chips on
Aug 24 to 28, `16:26 PLANNED` on Aug 31, and the trailing `17:00 ARMED` on Sep 1.
`after/p4a-1440-rise-aug.jpg` reads `1 armed  6 planned  20 posted`.

---

## 3. Arming without a takeover

Measured before: 5 interactions and a full-screen takeover, because `Schedule` is a `setMore`
disclosure at `DraftPane.tsx:1261` rather than a command.

**Where it belongs: the chip.** Judged against the interaction count and against file ownership.

- **Chip** - the row that needs arming is the planned chip, it already carries the date, and the
  confirm can therefore name that date without the operator entering one. **1 click + 1 confirm.**
- **Rail** - rejected. A rail row has no date by definition, so arming from there means picking a
  date first, which is the move panel doing the move panel's job.
- **Row action in the list** - rejected twice over. The list row shows no date, so arming from it
  arms to a day the operator cannot see; and `ContentList.tsx` is owned by Phase 4 items 2 and 3
  this session, so a fourth builder editing it is a collision for no gain.

**It keeps its confirm, always, and the confirm names the day and the time.** Verified in the
browser: *"The publisher reads status='scheduled' and posts it at Tue, Aug 25, 2026, 09:00 AM. This
is not an internal mark: it arms the bridge that publishes."* Screenshot `after/p4a-arm-confirm.jpg`.
No bulk path, no drag gesture, and no keyboard shortcut reaches it.

**Scoped to Ivan's lane, and that is deliberate.** The two arming writes are not interchangeable:
`scheduleDraft` (Ivan, a direct UPDATE scoped `.is('client_id', null)`) writes status + date and
nothing else; `operator_schedule_draft` (client) **also sets `board_visible=true`**, which publishes
the copy onto a paying client's live board. The draft window's own Schedule button is gated
`lane === 'ivan'` for that reason, so a client lane has no arming affordance in this app today, and
putting one on a hover control would be a client-facing decision taken by a calendar. A planned
client chip still says `Planned` - the lie is worth naming even where this surface cannot fix it.

**The date-move confirm is untouched.** "Status and board visibility stay as they are" is still
literally true of `operator_set_schedule_date`, because arming is a different write with a different
confirm. Nothing in the new copy implies the date RPC does more than it does.

### The click path, proven

`after/p4a-arm-harness.jpg` and `after/p4a-arm-confirm.jpg`. **No live row is in the shape the
control needs** (it draws on a planned row on Ivan's lane, and Ivan's two review rows are both
undated), so this one pass is a **render harness and is labelled one**: the GET response for Ivan's
drafts is rewritten in flight to give ONE REAL row a `scheduled_at`, nothing else moves, and no
request is added. It proves the click path and the payload, not coverage.

- 1 planned chip drawn, 1 `Arm it` control drawn, 0 on the armed and posted chips beside it
- control label: `Arm Two months of build... for Tue, Aug 25, 2026, 09:00 AM`
- confirm names the day and the time: **true**
- the write the confirm released, **intercepted, never sent**:
  `PATCH carousel_drafts?id=eq.a207d36b...&client_id=is.null&select=id`
  body `{"status":"scheduled","scheduled_at":"2026-08-25T07:00:00.000Z"}`

That payload is `scheduleDraft`, the existing Ivan-lane write, unchanged. No new RPC, no migration,
no n8n, no schema change, no new dependency.

---

## 4. Interaction counts, before and after

| task | before | after | takeovers |
|---|---|---|---|
| **clear one undated draft onto a date** | **no path** | **2** (drag onto a day, confirm) | 5 -> **0** |
| **one draft from review to armed** | **5** + takeover | **4** (drag, confirm, `Arm it`, confirm) | 1 -> **0** |
| arm a draft that already carries a date | 5 + takeover | **2** (`Arm it`, confirm) | 1 -> **0** |

**"No path" is the honest before for the first row.** The rail rendered zero rows, so the calendar
offered nothing to date. The only route in the app was the draft window at 5 interactions plus a
takeover, and that write **arms** (`status='scheduled'`), so it does not date without arming at all;
on a client lane it does not exist, because the button is gated `lane === 'ivan'`. Dating a draft
without arming it had no reachable path on any lane.

Keyboard and touch route for the same first task, since HTML5 drag does not exist on touch:
`Give it a date` (1), the date input (2), `Move` (3), confirm (4) = 4, still no takeover.

---

## 5. Screenshots

All at `goal-runs/workbench-polish-2026-08-22-out/after/`, authed, real rows, nothing written.

| file | what |
|---|---|
| `p4a-1440-rise-sep.jpg` | **the month containing both**: Aug 31 PLANNED beside Sep 1 ARMED, bar `2 armed 1 planned` |
| `p4a-1440-rise-aug.jpg` | 1440, Mattan lane, 6 PLANNED chips, rail at 48 rows with ages |
| `p4a-2560-rise-aug.jpg` | 2560, head on one line, PLANNED and ARMED in the same grid |
| `p4a-390-rise-aug.jpg` | 390, agenda list, counts wrapped, no horizontal overflow |
| `p4a-1440-ivan.jpg` `p4a-2560-ivan.jpg` `p4a-390-ivan.jpg` | Ivan's lane at all three widths, rail at 2 |
| `p4a-arm-harness.jpg` `p4a-arm-confirm.jpg` | the `Arm it` control and its confirm (render harness, §3) |
| `p4a-stock-before.png` `p4a-stock-after.png` `p4a-stock-after2.png` | `#exp/stock`, both builds, 0 differing pixels |

Probe measurements at all three widths, both lanes (`after/p4a-probe.json`):

| | 1440 | 2560 | 390 |
|---|---|---|---|
| chips whose head clips its own word | **0** | **0** | **0** |
| `documentElement.scrollWidth` vs `clientWidth` | 1440 = 1440 | 2560 = 2560 | 390 = 390 |
| rail scroll region / rail content | 558 / 2853 | 760 / 2853 | 523 / 2853 |
| grid height, unpushed by the rail | 830 | 792 | 3278 (agenda) |

The head-line wrap is a fix the probe found and review would not have: at 1440 the day cell is 108px
and `08:00 PLANNED` overflowed into `08:00 PLANNE` on 7 chips. A truncated word reads as a bug, and
this word is the one saying whether the post goes out.

### `#exp/stock` is pixel-identical

Not argued, compared. The commit before this branch (`a85f417`) was built into `/tmp/p4a-base` via
`git archive` (no branch switch, no worktree added) and served on 4182 beside this build on 4181.

**The first attempt at this was wrong and is worth recording.** A byte compare of the two PNGs said
`identical: true` on one run and `false` on the next, with all four byte counts different: the stock
shell paints live rows and a relative clock, so two captures four seconds apart are not the same
image, and a drifting baseline reads as a diff. `p4a-stock-diff.mjs` establishes the noise floor
first: three captures, interleaved after / before / after, the same build compared against itself
before the two builds are compared against each other, diffed per pixel in a canvas.

```
NOISE FLOOR   after vs after   1440x900   0 differing pixels
ACROSS        after vs before  1440x900   0 differing pixels
```

Expected, and the mechanism is worth writing down: `src/styles.css` is untouched; `faithful.css` is
imported only by `src/exp/v2c/Shell.tsx`, which `#exp/stock` never mounts; every selector added
takes three `.wb` classes **and** a `cal-` class, and the stock shell renders no `cal-` element.

**The three-class rule, verified rather than assumed.** `faithful.css:181` is
`.wb.wb, .wb.wb *{ font-size:var(--fs-body); … }`, which sets font-size on every descendant, so a
two-class selector renders at body size and looks correct in review. Every rule added here is
`.wb.wb.wb .cal-*`.

---

## 6. Writes

**Writes that reached the database: 0.**

Both probes install the interceptor before every navigation, copied from
`goal-runs/workbench-2026-plan-2026-08-21/tools/chip-probe.mjs` lines 13-19: route `**/rest/v1/**`
and fulfil `PATCH`, `PUT`, `DELETE` and non-`/rpc/` `POST` with `200 []`.

Because an RPC is a POST to `/rpc/` that the plain interceptor lets **through**, and this feature's
date path calls one, a second route on `**/rest/v1/rpc/**` is registered after it (Playwright runs
the later route first). It records the payload and answers `{ok:false, error:'blocked_by_probe'}`
rather than letting it land.

- `p4a-probe.mjs`, 7 passes, 3 widths, 2 lanes, 2 months: **0 write attempts of any kind.**
- `p4a-stock-diff.mjs`, 3 passes of `#exp/stock`: **0 write attempts of any kind.**
- `p4a-stock-and-arm.mjs`: **1 intercepted write attempt**, the deliberate `Arm it` click-through in
  §3, asserted on its payload and fulfilled at the route. It never left the browser.

Reads were the app's own and one read-only PostgREST script for the §1 and §2 tables.
`tools/refresh.mjs` was not run.

---

## 7. Tests

`npm run build` clean (`tsc -b` plus vite).

```
baseline (clean checkout, before any edit)   906 passed, 1 failed  (907)
after                                        934 passed, 1 failed  (935)
```

**The one failure is the known pre-existing one**, identified on a clean checkout before touching
anything: `calendarItems.test.ts` > *"passing no queue is the old behaviour exactly"*, at line 402.
It compares `buildCalendarItems([d()], [], NOW)` against `buildCalendarItems([d()])`, i.e. a fixture
clock of 2026-08-07 against the real one. The fixture is dated 2026-08-12, which is now in the past,
so one call says `stage: 'stuck'` and the other says `'scheduled'`. It is a clock, not a regression,
and the diff is byte-identical before and after this branch. Note the new `arming` field does **not**
widen that diff: `armingOf` answers `armed` for both `stuck` and `scheduled`, which is the semantics
working.

28 tests added: 13 in `calendarItems.test.ts` (rail predicate, the movable-by-construction
invariant, oldest-first, `armingOf` including the stuck case, `canArm` including the client
refusal) and 15 in `ContentCalendar.test.tsx` (the 89 rows reaching the rail, rail rows draggable,
ages rendered, the word on the chip, the split count including its zero, and the `Arm it` control
with its gating and its day-and-time label).

---

## 8. Constraints, checked

| constraint | state |
|---|---|
| existing reads and RPCs only | `setScheduleDateAt` and `scheduleDraft`, both pre-existing. No new RPC, no migration written or applied, no n8n, no schema change. |
| the date RPC writes `scheduled_at` and nothing else | its confirm is untouched, including "Status and board visibility stay as they are". Arming is a separate write with a separate confirm. |
| no new runtime dependency | `package.json` untouched. |
| no prospect-facing copy | none added. |
| zero em dashes in anything written | every line added, code comments included, uses a colon or a full stop. Pre-existing em dashes in untouched lines were left alone. |
| every CSS selector takes three `.wb` classes | yes, and `faithful.css:181` was read to confirm why. |
| `#exp/stock` pixel-identical | byte-identical, §5. `src/styles.css` untouched. |

## 9. Files touched

```
src/lib/calendarItems.ts          rail predicate, armingOf, canArm, CalendarItem.arming/.armable
src/lib/calendarItems.test.ts     13 tests
src/exp/v2c/ContentCalendar.tsx   rail render, draggable rail rows, split count, chip word, Arm it
src/exp/v2c/ContentCalendar.test.tsx  15 tests
src/exp/v2c/faithful.css          .cal-* only, three-class selectors only
```

## 10. Open, for whoever picks it up

- **Arming on a client lane has no affordance anywhere in this app**, before or after this change.
  It is a real gap and it is not a bug this surface should close on its own: the write that would
  do it also puts the post on a paying client's live board. Phase 4 item 3 is the owner of that
  decision.
- **The 6 planned risedtc rows are still planned.** This change names them; it does not act on
  them. Aug 24, 25, 26, 27, 28 and 31 will not publish unless someone arms them.
