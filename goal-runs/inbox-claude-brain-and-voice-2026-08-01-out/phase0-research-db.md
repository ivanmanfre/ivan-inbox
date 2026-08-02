# Phase 0 Research — DB ground truth (inbox-claude-brain-and-voice-2026-08-01)

Read-only, service-role key sourced from `/Users/ivanmanfredi/Desktop/claude-code-railway/main.py:46` (hardcoded default). Supabase project bjbvqvzbzczjbatgmccb, all queries via `curl` against `/rest/v1/...` with `Prefer: count=exact` + `Range` header for exact counts. No writes performed.

---

## 1. claude_memory

**Query:** `GET /rest/v1/claude_memory?select=*&limit=1`
Columns (10): `id, client_id, file_path, content, updated_at, content_hash, embedding, embedding_updated_at, tsv, kind`

No dedicated "tier/type" column — `kind` serves that role (values below). `updated_at` exists (timestamptz). No separate content-size column; measured directly.

**Total row count.** `GET /rest/v1/claude_memory?select=id&limit=1` + `Prefer: count=exact` + `Range: 0-0` →
`content-range: 0-0/1883`

🔴 **CONTRADICTS BRIEFING.** Briefing claims ~400 rows. Actual = **1883**. Not a filtering artifact — this is the unfiltered table count.

**client_id distribution** (fetched all 1883 rows paginated `select=client_id&limit=1000` at offset 0 and 1000, Counter in Python):
```
ivan               1382
unscoped            272
proswppp            158
shared-tech          29
global               28
agencyops             7
risedtc               5
-workspaces-ivan      2
```

**kind distribution** (same pagination, `select=kind`):
```
episodic   1191
semantic    692
```

**file_path shape** (fetched `select=file_path,client_id` all 1883 rows):
- Absolute paths (start with `/`): **exactly 2**, both `client_id = -workspaces-ivan`:
  - `/home/appuser/.claude/projects/-workspaces-ivan/memory/feedback_n8n_url.md`
  - `/home/appuser/.claude/projects/-workspaces-ivan/memory/MEMORY.md`
  ✅ **CONFIRMS BRIEFING** claim of "only 2 absolute paths."
- Top-level prefix distribution (relative paths, first path segment):
  ```
  session-logs   1191
  project         633
  shared           29
  global           28
  /home/appuser     2   (the 2 absolute paths above)
  ```

**Timestamp range.** `order=updated_at.asc/desc&limit=1`:
- oldest: `2026-04-16T22:26:04.841674+00:00`
- newest: `2026-08-01T10:44:17+00:00` (today — table is actively written)

**Content size** (fetched full `content` for all 1883 rows, computed len in Python):
- avg length: **3491.9 chars**
- max length: **51619 chars** (row id 118045)
- min length: **0** (at least one empty-content row exists)

---

## 2. claude_memory_relations

**Query:** `GET /rest/v1/claude_memory_relations?select=*&limit=1`
Columns: `id, from_kind, from_id, to_kind, to_id, relation, metadata, source, client_id, created_at, updated_at`

**Row count.** `Range: 0-0` + count=exact → `content-range: 0-0/14`. Table is nearly empty (14 rows total).

**Relation types present** (fetched all 14 rows, `select=relation,from_kind,to_kind,client_id`):
```
proposal_for   (from_kind=proposal, to_kind=client)   — 8 rows
tracked_in     (from_kind=proposal, to_kind=clickup)  — 6 rows
```
All 14 rows have `client_id=ivan`. This table is currently scoped entirely to proposal↔client / proposal↔clickup linking (source=`gen-proposals-index`) — no other relation types exist yet.

---

## 3. Content counts

### scheduled_posts
- **Total:** `Range:0-0` + count=exact → `content-range: 0-0/152` ✅ **CONFIRMS** the ~152 figure exactly.
- ⚠️ Table has **no `client_id` column** (confirmed via error: `column scheduled_posts.client_id does not exist`, code 42703). This table is single-tenant (Ivan only) — no cross-client scoping column exists here at all.
- **Status distribution** (all 152 rows, `select=status`):
  ```
  posted      135
  cancelled    15
  pending       2
  ```
- Probe row columns: `id, clickup_task_id, post_text, post_format, media_urls, scheduled_at, status, unipile_social_id, unipile_share_url, error_message, created_at, posted_at, updated_at, platform, ig_caption, ig_dm_keyword, ig_dm_reply, is_repost, source, post_kind, lead_magnet_slug`.

### lm_idea_candidates
- **status=reviewing count:** `Range:0-0` + count=exact filtered `status=eq.reviewing` → `content-range: 0-0/48` ✅ **CONFIRMS** briefing's 48.
- **Total:** `content-range: 0-0/1709`.
- **Status distribution** (all 1709 rows):
  ```
  archived    1448
  promoted     197
  reviewing     48
  pending        9
  scored         7
  ```

