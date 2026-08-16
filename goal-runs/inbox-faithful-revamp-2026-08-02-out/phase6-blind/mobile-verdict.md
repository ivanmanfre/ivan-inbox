# Blind mobile-polish judge — Workbench dashboard (localhost:5431)

Viewport 390×844, isMobile/hasTouch, dpr 3, real authenticated data. All 7 routes visited
(today, inbox, drafts/"Work", content, sends, ops, settings) plus the Claude (✳) tab.
Interactions exercised with real touch taps: opened an inbox thread and found the way back,
opened a draft row on the Work tab, opened the Content filter sheet and the attribution
toggle, opened the Claude composer and tried to leave it.

## Overall verdict: **FAIL** — not screenshot-clean yet.

The information density and layout are genuinely good on most screens (Today, Sends, Ops,
Settings all read well one-handed). But there is one real dead-end-adjacent bug (the Claude
tab traps you behind a nearly-invisible hit target) and one silently-hidden filter row that a
demanding user will absolutely find and screenshot.

## Ranked findings

1. **Opening the Claude tab hides the entire bottom nav, and the only way out is a ~6×20px
   hit target.** `mobile-claude-top.png` / `mobile-claude-composer-focused.png`. Tapping the
   ✳ tab replaces the tab bar with the chat composer — Today/Inbox/Work/Sends/Ops are no
   longer reachable by tapping where they used to be (confirmed: a real tap at the Inbox
   tab's old screen position just focuses the "Ask Claude…" input instead, hash does not
   change). The only escape is the "‹" glyph top-left. Measured its actual DOM hit box:
   **6.45px × 20px** — not the ~20px the glyph visually renders at. A tap there does work
   (confirmed via direct coordinate click), but a real thumb will miss that sliver constantly.
   Severity: this is the closest thing to a genuine navigation dead-end in the sweep.

2. **Content page's Stage/Kind/Pillar/Source filter row is silently clipped, no scroll
   affordance.** `mobile-content-top.png`. Measured directly: `.ct-fpills` has
   `scrollWidth=628` vs `clientWidth=358` (`overflow-x: auto`) — 270px of filter chips
   (past "Pillar") are off-screen with no scrollbar, no fade mask, and no arrow. "Source" is
   already half-cut at the right edge in the resting screenshot with nothing to signal more
   chips exist; a user has to accidentally swipe that exact 30px-tall strip to discover them.

3. **Ops card body text is hard-clipped mid-line with an orphaned text fragment.**
   `mobile-ops-top.png` (second card, "Rise / Respect turning down a signature…"). The
   message preview cuts off mid-sentence with no ellipsis, and a stray sliver of the next
   line's text pokes through just above the Discard/Approve buttons — reads like a rendering
   glitch rather than an intentional truncation.

4. **A draft row on the Work/DMs tab silently full-navigates you to a different tab.**
   `mobile-drafts-row-teleport-to-ops.png`. Tapping the "comment_…" row under
   "OPS · 2 — approved in Ops, not here" doesn't open a detail panel — it jumps you
   completely off the Drafts tab onto Ops (bottom-nav highlight moves too). The label
   technically says "not here," but the row still reads as an openable list item, and there
   is no transition or toast to explain the jump. Confirmed on mobile via real tap.

5. **Multi-line contact names break row alignment in Inbox.** `mobile-inbox-top.png`
   ("Muhammad Huzaifa" wraps to 2 lines) — the IVAN/INMAIL pills and row rhythm shift down
   and right relative to every single-line row around it, so the list's left/right rails
   visibly jump for that one row.

## Minor / borderline (not ranked)
- Several real controls sit right at or under the ~40–44px comfortable-touch-target line:
  Today's filter chips (43×30, 52×30, 53×30), the Sends "Range: 7d" pill and refresh icon
  (34×34), and the Claude composer's mic/send buttons (38×38 each). None of these are as
  severe as #1, but a demanding user tapping quickly on a real phone will feel the chips are
  tight.
- Sends' three stat-tile headers render as "ACC…", "GOV…", "RUN…" (truncated caps labels)
  — confirmed the full words exist ("GOVERNOR DETAIL" appears as a real section header
  further down the same page), so the tile label truncation is avoidable, not a data gap.
- Two duplicate-looking draft titles ("A great ROAS can still be a losing business," two
  different QA_BLOCKED ids back to back) surfaced while filtering by Mattan — a content/data
  observation, not a mobile-UI defect, flagged only because it was visible in a screenshot.
- No horizontal document jiggle anywhere (`scrollWidth === innerWidth` on every route/scroll
  state measured). No console errors during real navigation.
- Positive: the Content → Stage filter opens a proper native-feeling bottom sheet (drag
  handle, large tappable rows with counts) — genuinely good mobile pattern, no clipping.
- Positive: sticky header + independently-scrolling row list on Inbox/Content behaves
  correctly — header never disappears, only the list scrolls.
- Positive: back-navigation out of an inbox thread (once you land the tap) correctly returns
  to the exact prior scroll position and filter state.

## Screenshot index
`/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-faithful-revamp-2026-08-02-out/phase6-blind/`
- mobile-today-top.png / mobile-today-scroll.png
- mobile-inbox-top.png / -scroll.png / -detail.png (opened thread, finding #5's card is here)
  / -afterback.png
- mobile-drafts-top.png / -scroll.png / -row-teleport-to-ops.png (finding #4)
- mobile-content-top.png (findings #2) / -scroll.png / -filter.png (Mattan attribution toggle,
  works correctly)
- mobile-sends-top.png (minor: truncated stat labels) / -scroll.png
- mobile-ops-top.png (finding #3) / -scroll.png
- mobile-settings-top.png / -scroll.png (cleanest screen in the sweep)
- mobile-claude-top.png / -scroll.png / -composer-focused.png (finding #1)
- sweep-log.json — raw per-route measurements (hit-target sizes, clipped-element scan,
  settle/console-error log) behind the ranked findings above
