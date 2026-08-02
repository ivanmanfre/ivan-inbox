# Phase 0 — Full Screen Inventory (exp/brain, read-only scout)

Repo: `/Users/ivanmanfredi/Desktop/ivan-inbox`, branch `exp/brain` (not modified; no git commands run beyond `status`/`branch` read).
Method: read-only file reads + 3 parallel Explore-agent sweeps (default app screens; cand-a/b/c experimental shells; v2c workbench). Every claim below carries a file:line citation; anything not directly verified is marked **UNVERIFIED**.

Reachability map:
- Default app (no hash flag) → `src/App.tsx` → inline `Shell()` at `src/App.tsx:62`.
- `#exp/a` | `#exp/b` | `#exp/c` → `src/exp/index.tsx:42-56` lazy-loads `src/exp/cand-{a,b,c}/Shell.tsx` (older "content-hub IA tournament" candidates, goal-run `agentops-inbox-content-hub-2026-07-31`).
- `#exp/v2` | `#exp/v2c` → `src/exp/index.tsx:45,53` lazy-loads `src/exp/v2c/Shell.tsx` ("Workbench", winner structure from goal-run `inbox-v2-revamp-2026-08-01`; router always **emits** `#exp/v2/...`, `v2c` is read-compat only — `src/exp/v2c/route.ts:15-17,34-37`).
- Gate logic itself: `src/exp/index.tsx:29-40` (`getExpVariant`), regex `src/exp/index.tsx:32`.

---

## Summary table

| screen | route | class-guess | data tables | anchor column? |
|---|---|---|---|---|
| InboxScreen | default `#inbox` | working-list | `inbox_messages_v` | yes — Avatar at row start |
| ThreadScreen | default `#thread/:id` | detail pane | `inbox_messages_v` (read) + `outreach_messages` (write) | n/a (chat bubbles) |
| DraftsScreen | default `#drafts` | working-list | `inbox_messages_v` (filtered), `ops_drafts` (preview only) | yes — Avatar at card header |
| SendsScreen | default `#sends` | hybrid (Overview=overview, Lanes/Log=working/read-list) | `inbox_sends_v`, `inbox_sends_daily_v`, `inbox_messages_v` | yes — status dot / chip |
| OpsScreen | default `#ops` | working-list | `ops_drafts` | yes — kind chip at card header |
| SettingsScreen | default `#settings` | form (not a list) | none (auth/local only) | n/a |
| TodayScreen | default `#today` | overview (hybrid: hand-off rows are read-only nav) | edge fn `get-morning-brief` (opaque) + `inbox_accept_v2`, `inbox_pipeline_v`, RPC `inbox_governor`, `inbox_messages_v` | yes — Avatar at row start |
| LoginScreen | default (pre-session) | form | none (auth only) | n/a |
| OverviewView (kpi) | mounted inside SendsScreen "Overview" segment | overview | `inbox_sends_v`, `inbox_sends_daily_v`, `inbox_accept_v2`, `inbox_pipeline_v`, RPC `inbox_governor`, `inbox_scan_opens_v`, `inbox_outcomes_v`, `inbox_campaign_sends_v` (+legacy join `outreach_campaigns`+`inbox_messages_v`), RPC `inbox_range_kpis` | yes — severity dot on every tile/card |
| SeatHealthBanner | global banner, all tabs | overview (status strip) | `integration_config` (single JSON row) | n/a (banner) |
| **cand-a** AgentChatScreen | `#exp/a` → Content tab agent chat | hybrid (chat) | `n8nclaw_chat_messages` | n/a |
| **cand-a** AgentScreen | `#exp/a` → Ops→Agent segment | working-list | `n8nclaw_proactive_alerts`, `n8nclaw_reminders`, `n8nclaw_daily_summaries` | no |
| **cand-a** ContentQueue | `#exp/a` → Content→Queue | working-list | `carousel_drafts` | thumbnail+title, not chip |
| **cand-a** ContentStyles | `#exp/a` → Content→Styles | overview (gallery) | `content_prompts`, `lm_drafts_v2`, `carousel_drafts` (previews) | no |
| **cand-a** DraftDetail | `#exp/a` → Content drill-in | detail pane | `carousel_drafts` (single row) | n/a |
| **cand-b** ChatScreen | `#exp/b` → Studio→Chat | hybrid (chat) | `n8nclaw_chat_messages` | n/a |
| **cand-b** StudioScreen | `#exp/b` Studio tab (hub) | hybrid (dashboard hub + actionable inline cards) | `n8nclaw_*` (4 tables), `content_prompts`, `lm_drafts_v2`, `carousel_drafts` | no |
| **cand-b** QueueScreen | `#exp/b` → Studio→Content drill-in | working-list | `carousel_drafts` | no (title-led) |
| **cand-b** RemindersScreen | `#exp/b` → Studio→Reminders | working-list | `n8nclaw_reminders` | no |
| **cand-b** StylesGridScreen | `#exp/b` → Studio→All styles | overview (gallery) | `content_prompts`, `carousel_drafts` (previews) | no |
| **cand-b** SummariesScreen | `#exp/b` → Studio→Daily summaries | read-list | `n8nclaw_daily_summaries` | no |
| **cand-c** AgentScreen | `#exp/c` → Ops→Agent segment | working-list | `n8nclaw_proactive_alerts`, `n8nclaw_reminders`, `n8nclaw_daily_summaries` | no |
| **cand-c** ChatScreen | `#exp/c` → Ops→Agent→Chat | hybrid (chat) | `n8nclaw_chat_messages` | n/a |
| **cand-c** ContentQueue | `#exp/c` → Drafts→Work→Content | working-list | `carousel_drafts` | yes — 44×44 thumb at row start |
| **cand-c** StylesGallery | `#exp/c` → Drafts→Work→Styles | overview (gallery) | `content_prompts`, `lm_drafts_v2`, `carousel_drafts` (previews) | no |
| **v2c** ContentList | `#exp/v2/content` | working-list + embedded chart | `carousel_drafts`, plus sub-reads: `lm_idea_candidates`, `scheduled_posts`, `lm_drafts_v2`, `content_prompts`, `n8nclaw_proactive_alerts`/`n8nclaw_daily_summaries` | inline meta-row chip, not a fixed leading column |
| **v2c** ContentSections (module, not a screen) | inside ContentList lanes | read-list (all sub-sections read-only) | `lm_idea_candidates`, `scheduled_posts`, `lm_drafts_v2`, `content_prompts` | no |
| **v2c** OpsBoard | `#exp/v2/ops` | hybrid (KPI tiles + working queue + read history) | `ops_drafts` | reuses OpsScreen's PendingCard (kind chip) |
| **v2c** InboxHead | header band inside `#exp/v2/inbox` | overview (status strip) | `inbox_messages_v` (via shared `useInbox`) | n/a (band, not rows) |
| **v2c** ThreadPeer | peer pane inside `#exp/v2/inbox` | detail pane | `inbox_messages_v` (shared) | n/a |
| **v2c** ChatPane | peer/job `#exp/v2/.../chat` | hybrid (chat) | none — in-memory only, streams via edge fn `inbox-claude` | n/a |
| **v2c** DraftPane | peer inside `#exp/v2/content` | detail pane | `carousel_drafts` (single row) | n/a |

