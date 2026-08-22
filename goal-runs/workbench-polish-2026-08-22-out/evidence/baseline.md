# Phase 0 baseline — the ten worst workbench surfaces, BEFORE

Captured 2026-08-22 against the production build at http://localhost:4173/,
branch `wb/polish`, authenticated with the live Supabase session
(`.session.json`), real data. Capture script:
`goal-runs/workbench-polish-2026-08-22-out/evidence/capture.mjs` — re-run
verbatim against the same build for the "after" set (`node capture.mjs
http://localhost:4173/ ../after`).

**Safety.** Every page context installed the write interceptor before any
navigation (routes `**/rest/v1/**`, fulfils PATCH/PUT/DELETE and non-`/rpc/`
POST with `{status:200, body:'[]'}`). **Intercepted writes: 0** — nothing in
this sweep triggered a write attempt (no approve/skip/delete/schedule was
clicked; opening a thread and a draft are reads against `inbox_messages_v` /
`content_drafts`, and `read_at` stamping, if any, happens through a mutation
this interceptor would have caught and did not see fire).

**Totals.** 37 screenshots (32 base shots across viewport/theme combinations
+ 1 hover state + 4 tight crops). 0 console errors across every capture. 430
overflow hits total across 32 measured pages (`scrollWidth > clientWidth + 2`
on an element whose parent is not an `overflow-x:auto`/`scroll` scroller;
some entries hit the 40-per-page cap in the instrument, so the true count on
the densest pages — DMs list, Magnets — is higher).

**Theme coverage.** Per the brief's cheap-if-possible rule: dark captured for
all ten surfaces; light captured additionally only for surfaces 2 (Content
Calendar), 3 (Draft window) and 7 (DMs list), since a full light sweep would
have doubled the runtime for surfaces whose defects are not theme-dependent
(rail, palette, chat, ops, magnets, strategy, styles, list).

**Viewports.** 1440x900 and 390x844 for every surface; 2560x1440 added for
surfaces 2 and 3 only, per the brief.

---

## 1. Content lane, List tab

`01-content-list-1440x900-dark.jpg`, `01-content-list-390x844-dark.jpg`

Default Flow view, Ivan's lane, Ideas tab (90 rows). Seven-column card grid
(`ct-anchor` QA mark, checkbox, title, taxonomy chips, meta). Console errors:
0/0. Overflow: 5 hits at 1440 (mostly the 28px `ct-anchor`/16px `wb-selmark`
checkbox rendering 3px narrower than its own content — a chronic 3px clip on
every row's select mark), 12 hits at 390 (same clip plus the workhead segment
strip `wb-workseg` (325 vs 214 clientWidth) and the stage-tab strip
`ct-cmd-scroll` (429 vs 342) both genuinely wider than their box — these ARE
inside horizontally-scrollable strips in the app's intent, but the instrument
does not see an `overflow-x:auto` on their direct parent, so they are flagged;
worth a manual check in Phase 1 whether the scroll affordance is visible to a
first-time user at 390).

## 2. Content lane, Calendar tab

`02-content-calendar-{1440x900,390x844,2560x1440}-{dark,light}.jpg`,
`02-content-calendar-hover-1440x900-dark.jpg`

August 2026, Review filter pre-selected (2 rows waiting), 13 dated this
month. Confirms the named defect: every populated day cell shows exactly one
chip that is a **flat rectangle with a coloured left rail and no other
depth cue** — same background as its cell, 12px radius, no shadow, no border
elsewhere. At 1440 the cell is roughly 124x124px and the chip's height reads
as a large fraction of it, consistent with the plan doc's measured 70%. The
pistachio frame (`#C5E1A5`) wraps the whole dark plate with a visible gap and
large corner radius on every viewport captured, including 2560.

Console errors: 0 at every viewport/theme. Overflow: 0 at 1440 and 2560
(both themes); 8 at 390 (both themes) — same `wb-rib-sync`/`wb-gear`/
`wb-workseg` chrome-strip clips as surface 1, plus `ct-cmd-scroll` at 717 vs
342 (the lane+view switch strip is genuinely wider than the phone viewport
here, more so than on the List tab).

**Tooltip finding.** The chip's "was set for"/drift tooltip
(`ContentCalendar.tsx:335,363`) is implemented as a plain HTML `title`
attribute on the `.cal-chip-t` button, not a custom-positioned DOM element —
grepped `faithful.css`/`styles.css`/`wb2026.css` for a tooltip/fixed-position
rule keyed to it and found none. A native `title` tooltip is OS-rendered and
not part of the page's DOM, so Playwright's `hover()` (which sets the CSS
`:hover` state but does not reproduce OS dwell-timing) does not render it:
the hover shot shows no visible tooltip box. This is itself evidence for
Phase 3 — the fix the plan doc describes ("anchor the tooltip to its cell")
requires first **replacing** the native `title` with an actual DOM tooltip
component, because a native title cannot be anchored by CSS at all; whatever
Ivan saw pinned to the corner was the browser's own placement, not a bug in
app code that a positioning fix alone would solve. Flagging for the polish
phase rather than treating this shot as a null result.

