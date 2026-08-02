# Phase 6 — old-dashboard parity gap map

Follow-up scout on `inbox-visual-rebuild-2026-08-02`. Ivan picked candidate `faithful`, then said the new
surface "doesn't show different content stages… and lead magnet stages" and asked if anyone had looked at
how the OLD dashboard (`personal-site`) works. Nobody had. This file is that look, plus the diff against the
new workbench (`ivan-inbox`, branch `exp/brain`, `src/exp/v2c/*`).

Scope: data and structure only. No design opinions, no build recommendation.

## Live-probe note (read this before trusting any row count below)

Per the brief I tried to pull live distinct-status counts for `lm_drafts_v2` and `carousel_drafts` via
PostgREST `count=exact` head probes, using `ivan-inbox/.env.local`'s anon key first, then `.session.json`'s
bearer as fallback, minting nothing new:

- **Anon key → both tables return `content-range: */0`.** RLS blocks anon reads entirely on both tables
  (not a row-count issue — the count itself is 0, i.e. no visible rows at all under anon).
- **`.session.json` bearer → `PGRST303 "JWT expired"`.** The stored session (`expires_at` epoch
  `1785682240`) expired ~2h before this probe ran (probe time epoch `1785689362`). Per the brief I did not
  refresh or mint a replacement token.

