# Phase 2 spec — retire raw database values, give Errors its reason back

Repo `/Users/ivanmanfredi/Desktop/ivan-inbox`, branch `wb/2026-readability`. Read `goal-runs/workbench-2026-plan-2026-08-21/phase0-scope.md` first.

## File ownership (another pass is editing CSS at the same time)

- You own: **`src/lib/labels.ts` (new)**, and the `.tsx` call sites listed below.
- Your CSS, if any, goes ONLY in section **A · LABELS** of `src/exp/v2c/wb2026.css`. Do not edit `faithful.css` or `v2c/styles.css` — a parallel pass owns those and you will collide.
- Never touch `src/styles.css` (the `#exp/stock` control) or any `.test.ts` expectation without saying so.

## 1. The label map

Create `src/lib/labels.ts` exporting one function that turns a raw database value into human words, plus the maps behind it. Fix the CLASS, not the eight instances: any component that renders a value straight out of a row goes through this.

```ts
export function label(value: string | null | undefined, kind?: LabelKind): string
```

Rules the map must satisfy:
- Known values get real words: `dm_sent` / `Dm_sent` → `DM sent` · `thread_already_answered` → `Already answered` · `LEAD_MAGNET` → `Lead magnet` · `youtube_watch` → `YouTube watch` · `QA_BLOCKED` → `Blocked by QA` · `LINT_FAIL` → `Failed the language check` · `gold_icp_v2_seatless` → `Gold ICP (v2)`.
- Case-insensitive lookup, so `dm_sent` and `Dm_sent` hit the same entry.
- **Unknown values must degrade to readable, never to a crash and never to a bare code**: strip the prefix noise, replace `_` with a space, sentence-case it. `some_new_enum_v3` → `Some new enum v3`. A new database value must never ship a raw token to the screen again.
- Values that are already human (contain a space and no underscore) pass through untouched.
- Keep it pure and dependency-free, and unit-test it: add `src/lib/labels.test.ts` covering each known value, the case-insensitive path, the unknown-value fallback, null/undefined, and the pass-through.

## 2. Call sites

Find every place a raw row value reaches JSX. Confirmed starting points (verify each, and grep for more — `{d.` / `{t.` / `{a.` interpolations of status/kind/reason/verdict fields):

- `src/exp/v2c/DraftPane.tsx:1315` renders `{detail.kind}` (source kind).
- `src/exp/v2c/DraftPane.tsx` around :1206 and the QA tab renders verdict values.
- `src/exp/v2c/ContentList.tsx:203` renders `{d.qa_verdict}` in the chip.
- `src/exp/v2c/DmHistory.tsx:78, :91-92` — kind and client id.
- The thread header and the context sheet render `Dm_sent` / `dm_sent`.
- Ops (`src/exp/v2c/OpsBoard.tsx`) renders `thread_already_answered`, in four places, and some rows are nothing but the reason code — those rows need a real sentence, not a prettier token.
- Score reasoning renders `gold_icp_v2_seatless`.

**Do not change any string that reaches a prospect.** You are relabelling UI chrome only. `message_text`, DM/connect copy and `content_prompts` rows are untouchable.

## 3. The Errors tab reason column

The Content lane's `Errors` tab renders **46 rows**; 44 of them show a bare `—` where the failure reason belongs. The data exists — it drives the two chips that do appear.

- Find where the errored row's failure information lives (`qa_verdict`, `qa->>feedback`, `send_blocked_reason`, the log/lint fields in `src/lib/content.ts` around :1780-1995 — read it, do not guess) and render it, through the label map, on all 46 rows.
- One line, meta tier, truncated to one line with the full text in `title`. It answers "why did this fail" at a glance.
- If a row genuinely has no reason recorded, say so in words (`No reason recorded`), never a dash. An unknown must render as an honest sentence, not as silence.
- **Demote Approve on errored rows.** It currently renders at primary weight on rows that failed. It stays available, it stops looking like the recommended action (secondary treatment; find how other secondary actions are drawn in `ReviewActions.tsx` and match them).

## 4. Verification

```
npm run build && npm test
npx vite preview --port 4173 --strictPort &    # if not already up
node goal-runs/workbench-2026-plan-2026-08-21/tools/probe.mjs --lane content --vw 1440 --tab Errors
node goal-runs/workbench-2026-plan-2026-08-21/tools/probe.mjs --lane content --vw 390 --tab Errors
```
`npm run build` before every probe: the preview serves `dist/`. Refresh the session with `tools/refresh.mjs` if lanes render empty.

Gates:
- A grep of the rendered page text finds **zero** of the eight raw values, on every lane and both viewports. Use `probe.mjs` output plus `tools/measure.mjs --out .../phase2-after` and read `rawEnum` in the metrics for each lane — it already greps rendered text for `[a-z]+_[a-z]+_[a-z_]+` patterns. Target: `rawEnumN` drops to 0 (or only false positives you can name, e.g. an id the operator needs verbatim).
- All 46 Errors rows carry a reason; 0 render a dash. Count it in the DOM, do not eyeball.
- `npm test` pass count grows by your new tests and no existing test breaks. One pre-existing failure (`calendarItems.test.ts`) is known and stays.
- 0 console errors, 0 attempted writes (the probe prints both).
- Screenshots of the Errors tab at 1440 and 390, before and after. `baseline/shots/` holds the before set.

## 5. Deliverable

`goal-runs/workbench-2026-plan-2026-08-21/phase2-labels.md`: the map, every call site you changed with file:line, the before/after Errors tab evidence (counts and screenshots), the reason-field investigation (what field actually carries the failure and how you proved it), and anything you left raw on purpose with the reason.

Commit in 2-3 logical commits on `wb/2026-readability`. Never push. Zero em dashes in code, comments, UI strings or the report.
