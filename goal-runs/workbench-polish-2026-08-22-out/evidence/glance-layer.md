# The glance layer

Branch `polish/glance`, worktree `ivan-inbox-pw-gl`. Built against the dashboard
port audit's section 6, which found that a large part of the old dashboard's
"I can spot more stuff" advantage is architectural rather than typographic.

Every database request in this file and in the build itself is a GET.
**Attempted writes across every browser session and every script: 0**, asserted
by an interceptor installed on `**/rest/v1/**` and `**/rest/v1/rpc/**` before
any navigation (`gl-tools/harness.mjs`, ported from
`workbench-2026-plan-2026-08-21/tools/chip-probe.mjs:13-19`).

Baseline established before the first line was written: `npm run build` clean,
`npm test` **906 passing, 1 failing**, the failure being the known pre-existing
`calendarItems.test.ts` case. Same at the end.

---

## 1. What each count sums, and what it excludes

All four count reads live in one hook, `src/exp/v2c/useGlanceCounts.ts`, mounted
once in `Shell.tsx`. It replaces `useContentBadge.ts`, which is deleted.

| Where | Predicate, verbatim | Reads | Excludes |
|---|---|---|---|
| Rail **Content** | `carousel_drafts.status = 'review'`, **no lane filter** | 95 | every stage but review; nothing else |
| Content lane pills | the same, split by `client_id` (`NULL`/`risedtc`/`arch`) | 2 / 54 / 39 | a lane not in `CONTENT_LANES` is counted into the headline and shown separately, never dropped |
| Rail **Magnets** | `lm_drafts_v2.status IN ('review','lm_review')`, no lane filter | 12 | `lm_review` folds into `review` exactly as `styles.ts:342` already folds it |
| Rail **DMs** | unchanged: `inboxWaitingCount(threads)` | 10 | unchanged |
| Rail **Ops** | unchanged: `pendingOps(ops_drafts)` | 0 | unchanged |
| Rail **Workflows** | see section 3 | 19 | anything last run over 14 days ago |
| Global roll-up | **the rail's own counts, added up** | 117 | ideas, sends, comment feed, automation health |

**Styles, Strategy, Sends and Today get no count at all.** Styles is a shared
registry, Strategy is a per-lane document, Sends is analytics, and Today is a
digest of the other jobs so a count there would double every other number. A
count of zero is not rendered. That is deliberate and it is the audit's own
finding applied in reverse: 17 of the old sidebar's 21 rows carry a permanently
blank count column, which teaches the eye to stop looking at the column.

### The lane trap, and what was done about it

`src/lib/content.ts:103` scopes a lane at the QUERY layer, so a mounted
`useContent(lane)` holds one lane at a time by construction. The old badge was
`client_id IS NULL AND status='review'`, so **the rail read 2 while 93 client
drafts sat at the same decision stage one unlabelled pill away.** The rail row is
now cross-lane and the lane pills carry the split, so the 95 decomposes on
screen: `Ivan 2 · Mattan Danino 54 · Davorin Smit 39`. The rail row also carries
the predicate on its `title`.

There were two written rulings pointing the other way, and both were read before
this was changed: the old dashboard's own badge comment ("client drafts are never
folded into Ivan's actionable count") and `Shell.tsx`'s note that the client lane
is read-only here. Both are about the WRITE path. Neither says the work is not
his, and the whole finding is that lane-scoped silence hides work. The
decomposition is what keeps it honest.

### The roll-up's honesty mechanism

The single global figure is defined as **the sum of the rail rows on screen** and
nothing else (`Rail.tsx:rollup`). Every summand is a row on the same rail with
its own numeral, so the arithmetic is checkable without leaving the screen, and a
number that appears in the total but nowhere below it is impossible by
construction. Its `title` prints the summands and ends: *"it does not cover
ideas, sends, or automation health"*.

Named and deliberately outside it: 176 client ideas at `staged`, 95 lm idea
candidates at `reviewing`, the comment feed, the send queue, and the automation
alarm.

---

## 2. Independent verification of every number

`gl-tools/verify.mjs` reads every rendered numeral back out of the DOM.
`gl-tools/prove.py` then re-derives each one with curl against PostgREST, from a
separate process, writing each predicate by hand rather than importing the app's
query builder, so a bug in the builder cannot make both sides agree. Counts use
`Prefer: count=exact` with `Range: 0-0`, which returns a header and no row body
and therefore survives the 1000-row select clamp.