**Consequence:** every row/status count below that isn't from a live probe is sourced from dated code
comments in `ivan-inbox/src/lib/content.ts` and `ivan-inbox/src/lib/styles.ts` (a documented 2026-07-31 DB
check the previous build's authors ran), each cited with its file:line. They are the best available
evidence this pass, not a fresh count. If exact current numbers matter for a build decision, that DB check
needs to be re-run with a valid session.

---

## Part A — Post pipeline (carousel_drafts): mostly at parity

| what old dashboard shows | where (file:line) | what new surface shows | gap | data already fetched? |
|---|---|---|---|---|
| 8-stage post pipeline (Idea, Generating, Review, Approved, Scheduled, Published, Disqualified, Error), rendered as collapsible ClickUp-style sections with counts, pinned-open groups | `personal-site/lib/statusLabels.ts:10-19` (POST_STATUSES); `personal-site/components/dashboard/StudioListView.tsx:333-392` (groupByStatus render); `personal-site/components/dashboard/PostStudioPanel.tsx:41-44,247-248` (STATUS_ORDER/PINNED_STATUSES) | 6-stage pipeline (Ideas, Generating, Review, Approved, Scheduled, Published) as collapsible `StageSection`s + a `PipelineBar` stacked-bar summary; Error/Stuck lifted into a separate alert strip instead of being pipeline sections | **No gap in substance** — new surface deliberately moved error/stuck out of the stage flow into `AlertStrip` (a stated design choice, `ContentList.tsx:155-195`), and disqualified is a section named `archived`. Parity is real, just relabeled. | Yes — `useContent(lane)` / `groupByStage` |
| Idea-stage projection from `lm_idea_candidates` (status=reviewing, `content_type='post'`) onto the Posts board | `personal-site/lib/ideaProjection.ts:1-10,60-67` | `IdeasSection` renders **all** `lm_idea_candidates` at status=reviewing, with no `content_type` filter, and that same unfiltered count feeds the Ivan pipeline bar's "ideas" figure | **Gap.** New surface conflates post ideas and lead-magnet ideas into one number and one list; old surface keeps two disjoint idea-stage projections (one per content_type) so "12 post ideas" never quietly includes LM ideas. | Partially — `fetchIdeaCandidates()` (`content.ts:290-301`) has no `content_type` filter or facet |
| Retry / re-fire affordance on rows stuck in "generating" past a threshold (`genAge.ts` age-based heuristic), surfaced as a spinner-retry button in the list | `personal-site/components/dashboard/genAge.ts` (referenced from `PostStudioPanel.tsx:10,542,548`); `StudioListView.tsx:605-619` | Only `isStuckScheduled` exists (`content.ts:164-171`) — a **scheduled** row past its time with no URN. Nothing detects a **generating** row that's been stuck for hours. | **Gap.** A silently-stalled generation (n8n workflow died mid-run) has no signal anywhere in the new surface. | No — no query/derivation exists for it |
| Per-row inline status editor (dropdown), inline date editor (click-to-reschedule), bulk disqualify/delete, drag-to-calendar reschedule | `StudioListView.tsx:128-134,547-588,621-648` | `ReviewActions` offers only Approve / Skip (`ReviewActions.tsx`); no status dropdown, no date editing, no bulk actions | **Gap**, but likely intentional (LOCKED scope note in the goal-run: "behaviour work… out of scope for this run"). Flagging for completeness, not urgency. | N/A |
| Sortable columns: Pillar, Hook, Tier, Format, Source, Strength | `StudioListView.tsx:46-55,506-546` | Pillar and a style "structure" key exist only as **filter facets** (`contentFilters.ts:119-150`), not sortable list columns; Hook, Tier, Strength, Source have no facet or column at all | **Partial gap.** Filterable ≠ sortable/visible-at-a-glance; Hook/Tier/Strength/Source aren't even filterable. | Pillar/structure: yes (facet). Hook/Tier/Strength/Source: no |

## Part B — Lead-magnet pipeline (lm_drafts_v2): the gap Ivan actually named

This is the center of the complaint. The old dashboard treats LM drafts as a **9-stage pipeline**, exactly
mirroring the post board. The new surface treats them as a **flat, unstaged list**.

| what old dashboard shows | where (file:line) | what new surface shows | gap | data already fetched? |
|---|---|---|---|---|
| Canonical 9-stage LM pipeline: Idea → Generating → Generating resources → Review → Approved → Scheduled → Published, plus Disqualified/Error, each a real DB `status` value, legacy values folded to canonical via `normalizeLmStatus` (`draft`→idea, `ready`/`complete`→published, `pending`→idea, `lm_review`→review, `generating_content`→generating) | `personal-site/lib/statusLabels.ts:21-31` (LM_STATUSES); `personal-site/hooks/useLeadMagnets.ts:44-62` (LM_STATUS_ALIASES/normalizeLmStatus); `personal-site/components/dashboard/LeadMagnetStudioPanel.tsx:55-69` (STATUS_ORDER/PINNED_STATUSES) | **No stage concept exists.** `ResourcesSection` (`ContentSections.tsx:225-282`) renders every `lm_drafts_v2` row for the lane in one undifferentiated list, filterable by a `status` facet (`contentFilters.ts:209-214`) but never grouped, counted-per-stage, or ordered as a lifecycle | **THE gap.** No pipeline bar, no per-stage counts, no collapsible Idea/Generating/Review/Approved/Scheduled/Published sections, no legacy-status normalization (a raw `draft`/`ready`/`lm_review` value would render as its own literal status chip, unfolded) — everything Ivan said is missing, is missing. | Rows are fetched (`fetchResources`, `styles.ts:236-250`) but with **no status grouping, no normalization, no stage derivation** applied anywhere downstream |
| ClickUp-style collapsible sections per LM status with counts, pinned-open in-flight stages, published LMs collapsed by default behind a "Library" toggle so the working board isn't buried | `LeadMagnetStudioPanel.tsx:56,124-148,417-431`; `StudioListView.tsx:333-392` | Flat list; published and in-flight rows sit in the same undifferentiated section, no library collapse | **Gap.** A published-heavy LM table (this one accumulates) will visually bury the 1-2 rows actually in flight. | No |
| `generating_assets` as its own visible stage — distinct from `generating` (body-gen vs asset/page/cover build), each with its own age-chip and re-fire semantics | `LeadMagnetStudioPanel.tsx:463-478` | Not modeled at all — no stage taxonomy exists for LM rows in the new surface | **Gap.** | No |
| Idea-stage projection from `lm_idea_candidates` filtered to `content_type !== 'post'` (i.e. actual lead-magnet ideas), rendered on the LM board's own Idea stage | `personal-site/lib/lmIdeaProjection.ts:70-81` | Not modeled — see Part A row 2 above: LM ideas are invisibly folded into the one unfiltered `IdeasSection` | **Gap** (same root cause as Part A row 2 — worth fixing once, fixes both). | Partially |
| Stuck-resource detection (approved/published/live status but no live `landing_url`) | `personal-site` has no direct equivalent — this check is actually a **new-surface improvement** | `isStuckResource()` (`styles.ts:257-262`), surfaced in the alert strip | **No gap — new surface is ahead here.** Noted so it doesn't get discarded while fixing the stage gap. | Yes |

### What the LM stage vocabulary should probably be, restated

From `statusLabels.ts:21-31` + `useLeadMagnets.ts:49-58`, the canonical stage list a rebuild needs to
reproduce is:

`idea → generating → generating_assets → review → approved → scheduled → published`, with `disqualified`
and `error` as off-pipeline/alert states — the exact same shape as `PIPELINE_STAGES` in
`ivan-inbox/src/lib/content.ts:392-394`, plus one extra in-flight stage (`generating_assets`) posts don't
have, plus the legacy-alias fold-in so raw values (`draft`, `ready`, `complete`, `pending`, `lm_review`,
`generating_content`) never leak through as their own phantom statuses.

**This can be built as a `stageOfLm()` + `LM_PIPELINE_STAGES` pair living beside `stageOf()` /
`PIPELINE_STAGES` in `content.ts` (or a new `lib/leadmagnets.ts`), reusing the exact same `StageSection` /
`PipelineBar` components `ContentList.tsx` already has for posts** — the rendering primitives already
exist; only the LM-specific stage derivation and normalization function are missing.

---

## Part C — Other old-dashboard content views the new workbench has no equivalent for

| what old dashboard shows | where (file:line) | new surface | gap |
|---|---|---|---|
| Unified month-grid calendar — posts (emerald) AND lead magnets (violet), distinct glyphs, drag-to-reschedule, "+N more" overflow, mobile agenda fallback | `personal-site/components/dashboard-v2/sections/Calendar.tsx` (whole file); `personal-site/components/dashboard/PostCalendarView.tsx` (whole file, 424 lines) | **None.** `ivan-inbox/src/lib/today.ts:107,187,230-241` has a `content_calendar.entries` field, but it's only a flat "today / next up" list feeding the Today screen — no month view, no LM chips, no drag-reschedule. Confirmed via repo-wide grep: no calendar component exists under `src/exp/`. | **Gap**, and a fairly large one — this is the only surface (old or new) that shows posts and LMs on the same forward-looking timeline. |
| Performance-based per-pillar / per-topic / per-hook breakdown — "which pillars land" bars keyed on **avg impressions + engagement rate** (not row count), min-sample-guarded topic/hook rankings, content-type share, competitor benchmark (avg likes vs named competitors) | `personal-site/components/dashboard/PerformancePanel.tsx:155-382` (pillarData/topicData/hookData/benchmarkData) | `PillarMix` (`ContentSections.tsx:380-420`) exists but is **count-share only** (rows carrying a pillar ÷ total, vs a hand-set target %) — it answers "what did we produce", not "what landed". No topic/hook ranking, no competitor benchmark, no engagement-rate axis anywhere in the new surface. | **Gap — different axis entirely**, not a relabeling. If Ivan wants "which pillars land" specifically (the phrase closest to his complaint), this is the file that answers it, and none of its data (own_posts, competitor stats) is fetched by the new surface at all. |
| Reach vs Capture split — posts scored by impressions vs posts scored by named leads (lead-magnet CTA attribution), separate KPI rows and leaderboards | `PerformancePanel.tsx:26,69-99,511-570` | None | **Gap**, lower priority — this is a performance-analysis view, not a pipeline-stage view, so likely adjacent to Ivan's actual complaint rather than inside it. |
| Reading-first "swipe" review flow (approve/reject/skip with a session tally), auto-falls back to the classic board when the queue is empty | `personal-site/components/dashboard-v2/review/PostReviewFlow.tsx` (345 lines), `LmReviewFlow.tsx` (321 lines) | `ReviewActions` (`ContentList.tsx` cards) offers inline Approve/Skip per card but no dedicated sequential review mode or tally | **Gap**, minor — likely out of this run's LOCKED scope ("behaviour work... out of scope"), noted for completeness only. |

---

## Ranked list — what actually matters for Ivan's complaint

1. **LM pipeline has no stages at all** (Part B, row 1). This is the literal thing he said: "doesn't show...
   lead magnet stages." `ResourcesSection` is a flat, filterable-by-status list; it needs the same
   `stageOf`/`groupByStage`/`PipelineBar`/`StageSection` treatment `content.ts` + `ContentList.tsx` already
   give posts, plus the `generating_assets` stage and the legacy-alias fold that `useLeadMagnets.ts:49-58`
   already solved once in the old code.
2. **Post ideas and LM ideas are conflated** (Part A row 2 / Part B row 4). One unfiltered
   `lm_idea_candidates` fetch feeds both a "post ideas" pipeline-bar number and (nothing, currently) an LM
   idea stage. Splitting by `content_type` fixes both problems with one change to `fetchIdeaCandidates`.
3. **No stuck-generating detection** for either lane (Part A row 3) — a silently-stalled generation is
   invisible on the new surface the same way an unscheduled-approved post used to be invisible on the old
   dashboard (the exact class of bug `content.ts` was built to expose for the *scheduled* case, left unsolved
   for the *generating* case).
4. **No calendar** (Part C row 1) and **no performance-based pillar/topic/hook view** (Part C row 2) — both
   real, both larger builds, both probably a separate decision from "fix the LM stages," but both genuinely
   absent and worth a deliberate call (build vs. explicitly park) rather than staying missing by omission.

## Files referenced

- Old dashboard (`/Users/ivanmanfredi/Desktop/personal-site`): `lib/statusLabels.ts`, `lib/ideaProjection.ts`,
  `lib/lmIdeaProjection.ts`, `hooks/useContentLibrary.ts`, `hooks/useLeadMagnets.ts`,
  `hooks/useContentPipeline.ts`, `components/dashboard/PostStudioPanel.tsx`,
  `components/dashboard/LeadMagnetStudioPanel.tsx`, `components/dashboard/StudioListView.tsx`,
  `components/dashboard/PerformancePanel.tsx`, `components/dashboard/PostCalendarView.tsx`,
  `components/dashboard-v2/sections/Calendar.tsx`, `components/dashboard-v2/sections/Today.tsx`,
  `components/dashboard-v2/review/PostReviewFlow.tsx`, `components/dashboard-v2/useNavBadges.ts`.
- New surface (`/Users/ivanmanfredi/Desktop/ivan-inbox`, branch `exp/brain`): `src/lib/content.ts`,
  `src/lib/styles.ts`, `src/lib/contentFilters.ts`, `src/lib/today.ts`, `src/exp/v2c/ContentList.tsx`,
  `src/exp/v2c/ContentSections.tsx`, `src/exp/v2c/ReviewActions.tsx`.
