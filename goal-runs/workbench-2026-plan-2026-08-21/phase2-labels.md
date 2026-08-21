# Phase 2: retiring raw database values, and the Errors tab's reason column

Branch `wb/2026-readability`. Commits `25a3c17` (the label map and its call sites) and `cd7db67`
(the Errors reason column and the Approve demotion). Files touched: `src/lib/labels.ts` (new),
`src/lib/labels.test.ts` (new), `src/lib/content.ts`, `src/exp/v2c/ContentList.tsx`,
`src/exp/v2c/DraftPane.tsx`, `src/exp/v2c/Register.tsx`, `src/exp/v2c/ReviewActions.tsx`,
`src/exp/v2c/ContentSections.tsx`, `src/exp/v2c/fmt.ts`, `src/exp/v2c/wb2026.css` (section A only),
`src/screens/ThreadScreen.tsx`, `src/screens/OpsScreen.tsx`, `src/components/ContextSheet.tsx`,
`src/exp/v2c/ThreadPeer.tsx`. `faithful.css`, `styles.css` and `src/styles.css` were never touched.

## 1. The map

`src/lib/labels.ts` exports two functions over one map.

```ts
export function label(value: string | null | undefined, kind?: LabelKind): string
export function inlineLabel(text: string | null | undefined): string
```

`label()` is for a field where the WHOLE value is the raw token (a status column, a verdict, a
kind). `inlineLabel()` is for a raw token embedded inside a sentence a scorer already wrote
(`icp_reasoning`): it swaps only the known tokens it finds and leaves the surrounding prose
untouched, because running a whole paragraph through `label()`'s fallback would lower-case and
re-join words that were never a database value.

| raw value | label |
|---|---|
| `dm_sent` / `Dm_sent` | DM sent |
| `thread_already_answered` | Already answered |
| `LEAD_MAGNET` / `lead_magnet` | Lead magnet |
| `youtube_watch` | YouTube watch |
| `QA_BLOCKED` | Blocked by QA |
| `LINT_FAIL` | Failed the language check |
| `gold_icp_v2_seatless` | Gold ICP (v2) |

Lookup is case-insensitive (`Dm_sent`, `DM_SENT`, `dM_sEnT` all hit the `dm_sent` entry). A value
already written for a human (a space, no underscore) passes through untouched. Anything else,
today's eight and whatever the pipeline writes next month, degrades to a sentence: split on `_`
and `:`, lower-case, capitalise the first letter. `some_new_enum_v3` renders as `Some new enum v3`,
never as itself and never a crash. 13 unit tests in `src/lib/labels.test.ts` cover every known
value, the case-insensitive path, the unknown-value fallback, null/undefined, the pass-through
rule, and `inlineLabel`'s prose preservation.

`LabelKind` is exported and accepted as a second, currently-unused parameter, reserved for a
future caller where the same raw value needs to read differently in two registers at once. No such
collision exists among the eight values found live, so nothing consumes it today.

## 2. Every call site changed, file:line

Confirmed live before fixing, either by grepping the source or by driving the built app in a real
authed browser and reading `document.body.innerText` for the leak (method below):

- `src/exp/v2c/ContentList.tsx:188` (title attribute) the anchor dot's title attribute,
  `QA {d.qa_verdict}` raw.
- `src/exp/v2c/ContentList.tsx:211` the card's QA chip, `d.qa_verdict` raw (`QA_BLOCKED`,
  `LINT_FAIL` observed live).
- `src/exp/v2c/DraftPane.tsx:1310` and `:1318` the Source tab's tail and chip, `detail.kind` raw
  (`source_detail.kind`, a jsonb field normalised by `normalizeSourceDetail` in `content.ts`).
- `src/exp/v2c/Register.tsx:204` the QA provenance block, `qa.originalVerdict` raw.
- `src/exp/v2c/Register.tsx:225` the QA register's own verdict chip, `qa.verdict` raw (the same
  underlying `qa->>verdict` column as `d.qa_verdict` above).
- `src/exp/v2c/Register.tsx:296` the regeneration history's per-attempt verdict chip, raw.
- `src/exp/v2c/ContentSections.tsx:147` the idea card's closed-row source chip, `i.source` raw
  (routed through `sourceLabel`, not `label`, since it is the taxonomy-source vocabulary).
