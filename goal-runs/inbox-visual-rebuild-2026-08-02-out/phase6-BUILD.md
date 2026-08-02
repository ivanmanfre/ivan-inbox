# Phase 6 — parity build on candidate `faithful`

Ivan voted `faithful` and gave nine asks. They are built as commits **on top of** the judged commit
`22168ef`, which is untouched underneath. Branch `exp/vis-faithful`, worktree `wt-faithful`, dev server
`:5431`.

Commits, oldest first:

| commit | what |
|---|---|
| `d5523d2` | ask 1 + 8b — content column goes fluid, Sends' second segmented row becomes one pill |
| `00f66e7` | ask 1 verified — two defects the measurement caught in my own first pass |
| `1195e1b` | asks 2/3/6, data layer — LM lifecycle, idea discriminator, stalled-run clock |
| `a1fa47f` | asks 2/3/4/5/6/8a — the LM lane, the chip diet, the QA dot |
| `19735f6` | ask 7 — slash palette, + three defects the instrument caught |
| `3bbb5c5` | ask 9 — voice off by default, + the contrast class the baseline comparison exposed |
| `2b8554a` | the LM row's slot #1 stops repeating its own section header |

Verification: `npm test` **394 passing / 23 files** (16 new), `npm run build` **exit 0**, `npm run lint`
warnings only and all pre-existing. **Zero console errors** from `src/` at 1440 and 390 on both routes.

---

## Ask 1 — "when claude is closed the rest of objects accommodate"

**The premise was half right.** The work column already reclaimed 100% of the canvas when the peer closed
(`layout.ts:119` forces `wide` when the shown-peer list is empty). Its **children** did not: the base spine
caps every direct child of a solo `.rows` at 860px (`src/styles.css:31-36`), and — worse — `faithful.css`
loads after the spine and gives several of those blocks a **fixed** gutter margin (`:1129`,
`margin:14px var(--gut) 0`), which beats the spine's `auto` and killed its centering. So the cap was not
even the "capped but centered" compromise the spine intended: every block hugged the left edge and dumped
the whole reclaim as one lopsided strip on the right.

**Changed:** `src/exp/v2c/faithful.css:1158-1200` — a scoped rule lifting the cap on `.ct-rows > *` and
`.nav.wb-head`. Scoped to Content on purpose: inbox/drafts/thread keep the 860px measure, where a
1,240px-wide **message** row really is a defect. Base file untouched (D1 clean).

**Measured** (`scripts/phase6-reflow.mjs`, re-running the scout's method — session-injected, peer closed via
`.wb-pane-x`, `page.reload()` between states so a hash-only goto cannot leak the previous peer state):

| object | 1440 before | 1440 after | 1680 before | 1680 after |
|---|---|---|---|---|
| column | 620→1240 (100%) | same | 740→1480 (100%) | same |
| `.wb-chartcard` | 587→860 · **44%** · gapL 16 / gapR 364 | 587→1208 · **100%** · gapL 16 / gapR 16 | 707→860 · **21%** · gapR 604 | 707→1448 · **100%** · 16/16 |
| `.ct-alert` | **44%**, left-anchored | **100%**, symmetric | **21%** | **100%** |
| `.ct-filters` | **39%**, gapR 380 | **100%** | **16%** | **100%** |
| stage section `#wb-s-review` | **39%** | **100%** | **16%** | **100%** |

Every main object now grows **100%** of the column's growth, with equal gaps. Bar was ≥80% or centered.

**Two defects in my own first pass, both caught only by re-measuring:**
1. I zeroed the gutter margins as well as the cap — the chart card went flush against the rail (gapL=0).
   Only the cap needed lifting.
2. An unterminated CSS comment swallowed the rule and the numbers went straight back to 21-44%. **CSS fails
   silent**; the instrument is the only thing that knew.

**Judgment call:** `.ct-subtle` / `.ct-subline` (the 1-3 line meta annotations) go fluid with everything
else rather than staying capped. A capped block inside a fluid column is precisely the asymmetric strip
this rule exists to kill, and these are `--fs-meta`/`--text3` annotations, not body copy.