## 3. A draft opened in the draft window / takeover

`03-draft-window-{1440x900,390x844,2560x1440}-{dark,light}.jpg` (whole
window), `03-draft-window-actions-{1440x900,390x844}-dark.jpg` (crop of
`.dw-acts`), `03-draft-window-inspector-{1440x900,390x844}-dark.jpg` (crop of
`.dw-insp`)

Opened "Two months of build, then 30k a month to 80k a month on lead
magnets" (real row, QA PASS 82). Confirms every named defect:

- **Action row** (`.dw-acts`, cropped): Approve is a lime pill (`#c6ff5e`-ish,
  the accent), then five visually-identical dark grey rectangles in a row —
  Edit, Schedule, Regenerate, Swap image, Back to idea — same fill, same
  radius, same 1px border, no size or weight difference between "Edit" and
  "Back to idea" despite very different blast radius. Delete sits on its own
  line below, red outline, otherwise same size as the grey five. Measured:
  every grey button ~96-120px wide x 44px tall, identical corner radius,
  8px gaps.
- **Inspector header** literally reads "BACKEND DEPTH" (all-caps via CSS
  text-transform on the string `Backend depth`, `DraftPane.tsx:187`), with
  tab buttons QA / SOURCE / SOURCE / LOG / FIELDS also all-caps.
- **QA panel**: a big "82 PASS" readout, a horizontal score bar, then nine
  ALL-CAPS label rows (VOICE, SUBSTANCE, SPECIFICITY, DISTINCT, OPINION,
  ECONOMY, HOOK, VERIFIED, AI_TELLS) each with its own individual thin
  progress bar and a bare number — nine near-identical rows, no grouping,
  every label is a raw internal metric name (`AI_TELLS`, underscore intact).
- The 640px-ish centred LinkedIn artifact column sits inside a much wider
  middle region — at 1440 there's visible dead grey field to the right of the
  post card and image before the inspector rail starts.
- Did not scroll to the "SPUN FROM POST" / raw `urn:li:activity:` row or the
  "Post note" lime slab in this pass (they render further down the Source
  tab / note composer, which was not the default-open tab) — grepped and
  confirmed both exist verbatim: `DraftPane.tsx:994`
  (`source.push(['Spun from post', d.source_post_id])`, raw `source_post_id`
  is the LinkedIn URN) and `DraftPane.tsx:695` (`'Post note'` button inside
  `.dw-note`, full-width). Phase 2 should capture these on the Source tab and
  with the note composer open as an explicit extra shot, since the default
  QA-tab view (what a fresh open shows) does not surface them.

Console errors: 0 everywhere. Overflow: 13 (1440, both themes), 20 (390 dark
retried standalone after a batch flake — see note below; 390 light matched at
20), 6 (2560, both themes) — largest single overflow items are the QA
summary paragraph's `dd-logc-p` spans (up to 1125px content in a 270-301px
box, i.e. long unwrapped log lines) and the queue rail's title
`dw-qrow-t` (704px content in 178-337px box).

