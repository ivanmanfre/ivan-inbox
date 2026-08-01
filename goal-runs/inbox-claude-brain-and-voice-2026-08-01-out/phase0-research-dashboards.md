# Phase 0 research — dashboard-v2 + ClientBoardPage field inventory

Repo: `/Users/ivanmanfredi/Desktop/personal-site` (read-only pass). Line refs are to the
files as they exist right now.

---

## 1. `components/dashboard-v2/sections/ClientOps.tsx` (+ `clientops2/shared.tsx`)

Round-2 tournament-winner cockpit. Single component, four "cockpit areas": Content
(default) / Outreach / Leads, plus a production-line stage strip.

### Health strip (5 tiles, `ClientOps.tsx:213-237`)
| Tile | Source | Notes |
|---|---|---|
| Avg idea-ICP | `aggregates.avgIcp` (mean of `Idea.icp_score` over staged ideas) | band label via `icpBand()` |
| Avg draft-QA | `aggregates.avgQa` (mean of `Draft.qa_score`) | 1 decimal |
| LM capture | `captures/views` across all client LMs' `funnel` | shows `captures of views · N complete` |
| Buffer | `aggregates.bufferDepth` = board-JSON `queue.length` | `next {date}` if `nextPublish` set |
| Spend | `client.spend.total_usd` / `.week_usd` | from `operator_clients_overview` |
No red anywhere on this strip by design ("denominators only, no red").

### Stage strip (hero, `ClientOps.tsx:192-211`)
01 Staged ideas → 02 In review (the ONLY red-if->0 count in the whole composition) →
03 On board → 04 In buffer. Counts are `ideasStaged`, `reviewDrafts.length`,
`liveDrafts.length` (board_visible=true), `bufferDepth ?? scheduledDrafts.length`.

### Ideas lane (`IdeasLane`, line 420+)
Dense table: Band (`icpBand`) · Angle (hook/title + `score_breakdown.why`) · ICP·Buy·Auth
scores (`score_breakdown.icp_fit/buyer_signal/authority_fit`, out of 40/30/30) · Source
(label + link if URL) · Approve/Pass buttons → `operator_approve_idea` RPC
(`p_decision: 'approved'|'rejected'`). Inspect panel on the right shows the same score
breakdown plus `rubric_version` and **`AgentLogFeed`** (full agent log for that idea row,
table=`client_ideas`).

### Review lane (`ReviewLane`, line 519+)
Client-faithful post preview (`ClientPost` component — mimics LinkedIn UI using the
client's own founder identity from board JSON, never Ivan's). Rail groups Posts vs "Lead
magnet launches". Per-row meta: type, `QA {score}`, `on board` flag, age, `FunnelTag`
(reach/trust/buyers). Actions: **Schedule to buffer** (`operator_schedule_draft` RPC,
auto-picks next buffer slot 4 days out, rolled off weekends), **Edit copy** (textarea →
`operator_edit_draft_body`), **On board toggle** (`operator_set_board_visible`,
disabled unless `status==='review'`).