---

## Default app (`src/App.tsx` → `Shell()`)

Nav shell: `src/components/TabBar.tsx:1-34`. 6 tabs, fixed order: **Today ☼ → Inbox ◉ → Drafts ✦(badge) → Sends ↑ → Ops ◈ → Settings ⚙︎** (icons at `TabBar.tsx:9,13,17,21,25,29`). Desktop vs mobile layout branch: `src/App.tsx:148-192` (desktop = rail-shaped `TabBar` + list/detail split; mobile = stacked screen + bottom `TabBar`). Hash router: `src/lib/route.ts:13-32` (`parseHash`), tabs enumerated `route.ts:1-2`.

Note on the historical "Shell.tsx:99" filter-UI citation: there is **no standalone `src/Shell.tsx`** in the default app — `Shell()` is an inline function inside `src/App.tsx` (declared `App.tsx:62`). `App.tsx:99` is `if (!location.hash.startsWith('#access_token')) history.replaceState(...)`, part of the `nav()` handler — not filter UI. The nearest real match to the old citation is `src/exp/cand-b/Shell.tsx:97-99` (`filter`/`setFilter`/`refresh` passed into `<InboxScreen>`), which is an **experimental** shell, not the shipped one. v2c's own `Shell.tsx:99` is `const [filter, setFilter] = useState<Filter>('all')` — see verification table below.

### InboxScreen
- **File:** `src/screens/InboxScreen.tsx:96` (`export function InboxScreen`).
- **Renders:** dense scrollable thread list — search input + filter chips (All/Ivan/Rise/Email) + optional "N drafts waiting" banner; each row = avatar, name, client badge, channel badge, one-line snippet, relative time, unread dot, DRAFT pill.
- **Data source:** prop `threads` from `useInbox()` (`src/hooks/useInbox.ts:13`) → `fetchMessages()` `src/lib/inbox.ts:135-150` → real: `supabase.from('inbox_messages_v').select('*')`, `.order('created_at',asc).order('id',asc)`, paginated `.range()` up to 20,000 rows, no filter. Grouped client-side by `groupThreads()` (`inbox.ts:60`).
- **Actionable:** row click navigates only (`InboxScreen.tsx:184`); no per-row approve/reply (those live in ThreadScreen/DraftsScreen).
- **Density:** code comment states "nine rows are ever visible" at 390px, fixed `ROW_H=73` (`InboxScreen.tsx:26,34`); prose one-liner snippets; anchor = `<Avatar>` first (`InboxScreen.tsx:186`).
- **Chart:** none.

### ThreadScreen
- **File:** `src/screens/ThreadScreen.tsx:51` (`export function ThreadScreen`).
- **Renders:** chat/detail pane — bubbles (inbound left / outbound right + status), editable AI-draft card, compose input.
- **Data source:** `thread` prop (already fetched by shared `useInbox`). Mutations, all real: `approveDraft` → `outreach_messages.update(...).eq('id',id).is('sent_at',null).is('send_blocked_reason',null)` (`inbox.ts:168-177`); `discardDraft` → same table `.update({send_blocked_reason:'discarded_in_inbox'})` (`inbox.ts:179-184`); `composeReply` → `.insert(...)` (`inbox.ts:186-199`); `markThreadRead` → `.update({read_at})...` (`inbox.ts:201-206`).
- **Actionable:** yes — `onApprove` (`ThreadScreen.tsx:88`), `onDiscard` (`:102`), `onSend` (`:121`), gated by confirm sheet.
- **Density:** unbounded bubble scroll (`ThreadScreen.tsx:137-139`); no anchor column (not a row list).
- **Chart:** none.

### DraftsScreen
- **File:** `src/screens/DraftsScreen.tsx:231` (`export function DraftsScreen`).
- **Renders:** segmented (All/Ivan/Rise) swipeable draft cards + read-only "Ops · N" preview section above.
- **Data source:** `threads` filtered to `t.draft !== null` (`DraftsScreen.tsx:244`, same `inbox_messages_v` read). Ops preview via `useOps()` (`:238`) → `fetchOpsDrafts()` `src/lib/ops.ts:113-119` — real: `supabase.from('ops_drafts').select('*').order('created_at',desc).limit(300)`.
- **Actionable:** yes — swipe/buttons call `handleApprove` (`:153`, → `approveDraft`) / `handleDiscard` (`:174`, → `discardDraft`); bulk `discardAllStale` (`:259`). Ops-preview rows are explicitly navigation-only ("approved in Ops, not here", `:33-38`).
- **Density:** cards ~120-160px, ~3-5 visible on mobile; anchor = `<Avatar>` at card header (`:206`).
- **Chart:** none.

### SendsScreen
- **File:** `src/screens/SendsScreen.tsx:202` (`export function SendsScreen`).
- **Renders:** 3 segments — **Overview** (delegates to `OverviewView`, see below), **Lanes** (4 lane cards: dot + bar sparkline + big number), **Log** (chronological sent/failed feed).
- **Data source:** `load()` (`:217-229`) calls `fetchSends()` (`src/lib/sends.ts:46-50`, real `inbox_sends_v`) and `fetchSendsDaily()` (`sends.ts:52-56`, real `inbox_sends_daily_v`). Log: `fetchSendLog()` (`sends.ts:115-134`, real, two `inbox_messages_v` queries — outbound-sent desc limit `n*3`, and blocked desc limit 60, each optionally `.eq('client_id',client)`). Lane drill-in: `fetchLaneRecent()` (`sends.ts:141-167`, real, `inbox_messages_v` filtered by `message_type`, limit 400 → deduped to 25).
- **Actionable:** read-only — lane click only opens `LaneDetail` (comment "Drill-in... Read-only", `SendsScreen.tsx:151`).
- **Density:** Lanes = 4 cards, all visible, structured field-grid (dot/name/status/sparkline/number), anchor = status dot (`:317`); Log = dense chronological list, anchor = chip badge (`:108-115`).
- **Chart:** `Spark` bar-sparkline (component `:136`, rendered `:324` `<Spark values={lane.daily}/>`) fed by `lane.daily` from `buildLanes()` (`sends.ts:289-332`) ← real `fetchSendsDaily()`. **Real, not fabricated.**

