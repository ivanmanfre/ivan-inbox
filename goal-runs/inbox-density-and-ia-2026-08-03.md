# inbox-density-and-ia — kill the redundant section, compact the working surfaces

Authored 2026-08-03 ~13:20 from Ivan's live use of the deployed app, minutes after the
usability+voice run closed (`goal-runs/inbox-usability-and-voice-live-2026-08-03-out/REPORT.md`).
Everything below is his, verbatim intent. This spec is the complete list.

## What Ivan said

1. **"the inbox section u can remove it i see no purpose on it having dms and sends"** (said TWICE —
   the earlier run softened it into "make the badge honest"; he is now explicit). **Remove the Inbox
   job.** He already has DMs (conversations) and Sends (the log). REQUIRED FIRST STEP: prove where
   the Inbox's load-bearing rows live. The badge currently counts 28 to answer + 1 draft ready +
   **42 flagged: needs your reply** = 71. Those 42 are the reply-blindspot class — real people
   waiting. If DMs already renders them, deleting Inbox is pure subtraction and correct. If it does
   NOT, they move into DMs FIRST (same lane filters), and Inbox goes only once they are provably
   visible somewhere else. Do not trade a redundant tab for a blind spot; do not keep the tab to be
   safe, either — measure, move, delete.
2. **"the today stuff is all old shit"** — the screen leads with items 2-16 days old under a heading
   that says today. Note: the app IS syncing fresh (probed live: "Synced 13:12 · now"); the "Cached
   11:47 · 1d" he saw was a stale open tab. So the fix is not a fetch bug, it is what Today CHOOSES
   to show. Make it a today screen: what is new/actionable now leads; genuinely aged items are
   grouped and labeled as backlog with their age, not presented as today's plate; the "aging out: 4
   — older than 3 days, out of the count" mechanic must read as deliberate rather than as a
   confession. Never hide an owed item — re-rank and label it.
3. **"the content section windows still super hard to use i have to scroll super vertical and long...
   compact stuff with collapsibles arrows and also order things as well in horizontal so we have
   seen the main stuff easily.. like we have in our old interface"** — the Content surface is a long
   vertical scroll. Wanted: compact rows, collapsible sections with arrows (default-collapsed for
   everything except what needs him), and **horizontal organisation** so the main things are visible
   without scrolling. His reference for the interaction is the PRE-revamp interface
   (`#exp/stock` on the live app, and `src/screens/` in the repo) — go look at it, name what it did
   better, and bring that back inside the current skin. Applies to Content first; carry the same
   density decisions to Magnets and Ops where they fit.

## Mission

Cut the app down to what Ivan actually uses, and make Content readable without a long scroll — inside
the Nixtio skin already shipped. Deploy each item as it passes its gate; the app is live and he is
using it right now.

## Non-negotiables

- Repo `~/Desktop/ivan-inbox`, branch off `main`, merge+push at gates. NEVER `git add -A`.
  `:root` in src/styles.css:1-16 untouched. `#exp/stock` keeps working (it is also the reference for
  item 3 — do not modify it).
- The shipped look is LAW: reference `goal-runs/inbox-usability-and-voice-live-2026-08-03-out/
  reference-nixtio-full.png` + the contract in that dir's `phase2-style-delta.md`. Density changes
  live inside it; no new palette, no new radii vocabulary, no webfont, no new npm dependency.
- Mechanical floors: WCAG contrast, 44px tap targets at 390, zero horizontal overflow, zero console
  errors, tests green (currently 493/493), tsc + build clean before any deploy.
- Removing a surface is a DATA question before it is a UI question — run the queries, count the rows,
  show where each kind lands afterwards. A starved lane looks identical to a dead one.
- Never ask Ivan questions mid-run. Do not report until the definition of done is met.

## Phases

### Phase 1 — Inbox removal (data first, then the cut)
Census what `inbox_threads` / `inbox_messages_v` rows the Inbox surface holds by kind, and what DMs
renders today. Produce a mapping table (kind → where it lands after the cut → verified visible).
Move anything orphaned into DMs, then delete the Inbox job from the rail, tab bar, routes, and badge
math. `#exp/v2/inbox` must not 404 — redirect it to DMs. Gate: mapping table with live counts, no
orphaned kinds, censuses clean → deploy.

### Phase 2 — Today, honestly ranked
Re-rank so today's actionable work leads and aged work is grouped, labeled with age, and still
reachable. Keep the counts truthful (a re-rank is not a filter). Gate: screenshots at both widths
before/after with the item ages visible, plus the count arithmetic shown to still add up → deploy.

### Phase 3 — Content density (the big one)
Read `#exp/stock` / `src/screens/ContentScreen*` and name what it did better in a short ledger.
Then: compact rows, collapsible sections with arrows (persisted per section — the machinery already
exists in `useSectionState`), and a horizontal organisation of the top-level surface so the main
things are seen without scrolling. Measure the win: **height of the Content route and scroll distance
to the first actionable row, before vs after, at 1440 and 390.** Carry the decisions to Magnets and
Ops where they apply. Gate: measured reduction, blind seat at both widths ("can you find and action
the thing that needs you, without scrolling?"), censuses clean → deploy.

### Phase 4 — verify + close
Live authenticated pass on every remaining route at 1440 + 390 (console errors, overflow, contrast),
tests, REPORT.md in `goal-runs/inbox-density-and-ia-2026-08-03-out/`, memory writeback (update
`inbox-usability-and-voice-live-2026-08-03` and the MEMORY.md index).

## Definition of done

Inbox gone with nothing lost, Today leading with today, Content readable without a long scroll —
all deployed and live-verified, report written, memory updated.

## Resume rule

On death: read this file + the -out dir + `git log`, trust only committed state, re-measure any
uncommitted claim, continue from the first unmet gate. Commit every few minutes — this run's
predecessor lost six agents to quota limits and API drops and survived on commit discipline alone.
