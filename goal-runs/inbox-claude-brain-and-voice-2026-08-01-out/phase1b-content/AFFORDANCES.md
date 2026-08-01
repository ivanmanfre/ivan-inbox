# Phase 1B — write-affordance matrix + tag/filter spec

**Read-only by default.** The content section may write exactly what the inbox codebase
already writes today. Any row below marked *ships: no* is specified so that arming it later is
a deliberate act with the gate and precondition already written down — it is not a to-do.

---

## 1. The affordance matrix

| # | Action | Lane | Mechanism (exact) | Gate that permits it | Ships this run |
|---|---|---|---|---|---|
| A1 | **Approve a draft** | Ivan | `approveDraft(id)` → `carousel_drafts.update({status:'approved'}).eq('id',id).is('client_id',null)` (`content.ts:233`) | `reviewActionable(status,lane)` = `status==='review' && lane==='ivan'` (`content.ts:260`, unit-tested); confirm sheet; the `.is('client_id', null)` scope makes a mis-routed call a no-op rather than a cross-tenant write | **yes** (already shipped) |
| A2 | **Skip a draft** | Ivan | `skipDraft(id)` → `.update({status: SKIP_STATUS /* 'disqualified' */})`, same scoping (`content.ts:247`) | same gate + a **danger**-styled confirm, because unlike the dashboard's session-local `s`-key skip this write is durable | **yes** (already shipped) |
| A3 | Approve / skip on the Mattan lane | Mattan | — | `reviewActionable` returns false for every non-`ivan` lane, and both writes are `.is('client_id', null)`-scoped anyway — a button here would silently do nothing | **no, and never** |
| A4 | **Promote to Mattan's board** | Mattan | `supabase.rpc('operator_set_board_visible', { p_gate:'clientops', p_draft_id, p_visible })` (`personal-site/…/clientops2/shared.tsx:446`; `GATE` literal at `:21`) | Grant exists: `20260719_rls_closure_waves.sql:450-454` revokes execute from `anon, public` and grants to `authenticated`, and the inbox holds a real authenticated session. **The gate would permit it.** It still does not ship: (a) the inbox exposes no promotion path today; (b) the `status==='review'` precondition lives in ClientOps' *UI*, not in the RPC, so an inbox button would be a weaker gate wearing the same name; (c) a new client-facing artifact is handed over by Ivan personally before any surface can trigger it | **no** |
| A5 | Schedule / reschedule (either lane) | both | `operator_schedule_draft` (Mattan) · direct `carousel_drafts.update({scheduled_at, status:'scheduled'})` (Ivan, `Calendar.tsx`) | 🔴 **Refused on mechanism.** Flipping a draft to `'scheduled'` is exactly what the n8n bridge `yzXqLDIpuNzuhUQq` picks up to publish to LinkedIn. The status is the trigger. `content.ts:220-229` already forbids it in a comment | **no** |
| A6 | Publish / publish-now | both | publish webhook | Nothing in the inbox has ever published. `'approved'` publishes on some lanes elsewhere; A1's confirm copy states the boundary explicitly ("Marks approved. Nothing publishes.") | **no** |
| A7 | Delete a draft or a queue row | both | `delete_scheduled_post` RPC (`useContentPipeline.ts`) | Not in the inbox codebase. No delete affordance exists to extend | **no** |
| A8 | Edit post copy | both | `operator_edit_draft_body` · `client_board_edit_draft[_v2]` | Not in the inbox codebase | **no** |
| A9 | Any write to `lm_drafts_v2` (approve / edit / set cover / set landing) | both | `operator_set_lm_cover`, `setLmActiveCover()`, direct update | 🔴 **Refused on uncertainty.** Whether an n8n watcher treats `status='approved'` as a publish trigger is unverifiable from either repo (`styles.ts:218-221`). An affordance that *might* publish a page is not shipped on a maybe | **no** |
| A10 | Any write to `lm_idea_candidates` (approve / archive an idea) | Ivan | `operator_approve_idea` exists but targets `client_ideas`, a different table | No inbox path; wrong table; and the idea id never dedups, so a write keyed on it is unsafe as a durable decision | **no** |
| A11 | Append a note to `agent_log` | both | `supabase.rpc('append_agent_log', {p_table, p_id, p_agent:'Ivan', p_body})` (`AgentLogFeed.tsx`) | Granted to `authenticated` in the same migration. Still no: the register is evidence of what the machine did, and a human note interleaved into it changes what a later reader thinks the machine said | **no** |
| A12 | Ack an agent alert / complete a reminder | Ivan | `supabase.rpc('dashboard_action', {p_table, p_id, p_field, p_value})` | 🔴 `dashboard_action` is a `SECURITY DEFINER` generic field-setter whose allowlist reaches far past this domain — with different arguments it sets `outreach_campaigns.is_active`, i.e. **arms outreach**. `lib/agent.ts` already contains the correct containment (table/field are module-private consts, never parameters), and this section simply calls none of it | **no** |
| A13 | Send to the WhatsApp assistant | Ivan | `n8nclaw_dashboard_send` RPC | Not content; and the workbench already docks one chat peer. The dashboard's spoofed-webhook fallback is deliberately unported and stays that way | **no** |
| A14 | **Open the Claude peer about a draft** ("Ask Claude") | both | `addPeer(peers,{kind:'chat'})` + the draft's label as `about` (`Shell.tsx`, `DraftPane.tsx:222`) | Client-side state only; no DB write | **yes** (already shipped; this spec adds the lane + register to the context string, IA §5.7) |
| A15 | Switch lane, expand/collapse a stage, jump to a stage, pull-to-refresh, apply a filter | both | React state / re-query | No write | **yes** |

