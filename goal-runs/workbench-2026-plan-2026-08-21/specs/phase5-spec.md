# Phase 5 spec — layout fills the canvas

Repo `/Users/ivanmanfredi/Desktop/ivan-inbox`, branch `wb/2026-readability`. Read `phase0-scope.md` first.

The measured problem: at 2560 the Content lane's text covers **3%** of a 2,304px work area (703 body characters) and DMs covers **8%** (1,382 characters), while prose elsewhere runs to 329ch. The app is set small and laid out empty. A previous pass has already fixed the type; this one fixes the canvas.

## File ownership

- Your CSS goes in section **D · LAYOUT** of `src/exp/v2c/wb2026.css`, every selector at `.wb.wb.wb` (the `faithful.css` flattener eats anything weaker, silently).
- You may edit `src/exp/v2c/faithful.css` and `src/exp/v2c/styles.css` **only if** the earlier type pass has finished and committed (check `git log --oneline` for its commits). If it has not, do everything from `wb2026.css` with an override and say so in your report. Prefer the override either way: it keeps this pass reviewable in one place.
- `.tsx` you may touch, if the change genuinely needs markup: `src/exp/v2c/DmHistory.tsx`, `src/exp/v2c/MagnetsList.tsx`, `src/exp/v2c/Shell.tsx`, `src/exp/v2c/FilterRow.tsx`, `src/exp/v2c/LiveSheet.tsx`/the context sheet host, `src/screens/SendsScreen.tsx`. Check `git log` and `git status` first; if another pass is mid-flight in one of those, do the CSS half and report the deferred markup.
- Never touch `src/styles.css` (the `#exp/stock` control must stay pixel-identical).
- `git add` specific paths only.

## Measure your own before-state first

```
npx vite build --outDir dist-p5
npx vite preview --outDir dist-p5 --port 4176 --strictPort &
node goal-runs/workbench-2026-plan-2026-08-21/tools/measure.mjs --base http://localhost:4176/ --out goal-runs/workbench-2026-plan-2026-08-21/phase5-before --shots
```
Rebuild before every measurement. `tools/refresh.mjs` if lanes render empty. `tools/probe.mjs` drives tabs and clicks for the click-deep surfaces; read its source, it is short, and extend it if you need a different question answered.

## The work

**1. Kill the 860px list cap.** `src/exp/v2c/styles.css:31-40` caps `.wb.dt .wb-solo .rows > *` (plus `.nav`, `.draftbanner`, `.stalebar`, `.seg`, `.swipehint`) at 860px and centers them. `faithful.css:1612` already lifts it for `.ct-rows` only. The cap belongs on the prose measure, not the pane. Remove it as a pane cap; at 2560 a wide canvas should buy a second working pane rather than two fat margins. Keep every prose block inside the 70ch measure the type pass set.

**2. Container queries on `.ct-card`** — the highest payoff change in the repo for its size (~40 lines). The content table carries 736px of fixed grid tracks while the list pane hard-narrows to about 400px whenever a peer docks, so titles collapse and action columns clip. The `narrow` flag (`layout.ts:105`) cannot help: it is only set for non-list jobs and `content` is a list job.

**The guard, and it is not optional:** declare `container-type` **inside `@media (min-width:1000px)` only**. `container-type: inline-size` implies `contain: layout`, which makes `.wb-work` the containing block for the mobile filter sheet's `position: fixed` scrim, and the scrim then stops covering the tab bar. Verify the mobile filter sheet still covers the tab bar at 390 after your change, by screenshot, or the fix has traded a clip for a broken overlay.

**3. The context sheet moves beside the thread** instead of covering it, on the wide canvas, using width the plate already wastes. Its content is the best information design in the app: move it, do not rewrite it. Below the wide canvas it keeps its current behaviour.

**4. DM HISTORY paginates.** One click currently inlines all 213 conversations: body text goes 2,499 → 59,452 characters, controls 12 → 225, unvirtualized, and the expanded state persists across reloads (`DmHistory.tsx`, `useSectionState('dms.history')`). Cap the window and add an explicit "show more". Choose the page size from what the surface is for (scanning recent history), state your reasoning, and keep the count of what is hidden visible. Measured gate: expanded body text stays under 10,000 characters.

**5. The magnet queue rail flips back.** Titles truncate at about 14 characters while metadata wraps to four lines, and rows swing 60 to 110px. Two lines of title, one quiet meta line, one fixed row height. The hierarchy is currently inverted: the identifying text is starved and the secondary text is fed.

**6. The takeover's surplus goes to the inspector.** At 2560 the middle column grows to about 1,968px while its content rides a 640px centered ribbon, and the 360px inspector wraps its prose at 331px. **The 640px LinkedIn artifact measure is correct and must not widen** — widening it makes the preview lie about what the post will look like on LinkedIn. Give the surplus to the inspector instead.

**7. Mobile chrome: four stacked control rows become two.** At 390 a horizontally scrolling job row (clipped mid-word at "St…"), lane pills, search and filters push content roughly 30% down the screen. Two rows, nothing clipped mid-word. Do not delete a control without saying where it went.

**8. `popover` replaces the hand-rolled dismiss hooks** on the Filters sheet (`FilterRow.tsx:55, :127`) and the Sends range menu: the top layer and light-dismiss come for free, `.wb` selectors keep matching, and the hand-rolled Escape/outside-click handlers go away. Baseline is iOS 17+ / all current desktop browsers, which this app already targets. If a surface loses behaviour it had (focus return, nested interaction), keep the hand-rolled version there and say why.

**9. Scope `tabular-nums` off prose.** It is declared once at the `.wb` root (`faithful.css:106`) and inherits into DM bubbles and post previews, padding the digits inside running text. Keep it on numerals that line up in columns (tiles, tables, counts, the `.num` role, and the form controls at `faithful.css:116` which exist because a textarea does not inherit it). Turn it off for running prose: DM bubbles, post bodies and previews, alert bodies, strategy prose.

## Verification

Gates, measured, per surface and per viewport (390 / 1024 / 1440 / 2560), both themes:

- No lane leaves more than 40% of the plate empty at 2560, measured by glyph area, not element hit-testing. `measure.mjs` reports `platePct` from hit-testing, which is the WRONG instrument for this and reported 96% on a 3%-full pane; use the glyph-area method in `tools/probe.mjs` (`textAreaPctOfWork`), and note its known limit: it over-reports on horizontally scrolling tables, so read it only on non-scrolling surfaces.
- At 2560 the DMs lane renders a second working pane.
- The content table does not clip at any width with a peer docked. Verify with a peer actually open, not just at wide viewports.
- The mobile filter sheet scrim still covers the tab bar at 390.
- DM HISTORY expanded stays under 10,000 body characters.
- The LinkedIn artifact measure is still 640px; the inspector is wider than 331px.
- Magnet rail rows have one fixed height, titles get two lines.
- Mobile chrome is two rows, nothing clipped mid-word.
- 0 console errors, 0 real overflow (children of an `overflow-x: auto` scroller are not overflow; `measure.mjs` already excludes them, so if you count overflow another way you will report about 20 phantoms), 0 attempted writes.
- `npm run build` and `npm test` clean, no new failures.

## Deliverable

`goal-runs/workbench-2026-plan-2026-08-21/phase5-layout.md` with 2560 / 1440 / 1024 / 390 before-and-after pairs per surface, the glyph-area fill numbers before and after, the container-query guard verification (the mobile scrim screenshot), and anything deferred because another pass held the file.

Commit in 3-5 logical commits. Never push. Zero em dashes.