Output: `gl-tools/prove.json`. **12 checks, 0 disagreements.**

```
OK   rail Content                               95 vs 95
OK   lane pill Ivan                             2 vs 2
OK   lane pill Mattan Danino                    54 vs 54
OK   lane pill Davorin Smit                     39 vs 39
OK   lane pills sum to the rail row             95 vs 95
OK   rail Magnets                               12 vs 12
OK   roll-up = sum of rail counts               117 vs 117
OK   rail Workflows                             19 vs 19
OK   Ops list length                            19 vs 19
OK   the two health views really do overlap     6 vs 6
OK   "N more" outside the window                37 vs 37
OK   Needs review tab is lane-scoped            2 vs 2
```

The last check is the one that would have hidden a lie: it proves the stage tab
and the rail row are deliberately different scopes, and both are on screen at
once with the lane pills showing the arithmetic between them.

Every CSS value the build sets was also computed-style checked in the live page,
because `faithful.css:181` is `.wb.wb, .wb.wb *{ font-size: ... }` and a
two-class selector loses to it silently. Every new declaration carries three
`.wb` classes and every one landed on its intended value, none on the 16px/400
fallback:

| selector | rendered |
|---|---|
| `.wb-rollup-n` | 15px / 700 / `#FFFFFF` |
| `.wb-rollup-l` | 12px / 500 / `#949494` / `text-transform:none` |
| `.ct-cmd-lane-n` | 13px / 500 / `#C7C7C7` / mono |
| `.wb-auto-n` | 13px / 600 / `#C7C7C7` |
| `.wb-auto-w` | 12px / 400 / `#949494` |
| `.wb-rib-health-n` | 12px / 700 / `#FF9F0A` / `text-transform:none` |
| `.wb-rj-health .wb-rj-ic` | `#FF9F0A` |
| `.wb-rj-pip` (collapsed) | 6x6 / `#949494`, amber when severe |

No count takes the accent. The accent is a budget and a count is not an action.
Severity uses `--sev-attention` only.

---

## 3. Automation health, and the ruling it had to be built around

The inbox read `dashboard_workflow_stats` nowhere. On the day of the build that
was not hypothetical: **Carousel Generation** last errored 2 days ago, **Post
Generation** 8 days ago, **CLIENT Rise DTC Post Generation** 9 days ago, and
**Outreach - DM Sequence**, a 30-minute job, last ran 10 days ago.

But `TodayScreen.tsx:16` records that Ivan **cut** an n8n / workflow-error zone,
and `SystemAlertStrip.tsx:8` states what that ruling was aimed at: *"a permanent
shelf of n8n workflow errors nobody acts on"*. A straight port rebuilds that
shelf. So this obeys the same three conditions the alert strip obeys: it renders
nothing when there is nothing, every row names a dated consequence, and it is
windowed so the number can reach zero.

**The count** = the union, deduplicated on trimmed lowercase name, of

- `dashboard_workflow_stats` where `last_execution_status='error'` AND
  `is_active IS TRUE` AND `last_execution_at` within 14 days, and
- `scheduled_ops_status` where `enabled IS TRUE` AND
  `status IN ('OVERDUE','ERRORING')` AND `last_run_at` within 14 days.

`10 ∪ 15 = 19`, with an exact-name overlap of 6. **A naive sum would have claimed
25 broken automations when 19 are broken.** The overlap is the six n8n-sourced
jobs both views describe.

Three derivations, each forced by a measurement rather than chosen:

1. **`is_active` gate.** Unfiltered, `last_execution_status='error'` returns 19,
   which is exactly the number the audit read off the old rail. Two of those are
   deactivated workflows: a corpse cannot break a pipeline. 17 remain.
2. **The 14-day window.** Of those 17, seven last ran 72 to 167 days ago and
   three are named `TEMP - Add Diagram Columns (delete me)`,
   `TEMP - Create Table v2` and `Test Cookie Download`. The observed ages jump
   from 9 days straight to 72, so **any cutoff between 10 and 71 days selects the
   same rows**; 14 sits inside that gap and is not a constant pretending to
   precision. Same window on the scheduled side, where 42 of 45 overdue jobs are
   more than a week stale.