### OpsScreen
- **File:** `src/screens/OpsScreen.tsx:369` (`export function OpsScreen`).
- **Renders:** dense pending-card queue (kind chip, context, editable textarea, action buttons) + collapsible read-only Working/Done/Blocked sections.
- **Data source:** `useOps()` (`:374`) → `fetchOpsDrafts()` (`ops.ts:113-119`, real `ops_drafts`, order desc, limit 300).
- **Actionable:** heavy — `onApprove` (`:135`, branches to edge fn `postCommentReply` `ops.ts:151-172`, or real updates `approveWeeklyReport` `ops.ts:227-233` / `approveOpsDraft` `ops.ts:125-130`); `onGenerate` (`:198`, edge fn `generateCommentDraft` `ops.ts:199-218`); `onDiscard` (`:213`, real `discardOpsDraft` `ops.ts:235-240`).
- **Density:** full cards, ~2-3 visible with textarea open; anchor = kind chip at card header (`:236-241`).
- **Chart:** none.

### SettingsScreen
- **File:** `src/screens/SettingsScreen.tsx:34` (`export function SettingsScreen`).
- **Renders:** grouped settings form (push toggle, chime toggle, theme segmented control, sign-out). No list/table data.
- **Data source:** none — push via browser API (`src/lib/push.ts`), chime via localStorage (`src/lib/chime.ts`), theme via `document.documentElement.dataset` + localStorage (`:76-78`), sign-out via `supabase.auth.signOut()` (`:142`, auth action not query).
- **Actionable:** `togglePush` (`:43`), `toggleChime` (`:68`), `setThemeAndPersist` (`:75`), sign-out (`:142`).
- **Density:** ~5 fixed rows, fits without scroll; no anchor column (label-left/control-right form).
- **Chart:** none.

### TodayScreen
- **File:** `src/screens/TodayScreen.tsx:554` (`export function TodayScreen`).
- **Renders:** masthead (1 big number + 3-segment stacked bar) then 4 zones — 01 Urgent (row list), 02 Approve (hand-off rows, no inline action), 03 Today's content, 04 Campaign health (KPI tiles + per-lane bars + counter grid).
- **Data source:** `useToday()` (`:562`, `src/hooks/useToday.ts:43`). Zones 01-03 + masthead: `fetchBrief('counts'|'full')` (`src/lib/today.ts:316-329`) is a **bare `fetch()` to edge function `get-morning-brief`** (`today.ts:10`) — **not** a direct `supabase.from()` visible in this repo; the table(s) behind it are **UNVERIFIED** (server-side). Zone 04: real — `fetchAccept()` (`kpis.ts:43`, `inbox_accept_v2`), `fetchPipeline()` (`kpis.ts:44`, `inbox_pipeline_v`), `fetchGovernor()` (`kpis.ts:59-63`, RPC `inbox_governor`), `fetchReplyCounts()` (`today.ts:502-509`, real `inbox_messages_v`, `.eq('direction','inbound').gte('created_at',since)`).
- **Actionable:** read-only/navigational by design (comment `:192-204`) — hand-off rows only `onOpen` (navigate), never mutate; no approve/send button anywhere on this screen.
- **Density:** Urgent zone renders every `visible` row from the brief, uncapped in this file (cache-side cap `MAX_ROWS=30`, `today.ts:337`); rows are structured field-grid (avatar/name/kind chip/snippet/org/time, `:120-140`); anchor = `<Avatar>` (`:128`).
- **Chart:** masthead stacked bar (`td-stack`, `:91-101`) fed by `todayLoad(counts)` (`today.ts:291-297`) — derived from the **opaque edge-function brief**, not a raw table query traceable in this repo (flag as **partially unverified data source**, not fabricated — it is a real network call, just not one whose backing table is visible here). Health-strip lane bars (`td-bar-f`, `:499-507`) fed by real `fetchPipeline()`.

### LoginScreen
- **File:** `src/screens/LoginScreen.tsx:4` (`export function LoginScreen`).
- **Renders:** email + 6-digit-code two-stage form.
- **Data source:** none — `supabase.auth.signInWithOtp` (`:13,18`), `supabase.auth.verifyOtp` (`:25`).
- **Actionable:** yes — Send code / Email link / Sign in (`:35-42`).
- **Density:** n/a. **Chart:** none.

### OverviewView (kpi) — mounted from SendsScreen's "Overview" segment
- **File:** `src/screens/kpi/OverviewView.tsx:649` (`export function OverviewView`). Confirmed: `src/screens/kpi/` contains only this one file (no other charts directory).
- **Renders:** dense analytics dashboard in one scroll — `Hero` 3-tile decision gauges (`:136`), `Funnel` step chart (`:250`), optional `RangeSummary` (`:320`), `KpiRow` per-lane cards+sparkline (`:374`), `Pipeline` bar list (`:535`), `Governor` gauges (`:437`), `Seats` 2-card compare (`:511`), `Campaigns` table (`:608`).
- **Data source:** single effect (`:657-670`) fires 8 parallel real queries: `fetchSends()` (`sends.ts:46`, `inbox_sends_v`), `fetchSendsDaily()` (`sends.ts:52`, `inbox_sends_daily_v`), `fetchAccept()` (`kpis.ts:43`, `inbox_accept_v2`), `fetchPipeline()` (`kpis.ts:44`, `inbox_pipeline_v`), `fetchGovernor()` (`kpis.ts:59`, RPC `inbox_governor`), `fetchScanOpens()` (`kpis.ts:45`, `inbox_scan_opens_v`), `fetchOutcomes()` (`kpis.ts:46`, `inbox_outcomes_v`), `fetchCampaignSends()` (`sends.ts:184-208`, `inbox_campaign_sends_v`, legacy fallback `sends.ts:216-254` joining `outreach_campaigns`+`inbox_messages_v`). `RangeSummary` additionally: `fetchRangeKpis()` (`kpis.ts:53-57`, RPC `inbox_range_kpis`). **All real — no fabricated arrays found.**
- **Actionable:** read-only dashboard; only UI-state clicks (`SeatCard` client-filter switch `:526`; Campaigns "show paused" expander `:626`) — neither mutates.
- **Density:** very dense, everything renders simultaneously — Hero 3 tiles/row, KpiRow 4 lane cards/row, Pipeline ~4-5 bars, Governor ≤2 cards, Seats 2 cards, Campaigns variable rows (filtered active+sent>0). All structured field-grid, never prose. Anchor = severity dot (`sc-dot`) leading every tile/card (`:189,208,228,410,489`).
- **Chart (all real-data-fed):** `Spark` bar sparkline (component `:53`, render `:389` `<Spark values={lane.daily}/>`, fed by `buildLanes(data.rows,data.daily,client)` `:676` ← real fetches); `Gauge`/`BarGauge` (`:106,122`, used Hero `:196,215,235`, `GovGauge` `:414,425`, `SeatCard` `:494`, fed by real `data.accept`/`data.governor`/`data.pipeline`); `Funnel` (`:250-314`, fed by real `data.accept`/`data.scans`/`data.outcomes`); Pipeline bar fill (`ov-bar-fill` `:576`, fed by real `data.pipeline`).