## Ask 2 — lead magnets leave the posts list, and get the 9-stage pipeline

**Live probe first** (`count=exact` head per status, `lm_drafts_v2`, 2026-08-02, fresh session via
`scripts/dev-login.mjs`):

```
pending 37 · published 40 · disqualified 34 · review 10 · complete 2
lm_review 1 · approved 1 · error 1 · live 1                    total 127
  by tenant: client_id NULL 121 · risedtc 5 · _r1atest 1
ZERO rows at: idea · generating · generating_assets · scheduled · draft · ready
              · generating_content · skipped
```

**37 of 127 rows — 29% of the table, its largest single group — sit at the legacy value `pending`.** That
is why the alias fold is load-bearing rather than cosmetic: unfolded, the biggest group in the table renders
as a phantom status belonging to no pipeline.

**Changed:** the model is ported from `personal-site/lib/statusLabels.ts:21-31` (LM_STATUSES) and
`personal-site/hooks/useLeadMagnets.ts:44-62` (LM_STATUS_ALIASES / normalizeLmStatus), **reimplemented** in
this app's conventions rather than copied — `src/lib/styles.ts:266-390`: `normalizeLmStatus`,
`LM_PIPELINE_STAGES`, `LM_STAGE_LABEL`, `stageOfLm`, `groupByLmStage`, `LM_GENERATING_STAGES`,
`isStuckGeneratingLm`, sitting beside this app's `stageOf`/`groupByStage` and reusing its
`StageSection`/`PipelineBar` machinery.

The plot itself was lifted out of `ContentList`'s `PipelineBar` into `Surface.tsx:107-152` as
`CapsuleChart`, so both lanes draw the same chart without either file importing the other.

**Rendered:** `src/exp/v2c/ContentSections.tsx:344-560` — `ResourceLane` replaces the old flat
`ResourcesSection`. Its own boundary rule + `LANE / Lead magnets / 121` header, its own alert strip, its own
7-capsule pipeline chart, its own idea stage, its own stage sections in lifecycle order, its own filter bar.
Placed above `PillarMix` on both lanes (`ContentList.tsx:530`, `:625`).

**The fold, verified on the rendered page** (Ivan lane, 121 rows): Idea **37** (all folded from `pending`),
Needs review **10** (9 `review` + 1 `lm_review`), Published **42** (40 `published` + 2 `complete`),
Errors **1**, Archived **31**. 37+10+42+1+31 = 121. ✅

**Zero-row stages still spend a capsule slot** — measured 7 capsules rendered, 4 of them collapsed stubs
(`.wb-cap-0`). Dropping them would draw a five-stage pipeline that does not exist.