**Net: 4 write-capable actions ship — A1 and A2, both pre-existing, both Ivan-lane,
both `.is('client_id', null)`-scoped; A14 and A15 write nothing.** Eleven refusals, each with
its mechanism and gate named.

### 1.1 Standing prohibitions this matrix encodes

- **Nothing auto-posts to a client**, and nothing in this section can cause a post to reach
  Mattan's board.
- **No affordance may be added that does not already exist in the inbox codebase** — the two
  status writes are the whole surface.
- No optimistic success without a returned row (`Calendar.tsx`'s `.select('id')` guard is the
  precedent: a no-op move must not lie with a success toast).
- An unrecognised `client_id` is excluded, never coalesced into Ivan's lane (the `_r1atest`
  resource row).

---

## 2. Tag spec — the full tag set per row

Every tag below is **read from real data on the row**. Nothing is inferred, defaulted, or
computed from a hardcoded enum. A row that lacks a field shows no tag for it — never "—",
never "unknown", because a fixed skeleton of em-dashes reads as broken rather than sparse
(`DraftPane.tsx:17-19`).

### 2.1 Draft rows (`carousel_drafts`, both lanes)

| Tag | Source | Live values / coverage | Filterable |
|---|---|---|---|
| **Kind** | `type` | Ivan: `text` 91 · `single_image` 91 · `carousel` 15 · `video` 1. Mattan: `single_image` 41 · `text` 26 · `carousel` 17 | **yes** |
| **Stage** | `stageOf(row)` | `PIPELINE_STAGES` + `error`/`stuck`/`archived`/`other` | **yes** (and it is the section grouping) |
| **Board visibility** — *Mattan lane only* | `board_visible === true` (strict; NULL ≠ visible) | 20 on board / 64 internal | **yes — and it is the lane's primary grouping** |
| **Pillar** | `taxonomy.pillar` | Ivan: `methodology` 60 · `translator` 37 · `teardown` 19 · `personal` 15 · `case_study` 10 (57 unset). Mattan: `case_study` 50 · `teardown` 4 (30 unset). 🔴 stored lowercase-snake; the dashboard's target constant is Title Case — key on the raw value, map to a label, never compare to the constant | **yes** |
| **Structure** (the mission's `structure_used`) | `taxonomy.structure_used` — **not** a column; `style_id` is NULL on all 282 rows | `HOW-TO / DECLARATIVE` 26 · `TEARDOWN` 19 · `FRAMEWORK WALKTHROUGH` 14 · `HOT TAKE` 15 · `DATA-LED` 12 · `STORY` 12 · `CONFESSIONAL` 12 · `CASE STUDY` 2 (SHOUTY casing is the live convention) | **yes, family-keyed** |
| **Image style** (the mission's `image_style`) | `taxonomy.image_style` | `Concept Visual` 140 · `Framework Diagram` 26 · `Stat Card` 23 · `Before/After` 10 · `Brand Newsjack` 3 · `Lifestyle Photo` 2 · `Quote Card` 1 · plus free prose on 2 Mattan rows | **yes, family-keyed** |
| **Hook** | `taxonomy.hook_type` | Ivan: `story_opener` 19 · `data_led` 16 · `specific_receipt` 15 · `other` 12 · `quote_cold_open` 10 · `confessional` 10 · `pattern_interrupt` 6. Mattan: `other` 25 · `story` 18 · `story_opener` 10 · `data` 7 … — 🔴 the two lanes use **different spellings of the same idea** (`story` vs `story_opener`, `data` vs `data_led`), which is why facets are built per lane from loaded rows and never from a shared enum | **yes** |
| **Funnel stage** | `funnel_stage` | Ivan: `buyers` 63 · `reach` 49 · `trust` 45 (41 unset). Mattan: `buyers` 57 · `trust` 12 · `reach` 11 (4 unset) | **yes** |
| **Experiment arm** | `taxonomy.experiment.arm` (flattened) | 41 rows, **all Ivan; 0 Mattan** — so the chip is absent on Mattan's lane from data, not from a rule | **yes, Ivan lane** |
| **Source** | `taxonomy.source` (263) + `source_label` + `source_detail.kind`/`.label` | Mattan's labels are human sentences: `From RISE DTC's portfolio` 34 · `From your sales calls` 8 · `Hand-picked` 6 · `From Mattan (Slack 07-27)` 1. Ivan's are mostly NULL (190) | **yes**, on the normalised `kind`; the human label renders but does not become a facet (34 one-off strings would be a facet list longer than the result list) |
| **QA verdict** | `normalizeQa(qa).verdict` | strict: only `PASS` is a pass; `REWRITE_OK`/`FAIL`/missing read amber | **yes** |
| **QA score** | `normalizeQa(qa).score` | present on 163/282; Ivan 158/198 and Mattan 72/84 carry *some* qa | **yes**, as a band (≥80 / 60–79 / <60 / unscored), never a free numeric range — bands survive a scale change, a hardcoded 0–100 assumption does not (live rows use both `82` and `74/90` forms) |
| **Has image** | `normalizeImageUrls(image_urls).length > 0` | Ivan 105/198 · Mattan 70/84 | **yes** — and on the Mattan lane the **empty** case carries the `awaiting_media` re-pin warning (IA §3.4) |
| **Regenerated** | derived: `qa.qa_regen_attempts` or a `QA Regen Loop`/`Stuck Sentinel` entry in `agent_log` | `QA Regen Loop` appears 261 times across the log; `Stuck Sentinel` 121 | **yes** (boolean facet: "was regenerated") |
| **Backfilled evidence** | `qa.backfilled` (65) · any `agent_log` entry with `source='clickup_backfill'` (598 entries) | reconstruction, not a live agent step | **yes** (boolean) |
| **Age** | `updated_at` | — | **yes**, as the existing recency ordering; not a facet |

### 2.2 Idea rows (`lm_idea_candidates`, Ivan lane)

| Tag | Source | Live | Filterable |
|---|---|---|---|
| Source | `source` | `claude_sessions` 20 · `kyle_call` 16 · `calls` 15 · `manual` 1 · `youtube_watch` 1 | **yes** |
| Content type | `content_type` | `post` 50 · `lead_magnet` 3 | **yes** |
| Composite score | `composite_score` | populated on all 53 | **yes**, as a band |
| Sub-scores | `icp_fit_score`, `virality_score`, `gap_score`, `beat_fit_score` | — | no (rendered, not faceted — four numeric facets on 53 rows is a control heavier than its list) |
| Ivan engaged | `ivan_engaged` | true 15 / false 38 | **yes** |
| Format recommendation | `format_recommendation` | — | **yes** |
| Promoted | `promoted_draft_id`/`_table`/`_clickup_task_id` | NULL on all reviewing rows, by definition | no |

### 2.3 Publish-queue rows (`scheduled_posts`, Ivan lane)

| Tag | Source | Live | Filterable |
|---|---|---|---|
| Queue status | `status` ∈ `QUEUE_STATUSES` | `posted` 135 · `cancelled` 15 · `pending` 2 | **yes** — and labelled as a **separate vocabulary** from draft status, never merged |
| Post kind | `post_kind` | `reach` 151 · `capture` 1 | **yes** |
| Platform | `platform` | `linkedin` 150 · `instagram` 2 | **yes** |
| Repost | `is_repost` | true 3 | **yes** |
| Failed | `error_message` non-null | **9 rows** | **yes** — these lift into the alert strip |
| — | `source` | NULL on all 152 | **dropped from the row** |

### 2.4 Resource rows (`lm_drafts_v2`, both lanes)

| Tag | Source | Live | Filterable |
|---|---|---|---|
| Status | `status` | Ivan: `published` 40 · `pending` 37 · `disqualified` 31 · `review` 9 · … Mattan: `disqualified` 2 · `approved` 1 · `live` 1 · `review` 1 | **yes** |
| Format | `format` | — | **yes** |
| Has landing URL | `landing_url` non-null | 🔴 the stuck detector: `approved` + no `landing_url` for 9 days = `bb07706c…`, **Mattan's lane** | **yes** (boolean) |
| Has resource URL | `resource_url` non-null | 44 of Ivan's 121 | **yes** (boolean) — it is what `fetchResources` already filters on |

### 2.5 Style rows (`content_prompts`, both lanes)

| Tag | Source | Live | Filterable |
|---|---|---|---|
| **Family** | `styleFamilyOf(slug)` | `structure` 11 · `image` 6 | **yes — and it is mandatory.** 🔴 The families collide on `before-after`; every preview lookup goes through `previewKeyFor` (family-qualified). Never `normalizeStyleKey` at a call site |
| Recently updated | `updated_at` ≤ 7d | — | **yes** (boolean) |
| Has published examples | `previewsByStyle(laneRows).has(previewKeyFor(p))` | computed per lane; empty is the common case, not the edge case | **yes** (boolean) |

---

## 3. Filter mechanics

1. **Facets are derived from the rows currently loaded in the current lane**, never from a
   hardcoded list. Grounds: the two lanes spell the same hook types differently (`story` vs
   `story_opener`, `data` vs `data_led`); `taxonomy` carries ~25 keys beyond the six in
   `TAXONOMY_KEYS`; `image_style` already contains free prose on two Mattan rows. A hardcoded
   enum would be wrong the next time an agent writes a new value — the same failure mode that
   killed three hardcoded style catalogues.
2. **A facet with zero rows in this lane does not render.** That is how the experiment-arm
   chip disappears on Mattan's lane and how the Instagram platform facet disappears from most
   views — from data, not from a rule.
3. **Filtering is client-side over the already-fetched page**, and the active filter always
   shows both numbers: *"14 of 84 shown"*. Where the server-side exact `count` exceeds
   `rows.length` (PostgREST's 1000 cap), the filter bar says so rather than implying it
   filtered everything there is.
4. **A filter that empties the list renders the filtered-empty state, not the calm empty
   state.** This is the same distinction `fetchLaneProbe` draws at lane level, applied one
   level down: an empty result caused by a filter and an empty lane must never look the same.
5. **Filters are never persisted across lane switches.** A filter carried from Ivan's lane
   into Mattan's would silently hide rows in a lane where the vocabulary differs — the calm,
   wrong, empty board again, one level down.
6. **No filter is a default.** The lane opens showing everything it fetched, with `error`/
   `stuck` lifted above the flow. A default filter is a hidden row.
7. **Sort stays `updated_at` desc** inside every stage, matching the fetch order, so filtering
   never silently reorders.

---

## 4. What a reader of this file should check before arming anything

- The two shipped writes are `.is('client_id', null)`-scoped **in the query**, above any
  limit. Any future write must be scoped the same way, in SQL, not post-fetch.
- `'scheduled'` is a publish trigger (n8n `yzXqLDIpuNzuhUQq`). `'approved'` publishes on some
  lanes elsewhere. Neither status may be written from this section.
- `operator_set_board_visible` is executable by `authenticated` — the grant is not the gate;
  the `status==='review'` precondition is, and it lives in UI, so it travels with any call
  site or it does not exist.
- `dashboard_action` and `append_agent_log` are both granted to `authenticated` and both reach
  far past this domain. Their containment lives in `lib/agent.ts`'s module-private consts, and
  the content section's containment is simply that it calls neither.