### SeatHealthBanner (global, all tabs)
- **File:** `src/components/SeatHealthBanner.tsx:6`.
- **Renders:** warning banner, hidden (`return null` `:8,11`) unless a seat is degraded or the health-guard write is >5h stale.
- **Data source:** `useSeatHealth()` (`:7`, `src/hooks/useSeatHealth.ts:5`) → `fetchSeatHealth()` (`src/lib/seatHealth.ts:17-25`) — real: `supabase.from('integration_config').select('value').eq('key','seat_health_summary').maybeSingle()`, then client-side `JSON.parse` (`:24`) — single JSON-blob row, not a row-per-item table.
- **Actionable:** "Reconnect" is a plain external `<a href>` (`:19`), not an in-app handler.
- **Density:** 0-2 lines. **Chart:** none.

### Supporting components (not screens — noted for completeness)
`ConfirmSheet.tsx` (modal confirm + `useConfirm()` `:20`, `ConfirmProvider` `:24`, no data query) · `ContextSheet.tsx` (prospect context sheet from ThreadScreen `:155,164`; real queries `fetchProspectContext()`→`outreach_prospects` `context.ts:42`, `fetchScan()`→`scans` `context.ts:54,61`, `saveOperatorNote()`→`outreach_prospects.update` `context.ts:69`, actionable) · `PullIndicator.tsx:4` (presentational only) · `Skeleton.tsx` (`InboxSkeleton`/`OpsSkeleton`/`SendsSkeleton` — deliberate loading placeholders, not fabricated production data) · `Avatar.tsx:18` (hash-based color+initials, no fetch) · `Linkified.tsx:9` (URL auto-link, no data).

---

## Candidate A — `src/exp/cand-a/` (`#exp/a`)