**🔴 Judgment call — `live` is deliberately NOT folded.** It is a real live value (1 row, on Mattan's lane)
and it is **not** in the old dashboard's alias table. Folding it to `published` would be a semantic claim
this build invented rather than ported. It lands in `other`, which is rendered and never dropped. Adding it
is a one-line change to `LM_STATUS_ALIASES` and it is Ivan's call, not a builder's.

**Judgment call:** Mattan's lane gets the lane but **no idea stage** — `lm_idea_candidates` has no tenancy
column at all, so there is no Mattan side of that partition and inventing one would be a cross-tenant claim.

## Ask 3 — idea conflation

**The discriminator exists and was inspected, not inferred:** `lm_idea_candidates.content_type`. Head probes
at `status='reviewing'`, 2026-08-02:

```
post 57 · lead_magnet 3 · NULL 0        total at reviewing 60
whole table (any status): post 734 · lead_magnet 31 · NULL 235
```

**Changed:** `src/lib/content.ts:290-350` — `ideaKindOf`, `splitIdeas`, `fetchIdeaCounts`;
`src/hooks/useContent.ts:160-180` returns `{ split, counts }`. Post ideas feed the post pipeline
(`ContentList.tsx:419` legend now reads **"Post ideas 57 of 57"**, both figures scoped to
`content_type='post'`, the denominator from its own exact probe). Lead-magnet ideas feed the LM lane.

**🔴 It is a PARTITION, not an `.eq('content_type', …)` filter.** Under an equality filter a NULL or
unrecognised row would match **neither** lane and appear on no surface at all — and 235 rows in that table
carry a NULL `content_type`. Unclassified rows ride on the posts lane with an explicit label
("plus N with no content_type, shown here rather than dropped"). Pinned by a test.

Per-kind denominators come from their own `count=exact` probes, never from the 500-capped page — a
proportion drawn off a capped page is the fabricated-figure failure D2 names.

## Ask 4 — collapsible

`IdeasSection` was pinned open with **no toggle at all** (`open` literal, `onToggle={undefined}`), so 57
idea cards stood between the pipeline chart and the first draft needing a decision. Now closed by default
with a raised sticky header carrying the count (`ContentSections.tsx:144-215`, `Surface.tsx:82-100` +
`.wb-sech-sticky`). Measured on the loaded page: header reads `01 Ideas 57 ›`, zero `.ct-idea` rows in the
DOM until clicked, at both 1440 and 390. Page innerText fell from **37,438 → 10,726 chars** — that is the
scrolling Ivan was complaining about.

Published/archived were already closed by default on the post lane (`DEFAULT_OPEN`); the LM lane matches
(`LM_DEFAULT_OPEN` = idea/generating/generating_assets/review/approved). Review is open on both.

**Judgment call — the alert strip keeps its derived open/closed rule** (`open ?? n <= 6`) rather than being
forced open. Ivan's ask said "error/stuck open", but that rule exists because of a measurement recorded in
`ContentList.tsx:251-263`: on the live Ivan lane the strip carries 38 rows, and 38 rows of alert above the
chart put **zero** draft rows in the first 1440×900 viewport. The count, breakdown and chevron are always
visible; a handful still opens on sight.

## Ask 5 — "wtf with that chunk of tags"

| row | before | after (measured on the live page) |
|---|---|---|
| draft row | QA · type · funnel_stage · board-visibility · topic echo (up to 5) | **2** — QA verdict (fixed slot #1) + format. Max=min=2 across all rows, 1440 and 390 |
| idea row | source · content_type · engaged · raw_topic echo · time (4 + time) | **1 chip + time** — measured 2 elements on all 57 rows |
| LM row | — | **1 chip + landing link + time** (3 elements, one of which is a link, not a tag) |

Everything removed moved to the detail pane, which already rendered all of it (`DraftPane.tsx:87` funnel
stage, `:96` topic). On Mattan's lane the board chip is doubly redundant — that lane is **grouped** by it.
On idea rows, `content_type` is now constant inside a split section, so `source` is the informative one
(the brief's "source OR type, pick the more informative").

**A defect the capture caught:** my first LM row put the STAGE in slot #1, so inside the Idea section 37
consecutive rows each said "IDEA" — the section header restated 37 times, which is the tag wall itself.
Slot #1 carries the **format** now; the stage is already said by the section and the anchor dot, and the
raw DB value stays auditable on the chip's `title` so the fold can always be checked.

## Ask 6 — stuck generating

**🔴 The threshold is 20 minutes and it is PORTED, not picked:**
`personal-site/components/dashboard/genAge.ts:11`, `export const STUCK_MINUTES = 20`, already shared by the
old Posts board and the old LM board and already rendered there as the `generating · 24m ⚠` chip. The brief
allowed deriving a p95 from observed generation times *if the old board had none* — it has one, so the
ported number wins. There was nothing to derive from in any case: **zero rows sit at `generating` in either
table today**, so any p95 this build computed would have had an empty sample behind it.

`genAge.ts`'s timestamp rule is ported too: `taxonomy.generating_started_at` when set, else `updated_at`
(LM rows have no dedicated start timestamp). `elapsedMinutes` returns **null, never 0**, when there is
nothing to measure — 0 would claim the run just started.

**Changed:** `src/lib/content.ts:196-240` (`STUCK_GENERATING_MINUTES`, `elapsedMinutes`, `generatingSince`,
`isStuckGenerating`), `src/lib/styles.ts:376-390` (`isStuckGeneratingLm`, covering **both** LM generating
stages). Treatment: amber inset rule on the row (`.ct-stalled`) and slot #1 becomes `47m ⚠` — for that row,
that IS the verdict. Counts join the alert strip on both lanes (`ContentList.tsx:390-410`, LM lane's own
strip).

**Honest state today: 0 rows are stalled**, because 0 rows are generating. The detection ships structural,
same posture as the approved-unscheduled bucket, and is pinned by 6 unit tests rather than by a live row.

## Ask 7 — slash palette

`src/exp/v2c/ChatPane.tsx:25-106` (registry + `matchCommands`), `:355-380` (the dropdown), `:410-430`
(keyboard). `.wb-palette` CSS reuses the `.wb-modelmenu` overlay grammar, the pane's one existing precedent.
No new dependency, no new network call, every command short-circuits before `send()`.

**Measured live:** typing `/` opens **8 options** (`/model default`, 5 model ids, `/retry`, `/stop`), active
= first; ArrowDown moves to `/model claude-opus-4-8`; `/ret` filters to `["/retry"]`; Escape closes it and
clears the field.

**🔴 `/clear` is OMITTED, as the brief allowed.** `useChat` has no reset path — `turns` only grows, and
`retry` pops a tail rather than emptying it — so it needs new state logic, not a keyboard alias for a click
that already works. Outside the "pure wrapper" grant. `/about <off-screen id>` omitted for the same reason.

**A defect the instrument caught and the eye never would:** my first build **filtered unavailable commands
out of the list**. With no turns on the pane, typing `/retry` matched nothing → the palette closed → Enter
sent the literal string "/retry" to the model, which is the exact behaviour this ask exists to end. The
vocabulary never shrinks now: an unavailable command is listed, dimmed, and says why ("nothing to retry
yet"), and running it is a no-op (`chat.retry` and `chat.abort` both already guard internally).

## Ask 8 — the two panel grafts

**(a) 3-colour QA corner dot** (`ContentList.tsx:77-102`, `faithful.css:632-660`). The dot used to encode
the STAGE, which the section header two rows above already names. It carries the QA verdict now, severity
tokens only: green `--sev-clear` a literal PASS, amber `--sev-attention` anything that is not (FAIL /
NEEDS_REGENERATE / REWRITE_OK), grey `--text4` no verdict — the honest third state, and the reason this beats
an amber-only dot: *"not judged"* and *"judged fine"* are different facts. Measured on the live page:
**12 pass / 0 fail / 7 none**. LM rows keep stage keying — that table has no QA column at all.

**(b) `Range: 7d ⌄` pill** (`SendsScreen.tsx:270-305`, `faithful.css:900-925` + a base-sheet floor in
`src/styles.css` so the stock app keeps a working control). The second full-width segmented row is gone:
**measured `.seg` count 2 → 1** at both 1440 and 390, pill reads `Range: 7d ⌄`, right-set beside the display
title in the §11.1 anatomy (label never omitted, value is the active state, no accent fill). Custom date
inputs stay — a value editor, not a second filter chrome, and only after the pill has chosen Custom.

## Ask 9 (Ivan's addendum) — voice off by default

`ChatPane.tsx:108-131` (`voiceEnabled()`), `:196`, `:366`, `:400`, `:449`. The mic, the voice strip and the
hands-free sheet are not **mounted** unless `localStorage['wb-voice'] === 'on'`. **Nothing is deleted** —
`useVoice`, `VoiceControl`, `VoiceStrip`, `HandsFreeSheet` are all still built and wired; re-enable with one
console line + reload. No settings UI this pass, as instructed. Reason is measured, not taste: 38.6% WER on
this engine and `continuous:false` dropping finals mid-sentence, in a control that sits in the composer
where it is the easiest thing to hit by accident.

---

## Spine self-census

`scripts/_verify-faithful-instrument.mjs` (the independent instrument, not the builder's sweep), dark,
session-injected, wait discipline per §12 (`domcontentloaded`, poll skeletons-gone + no literal "Loading" +
innerText settled; **never** `networkidle`). `settled=true` / `loadingGone=true` on every route.

| route / vp | type sizes | fractional | weight ≥700 | accent | pills | contrast fails | doc overflow-x | console err |
|---|---|---|---|---|---|---|---|---|
| content / 1440 | 7 ✅ ≤9 | 0 ✅ | 1 ✅ ≤1 | 25 ✅ ≤30 | 95 | 2 | false ✅ | 0 ✅ |
| content / 390 | 6 ✅ | 0 ✅ | 1 ✅ | 19 ✅ | 90 | 2 | false ✅ | 0 ✅ |
| sends / 1440 | 6 ✅ | 0 ✅ | 1 ✅ | 27 ✅ | 112 | **0** ✅ | false ✅ | 0 ✅ |
| sends / 390 | 6 ✅ | 0 ✅ | 1 ✅ | 22 ✅ | 107 | **0** ✅ | false ✅ | 0 ✅ |

**Rail variance 0** at both viewports (n=66 rows, anchor x = 56 at 390 / 256 at 1440, min=max). **Tail rail
variance 0** (n=66). **Density band 40-47px**, inside the 40-60 band (baseline was 40-41; the LM row's
3-element meta line is the +6).

**Pill licence (§6.3):** the count rose 41 → 95 because more *licensed* elements render, not because a new
class took `999px`. The additions are severity/anchor dots (§6.3 item 6), capsule chart marks including the
zero stubs (item 7) and the Range filter pill (item 3). No row, card, input or categorical chip takes a pill
radius.

**Contrast — and the number only a baseline run could have made honest.** My first census read
`contrastFail=44` on content. Rather than argue it away I stood the judged commit `22168ef` up in a second
worktree on `:5439` and ran the same instrument: **baseline content = 5** (4 × `ct-thumb-empty` @ 3.58,
1 × `wb-cap` @ 4.43). So 42 of my 44 were the *same long-argued class* — the missing-image placeholder —
simply multiplied by 42 thumbless lead-magnet rows.

That class's own comment had always argued it is a **pictogram** under §3.2's 3:1 non-text bar, not body
text. The argument is right; it was just being made about a **text node**, which is why every census kept
scoring it as body text and why the count scaled with row supply. So it is now **drawn instead of typed** —
a bordered `::before`, `aria-hidden`, no text content — identical on screen, and the thing it always claimed
to be. Content contrast fails: **44 → 2, against a baseline of 5.**

The 2 remaining are `.wb-cap` (the value printed inside a capsule, 11px, ratio **4.43** vs the 4.5 bar).
**Pre-existing at the judged commit** (1 there, 2 here only because the LM chart adds a capsule at that cat
colour). Left unchanged deliberately: closing it means moving a `--cat-N-ink` hex, and the §9 colour answer
is not mine to edit in a parity pass. Flagged for the ballot.

## Captures

`goal-runs/inbox-visual-rebuild-2026-08-02-out/phase6-shots/` — all dark, session-injected, settled:
`content-{1440,390}-dark.png`, `content-{1440,390}-lm-lane.png` (lane boundary + header + 7-capsule chart),
`content-{1440,390}-ideas-open.png` (the one-click-open proof; the `-dark` shots are the collapsed proof),
`content-1440-palette.png`, `sends-{1440,390}-dark.png`.

## Omitted / left alone, with reasons

- **`/clear`** — needs new `useChat` state, not a wrapper (ask 7 above).
- **`live` → published** — not in the ported alias table; Ivan's call (ask 2 above).
- **Alert-strip forced-open** — kept the derived rule for a measured reason (ask 4 above).
- **The 2 `wb-cap` contrast misses** — pre-existing, and fixing them edits the colour answer.
- **Calendar and performance-based pillar/topic/hook views** (parity map Part C) — real, large, and outside
  the nine asks. Still absent, still worth a deliberate build-vs-park call.
- **LM write affordances** — the read-only posture is unchanged and deliberate: whether the watcher treats
  `lm_drafts_v2.status='approved'` as a publish trigger is unverifiable from either repo.

Staged by explicit path throughout; `git add -A` never used (D6). No push to `main` (D7). `:root` in
`src/styles.css:1-16` untouched (D1). No new dependency, webfont or `@font-face` (D3). No `ui-serif` (D4).