### lm_drafts_v2
- **Total:** `content-range: 0-0/127`. ⚠️ **Briefing claims 121** — off by 6 (127 actual vs 121 claimed). Not a match; close but not exact — worth re-checking if briefing filtered by something (e.g. excluding disqualified/error rows: 127 − 34 disqualified − 1 error = 92, still not 121; 127 − 1 error − 1 lm_review − 1 live... no clean subtraction hits 121 exactly).
- **Status distribution** (all 127 rows):
  ```
  published     40
  pending        37
  disqualified   34
  review         10
  complete        2
  approved        1
  lm_review       1
  live            1
  error           1
  ```
- Probe row columns (29 total): `id, topic, format, spec, resource_html, resource_url, post_body, email_copy, cover_url, qa, status, gate_keyword, created_at, updated_at, og_url, video_url, workflow_file_id, source_ref, slug, agent_log, topic_strength, notes, source, description, landing_slug, landing_url, landing_copy, campaign_id, vertical_slug, client_id, covers`.

### content_prompts
- **Total:** `content-range: 0-0/129`.
- Columns: `id, slug, title, body, kind, variables, version, is_active, source_page, updated_at, updated_by, category, scope`.
- **Style rows: exactly 17**, confirming the briefing's "~17 claimed" figure precisely. They split into **two colliding families** by `category`:
  - `category = "Carousel layouts"` (11 rows, all `scope=shared`): `style-before-after, style-data-driven, style-educational-breakdown, style-framework-walkthrough, style-myth-busting, style-step-by-step, style-case-study, style-comic-explainer, style-teardown, style-founder-process, style-receipts`
  - `category = "Single-image styles"` (6 rows, all `scope=shared`): `image-style-lifestyle-photo, image-style-framework-diagram, image-style-stat-card, image-style-concept-visual, image-style-before-after, image-style-quote-card`
  - **The collision:** `style-before-after` (carousel layout family) vs `image-style-before-after` (single-image family) — two distinct prompt rows both describing a "before/after" treatment, one for carousels, one for single images. A third near-miss slug exists but is NOT part of either family: `before-after-spec-generator` (category=`Analytics & misc`) — a spec-generation helper, not a style prompt.
  - `scope` distribution overall: `shared 93, client:ivan 11, client:risedtc 8, system 5, ivan 5, risedtc 4, ivan-only 3` (inconsistent scope-naming convention — mixes `client:X`, bare `X`, and `X-only` forms).

### carousel_drafts
- **Total:** `content-range: 0-0/282`.
- **client_id IS NULL (Ivan) count:** `content-range: 0-0/198` ✅ **CONFIRMS** ~198 claimed.
- **client_id=eq.risedtc count:** `content-range: 0-0/84` ✅ **CONFIRMS** ~84 claimed.
- **Status distribution per lane** (all 282 rows, `(client_id, status)` pairs):
  ```
  (Ivan/None,  published)     109
  (risedtc,    review)         70
  (Ivan/None,  disqualified)   69
  (Ivan/None,  review)         16
  (risedtc,    published)       9
  (risedtc,    error)           3
  (Ivan/None,  scheduled)       2
  (risedtc,    disqualified)    2
  (Ivan/None,  error)           2
  ```
- Probe row — full column list (38 cols): `id, title, type, topic, key_points, style_id, slides, authored_html, image_urls, post_body, ig_caption, taxonomy, qa, status, render_cost, scheduled_at, published_at, source_ref, created_at, updated_at, agent_log, topic_strength, render_engine, source_post_id, description, video_url, video_spec, pdf_url, slide_metadata, ig_slide_urls, regen_slides, video_status, video_feedback, video_style, client_id, board_visible, source_label, client_idea_id, source_detail, funnel_stage`.
  - ⚠️ Note on briefing terminology: there is **no column literally named `structure_used` or `image_style`**. The closest equivalents are `style_id` (style prompt reference) and `taxonomy`. The generation/agent log lives in **`agent_log`** (JSON array of `{ts, body, agent, source}` entries). `regen_slides` exists as a separate column (was `null` on every row sampled — regen tracking appears to live inside `agent_log` text, not this column). `board_visible` and `image_urls` confirmed present exactly as named.

---

## 4. Carousel draft with multiple regeneration attempts (DoD proof row)

**id: `792ee91c-5b0e-475b-9150-3bee9937bbb5`** (client_id=None → Ivan lane, status=`published`)
Column holding the log: **`agent_log`** (jsonb array, 37 entries — the longest in the table; queried via full-table scan of `select=id,agent_log,client_id,status` paginated, sorted by `len(agent_log)` descending).