Inspect column (right rail) — the load-bearing "who promoted / which gate fired" data:
- **Pipeline provenance block** (`co2-prov`): `idea_source_label`, `idea_source_ref`
  (link if URL), `idea_icp_score` + band, `source_post_id` flag ("spun from a source
  post"). Falls back to "Pre-pipeline draft — no linked idea" when nothing links.
- **`QAVerdictPanel`** (see §7 below) — parses `agent_log` for QA_Agent/LM QA
  Agent/Carousel QA/`*HALT*` entries, shows final verdict chip, iteration count, score
  delta since first pass, per-iteration score/issues-count/rewrite-applied flag.
- **`AgentLogFeed`** — the FULL merged timeline: `idea_agent_log` (if linked) + the
  draft's own `agent_log`, oldest→newest, with a note "timeline includes the source
  idea's agents" when the idea log is non-empty.

### Buffer lane (`BufferLane`, line 694+)
Calendar view (drag-to-reschedule, reuses `operator_schedule_draft`) or List view
(board-JSON `queue` ledger rows: title, `FunnelTag`, status, publish date). LM launches
render violet/`lm` kind so they read apart from posts.

### Live lane (`LiveLane`, line 777+)
What's currently `board_visible=true` (client can see + veto) plus already-`published`
rows (no toggle — can't un-publish). Toggle-off only allowed while `status==='review'`.

### Lead-magnet line (`LmLine`/`LaunchBlock`, line 828+)
Funnel silhouette bar (Views/Captures/Completes/CTA, log-scaled bars) as a rollup, then
per-LM cards: status pill, cover-pair picker (two cover stores: `lm.covers` row-level via
`operator_set_lm_cover`... actually two paths — `onSaveCover`→`setLmActiveCover()` lib
call for row covers, `onSwapCover`→`operator_set_lm_cover` RPC for board-JSON covers),
funnel figures, resource/landing links, embedded `LaunchBlock` (the LM's own launch post
with edit/schedule/on-board same as review lane), then `QAVerdictPanel` +
`AgentLogFeed` again keyed to `lm_drafts_v2`.

### Client activity feed (`ActionsFeed`, line 1069+)
Last 20 client actions from `client_board_actions` via `operator_client_actions`:
edit_copy / approve / request_changes / shift_request / voice_note (with inline audio
player from Supabase storage) / angle_swap / angle_swap_undone / post_removed /
post_restored / undo_approve. Unseen-count badge + "mark seen" →
`operator_mark_actions_seen`.

### Outreach tab
Delegates entirely to `OutreachView` (`clientops2/OutreachView.tsx`) reading
`operator_client_outreach` RPC — not read in full this pass (out of the 6 named files),
but the shared hook (`useClientOutreach`) surfaces `sequences`, `campaigns` (with
`counts.total/messaged/awaiting_reply/needs_reply/replied/gated`), `prospects` (full
per-prospect thread incl. `gate`/`anchor_client`, `dm_count`, `reply_count`, `messages[]`).

### client_id NULL (Ivan) vs 'risedtc' (Mattan)
ClientOps is **entirely** the operator-side, multi-tenant cockpit: it iterates
`useClientsOverview()` → `operator_clients_overview` which returns only *productized
clients* (i.e. rows with a real `client_id`, e.g. `risedtc`). Ivan's own content
(`client_id IS NULL` in `carousel_drafts`) does **not** appear here at all — that's the
`Today`/other Ivan-facing sections' job. `clientOps2/shared.tsx:18` (`clientId?: string |
null` on `CarouselDraft`) documents the trap directly: "Ivan's review queue must EXCLUDE
[client rows] — a Studio approve schedules to Ivan's own feed, and client drafts are
owned by their client board's own action path (`client_board_action` RPC), never by
`carousel_drafts.status`."

### RPCs called (ClientOps.tsx / clientops2/shared.tsx)
`operator_clients_overview`, `operator_client_drafts`, `operator_client_actions`,
`operator_client_ideas`, `operator_client_lms`, `get_client_board`,
`operator_set_board_visible`, `operator_schedule_draft`, `operator_approve_idea`,
`operator_edit_draft_body`, `operator_set_lm_cover`, `operator_mark_actions_seen`,
`operator_client_outreach`, `operator_client_pending_drafts`,
`operator_approve_rise_draft`, `operator_edit_rise_draft`, plus `append_agent_log`
(via `AgentLogFeed`, shared component).

---

## 2. `components/dashboard-v2/sections/Calendar.tsx`

Ivan's own unified calendar (not client-scoped) — merges two sources into one
`PostCalendarView`:
- **Posts**: `carousel_drafts` via `useContentLibrary()` (title, status, `scheduledAt`).
- **Lead magnets**: `scheduled_posts` rows matching the "comment <keyword>" pattern via
  `useLeadMagnets()`/`useContentPipeline()` (title from `postText`, `clickupTaskId`,
  `platform`, `isRepost`).

Drag-to-reschedule writes directly (no RPC — this is Ivan's own content, not client-
gated): `reschedulePost()` does `supabase.from('carousel_drafts').update({scheduled_at,
status})` — and critically **also flips status→'scheduled'** when moving a schedulable
post to a future date, because the sync bridge (`yzXqLDIpuNzuhUQq`) only picks up
`status==='scheduled'` rows (documented as `incident-calendar-schedule-no-queue-2026-06-13`,
line 78). It then also writes the linked `scheduled_posts` row directly (pending-only,
matched on `clickup_task_id===item.id`) so the publish queue doesn't wait for the bridge's
5-min cron. `rescheduleQueueRow()` guards with `.in('status', ['pending','queued_v2'])` +
`.select('id')` so a no-op move doesn't lie with a success toast.

Clicking a chip opens: `CarouselEditor` (posts, full edit sheet), `LeadMagnetEditor`
(LMs — always opens the full editor even for a queued repost, "consistency over direct
queue-text edit"), or `ScheduledPostEditor` (raw queue rows). No agent-log/QA display in
this component itself — that's inside the opened editor sheets (not read this pass).

Write affordances: drag-reschedule (direct table writes as above, no RPC — this is
Ivan's own content, un-gated), open-to-edit sheets.

---

## 3. `components/dashboard-v2/sections/StylesLive.tsx`

Two live-read panels, no writes at all (pure display):

1. **Visual style set** — `content_prompts` where `slug LIKE 'style-%' AND is_active=true`,
   columns `slug, title, body, updated_at`. Blurb = first ~2 non-heading lines of `body`
   (max 180 chars). "updated" badge if `updated_at` ≤ 7 days ago. Honest error state on
   RLS block ("no access · content_prompts read blocked"), never a hardcoded fallback list.
2. **Pillar taxonomy: target vs actual** — target mix from `lib/strategyConfig.ts`
   (`pillarMixTargets`, hardcoded 30/25/15/20/10 editorial constant) vs actual counts from
   `carousel_drafts.taxonomy.pillar` where `status='published' AND updated_at > now()-30d`
   (capped at 500 rows). Drift band (`ok`/`warn`/`off`) = `|actual-target|/target` at
   25%/50% thresholds, colored bar with a target-position tick mark.

No agent log, no QA, no client_id distinction — this is a pure aggregate/registry view,
Ivan-only (not client-scoped at all).

---

## 4. `components/dashboard-v2/sections/Today.tsx`

Ivan's landing screen. Pure read, no write affordances except navigation (`onNavigate`).

- **Changelog strip** ("Since you last looked") — `useChangelog()` reads `content_prompts`
  and other tables (line ref `useChangelog.ts:100,122,313`) to build a diff since last
  visit; clicking jumps to the owning section.
- **Triage strip** (6 stat lockups, `useTodayFeeds()` from `lib/useCockpitData.ts`):
  Posts in review (+ `postsReviewClient` — client-in-review overflow count),
  Comment drafts, Warm follow-ups (from `followup_drafts`), Workflows red/stuck (n8n
  execution errors), Scheduled today, Drift alarms (see below). Each source can go
  `offline` (RLS/probe failure) and renders "source offline" honestly rather than a
  fabricated number.
- **"Needs you" lead list** — up to 3 `postsReview` items + 1 `warmFollowups` item + 2
  `commentDrafts` items, each tagged "approve post"/"send warm"/"approve comment"; hover
  shows table+status provenance (e.g. `carousel_drafts · status=review`).
- **`WeeklyNoteCard`** — renders only while a Sunday RISE weekly-note draft is pending
  (n8n-status-webhook-gated; not read this pass).
- **n8n red list** — real workflow names, `dashboard_workflow_stats` where
  `last_execution_status='error'`.
- **Client tile** (rail) — `client_registry` row count/name; explicit note that the
  dashboard's anon key returns 0 rows here by design (server-side rebuild reads it) — a
  documented RLS trap, not a bug.
- **Drift alarm box** — `usePulse()` probes multiple tables for freshness; statuses
  `quiet`/`frozen` count as "drift" (this screen's single red). Lists up to 5 with table
  name + status tag.
- **"This week's mix" card** — `useWeekMix()`: promoted-idea counts this week by funnel
  stage (Reach/Trust/Buyers), warns if `buyers===0` ("Nothing this week speaks to people
  ready to buy"). Explicitly "advisory... never a quota."
- **"On the schedule" card** — today's scheduled-post count + first item's quoted text.

No agent-log/QA verdict display anywhere in Today — it's a triage/navigation surface, not
a content-inspection surface. No client_id split visible either (this is Ivan's own
dashboard-wide triage, client rows fold into the same counts via `postsReviewClient`
add-on only).

---

## 5. `components/ClientBoardPage.tsx` (8,481 lines — read in structural passes: types
block, `ReviewSurface`, `BuildSequence`/`AgentTrail`, `DetailModal`, `LeadsSurface`/
`OutreachSurface`, and the top-level page component/auth/gating logic at the bottom)

This is the **client-facing** surface (`/client/:slug`) — the authoritative definition of
what Mattan (or any client) is allowed to see. Two modes baked into one component:
- `isPreview` (mode `'demo'`|`'preview'`) — the pre-sale demo board, sales-funnel framing,
  approve/request-changes flow, idea intake as "theater."
- `isLive` (any other mode) — the production tool. Distinct copy everywhere (`live ?`
  ternaries throughout), different tab set, real RPC writes.

### What it explicitly HIDES from the client (the load-bearing gating)
- **No agent trail, no QA scores, no verdicts, no prompts, no model names, ever**, on a
  live board. `DetailModal` (`ClientBoardPage.tsx:3259-3273`) replaces the internal agent
  trail with "Client-appropriate provenance... No agent steps, scores, prompts, model
  names, or auto-publish" — just a human `statusLabel` (e.g. "Not scheduled yet",
  "Scheduled", "Being written") and a plain "what happens next" sentence.
- The only trace of the generation pipeline the client ever sees is the **translated**
  `agent_trail`/`BuildSequence` (line 1161) while a post is `generating` — and even there,
  raw step names are relabelled via `STEP_LABELS` (e.g. `'Copy quality gate'` → "Quality
  check", `'Carousel renderer'` → "Slides made") — no scores, no pass/fail language, no
  agent identity beyond a friendly phase noun.
- **Ideas bank is preview-only** (`ReviewSurface` line 2008-2010): "on a live client board
  the idea queue lives on Ivan's side (Client Ops), so the client sees finished posts,
  never the raw idea bank." Same for **Voice tab** and standalone **Photos tab** — dropped
  entirely on live boards (`visibleTabs` filter, line 8154-8157), and **story-intake card**
  / **idea-note record button** — preview-only theater, hidden `!isLive` (lines 7752-2198,
  8319).
- **Team tab** (self-serve invites) is live-only — preview boards have no allow-list.
- Dead/retired outreach lanes (`isDeadLane()`, matches "retired"/"no ratified
  sequence"/"Network Activation") are filtered from both the lanes list and the
  sequences list — never shown regardless of underlying data.
- `chats.mock === true` renders an explicit "example · goes live when LinkedIn connects"
  badge — never silently presented as real.
- Sample/example data (`SAMPLE_LEAD_PIPELINE`) is only used when `preview && !real data`,
  and is always labeled "example data"/"example leads" inline — never blended
  unlabeled with real rows.
- Client never sees `carousel_drafts.status` machinery language — stage labels are
  client-friendly overrides (`live ? 'Up next' : ...`), and the standalone "Scheduled"
  stage disappears on live boards (folds into "Up next", date-sorted with review-stage
  slotted posts) so there's one honest forward calendar instead of two buckets "wearing
  the same word."

### What it explicitly SHOWS (client-visible fields)
- Post/carousel/LM/newsletter queue items grouped by `Stage` (`planned/drafted/review/
  scheduled/published`) in 3 views: List (grouped-by-stage ledger), Board (kanban), Feed
  (LinkedIn-preview style). Per-row: hook/title, thumbnail, kicker (kind), scheduled
  date/time (client's own timezone, `America/Los_Angeles` hardcoded as `CLIENT_TZ`),
  `funnel_stage` chip (Reach/Trust/Buyers), an **honest source chip**
  (`source_detail: {kind, label, call_title, quote, lm_ref}` — real call quotes when
  `kind==='call'`, never a vague "Picked by Ivan").
- **History block** (live only) — every `edit_copy`/`approve`/`request_changes`/`note`
  event this draft has seen, from `client_board_draft_history[_v2]` RPC: label, "by"
  attribution, before/after diff on copy edits, quoted note text.
- **Leads tab**: capture→pipeline tiles (captured/contacted/replied/on-newsletter),
  hand-raiser vs high-fit-engager sections, per-lead detail modal with real message
  thread.
- **Outreach tab** (only if `board.outreach` present): send-status pill (live/paused —
  reads *committed campaign state*, `is_active` + scheduled first-send, never raw send
  activity), "up next" queue (name/company/domain/`icp_score`/lane, in actual send
  order) + today's pace bar, monthly allowance (InMail/connect/DM caps+remaining from
  `client_board_outreach_usage[_v2]` RPC), ICP bar, per-source lane counts
  (`count`/`scanned`/`fits`), message sequences (collapsible, `armed` flag + gate note per
  channel), named candidate list, conversation inbox (mock-flagged), orbit finds (with
  caveats), and the **live send log** (`client_board_outreach_log[_v2]` RPC) — every
  actually-sent message + reply status, per prospect.
- **Lead-magnet surface**, **Strategy surface**, **Performance surface** (real published-
  post metrics + outreach indicators), **Newsletter surface**, **Calendar surface** — not
  read line-by-line this pass but confirmed present via the `surfaces` map (line 8086+).

### Write affordances (client-initiated, all via the versioned `client_board_action[_v2]`
RPC family, session-token gated post-auth)
`edit_copy`, `request_changes`, `note` (angle_swap / angle_swap_undone / post_removed /
post_restored / undo_approve / voice_note / idea_draft_next / idea_pass events),
approve (`onApprove`), plus dedicated RPCs: `client_board_schedule[_v2]` (initial
schedule lookup), `client_board_edit_draft[_v2]` (direct-apply edit with before/after
log row), `client_board_edit_lm_promo[_v2]` (LM email/DM promo copy), `client_board_
set_media[_v2]` (attach/clear a lifestyle photo from the client's own photo pool, storage
bucket `client-photos`), `client_board_set_schedule[_v2]` (reschedule/clear a day, LA-
timezone wall-clock → UTC conversion done client-side), `client_board_hide_draft[_v2]`
(reversible "remove from buffer", sets `board_visible=false`), `client_board_draft_
history[_v2]` (read), `client_board_replacement_pool[_v2]` / `client_board_slot_state
[_v2]` (open-slot refill: restore original / pick a ready draft / pick a bench angle).

Auth: `?k=` token → `get_client_board`; magic-link fragment `#ml=` → `redeem_board_login`
→ session token → `get_client_board_by_session`; stored session in localStorage; sign-in
screen otherwise. Every RPC family has a **legacy token path and a `_v2` session path**
run in parallel depending on which auth mode is active — noted throughout as "BYTE-
IDENTICAL" / "same RPC posture."

### client_id NULL vs 'risedtc' handling
ClientBoardPage never reads Ivan's own content at all — it is keyed purely by `:slug`
(one row per client board in `client_boards`), fetched via `get_client_board`/`
get_client_board_by_session`. There is no client_id-NULL branch here; that content lives
on the Ivan-only dashboard sections (Today, ClientOps overview-list exclusion, Calendar).
The board's own `mode` field (`generating`/`failed`/`demo`/`preview`/anything else=live)
is the only "which flavor of client" branch, and `isLive = !isPreview` (`mode !== 'demo'
&& mode !== 'preview'`) drives essentially every gating decision listed above.

---

## 6. `components/dashboard-v2/sections/rebuilt/AgentRebuilt.tsx` ("AgentOps")

Operator-only "n8nClaw" WhatsApp mirror. Backed by `useAgentData()` hook
(`hooks/useAgentData.ts`) reading four tables:
- `n8nclaw_proactive_alerts` (id, alert_type, title, body, sent, sent_at, created_at)
- `n8nclaw_reminders` (id, reminder_text, remind_at, status, recurrence, created_at) —
  only `status='pending'` fetched
- `n8nclaw_daily_summaries` (id, date, summary, topics[], action_items[], message_count,
  created_at) — last 7
- `n8nclaw_chat_messages` (id, role, content, created_at) — paginated 50/page, "load
  older" button

### Stat strip
Total messages (+ today count), Logged this week (7d), Proactive alerts (+ distinct
`alertType` count), Pending reminders.

### Transmission log (chat)
Role-based (`user`/`assistant` → "Ivan"/"Agent"), date separators, auto-scroll-to-bottom
with a manual scroll-down button when scrolled up, typing indicator while `sending`.
Realtime-refreshed via `useAutoRefresh` on `n8nclaw_proactive_alerts` +
`n8nclaw_chat_messages`.

### THE BOX (unacknowledged alerts) — the screen's one red
Shows up to 4 unacked (`sent===false`) alerts with title, `alert_type`, relative time,
and an **Ack** button → `acknowledgeAlert(id)` → `dashboardAction('n8nclaw_proactive_
alerts', id, 'sent', 'true')` (generic dashboard-action helper, not a named RPC).

### Alerts / Reminders / Summaries accordions
- **Alerts** (up to 20 shown): dot on/off by `sent`, title, type tag, relative time,
  per-row **Ack** button for unsent ones.
- **Reminders**: reminder text, relative `remind_at`, recurrence tag, **Mark complete**
  button → `completeReminder(id)` → `dashboardAction('n8nclaw_reminders', id, 'status',
  'completed')`.
- **Summaries**: date, message count, summary text, up to 4 topic tags.

### Send/Refresh
- **Send** — textarea + button, Enter submits (Shift+Enter newline). Tries
  `supabase.rpc('n8nclaw_dashboard_send', { p_message })` first; falls back to a direct
  webhook POST to `https://n8n.ivanmanfredi.com/webhook/n8nclaw-whatsapp` (mimics an
  inbound WhatsApp message payload shape) if the RPC isn't set up. Optimistic pending-
  message bubble; polls with backoff (2s→2s→3s→3s→5s) while waiting for the assistant's
  reply; 45s hard timeout clears sending state with a toast error.
- **Refresh** button — re-runs `fetch()` (all 4 table reads).

No client_id concept here at all — this table set (n8nclaw_*) is Ivan's personal
WhatsApp-agent mirror, entirely un-client-scoped.

---

## 7. `AgentLogEntry` / agent-log normalization — full shape vs what's shown

No function literally named `normalizeAgentLog` exists in the repo (grepped `*.ts`/`*.tsx`
excluding node_modules and worktrees — zero hits). The closest equivalents:

**Type** (`hooks/useContentLibrary.ts:4-9`):
```ts
export interface AgentLogEntry {
  ts: string | null;
  agent: string;
  body: string;
  source?: string;        // 'n8n' (live) | 'clickup_backfill' (historical)
  comment_id?: string;    // present for backfilled entries
}
```
That's the FULL structure stored/returned — no hidden fields beyond these 5.

**Presentation-layer "normalization" happens in two places, both operator-only**
(`components/dashboard/AgentLogFeed.tsx` and `components/dashboard/QAVerdictPanel.tsx`):

- `AgentLogFeed.tsx: humanizeBody()` (line 23-41) — if `body` is JSON, pulls a human
  field (`qa_feedback`, `feedback`, `overall_feedback`, `generated_post`, `final_post`,
  `hooks_text`, `revised_caption`, `summary`, `verdict_summary`, `note`, `text`, `body`,
  `message`) out for display; otherwise falls back to a slimmed JSON (drops any
  `*_body`/`*_raw`/`rewrite`/`qa_rewrite` keys and any string >600 chars) so the raw log
  is never dumped verbatim. Preview text is **truncated to 160 chars** with an
  expand/collapse toggle per entry (`bodyOpen[i]` state) — this IS the "excerpt behind
  Show more" the goal-run brief asked about, though the button label reads
  "expand"/"collapse" not "Show more".
- `AgentLogFeed.tsx: detectStatus()` (line 69-80) — classifies each entry into
  pass/fail/rewrite/info/halt by scanning `body` text for `VERDICT: PASS/FAIL/
  REWRITE_OK/NEEDS_REGENERATE`, `APPROVED`, or agent name containing `HALT`. Drives a
  colored spine-dot + chip (PASS/FAIL/REWRITE/HALT, no color for `info`).
- `AgentLogFeed.tsx: AGENT_ICON` map — 17 named agents (Ivan, Editorial Agent, LM
  Editorial Agent, Hook Agent, Content Agent, Carousel Structurer/Content Agent,
  Carousel QA, QA Agent, LM QA Agent, QA HALT, Carousel QA Gate HALT, LM Cover Copy
  Agent, Image Generation, IG Caption Generator, Scheduling Agent, Publisher, AI-Slop
  Gate, Lint Gate, Promoter) each get a distinct lucide icon; unknown agent names fall
  back to a generic Bot icon — so the full agent roster is enumerable from this file.
- **Compose/write**: `AgentLogFeed` optionally renders a note-composer (textarea + Post
  button) when `table`+`rowId` are supplied, which calls `supabase.rpc('append_agent_log',
  { p_table, p_id, p_agent: 'Ivan', p_body })` — the only write path touching `agent_log`
  from the dashboard.
- `QAVerdictPanel.tsx: parseIteration()` (line 24-52) — regex-extracts `Status:`,
  `VERDICT:`, `SCORE:` (1-10), an `ISSUES:` count (numbered list items before the next
  `SUGGESTIONS:`/`REWRITE:` section), and a `REWRITE:` block (only surfaced if >30
  chars) from QA-agent bodies specifically (`QA Agent`, `LM QA Agent`, `Carousel QA`,
  `QA HALT`, `Carousel QA Gate HALT`). This is what powers the "composite score,
  regeneration attempts + verdicts" requirement: it shows the FULL iteration history
  (score progression sparkline, delta since first pass) and, when a verdict was
  `REWRITE_OK`, explicitly surfaces the **applied rewrite block** as "what auto-publish
  shipped" — closing what the code comments call "the voice-drift blind spot where
  rewrites land silently."

Both components are **operator-only** (used inside ClientOps' inspect rails) — none of
this raw agent-log/QA-verdict machinery reaches `ClientBoardPage.tsx` (confirmed in §5:
DetailModal explicitly replaces it with a stripped "what happens next" block).

---

## 8. Every `supabase.rpc(...)` call site across the 6 named files + shared deps

**ClientOps.tsx / clientops2/shared.tsx**: `operator_clients_overview`,
`operator_client_drafts`, `operator_client_actions`, `operator_client_ideas`,
`operator_client_lms`, `get_client_board`, `operator_set_board_visible`,
`operator_schedule_draft`, `operator_approve_idea`, `operator_edit_draft_body`,
`operator_set_lm_cover`, `operator_mark_actions_seen`, `operator_client_outreach`,
`operator_client_pending_drafts`, `operator_approve_rise_draft`,
`operator_edit_rise_draft`.

**Calendar.tsx**: none (direct table writes only — `carousel_drafts`, `scheduled_posts`;
also `delete_scheduled_post` RPC lives in `useContentPipeline.ts`, not called from
Calendar.tsx itself).

**StylesLive.tsx**: none (pure reads on `content_prompts`, `carousel_drafts`).

**Today.tsx**: none directly (its hooks — `useTodayFeeds`, `usePulse`, `useChangelog`,
`useWeekMix` — do direct table reads, no RPCs, per the grep above).

**ClientBoardPage.tsx** (full list, line-numbered above at first occurrence):
`client_board_public_brand`, `redeem_board_login`, `get_board_team`,
`invite_board_member`, `client_board_action` / `client_board_action_v2`,
`client_board_schedule` / `_v2`, `client_board_outreach_usage` / `_v2`,
`client_board_outreach_log` / `_v2`, `client_board_outreach_status` / `_v2`,
`client_board_slot_state` / `_v2`, `client_board_replacement_pool` / `_v2`,
`client_board_draft_history` / `_v2`, `client_board_edit_draft` / `_v2`,
`client_board_edit_lm_promo` / `_v2`, `client_board_set_media` / `_v2`,
`client_board_set_schedule` / `_v2`, `client_board_hide_draft` / `_v2`,
`get_client_board_by_session`, `get_client_board`.

**AgentRebuilt.tsx**: none directly; `useAgentData.ts` calls `n8nclaw_dashboard_send`
(with webhook fallback); ack/complete use the generic `dashboardAction()` helper (table
patch, not a named RPC).

**AgentLogFeed.tsx** (shared, used by ClientOps + LmLine): `append_agent_log`.

---

## File paths referenced
- `/Users/ivanmanfredi/Desktop/personal-site/components/dashboard-v2/sections/ClientOps.tsx`
- `/Users/ivanmanfredi/Desktop/personal-site/components/dashboard-v2/sections/clientops2/shared.tsx`
- `/Users/ivanmanfredi/Desktop/personal-site/components/dashboard-v2/sections/Calendar.tsx`
- `/Users/ivanmanfredi/Desktop/personal-site/components/dashboard-v2/sections/StylesLive.tsx`
- `/Users/ivanmanfredi/Desktop/personal-site/components/dashboard-v2/sections/Today.tsx`
- `/Users/ivanmanfredi/Desktop/personal-site/components/ClientBoardPage.tsx`
- `/Users/ivanmanfredi/Desktop/personal-site/components/dashboard-v2/sections/rebuilt/AgentRebuilt.tsx`
- `/Users/ivanmanfredi/Desktop/personal-site/components/dashboard/AgentLogFeed.tsx`
- `/Users/ivanmanfredi/Desktop/personal-site/components/dashboard/QAVerdictPanel.tsx`
- `/Users/ivanmanfredi/Desktop/personal-site/hooks/useContentLibrary.ts`
- `/Users/ivanmanfredi/Desktop/personal-site/hooks/useAgentData.ts`
- `/Users/ivanmanfredi/Desktop/personal-site/hooks/useLeadMagnets.ts`
- `/Users/ivanmanfredi/Desktop/personal-site/hooks/useContentPipeline.ts`
- `/Users/ivanmanfredi/Desktop/personal-site/lib/useCockpitData.ts`
- `/Users/ivanmanfredi/Desktop/personal-site/lib/usePulse.ts`
- `/Users/ivanmanfredi/Desktop/personal-site/lib/useChangelog.ts`