- `src/exp/v2c/ContentSections.tsx:169` the idea card's expanded-row content-type chip,
  `i.content_type` raw (live values are `post`/`lead_magnet`/null per `content.ts:512-518`; the
  spec's `LEAD_MAGNET` fixture is the uppercase test-casing of the same field).
- `src/exp/v2c/fmt.ts:96` `sourceLabel()`'s fallback for a `taxonomy.source` slug the curated
  `SOURCE_LABEL` map has not seen. This is where `youtube_watch` was actually reaching the screen
  (the Content > Errors tab's SOURCE column, `ContentList.tsx`'s `ct-colv`); the fallback used to
  be `?? s` (return itself), now `?? label(s)`.
- `src/screens/ThreadScreen.tsx:31` the outbound bubble's send-failed micro-label,
  `send_blocked_reason` raw.
- `src/screens/ThreadScreen.tsx:216` the thread header's stage text. This was the actual source
  of `Dm_sent`: a local `stageLabel(s)` function did `s.charAt(0).toUpperCase() + s.slice(1)`,
  first-letter-uppercase with no underscore handling, which is exactly how `dm_sent` became
  `Dm_sent`. The function is deleted; the call site now calls `label(thread.stage)` directly.
- `src/screens/OpsScreen.tsx:537` `ReadOnlyRow`'s "Blocked: {reason}" line, `send_blocked_reason`
  raw. This is Ops' actual `thread_already_answered` leak (see section 4 on the spec's attribution).
- `src/components/ContextSheet.tsx:62` the context sheet's Stage row, `thread.stage` raw.
- `src/components/ContextSheet.tsx:102` the "Why this score" block, `ctx.icp_reasoning`, routed
  through `inlineLabel`, not `label`, because it is a full sentence with a raw token inside it (see
  section 4).
- `src/exp/v2c/ThreadPeer.tsx:32` the thread peer's Ladder, unknown-stage fallback. The ladder
  already draws known stages as a position; a stage this file has not seen used to print itself
  raw rather than draw a guess (a deliberate design choice worth keeping), and now it prints the
  labelled sentence instead of the raw token.

## 3. Errors tab: the reason-field investigation