3. **`error_count_24h` is not read anywhere.** Rows whose last execution was 115
   to 167 days ago still report `error_count_24h` of 2 and 13, with `updated_at`
   stamped 2026-03-11. That column stopped being refreshed. The old dashboard
   sums it across every workflow and drives a `critical`/`degraded` verdict off
   the total (`hooks/useWorkflowStats.ts`), so that verdict is computed from
   stale data. This build renders `last_execution_status` plus the AGE of that
   execution, both checkable on the row.

What the window leaves out is stated on screen rather than hidden: *"37 more last
ran over two weeks ago and are not counted above."* (7 workflows + 30 scheduled
jobs.)

**Read only.** No Pause/Resume, no n8n toggle edge function, no deep link. A
count in the rail foot, a dated list in Ops, and the route between them.

The alarm is deliberately NOT a summand of the roll-up. Everything in `counts` is
work Ivan can do; a red workflow is a thing that has stopped, and nothing on this
rail lets him restart it.

---

## 4. Facts visible in the first viewport, before and after

`gl-tools/density-all.mjs`. A **fact** is a leaf element, visible and inside the
first viewport box, whose own text is a quantity (a bare number, or a number
leading a short phrase) or a state dot. Prose is excluded: a paragraph is not
something you spot without reading it. "Before" is the pre-change tree built from
commit `61e6af4` and served on 4188; "after" is this build on 4187; same script,
same estimator, same viewports.

| surface | before | after | gain |
|---|---|---|---|
| Content, 1440x900 | 16 | **22** | +6 (+38%) |
| Content, 390x844 | 10 | **16** | +6 (+60%) |
| Ops, 1440x900 | 13 | **16** | +3 (+23%) |
| Ops, 390x844 | 10 | **12** | +2 (+20%) |

Reproduced three times, identical every time.

**The estimator had to be fixed before the numbers meant anything.** A fixed 5.5s
wait under-counted non-deterministically: the same surface read 11 quantities on
one pass and 0 on the next, because a cold browser profile loses the realtime
handshake and the count queries land late. A count only grows as a page finishes,
so the script now polls until the number stops moving for three consecutive
reads. An under-count would have flattered either side at random, which is the
one thing a density claim cannot afford. The first draft of this file would have
reported a 6-fact LOSS on Content at 1440.

What the extra facts are, on Content at 1440: the roll-up (117), Magnets (12),
Workflows (19), and the three lane counts (2 / 54 / 39).

### What was already there, and was not rebuilt

The audit's third recommendation is a permanent count strip above the stage tabs.
Measured before anything was added: **at 1440 all nine rendered stage tabs and
their numerals are already inside the first viewport** (Ideas 90, Needs review 2,
Generating 0, Approved 0, Scheduled 1, Published 113, Errors 48, Archived 88,
Other 3). The tab bar has been that strip since 2026-08-20. A second row printing
the same nine numbers is the D6 doubling `ContentList.tsx` already retired once,
at Ivan's word. So the strip above the tabs became the **lane** split, which is
the same fold one level up and the bigger one: 93 drafts hidden behind an
unlabelled pill against 0 stage numbers hidden behind a tab.

---

## 5. `#exp/stock` is byte-identical

`gl-tools/stock-proof.mjs`. The pre-change tree (`61e6af4`) and this build are
served side by side and `#exp/stock` is screenshotted from both as PNG at three
viewport/theme combinations, then compared by SHA-256.

| view | before | after | identical |
|---|---|---|---|
| 1440x900 dark | `00c7dce1e952...` | `00c7dce1e952...` | yes |
| 1440x900 light | `13e693a50705...` | `13e693a50705...` | yes |
| 390x844 dark | `75195787a422...` | `75195787a422...` | yes |

Byte for byte, not eyeballed. Structurally this is expected: every file touched
is v2c-only, `wbsys.css` is imported from `v2c/Shell.tsx` alone, and every
selector added is `.wb`-scoped. `inventory.md` lists eleven components that do
cross into stock and none of them is `Rail`, `ContentList`, `OpsBoard` or
`wbsys.css`. `src/styles.css` was not touched. Pair kept at
`after/gl-stock-before-1440-dark.png` and `after/gl-stock-after-1440-dark.png`.

---

## 6. Two layout defects the glance layer exposed

Both were caused by adding to the frame, both were measured before the fix, and
both are documented in place.