**One flake.** The 390x844 dark whole-window screenshot failed once mid-batch
("Clipped area is either empty or outside the resulting image" — a Playwright
font-load race, not a clip bug in the shot itself since no clip was passed).
Retried standalone immediately after and it succeeded with an overflow
signature matching its light-theme sibling at the same viewport (20 hits),
so the retry is representative. The inspector crop at 390 needed a different
approach: `.dw-insp` is 2792px tall inside the takeover's own internal
scroller (the takeover is a `position:fixed` overlay — `document.
scrollHeight` reports only the 844px viewport, so a plain full-page clip
can't reach it). Captured the viewport-visible slice after
`scrollIntoViewIfNeeded()` instead of the section's true top edge — a fair
"what a phone user actually sees," not a full-height crop like the 1440 one.

## 4. Content lane, Strategy tab

`04-content-strategy-1440x900-dark.jpg`, `04-content-strategy-390x844-dark.jpg`

Console errors: 0/0. Overflow: 0 at 1440, 7 at 390 (chrome-strip clips
consistent with surfaces 1/2, plus `wb-strat-read`/`wb-strat-head` at
358 vs 342 — a 16px genuine overflow on the strategy panel headers).

## 5. Content lane, Styles tab

`05-content-styles-1440x900-dark.jpg`, `05-content-styles-390x844-dark.jpg`

Console errors: 0/0. Overflow: 0 at 1440, 9 at 390 (`ct-style-i` at
508 vs 282 clientWidth is the largest — a style-resource row's inner content
is nearly 2x its box at phone width).

## 6. Ops lane (default view)

`06-ops-lane-1440x900-dark.jpg`, `06-ops-lane-390x844-dark.jpg`

"Nothing waiting on you" state, "Already handled" log of 10 recent
reply/booked events (real Rise/booking data, call ids like `#C0BJ72F58BY`).
Console errors: 0/0. Overflow: 6 at 1440 — all `log-snip` rows, up to
1761px of content in a 558px box (unwrapped long log lines, same pattern
as the draft window's QA log). 13 at 390 (same log-snip clipping plus the
usual chrome-strip hits).

## 7. DMs lane, list

`07-dms-list-{1440x900,390x844}-{dark,light}.jpg`

9 threads, real prospect names, drafts and channel badges (IVAN/RISE, DM/
INMAIL), a "2 drafts pushed to later" banner. Console errors: 0 across all
four. Overflow: 22 hits at 1440 (both themes, identical), 34 at 390 (both
themes, identical) — dominated by `snip` (message preview) rows running up
to 1265px inside an 887px (1440) or 216px (390) column, plus the recurring
`av g*` avatar 3px clip and `wb-selmark` checkbox clip seen elsewhere. Theme
had zero effect on overflow counts, which is expected since overflow is a
layout property, not a colour one — the light captures here are mainly a
contrast/palette check, not a new-overflow check.

## 8. DMs lane, a thread opened (ThreadPeer)

`08-dms-thread-1440x900-dark.jpg`, `08-dms-thread-390x844-dark.jpg`

Opened Aleksa Mladenović's thread: real message history, an "AI follow-up ·
waiting on you" drafted reply rendered as a lime card, Discard/Later/
Approve & send row. Console errors: 0/0. Overflow: 27 at 1440 (list column
`snip` rows now clipped harder — 433px box vs up to 1265px content, since
the list narrowed to make room for the peer), 3 at 390 (mobile takeover
replaces the list entirely, so only small avatar-badge clips remain).

## 9. Magnets lane

`09-magnets-lane-1440x900-dark.jpg`, `09-magnets-lane-390x844-dark.jpg`

195 lead magnets, 1 errored, "Lead-magnet ideas" sub-list (5 rows, scored
55.82-61.9) above the main status-tab table (Idea 109, Needs review 11,
Published 43, Errors 1, Archived 31 — all real). Console errors: 0/0.
Overflow: 24 at 1440 (`ct-anchor`/`wb-selmark` clip repeated 12x down the
idea rows, plus two `ct-title ct-row-p` title overflows at 829/733px in a
692px column), 35 at 390 (adds `ct-tabs` at 1095px content in a 374px box —
the seven-tab status strip is nearly 3x its box width on a phone, worse than
any other surface's tab-strip overflow measured in this sweep).

## 10. Command palette / Claude chat pane

`10a-command-palette-{1440x900,390x844}-dark.jpg`,
`10b-claude-chat-{1440x900,390x844}-dark.jpg`

Palette opened with ⌘K over the DMs list, real command groups (MOVE/SELECT/
ACT) with live counts ("Selects all 9 rows currently on screen"). Claude
pane opened by clicking the rail's Claude row, docked beside the DMs list
with three suggested prompts and a live/default badge. Console errors: 0
across all four shots. Overflow: palette — 22 (1440), 34 (390), same
DMs-list-behind-the-scrim clipping as surface 7 since the list is still
mounted under the palette. Claude chat — 26 (1440), 1 (390, since the chat
pane takes the phone screen over entirely and the list underneath isn't
painted).

---

## Cross-surface patterns worth carrying into Phase 1

1. **The 16px/13px checkbox-and-anchor clip** (`ct-anchor` 31 vs 28,
   `wb-selmark` 29 vs 16) repeats on every list surface (1, 3, 9) — a single
   token-level fix (padding or box-sizing on `.wb-selmark`) likely clears a
   double-digit fraction of the total overflow count in one change.
2. **Unwrapped long-text spans** (`dd-logc-p` in the draft window's QA log,
   `log-snip` in Ops, `snip` in DMs) are the largest individual overflow
   deltas measured (up to 1761px content in a 558px box) — all three look
   like the same underlying pattern (a log/preview line with no
   `white-space: normal` / `word-break`) reproduced in three components.
3. **Tab/segment strips genuinely exceed their box at 390** (`wb-workseg`,
   `ct-cmd-scroll`, `ct-tabs`, `wb-strat-read`) on every content-lane
   surface — these may be intentionally horizontally scrollable (Rail.tsx's
   own comment says the strip "scrolls rather than shrinking"), but the
   instrument's overflow probe (which excludes only children of an explicit
   `overflow-x:auto`/`scroll` ancestor) still flags them, meaning either the
   scroll container isn't marked that way in CSS or the affordance is
   genuinely invisible to a first-time phone user. Worth a manual look, not
   just a metrics fix.
4. **Zero console errors and zero writes across the entire sweep** — the
   write interceptor held for all 37 captures including two thread/draft
   opens that would otherwise have stamped `read_at` or similar on a live
   row.