The spec pointed at `qa_verdict`, `qa->>feedback`, `send_blocked_reason` and the log/lint fields
around `content.ts:1780-1995`. Read in full: `send_blocked_reason` belongs to
`outreach_messages` (the DM/inbox domain, `src/lib/inbox.ts`), not `carousel_drafts` (the content
domain); a content draft has no such column. `qa->>feedback` is real but is only selected on the
detail fetch (`fetchDraftDetail`'s `select('*')`), not on the list query the Errors tab's cards
render from (`content.ts`'s `COLS` constant selects only `qa_verdict:qa->>verdict` and
`qa_score:qa->>score` as jsonb projections). The lines at `content.ts:1780-1995` turned out to be
`parseLogEntry`/`groupLogByAgent`, the AGENT LOG register, a different surface (`DraftPane`'s Log
tab), not the Errors card.

What the list row actually carries, confirmed by reading `content.ts`'s `ContentDraft` type and
`COLS`: `qa_verdict`, `qa_score`, and the full `taxonomy` object (selected whole, not projected).
`taxonomy.error_message` already exists as a concept in this codebase: `DraftPane.tsx:725-727`
reads it via `taxonomyValue(d.taxonomy, 'error_message')` and prints it next to the error chip in
the detail screen, with the comment "that is where an errored row's reason actually lives"
(`content.ts:2174-2176`). The list row simply never rendered it.

Measured live against the real 46-row Errors tab (script drove every card, opened its detail, read
`.ct-err`'s text): 31 rows carry `taxonomy.error_message`, 30 carry a `qa_verdict`, 15 carry both,
and **0 carry neither**. So the union already covers all 46 rows today, but a future row could
still carry neither, and the spec is explicit that it must still say something.

`draftFailureReason()` (`content.ts:2211`) resolves in that priority order: `taxonomy.error_message`
first (the pipeline's own account, e.g. "Generation stuck, no completion within 46 minutes. Likely
a silent workflow chain break."), the labelled `qa_verdict` (optionally with the score) as a
fallback, and `'No reason recorded'` when a row genuinely carries neither, untested by the live
data today but load-bearing for the day a row does.

Rendered at `ContentList.tsx:175` (`const reason = stage === 'error' ? draftFailureReason(d) : null`)
and `ContentList.tsx:252` (`<div className="ct-reason" title={reason}>{reason}</div>`), one line,
meta tier, truncated with the full text in `title`. CSS at `wb2026.css:29`
(`.wb.wb.wb .ct-reason`), section A only, mirroring the one-line-ellipsis treatment `.ct-src`
already carries in `faithful.css`. Computed style read in the real preview (not the declaration):
`font-size:13px, line-height:20.8px` at both 1440 and 390, matching `--fs-meta`, not the
flattener's 16px body tier.

## 4. Approve, demoted on errored rows

`ReviewActions.tsx` (`:38`, `:48`, `:88`) takes a new `demoteApprove?: boolean` prop and swaps the
button's own `btn p` for the `btn s` class Skip already uses, the same secondary treatment already
live in the same component, not a new visual invented for this. `ContentList.tsx:266` passes
`demoteApprove={stage === 'error'}`.

`DraftPane.tsx:1233` carries its own hand-rolled Approve button (`dw-key`/`dw-key p`), separate from
`ReviewActions` despite that component's header comment claiming it is "rendered from two places":
it is not; the detail screen never imports `ReviewActions` at all (confirmed by grep, zero
`<ReviewActions` in `DraftPane.tsx`). Demoted it too, for consistency between the card and the
detail screen on the same row: `className={\`dw-key${d.status === 'error' ? '' : ' p'}\`}`.

Confirmed by computed style in the real preview, not by reading the class name back:

| lane | class | background | text color |
|---|---|---|---|
| Needs review Approve | `btn p` | `rgb(53,53,51)` | `rgb(255,255,255)` |
| Errors Approve | `btn s` | `rgb(42,42,41)` | `rgb(199,199,199)` |

## 5. Before / after evidence

### Raw-enum sweep (`tools/measure.mjs`'s `rawEnum`, which greps rendered text for the eight known
values plus any generic `word_word_word` pattern), all 9 lanes, 1440 and 390

Before (own port, own build, targeted DOM sweep this run): `today` carried
`rise_engager_ads_first` (a real campaign identifier, not a leak, see below); `ops` carried
`thread_already_answered` x5; the Content > Errors tab carried `QA_BLOCKED`, `youtube_watch`,
`LINT_FAIL`; DMs carried `Dm_sent` / `dm_sent`; the context sheet carried `gold_icp_v2_seatless`
embedded in its reasoning sentence.

After (`goal-runs/workbench-2026-plan-2026-08-21/phase2-after/metrics.json`, this run, rebuilt and
re-measured after the interrupt, from a fresh Supabase session against the branch's committed
state):

```
today@1440    rawEnumN=0   dms@1440      rawEnumN=0   content@1440   rawEnumN=0
magnets@1440  rawEnumN=0   styles@1440   rawEnumN=0   strategy@1440  rawEnumN=0
sends@1440    rawEnumN=0   ops@1440      rawEnumN=0   settings@1440  rawEnumN=0
today@390     rawEnumN=0   dms@390       rawEnumN=0   content@390    rawEnumN=0
magnets@390   rawEnumN=0   styles@390    rawEnumN=0   strategy@390   rawEnumN=0
sends@390     rawEnumN=0   ops@390       rawEnumN=0   settings@390   rawEnumN=0
```

0 across all 9 lanes at both viewports. `rise_engager_ads_first` (today's alert strip) was never
one of the eight and is a campaign/anchor identifier the operator needs verbatim to find it in
n8n; it still matches the generic `word_word_word` pattern the instrument also greps for, so it
is a counted false positive, not a miss. It is not UI chrome, it is an id.

Driven separately (a raw-enum sweep only checks default-tab text; the Errors tab and the context
sheet needed a click-through), confirmed 0 after fix:

- Content > Errors tab (card list): 0 raw tokens. `youtube_watch` reads `YouTube watch`, `manual`
  reads `Manual`, `QA_BLOCKED` reads `BLOCKED BY QA` (chip text-transforms uppercase, same as every
  other chip on the row; the underlying string is `Blocked by QA`), `LINT_FAIL` reads
  `FAILED THE LANGUAGE CHECK`.
- DMs thread header + context sheet: 0 raw tokens. `Dm_sent` / `dm_sent` both read `DM sent`.
  `gold_icp_v2_seatless` inside the reasoning sentence reads `Gold ICP (v2)`, the rest of the
  sentence ("comment on Daniel Scharff 1d ago; Shopify single-brand...") untouched.

### Errors tab reason column, DOM-counted (not eyeballed), both viewports

`errors-dom-check.json` (this run, `goal-runs/workbench-2026-plan-2026-08-21/phase2-after/`):

```
1440: cardCount 46, reasonCount 46, dashReasonCount 0, primaryApprove 0, secondaryApprove 46
 390: cardCount 46, reasonCount 46, dashReasonCount 0, primaryApprove 0, secondaryApprove 46
```

Before: 0 of 46 cards carried any `.ct-reason` element at all (it did not exist). The closest
thing on the row, the QA chip, carried some information on 30/46 (`QA_BLOCKED`/`LINT_FAIL` raw) and
a bare dash on 16/46; none of the 46 answered "why did this fail" the way the spec asked for.

After: 46/46 carry a reason, 0 render a dash, 0 primary Approve buttons on the tab, 46 secondary.
0 console errors, 0 attempted writes (both counted by the harness on every run in this file).

Screenshots: `goal-runs/workbench-2026-plan-2026-08-21/phase2-before/shots/errors-{1440,390}-before.png`
(captured from a clean `git worktree` at the commit immediately before this phase's changes, so the
"before" is the real prior state and not a guess) and
`goal-runs/workbench-2026-plan-2026-08-21/phase2-after/shots/errors-{1440,390}-after.png`.

### `npm run build` / `npm test`, final state on the branch

`npm run build` (`tsc -b && vite build`) is green, no errors. `npm test` is 882 passed, 1 failed,
43 files. The 1 failure is `calendarItems.test.ts > "passing no queue is the old behaviour
exactly"`, pre-existing per `phase0-scope.md` and untouched by this phase (not a file this phase
edited). My 13 new tests in `labels.test.ts` are included in the 882.

## 6. Left raw on purpose

- The QA gate's structural key names, `ai_tells_found`, `human_markers_found`,
  `moral_wrap_quote`, `entry_first_event_sentence`, `bait_switch_check`, still render under their
  own field names in the QA detail's gate-detail rows (`Register.tsx`, `KeyRows` over
  `qa.gates`). These are field NAMES, not enum VALUES; the codebase already has a standing rule
  for this exact class of thing one screen over (`ContentSections.tsx:174`: "the scorer's own
  rubric, under its own names, never relabelled into the dashboard's vocabulary, which is a
  different rubric over a different table"). Relabelling them would invent a translation the judge
  never wrote. Left alone on purpose, matching existing codebase philosophy rather than my own
  call.
- `src/exp/cand-a/DraftDetail.tsx:168` renders `{qa.verdict}` raw, the same leak class as
  `Register.tsx:225`. `cand-a` is a separate, non-live experimental candidate screen (not reachable
  from `#exp/v2/*`, the route this phase and the spec scope to). Left untouched to keep the diff
  inside the phase's actual surface.
- `DmHistory.tsx:78, 91-92`, named in the spec as a kind/client_id leak, was already fixed by an
  earlier commit on this branch (`39c1ed7`/`68f4522`, before this phase started): `kind` already
  goes through a local `KIND_LABEL` map and `client_id` is compared against known lane ids, never
  printed raw. `Avatar.tsx`'s `client_id` prop is destructured but never read in the component
  body, a dead prop, nothing renders it. Confirmed by reading the file and by driving a live
  thread through DM history; nothing left to fix there.

## 7. Where the spec and the codebase disagreed

- The spec attributes the `thread_already_answered` leak to `OpsBoard.tsx` "in four places." The
  actual render site is `src/screens/OpsScreen.tsx:537` (`ReadOnlyRow`'s "Blocked: {reason}" line),
  which `OpsBoard.tsx` imports and composes (`OpsGroups`/`PendingCard` from `OpsScreen.tsx`) but
  does not itself contain. Fixed at the real site. Measured count on load was 5 occurrences, not 4;
  live production data, not a fixed count, so the exact number moves between runs. The leak and
  its location are what matter and both are confirmed.
- The spec's line references inside `DraftPane.tsx` (`:1315` for `detail.kind`, `:1206` for a
  verdict render) were close but had drifted from concurrent work on the branch: `:1315` is now
  `:1318`/`:1310`, and `:1206` in the current file is prose (the "not promotable" client note), not
  a verdict render. The actual verdict renders are in `Register.tsx` (the QA tab DraftPane opens),
  fixed there instead.
- The spec frames `qa_verdict`/`qa->>feedback`/`send_blocked_reason` as the Errors reason's
  candidate fields. As detailed in section 3, `send_blocked_reason` does not exist on a content
  draft at all (it is an inbox/DM column), and `qa->>feedback` is not selected on the list query
  the Errors card renders from. The field that is actually selected and actually carries the
  answer is `taxonomy.error_message`, already read by `DraftPane.tsx` for the detail screen and
  simply never wired to the card. The spec's instinct (find where the data already lives, do not
  guess) was right even where its named fields were not the real ones.