Log excerpt showing multiple full regeneration cycles across ~4 hours on 2026-07-13→14, then publish 5 days later:
```
0  2026-07-13T22:30:51Z  Stuck Sentinel: "Generation stuck — no completion within 23 minutes. Likely a silent workflow chain break."
1-7  2026-07-13T22:51Z   first pass fails — QA/hook/caption all choke on a session-limit error string leaking into generated_post ("You've hit your session limit...")
8  2026-07-14T00:13:11Z  Lint Gate: "VERDICT: PASS after 1 regeneration attempt(s) ... word_cap: 171 words; feed posts cap at 160, trim to core point"
9-14  ...second full pass, QA REWRITE_OK 68/90...
15-21 2026-07-14T01:25-01:28Z  ...third full pass, QA REWRITE_OK 69/90...
22-28 2026-07-14T02:01-02:20Z  ...fourth full pass, QA REWRITE_OK 74/90, new thesis line drafted...
29-35 2026-07-14T02:21-02:24Z  final pass, Lint/Slop/Forbidden-Language/Caption gates all PASS
36  2026-07-19T16:55:42Z  Publisher: "✅ Published via Unipile — social_id: urn:li:activity:7484652191836766209"
```
This is a strong DoD candidate: shows a stuck-sentinel trigger, a leaked-error content failure, and 3+ distinct regeneration/QA cycles before eventual pass, all in one `agent_log` array on one row.

Runner-up rows with comparably long logs (all `client_id=None`/published except one risedtc): `e3e6e511-...` (36), `25813de4-...` (36), `190157cb-...` (36), `e132cd34-...` (30, status=review), `066d4a3e-...` (29, status=disqualified), `e3e1d0c5-...` (27, client_id=risedtc, status=review — best risedtc-lane candidate if the proof needs a non-Ivan tenant).

---

## 5. Stuck / approved-but-undated row

Checked `carousel_drafts` status=`scheduled` (only 2 rows) and `scheduled_posts` status=`pending` (only 2 rows) — **none are actually stuck**: all 4 have `scheduled_at` set to real future dates (2026-08-12, 2026-08-27 — today is 2026-08-01), so they're legitimately queued, not orphaned nulls.

Best real "stuck" candidate found instead, in **lm_drafts_v2**:
**id: `bb07706c-afdf-45ef-ac03-59b1cd8c512f`**, slug `rise-dtc-repeat-customer-report-card`, `client_id=risedtc`, **status=`approved`**, `landing_url=NULL`, `created_at=2026-07-23T01:25:04Z`, `updated_at=2026-07-26T14:55:31Z`. Approved 9 days ago (as of today 2026-08-01) with no landing URL ever populated — an approved resource that never got a live landing page. This is the only `status=approved` row in the whole 127-row table (see status distribution above), so it's a clean singular proof row.

Secondary note: `carousel_drafts` has several `status=review` rows with `scheduled_at=NULL` sitting since 2026-07-17 (e.g. `f3ddece9-8dc8-4ab5-87b2-90201e746204`, `d9f2ebc3-63b0-4e19-a5ba-070e719d659f`, both client_id=risedtc, board_visible=true) — these are "in review, never dated" rather than "approved but undated," a softer version of the same failure mode if a second example is needed.

---

## 6. client_registry — tenants known to the system

**Query:** `GET /rest/v1/client_registry?select=id&limit=1` + count=exact → `content-range: 0-0/8`
**Query:** `GET /rest/v1/client_registry?select=client_id,display_name,is_active&limit=100`

All 8 rows, all `is_active=true`:
```
agencyops    | Agency Ops - PreDemo Agent
secondmile   | SecondMile - Maggie Onboarding
lemonade     | Lemonade
proswppp     | ProSWPPP
the-reeder   | The Reeder
ivan         | Ivan Content System
interlude    | Interlude
risedtc      | RISE DTC (Mattan Danino)
```
Note: `claude_memory.client_id` values seen (`ivan, unscoped, proswppp, shared-tech, global, agencyops, risedtc, -workspaces-ivan`) don't fully align with this registry — `unscoped`, `shared-tech`, `global`, and `-workspaces-ivan` are memory-system-internal pseudo-tenants, not real client rows; conversely `secondmile`, `lemonade`, `the-reeder`, `interlude` are registered clients with **zero** claude_memory rows at all. Useful for the cross-tenant proof: real content tables (carousel_drafts, content_prompts scope=risedtc) only show activity for `ivan` and `risedtc` — the other 6 registered clients have no live content-table footprint in the tables checked here.

---

## Query log summary (for audit)
All queries run via `curl -s "$SUPABASE_URL/rest/v1/<table>?..." -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY"`, with `-H "Prefer: count=exact" -H "Range: 0-0"` for exact counts (reading `content-range` response header), and full pagination (`limit=1000&offset=N`) for distributions, since PostgREST caps default page size. Service key sourced from `/Users/ivanmanfredi/Desktop/claude-code-railway/main.py:46`. Only SELECT/HEAD requests were issued — no writes.