1. **The collapsed rail's expand button had nowhere to go.** `.wb-rail.min` is
   64px wide with 10px of padding, so the top row has 44px of usable width and
   cannot hold a 32px button beside a numeral. Laid out as a row the button
   rendered at **x=73 inside a rail spanning x=20 to x=84**, i.e. outside its own
   rail and under the working column, where nothing could click it. The top row
   now stacks. Measured after: button at x=38, w=32, fully inside.
2. **The mobile ribbon overlapped the work pills.** On a work job the whole
   ribbon becomes an absolute overlay at the top right of the plate and the pill
   strip reserves 144px for it (`wb2026.css` D7). Adding to it pushed its left
   edge to x=161 against a pill strip whose visible right edge was 206: 45px of
   the Magnets pill rendered underneath. The reserved lane is now 200px, taken
   from the overlay's re-measured box (14 + 29 + 10 + 73 + 10 + 32 + 10 + 14 =
   192) plus 8px of clearance. Noted rather than silently fixed: **at 144 that
   lane was already 9px short of the overlay it reserves for, before this pass
   added anything.**

Also fixed in passing: the collapsed rail hid `.wb-rj-n` entirely
(`faithful.css:2553-2557`), so collapsing the rail deleted the whole count
column, which is the one thing the rail is for. A 6px pip now carries PRESENCE in
that state only. It states no magnitude on purpose: a two-digit numeral does not
fit a 64px rail and a clipped one would be a wrong number. Verified: collapsed,
4 pips visible and 0 numerals.

---

## 7. Judged too noisy to add, or out of scope

- **The roll-up on the phone.** Built, measured, taken back out. It took the
  ribbon overlay from 144px to 221px at 390, printed on top of the Magnets pill,
  and would have cost another 56px of the only strip that reaches Styles and
  Strategy, in a band whose fold from four rows to three is recorded as a fight
  in `wb2026.css` D7. And unlike the desktop rail, the phone already carries
  every one of the roll-up's summands as its own numeral on every screen: the
  bottom bar IS the rail's counts. The automation mark is the opposite case and
  it stayed, because it exists nowhere else on that viewport.
- **The 45 overdue scheduled jobs, unwindowed.** 42 of 45 are over a week stale
  and 23 are over a month. A number that cannot reach zero becomes wallpaper,
  which is the failure mode of the old sidebar's blank count column with the sign
  flipped. They are counted in the "37 more" line instead.
- **`error_acknowledged` as a hide.** Three of the red workflows are marked read
  on the old dashboard. Hiding them would make the count unreachable from this
  app, which cannot acknowledge anything. They are counted and the state is
  printed on the row.
- **A severity dot on the Sends rail row.** `lib/sends.ts:buildLanes` returns a
  `live`/`slowing`/`stale` tier per lane, and a stale send lane is the same class
  of fact as a red workflow. Not added: it needs a cross-tenant read this hook
  does not make, and item 4 of the brief scopes the alarm to workflow health.
  Flagged as the obvious next one.
- **A deep link to the n8n workflow page.** A plain anchor is not a control, but
  the host is not in the app's config and hardcoding it would be inventing a
  fact. The row names the workflow instead.
- **A group total on the rail's Content label.** The four members each carry
  their own numeral one row below it. That is the D6 doubling.
- **`error_count_24h` anywhere.** Stale, see section 3.

---

## 8. Files

Built: `src/exp/v2c/useGlanceCounts.ts` (new), `Rail.tsx`, `Shell.tsx`,
`ContentList.tsx`, `OpsBoard.tsx`, `wbsys.css` (section 8).
Deleted: `src/exp/v2c/useContentBadge.ts`, replaced by the hook above.
Not touched: `TodayScreen.tsx`, `InboxScreen.tsx`, `calendarItems.ts`,
`ContentCalendar.tsx`, `content.ts`, `BulkBar.tsx`, `src/styles.css`.

Evidence: `evidence/gl-tools/` (harness, density, verify, prove, stock-proof,
after-shots, and their JSON output). Screenshots: `after/gl-*.jpg` at 1440 and
390 in both themes on Content and Ops, plus the collapsed rail and the stock
pair.

No new runtime dependency. No migration, no n8n call, no schema change, no
prospect-facing copy, no bare-key action shortcut.
