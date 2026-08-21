# Phase 3 spec — Today becomes a briefing

Repo `/Users/ivanmanfredi/Desktop/ivan-inbox`, branch `wb/2026-readability`. Read `goal-runs/workbench-2026-plan-2026-08-21/phase0-scope.md` first.

Today is the first screen of Ivan's day. It currently renders machine output: raw telemetry strings, duplicate warnings, an emoji as a severity signal, and 20px dismiss targets.

## File ownership (three passes run in parallel)

- You own: `src/components/SystemAlertStrip.tsx`, `src/lib/systemAlerts.ts` (+ a new test file), and the alert-row parts of `src/screens/TodayScreen.tsx`.
- Your CSS goes ONLY in section **B · TODAY** of `src/exp/v2c/wb2026.css`, every selector at `.wb.wb.wb`.
- Do NOT edit `src/exp/v2c/faithful.css`, `src/exp/v2c/styles.css`, `src/lib/labels.ts` or `src/lib/content.ts` — other passes own those. `git add` specific paths only, never `-A`.
- Never touch `src/styles.css`.

## What was measured on the live surface

84 alert nodes rendering 72 distinct ones. The `bennett-ca` scan warning ships twice, byte-identical. Six warnings share one identical body and never group. The CRITICAL card concatenates a WARN block inside its own string. 14 text blocks run past a comfortable measure. Dismiss targets are 15x20px. Today also carries **37 sub-32px controls** at every viewport, the largest count in the app.

Re-measure all of this yourself before you change anything, and record the before numbers. Do not import them.

## The rebuild

`fetchSystemAlerts` (limit 20) → `rankAlerts` → `SystemAlertStrip` renders a bar plus one `Row` per alert. Change the shaping, not the source contract:

1. **Dedupe on identical body.** Two alerts with the same body are one row. The writer's `dedupe_key` is supposed to prevent this and demonstrably does not, so the UI defends itself. Dedupe on normalized body text (trim, collapse whitespace, case-fold) and keep the newest, most severe instance.
2. **Group by kind with a count.** Alerts sharing a failure shape render as one row that names the shape and counts the instances: `Scan integrity · 4 stores, same failure`. Group members are reachable from the row (see 4), never lost. Derive the group key from `source` plus the normalized body shape (strip digits and ids before comparing, so "store A failed" and "store B failed" group). Digits must be stripped for the COMPARISON only, never from what is displayed.
3. **Lead with the number as a number.** A count buried mid-sentence becomes a figure at the front of the row. Reuse the existing figure tier (`.wb-figure` / `--fs-figure`) rather than inventing a size.
4. **Park raw telemetry behind a disclosure.** The row shows the human sentence and the action; the raw string, ids and the grouped members live behind a native `<details>`/summary or an equivalent already used in this app. Nothing is deleted.
5. **Split the concatenated card.** A CRITICAL card carrying a WARN block inside its own string is two alerts. Split on the embedded severity marker and render two rows.
6. **Replace the emoji severity mark.** The alert strip renders 🔴 as its severity signal. Replace it with a drawn severity mark using the existing tokens `--sev-clear` / `--sev-attention` / `--sev-urgent` (they exist for exactly this and the strip already computes a `TONE` map). Keep the text label ("Critical" / "Warning" / "Note") beside it — color alone is not a signal.
7. **Dismiss targets to 44px** minimum on every viewport, and every other primary target on Today to >=44px at 390px. The visible mark can stay small; the hit area grows (padding, or a `::after` inset overlay — this app already uses that pattern, see the note at `v2c/styles.css:434`).
8. **Measure.** Alert bodies cap at 70ch. Another pass is applying a global measure cap; if your rows are already inside it when you measure, say so and move on.

## Copy rule

An alert must name something actionable today. Rewrite the row copy so each one says what happened and what it means, in plain words. This is UI chrome, not prospect-facing copy, so you may rewrite it freely — but zero em dashes, no AI-tell vocabulary, no false urgency, and never invent a fact the alert row does not carry.

## Verification

Build and measure on YOUR OWN port (other agents hold 4173 and 4174):
```
npx vite build --outDir dist-p3
npx vite preview --outDir dist-p3 --port 4175 --strictPort &
node goal-runs/workbench-2026-plan-2026-08-21/tools/measure.mjs --base http://localhost:4175/ --out goal-runs/workbench-2026-plan-2026-08-21/phase3-after --only today --viewports 390,1440 --shots
npm run build && npm test
```
Rebuild before every measurement. `tools/refresh.mjs` if lanes render empty.

Gates:
- rendered alert node count equals distinct alert count (no duplicate bodies anywhere in the DOM);
- the six identical bodies render as ONE grouped row carrying a count;
- every dismiss and primary target on Today measures >=44px at 390px (the harness reports `u32`/`u44` counts — Today's 37 sub-32px controls must drop, and you must name any that legitimately remain);
- no emoji in the alert strip's severity position;
- 0 console errors, 0 attempted writes (both printed by the harness);
- `npm test` grows by your tests, breaks nothing. `calendarItems.test.ts` has one known pre-existing failure that stays.
- Unit-test the dedupe and grouping functions directly with real-shaped fixtures, including the pair that must group and a pair that must NOT group.

## Deliverable

`goal-runs/workbench-2026-plan-2026-08-21/phase3-today.md`: before/after node and distinct counts (measured, both viewports), the dedupe and grouping rules with their tests, the target-size table, before/after screenshots at 1440 and 390, and anything you left with the reason.

Commit in 2-3 logical commits on `wb/2026-readability`. Never push.
