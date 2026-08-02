# Phase 1B — surface-or-drop decision table

Every one of the **29 value-level exports** of `src/lib/content.ts` (14 pure `type` aliases
excluded — the mission's "29" counts values, verified by direct count) plus the **4 row sets**
named in the mission. **33 required rows, 33 present, no gaps.** Two appendices cover the
`styles.ts` and `agent.ts` exports the IA also depends on.

Legend — **Surface**: rendered by, or directly powering, something a human sees, with the IA
section that owns it. **Drop**: not surfaced, with the reason. **Engine**: not rendered
itself, but load-bearing behind something that is (dropping it breaks a surface).
"Used today" = consumed by the shipped v2c build (`ContentList` / `DraftPane` /
`ReviewActions` / `useContent` / `useContentBadge`).

---

## A. `src/lib/content.ts` — 29 value exports

| # | Export | Kind | Used today | Decision | Where / why |
|---|---|---|---|---|---|
| 1 | `ACTIVE_STATUSES` | const | internal only | **Engine** | `review,error,generating,approved,scheduled` — the "fetch regardless of age" set inside `fetchContentDrafts`/`fetchLaneProbe`. An approved post from 90 days ago that never got a date is exactly the backlog IA §2.4 exists to expose. Never rendered as a list. |
| 2 | `RECENT_DAYS` | const | internal only | **Engine** | 60. Half of the recent-OR-active filter. Surfaced only as prose in the filter-ate-everything error state ("the recent-or-active filter ate them"), never as a number. |
| 3 | `ARCHIVED_STATUSES` | const | internal only | **Engine** | `disqualified, skipped`. Feeds `stageOf`/`bucketDrafts`' archived branch (IA §2.1, 69 Ivan rows). |
| 4 | `laneFilter` | fn | **no** (unused by UI) | **Surface — promoted to mandatory** | IA §0. The whole two-lane IA rests on it. `.eq('client_id','ivan')` returns zero rows and renders a calm, wrong, empty board. Every read in IA §7 goes through it; nothing may query `client_id` by hand. |
| 5 | `draftLane` | fn | no | **Engine** | NULL→`'ivan'` coalesce at the consumption layer, matching every other screen (`today.ts:199 rowClient`). Needed the moment a row is displayed outside a lane-scoped list (the merged alert strip, IA §2.3, mixes queue rows and draft rows). |
| 6 | `bucketDrafts` | fn | yes (`useContent`) | **Engine** | 9 triage buckets. IA §2.1 renders the **lifecycle** grouping, not triage — but buckets stay as the engine behind counts and behind `cand-b`'s shape contract (`useContent` returns `buckets` first and unchanged on purpose). Not a second competing board. |
| 7 | `isStuckScheduled` | fn | via `bucketDrafts`/`stageOf` | **Surface** | IA §2.4 alert strip. 0 rows today; ships anyway — the trap is structural, not empirical. Also covers the no-`scheduled_at`-at-all case, which is invisible on the dashboard *and* can never fire. |
| 8 | `QUEUE_STATUSES` | const | **no** | **Surface** | IA §2.3. `pending,queued_v2,posting,posted,failed,cancelled` — `scheduled_posts`' own vocabulary, unrelated to `carousel_drafts.status`. Renders as the queue strip's status chips. Live: posted 135 / cancelled 15 / pending 2. |
| 9 | `SKIP_STATUS` | const | literal only | **Engine** | `'disqualified'`. `ReviewActions` currently hardcodes the string; the const is the durable-decision marker that separates this from the dashboard's session-local `s`-key skip (which writes nothing and evaporates on reload). Kept so the confirm-sheet copy and the write can never drift apart. |
| 10 | `reviewActionable` | fn | yes (`ContentList`, `DraftPane`) | **Surface** | IA §3.3/§3.7. One rule, two call sites: `status==='review' && lane==='ivan'`. This is what keeps the Mattan lane read-only, and it is unit-tested. |
| 11 | `PIPELINE_STAGES` | const | yes | **Surface** | IA §2.1. IS the render order of the queue and the stage rail — there is no second ordering constant to keep in sync. |
| 12 | `ALERT_STAGES` | const | yes | **Surface** | IA §2.1/§2.3. `error`,`stuck` lifted above the flow. Extended by this spec to also receive queue rows carrying `error_message` (9 rows) and the stuck resource row (`bb07706c`). |
| 13 | `STAGE_LABEL` | const | yes | **Surface** | Section headers and the stage chip. |
| 14 | `stageOf` | fn | yes | **Surface** | One row → one stage. Branch order is load-bearing: `scheduled` is tested for stuck-ness *before* it counts as scheduled. |
| 15 | `groupByStage` | fn | yes | **Surface** | The Ivan lane's primary grouping. On the Mattan lane it becomes the **secondary** key inside the promotion groups (IA §3.2) — same function, different nesting. |
| 16 | `countUndated` | fn | yes | **Surface** | The approved-black-hole counter, as the `wb-pipe-warn` figure and the Approved sub-line. 0 today. |
| 17 | `countBoardVisible` | fn | yes | **Surface — promoted to the Mattan lane's primary grouping** | IA §3.2. Strict `=== true`; absence of the flag is not evidence of promotion. 20 of 84. |
| 18 | `normalizeAgentLog` | fn | yes (`DraftPane`) | **Surface — must be extended** | IA §5.4. Returns `{ts, body}` and **discards `agent` (2 999 entries) and `source`**, so 37 log entries render with no idea who wrote them. Spec extends the return type to `{ts, agent, body, source, comment_id}` keeping every never-throws property. Largest single field gap in the section. |
| 19 | `normalizeQa` | fn | yes (`DraftPane`) | **Surface — must be extended** | IA §5.2. Reads 3 of the 23 live `qa` keys; drops `rewrite_text` (150 rows) — *what actually shipped when a gate rewrote the post*. Keeps the strict `verdict==='PASS'` rule: REWRITE_OK/FAIL/missing all read amber. |
| 20 | `TAXONOMY_KEYS` | const | **no** | **Surface — as the ordered head of a longer list** | IA §5.6. The 6 known keys render first, in this order; the ~25 further live keys render after them, so a key the generator adds next month appears without a code edit. Dropping the const would lose the deliberate ordering. |
| 21 | `taxonomyFields` | fn | yes (`DraftPane`) | **Surface — must be extended** | IA §5.6. Correctly handles the bare-string-is-`structure_used` collision (4 rows) and flattens `experiment.arm`. Extended to also emit the unknown-key remainder rather than silently dropping ~25 keys. |
| 22 | `normalizeKeyPoints` | fn | yes | **Surface** | IA §5.5. Only 13 rows carry key points; renders when present, nothing when not. |
| 23 | `normalizeImageUrls` | fn | yes | **Surface** | IA §5.5. Handles the single-bare-URL shape that would otherwise render as a row of one-character images. Its **empty** result is load-bearing on the Mattan lane (the `awaiting_media` re-pin warning, IA §3.4). |
| 24 | `fetchContentDrafts` | async | yes | **Surface** | R1. Lane-scoped, recent-OR-active, `.limit(1000)`, exact count. |
| 25 | `fetchScheduledQueue` | async | **no** | **Surface — first consumer** | R4 / IA §2.3. The 152 `scheduled_posts` rows are read by nothing in the UI today. Note it takes no lane argument and needs none: the table has no `client_id` column at all. |
| 26 | `fetchLaneProbe` | async | yes | **Surface** | R2. `{scoped,total}` is what makes "empty lane" and "the filter ate everything" render differently. Neither the dashboard nor this app could tell them apart before it existed. |
| 27 | `approveDraft` | async | yes (`ReviewActions`) | **Surface — Ivan lane only** | The only two writes in the section. `status='approved'`, `.is('client_id', null)`. Does **not** publish: publishing needs `scheduled_at` + `status='scheduled'`, which is what the n8n bridge picks up. Confirm-sheet copy says exactly that. |
| 28 | `skipDraft` | async | yes | **Surface — Ivan lane only** | `status='disqualified'`, same scoping. A durable decision, hence a danger-styled confirm. |
| 29 | `fetchDraftDetail` | async | yes | **Surface** | R3. `select('*')` on purpose — a hand-maintained column list would silently start hiding fields the day an agent writes a new one. Returns `null` (not an error) for a gone row so deleted ≠ unreadable. |

**Tally A — 29 rows: 19 Surface · 10 Engine · 0 Drop.** Nothing in `content.ts` is dead.
Three (`#18`, `#19`, `#21`) surface today but lose real fields and are specified as extensions.
Four (`#4`, `#8`, `#20`, `#25`) are unused today and are surfaced by this IA.

---

## B. The four row sets

| # | Row set | Live count (2026-08-01) | Decision | Where / why |
|---|---|---|---|---|
| 30 | **`scheduled_posts`** | **152** — posted 135 · cancelled 15 · pending 2 (2026-08-12, 2026-08-27, both genuinely future) | **Surface — Ivan lane, read-only** | IA §2.3. No `client_id` column exists (`42703`), so it is Ivan's *by construction*, not by filter. Renders as a strip inside the Ivan lane's Scheduled section answering "did the scheduled thing actually go out". Carries `post_kind` (reach 151/capture 1), `platform` (linkedin 150/instagram 2), `is_repost` (3), `posted_at`, `unipile_share_url`, `clickup_task_id` (148). **The 9 rows with `error_message` are lifted into the alert strip** — the only place a publish failure is written down. `source` is NULL on all 152 → dropped from the row. No write, ever: flipping a status here or on the paired draft is what makes n8n publish. |
| 31 | **`lm_idea_candidates` at `status='reviewing'`** | **53** (Phase 0 read 48 the same day; content-radar writes this table live — both are correct at their instant, and the IA never hardcodes either) | **Surface — Ivan lane, read-only, as the Ideas stage** | IA §2.2. No `client_id`, and `workspace_type`/`campaign_id` are NULL on all 53 → Ivan by construction. Renders `normalized_topic`, `composite_score` (on all 53), the four sub-scores, `why_score`, `source` (claude_sessions 20 · kyle_call 16 · calls 15 · manual 1 · youtube_watch 1), `content_type` (post 50/lead_magnet 3), `post_angle`, `ivan_engaged` (15), `source_ref`/`slack_permalink`, and the `promoted_draft_*` link. 🔴 Idea identity derives from the LLM's own title and never dedups — so: count rows not topics, never key UI state on the id across refreshes, never dedup client-side. No approve affordance (`operator_approve_idea` is client-scoped and lives on ClientOps). |
| 32 | **`lm_drafts_v2`** | **127 = 121 Ivan · 5 Mattan · 1 `_r1atest`**; Ivan rows with a `resource_url`: 44 | **Surface — both lanes, strictly read-only; one row dropped** | IA §3.5/§4.3/§4.4. 🔴 **Read-only on purpose** — whether the publish watcher treats `status='approved'` as a trigger is unverifiable from either repo, so no approve/edit affordance may exist that might turn out to publish a page. The briefing's "121" was the Ivan lane; Phase 0's "127" was the table. `fetchResources()` is hardcoded `.is('client_id', null)` and therefore **cannot see the stuck proof row** `bb07706c…` (`client_id='risedtc'`, `approved` since 07-23, `landing_url` NULL 9 days) — it needs a lane parameter, which is a read change. The `_r1atest` row is **dropped**: an unrecognised tenant is excluded, never coalesced into Ivan's lane. |
| 33 | **`content_prompts` style rows** | **17** = 11 `Carousel layouts` (structure) + 6 `Single-image styles` (image), all `scope=shared` | **Surface — inside both lanes, previews computed per lane** | IA §4.1. Enumerated live, never hardcoded (three historical hardcoded catalogues were each wrong the next day). 🔴 The two families **collide on `before-after`** — `previewKeyFor` (family-qualified) is the only permitted lookup; a family-blind key hands the image family's 10 published Before/After examples to the structure card. Previews come from the current lane's published rows, so Ivan's roster shows Concept Visual 140 / Framework Diagram 26 / Stat Card 23 / Before/After 10 while Mattan's is Concept Visual 71 and almost nothing else — an empty preview is a designed state, a wrong preview is a lie. |

**Tally B — 4 rows: 4 Surface (1 with a sub-row dropped).**

**Grand total: 33 decisions — 23 Surface · 10 Engine · 0 wholesale Drop · 1 sub-row drop
(`_r1atest`).**

---

## Appendix C — `src/lib/styles.ts` value exports (10)

Required because IA §4 surfaces the roster and resources. Not part of the mandated 33.

| Export | Decision | Why |
|---|---|---|
| `styleFamilyOf` | Engine | Prefix test, not a guess. The image test must run first: `image-style-x` *contains* `style-` without having it as a prefix. |
| `fetchStyleRoster` | Surface (R5) | `or('slug.like.style-*,slug.like.image-style-*')` + `is_active`. Fetching only `style-*` is what left the image family off the roster historically. |
| `normalizeStyleKey` | Engine — **never a call site** | Family-blind by design; `previewKeyFor` re-attaches the family. Also deliberately non-fuzzy: `DATA-LED` and `style-data-driven` stay unmatched forever rather than silently cross-wiring two styles' examples. |
| `cleanStyleTitle` | Surface | Strips the family prose prefix ("Style: ", "Carousel Style — ", "Post Image — ") since the section header already says the family. |
| `styleKeysOf` | Engine | Splits a draft's claims by family, incl. the bare-string-taxonomy case. Returning one flat list is what would let 71 Concept Visual image examples land on a structure card. |
| `MAX_PREVIEW_IMAGES` | Engine | 6. Past that it is payload. |
| `previewKey` | Engine | The `${family}:${key}` join string, exported so no UI hand-rolls it. |
| `previewKeyFor` | **Surface — the only permitted lookup** | The collision fix, per the mission's load-bearing trap. |
| `previewsByStyle` | Surface | Published rows → per-style previews, newest first. Called **per lane** by this IA. |
| `fetchResources` | Surface (R6) — **needs a lane parameter** | Currently `.is('client_id', null)`, which hides Mattan's 5 rows including the stuck proof row. |

## Appendix D — `src/lib/agent.ts`, only the parts IA §6 places

`agent.ts` and `useAgent.ts` are consumed **only** by the retired `cand-a/b/c` shells; v2c
reads none of them today.

| Export | Decision | Why |
|---|---|---|
| `fetchAlerts` + `ALERT_WINDOW_DAYS` + `alertWindowCutoff` + `unsentAlerts` | **Surface — Ivan lane alert strip, count line only** | All 20 live alerts are `pipeline_stall`, all unacknowledged, newest 68 days old → every one falls outside the 14-day window, so the windowed list is legitimately empty and `olderUnsent=20` is the whole story. Their `data.tasks[]` carries ClickUp task ids, not draft uuids → **no deep link is possible** and none is faked. |
| `fetchDailySummaries` | **Surface — Ivan lane, collapsed, bottom** | Read-only: date · `message_count` · `summary` · `topics` · `action_items`. |
| `ackAlert`, `ackReminder`, `ALERT_TABLE`/`ALERT_FIELD`/`REMINDER_TABLE`/`REMINDER_FIELD` | **Drop (no write ships)** | These go through `dashboard_action`, a `SECURITY DEFINER` generic field-setter whose allowlist reaches far past this domain (it will set `outreach_campaigns.is_active`, i.e. **arm outreach**). `agent.ts` already contains it correctly — table/field are module-private consts, not parameters — but the content section adds no write this run, so nothing calls it. |
| `fetchReminders` | **Drop from the content section** | 35 rows, 11 pending, all personal (`💊 Take your RETA`, `Cancel ClassPass`). Zero content semantics; a medication reminder inside a content pipeline is a category error. |
| `fetchChat`, `fetchChatBefore`, `sendChat`, `CHAT_PAGE_SIZE`, `chatDayKey`, `needsDaySeparator`, `startsTurn`, `latestAssistantId` | **Drop from the content section** | The workbench already docks one chat peer (Claude). A second, different chat living inside a content lane teaches that the two are the same assistant. `sendChat`'s hardened RPC-only posture (the dashboard's spoofed-WhatsApp-webhook fallback deliberately not ported) stands unused rather than being weakened. |