**Shell nav:** `Shell.tsx:22` tab type `'inbox'|'drafts'|'sends'|'ops'|'content'|'today'`. TabBar order (`cand-a/TabBar.tsx:12-38`): **Today ☼ → Inbox ◉ → Drafts ✦ → Sends ↑ → Ops ◈ → Content ▤(badge)**. Settings dropped from the tab bar entirely (reached via a gear icon inside `ContentScreen.tsx:25`, pushed full-screen by `SettingsPush.tsx`). Ops becomes a two-segment host (`OpsHost.tsx`: Cards=stock `OpsScreen` / Agent=this candidate's `AgentScreen`).

### AgentChatScreen — `cand-a/AgentChatScreen.tsx:18`
Full-screen chat overlay. Data: `useAgent()` (`src/hooks/useAgent.ts:8-78`) → `fetchChat()` `src/lib/agent.ts:55-62` — real `n8nclaw_chat_messages.select('id,role,content,created_at').order('created_at',desc).limit(50)`, reversed for display; realtime on `n8nclaw_chat_messages`/`n8nclaw_proactive_alerts` (`useAgent.ts:48-51`). Actionable: send → `sendChat()` `agent.ts:157-162` → RPC `n8nclaw_dashboard_send`. Density: ≤50 messages, prose, no anchor. No chart.

### AgentScreen — `cand-a/AgentScreen.tsx:119`
Working-list: Alerts/Reminders/collapsible Daily-summaries. Data: `fetchAlerts()` `agent.ts:99-121` real (`n8nclaw_proactive_alerts`, `.gte('created_at',cutoff-14d).order(desc).limit(50)` + head-count for `olderUnsent`); `fetchReminders()` `agent.ts:123-130` real (`n8nclaw_reminders.eq('status','pending').order('remind_at',asc)`); `fetchDailySummaries()` `agent.ts:132-144` real (`n8nclaw_daily_summaries.order('date',desc).limit(7)`). Actionable: Ack (`AgentScreen.tsx:37-64` → RPC `dashboard_action` on `n8nclaw_proactive_alerts.sent`), Done (`:67-89` → RPC `dashboard_action` on `n8nclaw_reminders.status`). Density: ≤50 alerts (4-line clamp `:24-32`), all pending reminders, 7 summaries. No anchor column. No chart.

### ContentQueue — `cand-a/ContentQueue.tsx:136`
Lane chip + stage-count rail + collapsible stage sections of cards. Data: `useContent(lane)` (`src/hooks/useContent.ts:12-72`) → `fetchContentDrafts(lane)` `content.ts:183-196` real (`carousel_drafts`, lane filter `laneFilter()`, `.or('updated_at.gte.<60d>,status.in.(review,error,generating,approved,scheduled)')`, order desc, limit 1000) + `fetchLaneProbe(lane)` `content.ts:312-326` head-count; realtime on `carousel_drafts` (`useContent.ts:62-64`); grouped via `groupByStage()` `content.ts:447-451` (pure fn over real rows). Actionable: `ReviewActions` shown only when `reviewActionable(status,lane)` (`content.ts:368-370`, review+ivan). Density: up to 1000 rows across ~8 sections, default-open ideas/generating/review/approved (`:134`); anchor = thumbnail+title pair, not a fixed status chip. Stage-rail count chips (`:85-106`) real, from `groupByStage` result — count badge, not bar/chart.

### ContentScreen — `cand-a/ContentScreen.tsx:14`
Pure router/header (title+gear+segmented Queue/Styles), no direct data.

### ContentStyles — `cand-a/ContentStyles.tsx:54`
Gallery of Post/Image style cards + Resources list. Data: `useStyles()` (`src/hooks/useStyles.ts:8-43`) → `fetchStyleRoster()` `styles.ts:39-57` real (`content_prompts.or('slug.like.style-*,slug.like.image-style-*').eq('is_active',true).order('slug')`); `fetchResources()` `styles.ts:236-249` real (`lm_drafts_v2`, lane-filtered, order desc, limit 200); `fetchContentDrafts('ivan')` reused for previews. Read-only (resource link is external `<a href>` `:116`). Density: roster ~11+6 (per comment `styles.ts:10`) + up to 200 resource rows; anchor = thumbnail+title. No chart.

### DraftDetail — `cand-a/DraftDetail.tsx:224`, body `:74`
Detail pane — title/type/stage chips, Dates, Source, Generation register (agent log), QA block, Taxonomy, Images, Description, Post body, Key points, IG caption, PDF link (sparse-field-aware, comment `:11-15`). Data: `useDraftDetail(id)` (`src/hooks/useContent.ts:82-109`) → `fetchDraftDetail(id)` `content.ts:512-517` real (`carousel_drafts.select('*').eq('id',id).maybeSingle()`), not realtime by design. Actionable: `ReviewActions` at bottom if actionable (`:214-218`). Density: one record, prose-heavy with label/value blocks (`Rows` `:28-40`), no anchor (detail, not list). **No chart** — note: `lib/content.ts:709-721` has a QA score-progression helper available but this screen renders `qa.score` as a bare number (`:162`) only, not a chart.

### OpsHost — `cand-a/OpsHost.tsx:24`
Router: Cards=stock `OpsScreen` / Agent=candidate's own `AgentScreen`. No direct data.

### ReviewActions — `cand-a/ReviewActions.tsx:13`
Skip/Approve button pair, confirm-gated. The only mutating surface in the Content tab. `approveDraft(id)` → `content.ts:341-346` (`carousel_drafts.update({status:'approved'}).eq('id',id).is('client_id',null)`); `skipDraft(id)` → `content.ts:355-360` (`.update({status:'disqualified'})`). Handler `:24-45`.

### SettingsPush — `cand-a/SettingsPush.tsx:9`
Back-chevron wrapper around stock `SettingsScreen`.

---

## Candidate B — `src/exp/cand-b/` (`#exp/b`)

**Shell nav:** `Shell.tsx:27`, tab type `cand-b/TabBar.tsx:8`: `'inbox'|'drafts'|'sends'|'ops'|'studio'|'today'`. Order (`TabBar.tsx:15-38`): **Today ☼ → Inbox ◉ → Drafts ✦ → Sends ↑ → Ops ◈ → Studio ◇** (no badge on Studio). Ops here is the unmodified stock `OpsScreen` (`Shell.tsx:112`) — Agent functionality lives entirely inside Studio instead. Studio is a single scrolling hub, not tabs, folding Settings back in as its last row (`StudioScreen.tsx:427-430`); pushed sub-views hide the tab bar (`Shell.tsx:163-167`, `studioPushed`).

### ChatScreen — `cand-b/ChatScreen.tsx:22`
Full-screen chat, props-driven (`messages`/`onSend` from Studio's `useAgent()`), same `fetchChat()` chain (`agent.ts:55-62`, `n8nclaw_chat_messages`, limit 50). Send → `agent.send` → `sendChat()` RPC (`agent.ts:157-162`). ≤50 messages, prose, no anchor. No chart.

### ContentCard — `cand-b/ContentCard.tsx:10`
Single review-card primitive (thumbnail/title/time/snippet + Approve/Skip or read-only note), reused by StudioScreen's inline top-3 and QueueScreen's full bucket. Data: `draft` prop from `useContent(lane).buckets.review` (same `fetchContentDrafts` chain). Actionable (Ivan lane only): `approveDraft`/`skipDraft` (`content.ts:341-346,355-360`) via handlers `:17-43`; Rise lane read-only (`:74-76`).

### QueueScreen — `cand-b/QueueScreen.tsx:56`
Pushed full-screen view, 8 collapsible buckets (review/error/stuckScheduled/approvedUnscheduled/generating/scheduled/published/archived) + Other; only `review` renders actionable `ContentCard`s, everything else is read-only `PlainRow` (`:24-34`). Data: `buckets`/`laneTotal` from Studio's `useContent(lane)`, grouped via `bucketDrafts()` (`content.ts:130-158`). Density: potentially large (`totalRows` `:84`), default-open = 4 actionable sections + tapped bucket (`:67-71`); anchor = title text, no fixed leading chip. No chart.

### RemindersScreen — `cand-b/RemindersScreen.tsx:48`
Pushed list, Done button per row. Data: `reminders` prop ← `fetchReminders()` (`agent.ts:123-130`, `n8nclaw_reminders`, pending, order asc). Actionable via `ackReminder()` RPC (`agent.ts:195-197`), handler `:14-25`. All pending rows, one line each, no anchor.

### StudioScreen — `cand-b/StudioScreen.tsx:190` — **flagship/densest screen of all 3 candidates**
Renders in order (`:279-431`): unacked alert cards (dismiss) → Agent nav group (Chat/Reminders/Daily-summary) → Content group (lane chips + 4 KPI count-tiles + inline top-3 review `ContentCard`s) → Styles group (horizontal-scroll strips by family + "All styles ›") → Resources list → More group (Settings nav row). Data: 3 hooks mounted directly — `useAgent()` (`:191`), `useStyles()` (`:192`), `useContent(lane)` (`:194`) — all real, tables as above. 4 "KPI tiles" (`tiles` array `:285-290`) render `content.buckets[t.key].length`, a **real count derived from the live fetch, not fabricated** — cite render `:352`, source `content.buckets` (`src/hooks/useContent.ts:42-58`). Actionable: tiles navigate only (push queue view, `:339-356`); inline top-3 cards actionable via `ContentCard`; alert dismiss → `ackAlert()` (`:204-212`) → RPC. Density: richest screen — alert cards (14d window), 3 nav rows, lane chips, 4 tiles, ≤3 review cards, 2 style strips, resources list, 1 settings row; no fixed anchor column anywhere (titles lead). **No sparkline/bar/line chart in this file** — only numeric count tiles + image strips, all real.

### StylesGridScreen — `cand-b/StylesGridScreen.tsx:65`
Full-screen "All styles" grid (Post/Image family sections). Data: `styles`/`previews` props ← `fetchStyleRoster()` (`styles.ts:39-57`, `content_prompts`) + `previewsByStyle()` (`styles.ts:180-203`, derived from real `fetchContentDrafts('ivan')` rows — not fabricated). Read-only. Density: full roster grid, no anchor (image-first tile). No chart.

### SummariesScreen — `cand-b/SummariesScreen.tsx:5`
Full-screen list of daily-summary cards (date/prose/topic chips/action bullets). Data: `summaries` prop ← `fetchDailySummaries()` (`agent.ts:132-144`, `n8nclaw_daily_summaries`, order desc, limit 7). Read-only. ≤7 cards, prose-dense, no anchor. No chart.

---

## Candidate C — `src/exp/cand-c/` (`#exp/c`)

**Shell nav:** `Shell.tsx:20,36-194` — tab type **identical to the main app's** (`'inbox'|'drafts'|'sends'|'ops'|'settings'|'today'`), and it imports the real shared `TabBar` directly (`cand-c/Shell.tsx:10`, `../../components/TabBar`) — **no local tab-bar copy, no new tab**. Instead two existing tabs gain internal segments: **Drafts → "Work"** = `[DMs|Content|Styles]` (`WorkScreen.tsx:6,8-12`, DMs=stock `DraftsScreen`); **Ops → `OpsHub`** = `[Cards|Agent]` (`OpsHub.tsx:7-10`, Cards=stock `OpsScreen`, Agent=candidate's own `AgentScreen`). Settings tab renders stock `SettingsScreen` directly (`Shell.tsx:130`), no indirection.

### AgentScreen — `cand-c/AgentScreen.tsx:125`
Ops→Agent segment. Chat nav row → Alert cards (Ack) → Reminder rows (Done) → Daily-summary rows (expand-on-tap). Data: own `useAgent()` mount (`:126`) — same `fetchAlerts`/`fetchReminders`/`fetchDailySummaries` chain as A/B. Actionable via RPC `dashboard_action` (same as A/B). Density: ≤50 alerts (4-line clamp `:29-36`), all pending reminders, ≤7 summaries (one open at a time, `:128`). Anchor: `ops-kind`/`ops-tm` badge top-right of card, not row-start. No chart.

### ChatScreen — `cand-c/ChatScreen.tsx:18`
Mounts its own independent `useAgent()` (`:19`, unlike A/B which receive it as a prop). Full-screen chat, linkified bubbles. Data: `fetchChat()` (`agent.ts:55-62`, `n8nclaw_chat_messages`, limit 50). Actionable: send → `sendChat()` RPC (`agent.ts:157-162`), handler `:30-37`. ≤50 messages, prose. No chart.

### ContentQueue — `cand-c/ContentQueue.tsx:134`
Drafts→Work→Content segment. Lane chip + 7 fixed-order collapsible sections + collapsed "Other". Data: own `useContent(lane)` mount (`:136`) → `fetchContentDrafts`/`fetchLaneProbe` (`content.ts:183-196,312-326`, `carousel_drafts`), grouped via `bucketDrafts()`. Actionable: Skip/Approve only when `actionable = s.key==='review' && lane==='ivan'` (`:187`) → `approveDraft`/`skipDraft` (`content.ts:341-346,355-360`), handlers `:64-89`. Density: potentially large (all sections + Other); anchor = **44×44 thumbnail at row start** (`Thumb`, `:48-55`) — closest of all three candidates to a true fixed anchor column, though image not chip. No chart.

### OpsHub — `cand-c/OpsHub.tsx:18`
Router: Cards=stock `OpsScreen` / Agent=this candidate's `AgentScreen`. No direct data.

### StylesGallery — `cand-c/StylesGallery.tsx:74`
Drafts→Work→Styles segment. 2-column grid per family + Resources list. Data: own `useStyles()` mount (`:75`) → `fetchStyleRoster()` (`styles.ts:39-57`), `fetchResources()` (`styles.ts:236-249`, `lm_drafts_v2`), `previewsByStyle()` over real `fetchContentDrafts('ivan')` rows. Read-only (external `<a href>` resource links `:116-137`). No anchor (tile-first). No chart.

### WorkScreen — `cand-c/WorkScreen.tsx:23`
Pure router: segmented `[DMs|Content|Styles]` → stock `DraftsScreen` / candidate's `ContentQueue` / `StylesGallery`.

**Cross-candidate note:** no FABRICATED/mock array feeds any list or chart in any of the 21 files across cand-a/b/c — every list traces to a live `.from(table)` call via the shared hooks/lib chain. No chart/sparkline/bar dataviz component exists in any of the three candidates; all "visualizations" are numeric count tiles or chip badges bound to real query results.

---

## v2c Workbench — `src/exp/v2c/` (`#exp/v2` / `#exp/v2c`)

This is the **winning structure carried forward** from the inbox-v2-revamp tournament and the highest-priority surface for the redesign.

### Nav shell
- Route parsing: `src/exp/v2c/route.ts:23-32` (`parseWbHash`, matches `^#exp\/v2c?(?:\/([^/]*))?(?:\/([^/]*))?`); `wbHash()` (`route.ts:34-37`) always **writes** `#exp/v2/<job>[/chat]` (v2c is read-compat only, `route.ts:15-17`).
- Job set: `src/exp/v2c/layout.ts:14,39,47-50` — `JOBS = ['today','inbox','drafts','content','sends','ops','settings']`, icons `{today:☼, inbox:◉, drafts:✦, content:▤, sends:↑, ops:◈, settings:⚙︎}`. This is the main app's 6 tabs **plus one new destination, Content (▤)**, which has no dedicated slot at all in `src/components/TabBar.tsx:1`.
- **Desktop rail** (`Rail.tsx:91-137`, `.wb-rail`): avatar/title (`:93-96`) → `before=[today,inbox]` (`:88`) → nested "Work" group `[drafts(DMs), content(Content)]` (`:100-103`, labels via `WORK_LANE_LABEL` `:16`) → `after=[sends,ops]` (`:89,104`) → separator (`:111`) → non-job **"Claude" row** (glyph `✳`, `:112-116`, docks a context peer rather than switching screens) → separator → Settings row + sync indicator footer (`:121-134`). Full order: **Today → Inbox → [Work: DMs, Content] → Sends → Ops → Claude → Settings**.
- **Mobile bottom bar** (`Rail.tsx:146-186`, `MobileTabs`): 6 slots — Today, Inbox, Work(✦, drafts+content merged badge), Sends, Ops, **Claude(✳)** — **Settings dropped from the bottom bar** (reached via gear icon in the ribbon, `Shell.tsx:392-394`) and Claude given a real slot in its place. Named departure from `TabBar.tsx`'s flat 6-slot bar reused unmodified across viewports.
- Layout resolution: `layout.ts:104-125` (`planWorkbench`), 3 canvases — mobile <1000px, desktop 1000-1319px, wide ≥1320px (breakpoints `Shell.tsx:60-61`); desktop holds 1 peer, wide up to 2 (`MAX_PEERS=2`, `layout.ts:84,87-89`); peers are `{kind:'thread'|'draft'|'chat'}` (`layout.ts:23-29`) rendered right of the working-list column; zero-peer state goes full-width (`layout.ts:119`, fix for a "ghost pane" defect noted `Shell.tsx:36-39,50-51`).

### ContentList — `src/exp/v2c/ContentList.tsx:507`
Two lane tabs (`:536-541`), alert strip, `PipelineBar`/`StackBar` chart (`:122-153`), `FilterBar`, stage-grouped `Card` sections (`:52-96`). Data: `useContent(lane)` → `fetchContentDrafts`+`fetchLaneProbe` on `carousel_drafts` (`content.ts:183-196,312-326`; lane filter `content.ts:86-89`; `.or('updated_at.gte.<14d>,status.in.(ACTIVE_STATUSES)')` `:191`; order desc; limit 1000); realtime on `carousel_drafts` (`useContent.ts:62-63`). Sub-reads feeding embedded sections: `lm_idea_candidates` (`content.ts:290-301`, `status='reviewing'`, order `composite_score` desc, limit 500), `scheduled_posts` (`content.ts:222-230`, `.in('status',QUEUE_STATUSES)`, order desc, limit 500), `lm_drafts_v2` (`styles.ts:236-250`, lane-filtered, order desc, limit 200), `content_prompts` (`styles.ts:39-57`), `n8nclaw_proactive_alerts`+`n8nclaw_daily_summaries` (`agent.ts:99-133`). **No fabricated rows** — `mock.ts` only injects a synthetic error string via `?wbmock=fetch-error` (`ContentList.tsx:524`), never fake data. Actionable: `ReviewActions` (`ReviewActions.tsx:13-60`) gated by `reviewActionable(status,lane)` (`content.ts:368-370`, review+ivan only — Mattan's lane is read-only by construction). Density: default-open stages `['ideas','generating','review','approved']` (`:236`); compact image+2-line cards; no fixed leading anchor column — status/QA chip floats inline in the meta row (`:72-89`). Chart: `PipelineBar`→`StackBar` (`:134`, primitive `Surface.tsx:107-122`, real, from `stages`); `PillarMix` (`ContentSections.tsx:380-420`, bar-per-pillar %, computed client-side from real `drafts` rows).

### ContentSections (module inside ContentList's lanes, not a standalone screen) — `src/exp/v2c/ContentSections.tsx`
`IdeasSection` (`:113`, `lm_idea_candidates`, expandable score grid `scoreLine` `:51-56`, read-only per comment `:141`) · `QueueStrip` (`:184`, `scheduled_posts`, capped render at 60 `:213-216`, read-only "never a control" `:199-201`) · `ResourcesSection` (`:225`, `lm_drafts_v2`, read-only `:246-251`) · `StyleRoster` (`:297`, `content_prompts` + client-computed preview counts `:308`, read-only) · `PillarMix` (`:380`, chart, ivan-lane only) · `AlertCountLine`/`SummariesSection` (`:426,437`, `n8nclaw_*` read-only digest). All rows read-only — the only mutating buttons on the Content surface live in `ReviewActions.tsx`.

### ContentBits — `src/exp/v2c/ContentBits.tsx` (shared primitives, not a screen)
`Val`/`Block`/`Rows`/`KeyRows` (`:13,44-74`), **`FilterBar`** (`:87` — the actual filter widget every section above mounts), `FilteredEmpty` (`:143`), `Figure` (`:156`). No data fetching of its own.

### OpsBoard — `src/exp/v2c/OpsBoard.tsx:82`
KPI tile row + `StateBand`/`StackBar` (`:45-80`, 4 tiles: waiting/working/done/blocked), freshness line (`freshness.ts`), two columns ≥1000px: pending queue (left) + read-only "already handled" history (right, `:146-166`), reusing `OpsGroups`/`PendingCard` from `src/screens/OpsScreen`. Data: `useOps()` (`src/hooks/useOps.ts:5-41`) → `fetchOpsDrafts()` (`ops.ts:113-120`, real `ops_drafts`, order desc, limit 300), realtime on `ops_drafts` (`useOps.ts:33-34`). Actionable: approve/discard via reused `PendingCard` writes (`ops.ts:125-233`) — OpsBoard itself owns only the frame (`:19-21`). Density: 4 KPI tiles, up to ~10 "done" rows (`ops.ts:98-103` limit=10) + unbounded pending. Chart: `StackBar` (`:65-70`, real, from `ops_drafts`-derived counts).

### Register (detail-body sub-renderer inside DraftPane, not a screen) — `src/exp/v2c/Register.tsx`
`QaRegister` (`:40` — score bar `wb-qa-g` `:58-73`, verbatim feedback/rewrite, regen history, catch-all `KeyRows` `:147`, read-only) · `AgentRegister` (`:157` — full agent generation log + score-progression strip `:171-189`, read-only). Data arrives as already-fetched props from `DraftPane`'s `useDraftDetail` — no independent query.

### InboxHead — `src/exp/v2c/InboxHead.tsx:16`
Header band: one `StackBar` (3 segments: replied/draft-ready/waiting) + legend + "N threads · relAge" line. Data: `threads` prop from the shared `useInbox()` mount (`Shell.tsx:113`) → `fetchMessages()` (`inbox.ts:135-150`, real `inbox_messages_v`, paginated to 20,000 rows) → `groupThreads()` (`inbox.ts:60-94`). Actionable: "Draft ready" legend chip navigates to Drafts job (`:37`), otherwise read-only. Density: header band, count-only, not rows. Chart: the `StackBar`, real, computed at `:21-23`.

### ThreadPeer — `src/exp/v2c/ThreadPeer.tsx:45`
Pane header (avatar, `Ladder` stage-progress widget `:17-43`, DRAFT pill, "Ask Claude" button, close) wrapping stock `ThreadScreen` (`:61`). Data: `thread` prop, looked up from the single `useInbox()` mount (`Shell.tsx:142-144`), no separate fetch. Actionable: "Ask Claude" (`:58`) opens chat peer; reply/send actions owned by wrapped `ThreadScreen` (out of this file's scope).

### ChatPane — `src/exp/v2c/ChatPane.tsx:67`
Header w/ session id + model picker (`:132-182`), "about" context card (`:194-203`), message list via `ChatMessage.tsx` (`:225-234`), voice strip, composer w/ send/stop. Data: **in-memory only** — `useChat()` (`useChat.ts:53-194`) owns `turns` as React state, never persisted to a table; streams via `getTransport()` (`chat/transport.ts`) → real broker `sendToClaude` (`src/lib/claude.ts` → edge fn `inbox-claude`) unless `?wbmock=chat:*`. Actionable: send/stop, retry (`:229`), model picker (local state only), voice controls. Not a data list.

### DraftPane — `src/exp/v2c/DraftPane.tsx:238`, body `:35`
Full detail register — header/meta chips, error banner, `QaRegister` (top, `:140`), Dates/Source/Post/Images/Key-points/Description blocks, `AgentRegister`, Taxonomy + catch-all, IG caption/PDF/slides. Data: `useDraftDetail(id)` → `fetchDraftDetail(id)` (`content.ts:512-517`, real `carousel_drafts.select('*').eq('id',id).maybeSingle()`), not realtime (`useContent.ts:74-77`). Actionable: `ReviewActions` at bottom (`:230-232`, same `reviewActionable` gate); "Ask Claude" (`:268`) docks chat peer with this draft as context. Density: prose/field-grid document, ~15-25 populated fields typical, many conditionally rendered (`:20-22`), no repeated-row list.

### Filter-UI site verification (all 6 confirmed unchanged)
| cited location | actual content | status |
|---|---|---|
| `ContentList.tsx:516` | `const [filters, setFilters] = useState<FilterState>({})` (inside `ContentList`) | confirmed |
| `ContentSections.tsx:121` | `const [filters, setFilters] = useState<FilterState>({})` (inside `IdeasSection`) | confirmed |
| `ContentSections.tsx:191` | `const [filters, setFilters] = useState<FilterState>({})` (inside `QueueStrip`) | confirmed |
| `ContentSections.tsx:233` | `const [filters, setFilters] = useState<FilterState>({})` (inside `ResourcesSection`) | confirmed |
| `ContentSections.tsx:305` | `const [filters, setFilters] = useState<FilterState>({})` (inside `StyleRoster`) | confirmed |
| `Shell.tsx:99` (v2c) | `const [filter, setFilter] = useState<Filter>('all')` | confirmed |

Note: each line above is the *state site*; the actual rendered filter-bar widget (chips/toggle logic) is the one shared `FilterBar` component at `src/exp/v2c/ContentBits.tsx:87-138`, mounted by every section listed.

### Theme system (v2c)
- **v2c itself has zero dark/light logic** — no hits for `theme`/`data-theme`/`prefers-color-scheme` anywhere under `src/exp/v2c/`; it is a pure consumer of the global CSS tokens.
- Toggle: manual only (no media query) — `src/screens/SettingsScreen.tsx:75-79` (`setThemeAndPersist`) sets `document.documentElement.dataset.theme` + `localStorage.setItem('inbox-theme',next)`; switch UI `SettingsScreen.tsx:134-137`. v2c reaches this same screen unchanged at `Shell.tsx:318` (`{job === 'settings' && <SettingsScreen />}`).
- Boot: `src/main.tsx:7-9` — light mode applied only if `localStorage.getItem('inbox-theme')==='light'`; default (no stored value) is dark.
- Tokens: dark/default `src/styles.css:1-6` (`:root{--bg:#000000;--surface:#1C1C1E;--surface2:#2C2C2E;--surface3:#3A3A3C;--text:#FFFFFF;--text2:rgba(235,235,245,.6);--text3:rgba(235,235,245,.3);--accent:#10A37F;--accent-soft:rgba(16,163,127,.16);--blue:#0A84FF;--sep:rgba(84,84,88,.5)}`); light overrides `src/styles.css:7-12` (`:root[data-theme='light']{...}`) + `:13-16` (2 component-specific light overrides). v2c-local light patches: `src/exp/v2c/styles.css:58` (`.wb-rail` background) and `:127` (`.wb-pane-h` background) — only these two chrome surfaces are patched locally; everything else inherits global tokens. v2c-local layout tokens (radii only, not color): `src/exp/v2c/styles.css:11-16` (`.wb{--r-sm:14px;--r-md:16px;--r-lg:20px;--r-chip:7px}`, scoped to `.wb` class applied in `Shell.tsx:208,382,404`).
- **Redesign implication:** v2c re-themes automatically from `src/styles.css:1-12`; only its two local light-mode patches need separate attention.

### Chat/voice subsystem (brief)
`ChatPane.tsx`/`ChatMessage.tsx` render markdown (`chat/renderer.ts`) + tool-call summaries (`chat/toolSummaries.ts`) + composer + voice controls (`VoiceControl.tsx`/`useVoice.ts`). Data: **in-memory only, never table-backed** — `useChat.ts:53-194` owns `turns` as React state, built via `buildContext()` (`:36-46`, replays last `CONTEXT_TURNS=6` turns as prose) and streamed via `getTransport()` → real broker by default, edge fn `inbox-claude`; comment `useChat.ts:6-18` states no server-side resume, nothing persists across reloads. Mock lever `?wbmock=chat:error-cold|error-mid` swaps a fake transport for demoing error states (labeled test lever, not a production fabrication). Voice is feature-detected browser Speech Recognition/Synthesis, also mock-driveable (`?wbmock=voice:*`), no backend table.

---

## Notable surprises for the orchestrator

1. **No standalone `Shell.tsx` in the default app** — it's an inline function in `App.tsx`. The historical "Shell.tsx:99" filter citation only resolves inside experimental trees (`cand-b/Shell.tsx:97-99` or `v2c/Shell.tsx:99`), not the shipped app.
2. **Zero fabricated/hard-coded data was found feeding any chart or list** across all ~40 screens/modules inventoried (default app + 3 old candidates + v2c). Every `Spark`/`Gauge`/`StackBar`/`Funnel`/`PillarMix` traces to a real Supabase query or RPC. The one soft spot: `TodayScreen`'s masthead stack bar and zones 01-03 are fed by an **opaque edge function** (`get-morning-brief`) whose backing table is not visible in this repo — not fabricated, but not independently verifiable from the client code either.
3. **`OverviewView.tsx` (kpi dashboard) is the single densest, most chart-heavy screen in the whole app** — 8 parallel real queries, 4 distinct chart primitives (Spark, Gauge/BarGauge, Funnel, bar-fill), all real. This is likely the natural "overview" archetype exemplar for the redesign.
4. **v2c genuinely introduces a new "Content" nav destination** with no analogue in the shipped `TabBar.tsx` — all three old candidates (a/b/c) also independently invented a way to surface content-drafts more prominently (new tab, hub, or segment), suggesting this was a converged need across three independent design attempts.
5. **Anchor-column discipline is inconsistent and mostly absent** outside the default app's InboxScreen/DraftsScreen/TodayScreen/OverviewView (avatar or severity-dot leading every row/tile). None of cand-a/b/c and only partially v2c (inline floating chip, not fixed-left) carry this pattern forward — cand-c's `ContentQueue` thumbnail comes closest among the experimental trees.
6. **v2c's mobile nav swaps Settings for a "Claude" chat slot**; desktop rail keeps both (Claude as an extra row, Settings still in the footer) — a real information-hierarchy divergence between viewports worth flagging to the design orchestrator.
