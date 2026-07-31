# Phase 1b — Content Data Map (Ivan brand + Rise DTC), personal-site dashboard

Read-only audit. Repo: `/Users/ivanmanfredi/Desktop/personal-site`. All paths below are
relative to that repo root unless given in full.

## 1. Content data model — Ivan vs Rise (client)

Same tables hold both lanes; the split is **one nullable column**, never separate
tables:

- **`carousel_drafts`** — posts/carousels (Ivan's own AND client boards, e.g. RISE).
  - `client_id` column is the split: `null` = Ivan's own library, non-null = a
    client board's draft. `hooks/useContentLibrary.ts:70` (`clientId: row.client_id ?? null`),
    scoped at read time `hooks/useContentLibrary.ts:114` (`.is('client_id', null)`
    — "Ivan's OWN content library... Client-owned drafts (client_id set, e.g. RISE)
    live on their own Client Ops surface").
  - Realtime channel also re-filters client rows out client-side:
    `hooks/useContentLibrary.ts:174-177` (if `row.client_id != null` drop it from local state).
  - `CarouselDraft.clientId` doc comment: `hooks/useContentLibrary.ts:18-24`
    ("Ivan's review queue must EXCLUDE these... client drafts are owned by their
    client board's own action path (client_board_action RPC), never by
    carousel_drafts.status. Documented trap.").
- **`lm_drafts_v2`** — lead magnets, same split via `client_id`.
  `hooks/useLeadMagnets.ts:70` (`clientId: row.client_id ?? null`); doc comment
  `hooks/useLeadMagnets.ts:12-13` ("Non-null on LMs owned by a client board. Ivan's
  approve queue must EXCLUDE these").
- **`scheduled_posts`** — the LinkedIn publish queue for BOTH lanes; has its own
  `platform` and `is_repost` columns but no `client_id` seen in the dashboard's
  select (`hooks/useContentPipeline.ts:34-37`, `select('*')`) — scoping for this
  table is UNKNOWN from the dashboard code alone (would need the table schema /
  a migration read).
- **Client-only ideas table**: `client_ideas` — referenced only as an
  `AgentLogFeed table="client_ideas"` prop in `components/dashboard-v2/sections/ClientOps.tsx:509`;
  actual reads/writes for it happen server-side inside `operator_client_ideas` /
  `operator_approve_idea` RPCs (see §6), not via a direct `.from('client_ideas')`
  call anywhere in this repo.
- **Ivan's own ideas**: `lm_idea_candidates` — read via an edge function, not a
  direct table select: `lib/ideaProjection.ts:14` (`FEED_URL = .../lm-curator-feed`),
  projected into board-shaped rows by `candidateToIdeaDraft`
  (`lib/ideaProjection.ts:125-174`). This table is Ivan-only; no client_id split
  observed (client ideas live in the separate `client_ideas` table instead, per
  `operator_client_ideas` above).
- **Rise/client board container**: `client_boards` — referenced only in a type
  comment `components/ClientBoardPage.tsx:27` ("shape of client_boards.board");
  the JS never selects it directly — everything client-board-related is read via
  RPCs (`get_client_board`, `get_client_board_by_session`) that presumably read
  `client_boards` + `carousel_drafts`/`lm_drafts_v2` server-side and return an
  assembled `board.queue` / `board.ideas` / `board.lead_magnets` JSON blob. The
  RPC bodies are **not present in this repo's `supabase/migrations/*.sql`**
  (grepped, no `CREATE FUNCTION get_client_board` found) — UNKNOWN beyond the
  call-site contract.

**Summary**: no per-client table fork. `carousel_drafts.client_id` /
`lm_drafts_v2.client_id` is the tenancy column for post/LM content; Ivan's
surfaces read with `client_id IS NULL`, and the Rise/client board reads the same
underlying tables (indirectly, through RPCs scoped by `client_id`/slug/token)
plus a client-only `client_ideas` table for the idea stage.

## 2. Status vocabulary and lifecycle

### `carousel_drafts.status` (Ivan's posts/carousels — client rows use same column)
Observed literal values across the code:
`idea` (client-side-only projection, never written to DB — `lib/ideaProjection.ts:135`),
`draft` (default fallback when DB value is null/empty — `hooks/useContentLibrary.ts:69`),
`generating` (`lib/studioActions.ts:63`, `:370` for LM),
`review` (filter — `PostWorkSurface.tsx:103`),
`approved` (`PostWorkSurface.tsx:225`, `ClientOps` statusCounts),
`disqualified` (reject/kill — `PostWorkSurface.tsx:234`, `:259`, `LmWorkSurface.tsx:189`),
`scheduled` (`lib/studioActions.ts:262`, `Calendar.tsx:83`),
`published` (`clientops2/shared.tsx:190`/`220` statusCounts),
`error` (`PostWorkSurface.tsx:113`).
No exhaustive DB-side CHECK constraint was located in this repo (UNKNOWN — would
need the live schema); this list is everything the dashboard code branches on.

- **Ivan's Review lane query** (`PostWorkSurface.tsx:100-106`) — INCLUDES only
  `status === 'review' && !clientId && !isIdea && !skipped`. EXCLUDES client rows,
  idea-stage rows, and anything not exactly `'review'`.
- **Ivan's error/stuck triage** (`PostWorkSurface.tsx:113-120`) — `error` rows
  (client-excluded) and "stuck" = `status === 'scheduled' && scheduledAt < now &&
  !sourcePostId` (i.e. passed its time with no published-LinkedIn URN yet).
- **Client-review count shown to Ivan** (`PostWorkSurface.tsx:107-110`,
  `LmWorkSurface.tsx:87-90`) — counted but never actionable from this surface
  ("client boards own these").

### `lm_drafts_v2.status`
Canonical 9-stage pipeline with legacy-alias folding
(`hooks/useLeadMagnets.ts:49-62`, `normalizeLmStatus`):
raw `draft`→`idea`, `ready`/`complete`→`published`, `pending`→`idea`,
`lm_review`→`review`, `generating_content`→`generating`. Canonical values seen in
code: `idea`, `generating`, `review`, `approved`, `disqualified`, `scheduled`,
`published`, `error`.
- **LM review queue** (`LmWorkSurface.tsx:72-78`) — INCLUDES `status==='review' &&
  !clientId && isLmFormat(format) && !acted`. `offRosterCount` (line 81-84)
  surfaces review rows whose `format` isn't on the known roster (rather than
  silently dropping them — contrasted explicitly with "the classic board drops
  them entirely").
- **LM error strip** (`LmWorkSurface.tsx:92-95`) — `status==='error' && !clientId`.
- **LM client-review count** (`LmWorkSurface.tsx:87-90`) — client rows,
  never approvable here.

### `scheduled_posts.status` (publish queue, both lanes)
`pending`, `queued_v2`, `posting`, `posted`, `failed`, `cancelled`
(`components/dashboard-v2/sections/calendarItems.ts:25-32`, the tone map).
- Reschedulable only while `pending`/`queued_v2`
  (`Calendar.tsx:135` `.in('status', ['pending','queued_v2'])`;
  `calendarItems.ts:42-45` `QUEUE_RESCHEDULABLE`).
- `useContentPipeline.ts:34-37` reads ALL rows unfiltered (`select('*')`, no
  status/client filter) — this hook itself does no exclusion; filtering happens
  downstream in `calendarItems.ts`.

### Client-facing derived "Stage" vocabulary (NOT the same as raw `status`)
`components/ClientBoardPage.tsx:71` — `type Stage = 'planned' | 'drafted' |
'review' | 'scheduled' | 'published'`; `STAGE_ORDER` at line 1052 = `['review',
'drafted', 'scheduled', 'published']`. `stageOf()` (line 7817) can override the
server-supplied `q.stage` client-side: `q.generating ? 'drafted' :
angleSwaps[q.id] ? 'drafted' : stageOverride[q.id] ?? q.stage`.
This is a **second, separate vocabulary** layered on top of the raw DB status —
it comes back pre-computed inside the `get_client_board` RPC payload
(`board.queue[].stage`), not recomputed here from `carousel_drafts.status`
directly (that mapping is server-side / UNKNOWN from this repo).

### VERIFIED TRAP — "This week" hides items once they leave `stage='review'`
`ClientBoardPage.tsx:2498` — the actionable "needs your review this week" ledger:
```
const actionable = [...weekQ.filter((q) => q.stage === 'review' && isScheduled(q))]
```
and the sibling counters at `:2503` (`waitingElsewhere`), `:2510`, `:2590`
(`readyToAdd`), and `:8141` (`scheduledCount`) all gate on `stageOf(q) ===
'review'` explicitly. **Confirmed**: once a queue item's stage is anything other
than `'review'` (e.g. it has progressed to `'scheduled'`), it is filtered OUT of
every one of these "needs attention this week" computations — it stops asking
the client for anything, by design of the filter, matching the memory trap
"status='scheduled' HIDES from board This-week (use stage='review')". The raw
`carousel_drafts.status='scheduled'` flip (`lib/studioActions.ts:259-267`,
`Calendar.tsx:75-84`) is presumably what the server-side RPC maps to
`stage='scheduled'` — that mapping function itself was not found in this repo's
migrations (UNKNOWN, likely defined directly in Supabase, not tracked here).

### Video sub-status (`carousel_drafts.video_status`, separate column, type='video' rows only)
`queued | generating | review | approved | failed`
(`hooks/useContentLibrary.ts:42-43`). Independent lifecycle from the row's main
`status`; `approveVideo()` (`lib/studioActions.ts:328-338`) sets BOTH
`video_status='approved'` AND `status='scheduled'` + `scheduled_at` together.

## 3. Statuses meaning "needs Ivan's attention"

- `carousel_drafts.status === 'review'` (own, non-client, non-idea) — the Review lane queue.
- `carousel_drafts.status === 'error'` (own) — Attention/error triage drawer (`PostWorkSurface.tsx:113,354-359`).
- `carousel_drafts.status === 'scheduled'` past its `scheduled_at` with no `source_post_id` — "stuck" (silently never published), Attention drawer (`PostWorkSurface.tsx:114-120`).
- `lm_drafts_v2.status === 'review'` (own, on-roster format) — LM review queue.
- `lm_drafts_v2.status === 'error'` (own) — LM error strip with retry (`LmWorkSurface.tsx:92-95`, retry at `:158-165`).
- `lm_idea_candidates` in `reviewing` (fetched via `lm-curator-feed`, `lib/ideaProjection.ts:191-198`, filtered to `content_type==='post'`) — the Ideas lane top-of-board, needs promote/defer/kill.
- Client-side (internal Ivan Client Ops view, `clientops2/shared.tsx:187-190`): `statusCounts.review` bucket is the client-draft "needs a decision" count Ivan tracks per client, though the actual approve action there is the client's own, not Ivan's — Ivan's role in `ClientOps.tsx` is oversight/scheduling (`operator_schedule_draft`, `operator_set_board_visible`), not approval.

## 4. Mutations (with external-publish implications)

### Ivan's own posts (`PostWorkSurface.tsx` → `lib/studioActions.ts`)
| Action | Write | File:line | Publishes externally? |
|---|---|---|---|
| Approve idea | `lm-curator-decide` edge fn (`decision:'approve'`) | `lib/ideaProjection.ts:216-229`; call site `PostWorkSurface.tsx:171-180` | No — promoter creates a new generating draft; not a publish. |
| Defer / reject idea | same edge fn, `decision:'defer'`/`'reject'` | `PostWorkSurface.tsx:182-190`, `:196-214` | No. |
| Approve review draft | `carousel_drafts.status='approved'` via `setStatus()` | `lib/studioActions.ts:250-255`; call `PostWorkSurface.tsx:222-229` | **No** — `approved` here is NOT a publish trigger by itself (contrast with LM lane below); publishing still requires a `scheduled_at` + `status='scheduled'`. |
| Reject review draft | `status='disqualified'` | `PostWorkSurface.tsx:231-238` | No. |
| Edit body | `saveDraft({post_body})` → `carousel_drafts` update | `lib/studioActions.ts:90-122`; call `PostWorkSurface.tsx:246-254` | No. |
| Disqualify stuck | bulk `status='disqualified'` direct `.update().in('id',...)` | `PostWorkSurface.tsx:257-264` | No (undoes a dead schedule). |
| Reschedule (Calendar drag) | `carousel_drafts.scheduled_at` (+ `status='scheduled'` if promotable) THEN mirrors into `scheduled_posts` pending row | `Calendar.tsx:65-109` | **Yes, indirectly** — flipping `status→'scheduled'` is what the n8n Bridge workflow (`yzXqLDIpuNzuhUQq`, named in comment `Calendar.tsx:76-78`) picks up on a 5-min cron to insert the `scheduled_posts` queue row that the publisher watches; the code here ALSO writes `scheduled_posts` directly for instant effect (`:95-102`). |
| Regenerate/re-author draft | `status='generating'` + `taxonomy.generating_started_at`, then fires `post-gen-v2` webhook | `lib/studioActions.ts:52-88` | No direct publish; re-enters generation pipeline. **Does NOT clear `image_urls` in this code path** — the regen call only patches `status`/`taxonomy`; any image wipe (per the memory trap "regen wipes image_urls") must happen server-side in the n8n `post-gen-v2` workflow, not in this repo's client code (UNKNOWN/could not confirm client-side; flagged as a trap to verify server-side). |
| Schedule directly | `scheduleCarousel()` sets `status='scheduled'`+`scheduled_at` | `lib/studioActions.ts:259-267` | **Yes, indirectly** via the same Bridge workflow. |
| Publish now | fires `publish-now` n8n webhook (`draft_id`, shared secret) | `lib/studioActions.ts:269-289` | **Yes, directly** — explicit immediate-publish button; server-side guards against double-post; realtime flips draft to `published` with URN once done. |
| Image edit / revert | `carousel_drafts.image_urls` update (+ `image_edit_versions` insert) | `lib/studioActions.ts:484-506` | No. |
| Redo video | `video_status='generating'` (+`video_style`/`video_feedback`), fires `video-gen-v2` webhook | `lib/studioActions.ts:300-322` | No (renders async, PATCHes back `video_status='review'`). |
| Approve video | `video_status='approved'` + `status='scheduled'` + `scheduled_at` (via `findNextSlot`) | `lib/studioActions.ts:328-338` | **Yes, indirectly** — same Bridge path as a scheduled post. |

### Lead magnets (`LmWorkSurface.tsx` / `lib/studioActions.ts`)
| Action | Write | File:line | Publishes? |
|---|---|---|---|
| Approve & build assets (PRIMARY) | flips `status='generating'` then fires `lm-gen-v2` webhook phase=`'assets'` | `lib/studioActions.ts:362-377`; call `LmWorkSurface.tsx:137-156` | No — builds resource/email/cover; not a publish. |
| Approve (status-only, SECONDARY) | direct `lm_drafts_v2.status='approved'` update | `LmWorkSurface.tsx:174-180` | No observed direct publish trigger from `approved` alone in this code path (contrast with the memory trap "approved=publishes in some lanes" — **not confirmed true for this specific LM approve button**; the promo post itself is scheduled separately via `scheduleLM`). |
| Reject | `status='disqualified'` | `LmWorkSurface.tsx:189-194` (also `lib/studioActions.ts` LmReviewFlow variant) | No. |
| Retry generation | fires `lm-gen-v2` phase=`'content'` | `lib/studioActions.ts:362-372` reused via `LmWorkSurface.tsx:159-165` | No. |
| Save edit | `saveLMDraft()` → `lm_drafts_v2` update (post_body/email_copy/resource_html/spec merge) | `lib/studioActions.ts:423-441` | No. |
| Schedule LM promo | POSTs to `lm-schedule` edge fn (service-role write to `scheduled_posts`, since anon key is SELECT-only there) + flips draft stage | `lib/studioActions.ts:383-397` | **Yes, indirectly** — inserts/updates the `scheduled_posts` row the LinkedIn publisher watches. |
| Repost LM | fires `lm-gen-v2` phase=`'repost'` (shared secret) — inserts a new pending `scheduled_posts` row, `is_repost=true` | `lib/studioActions.ts:408-416` | **Yes, indirectly** (new queued post). |
| Regen cover | fires `lm-regen-cover-v2` webhook, PATCHes `lm_drafts_v2.cover_url` server-side | `lib/studioActions.ts:418-421,443-451` | No. |
| Set active cover | `operator_set_lm_active_cover` RPC (variant-constrained server-side) | `lib/studioActions.ts:521-528` | No. |

### Calendar-level mutations (both lanes)
- `onReschedule` routes to `reschedulePost` (carousel_drafts path, above) or
  `rescheduleQueueRow` (direct `scheduled_posts.scheduled_at` update, guarded to
  `status in ('pending','queued_v2')`, `.select('id')` to detect a real vs
  no-op match) — `Calendar.tsx:111-151`.
- LM chips always open the full `LeadMagnetEditor`, never a direct queue-text
  edit (`Calendar.tsx:156-160`).
- Non-LM, non-post queue rows ("post-queue") open `ScheduledPostEditor`
  (`Calendar.tsx:161-163,189-191`), whose own mutation path
  (`hooks/useContentPipeline.ts:79-98`, `dashboardAction()` RPC / `delete_scheduled_post` RPC) was not
  further traced — noted for completeness in §6.

### Client board (`ClientBoardPage.tsx`) — token/session-gated RPC mutations only
Single dispatcher `act()` (`ClientBoardPage.tsx:7034-7057`) posts one of
`'approve' | 'edit_copy' | 'request_changes' | 'shift_request' | 'note'` to
`client_board_action` (query-token path) or `client_board_action_v2`
(magic-link session path) — **RPC bodies not in this repo** (UNKNOWN exact
table writes; the comment at `:7419` notes the buffer-remove path "never flips
carousel_drafts.status, so client drafts stay out of Ivan's scheduler").
Additional direct-purpose RPCs, all `v1`(`p_token`)/`v2`(`p_session`) paired:
`client_board_set_schedule[_v2]` (`:7347,7351` — writes `carousel_drafts.scheduled_at`
per inline comment `:3123,3175`), `client_board_set_media[_v2]` (`:7321,7325`
— sets `carousel_drafts.image_urls` + board queue media_url per comment `:7313`),
`client_board_edit_draft[_v2]` (`:7270,7274`), `client_board_edit_lm_promo[_v2]`
(`:7295,7299`), `client_board_hide_draft[_v2]` (`:7373,7377`).
None of these were observed to fire an n8n webhook directly from this file —
publishing for client content is presumably the same `scheduled_posts`
queue + LinkedIn publisher n8n workflow, reached only once the RPC (server-side,
not in this repo) flips the underlying `carousel_drafts.status`/`scheduled_at`.
**Known trap not directly re-verifiable in this repo's code** (per memory,
confirmed elsewhere): "approved=publishes" in some other lane, and "regen wipes
image_urls" on the Rise Monday regen — neither the publish-on-approve nor the
image wipe is visible as a client-side write in `ClientBoardPage.tsx` or
`studioActions.ts`; both would be inside the un-tracked RPC bodies.

## 5. Calendar — what feeds it

`components/dashboard-v2/sections/Calendar.tsx` + `calendarItems.ts` merge THREE sources into one chip list (`calendarItems.ts:54-65`, precedence post > lm > post-queue):
1. **`post`** ← `carousel_drafts` (`useContentLibrary`) rows that HAVE a `scheduledAt` (`calendarItems.ts:71-82`); tone = raw `status` string cast directly to `CalendarTone` (`:78`).
2. **`lm`** ← `scheduled_posts` (`useContentPipeline`) rows whose `clickup_task_id` matches a real `lm_drafts_v2.id` (`lmDraftIds` passed in from `useLeadMagnets`, `Calendar.tsx:41,60`); tone mapped via `SP_STATUS_TO_TONE` (`calendarItems.ts:25-32`: `pending/queued_v2→scheduled`, `posting→generating`, `posted→published`, `failed→failed`, `cancelled→cancelled`).
3. **`post-queue`** ← every other LinkedIn `scheduled_posts` row not already shown as a `post` chip (`calendarItems.ts:84-115`).
Non-LinkedIn `scheduled_posts` rows are filtered out entirely (`isLinkedIn()`, `calendarItems.ts:34-36,85`).
Drag-to-reschedule dispatches to `reschedulePost` or `rescheduleQueueRow` depending on `item.kind` (`Calendar.tsx:149-151`), see §4.
Rendering itself is `components/dashboard/PostCalendarView.tsx` (imported `Calendar.tsx:7`) — not read in this pass (out of the requested file list; flagged as a further read if needed).

## 6. Exhaustive tables / RPCs / edge functions touched (for the access-probe phase)

**Tables (direct `.from()` reads/writes from the dashboard code read in this pass):**
- `carousel_drafts` — `hooks/useContentLibrary.ts`, `lib/studioActions.ts`, `components/dashboard-v2/sections/Calendar.tsx`, `components/dashboard-v2/review/PostWorkSurface.tsx`
- `lm_drafts_v2` — `hooks/useLeadMagnets.ts`, `lib/studioActions.ts`, `components/dashboard-v2/review/LmWorkSurface.tsx`
- `scheduled_posts` — `hooks/useContentPipeline.ts`, `components/dashboard-v2/sections/Calendar.tsx`, `hooks/useLeadMagnets.ts` (read-only, `lastPostedAt` lookup)
- `image_edit_versions` — `lib/studioActions.ts:489`
- `client-photos` (storage bucket, not a DB table) — `components/ClientBoardPage.tsx` (multiple lines)
- `post-stills` (storage bucket) — `lib/studioActions.ts` (`listPostStills`, `uploadPostImage`)
- `client_boards` — referenced only in a type comment (`ClientBoardPage.tsx:27`); never selected directly from JS
- `client_ideas` — referenced only as an `AgentLogFeed` table prop (`ClientOps.tsx:509`); no direct `.from()` call found

**RPCs called from this code:**
- `dashboard_action` (generic dispatcher; `lib/dashboardActions.ts:11-19`, also used with `op:` payloads for newsletter/topic-queue actions)
- `delete_scheduled_post` (`hooks/useContentPipeline.ts:91`)
- `operator_set_lm_active_cover` (`lib/studioActions.ts:523`)
- `newsletter_issue_upsert` / `_approve` / `_schedule` / `_cancel` / `_send_now` / `_delete` (`lib/dashboardActions.ts:58-95`)
- `get_client_board`, `get_client_board_by_session` (`ClientBoardPage.tsx:7667,7716,7647,7718,7742`)
- `redeem_board_login` (`:7676,6667`)
- `client_board_action`, `client_board_action_v2` (`:7044,7052`)
- `client_board_hide_draft[_v2]`, `client_board_set_schedule[_v2]`, `client_board_set_media[_v2]`, `client_board_edit_lm_promo[_v2]`, `client_board_edit_draft[_v2]`, `client_board_draft_history[_v2]`, `client_board_replacement_pool[_v2]`, `client_board_slot_state[_v2]`, `client_board_outreach_status[_v2]`, `client_board_outreach_log[_v2]`, `client_board_outreach_usage[_v2]`, `client_board_schedule[_v2]` (all `ClientBoardPage.tsx:7095-7451`)
- `client_board_public_brand` (`:6625`)
- `get_board_team`, `invite_board_member` (`:6766,6785`)
- `operator_client_outreach`, `operator_client_pending_drafts`, `operator_approve_rise_draft`, `operator_edit_rise_draft`, `operator_clients_overview`, `operator_client_drafts`, `operator_client_actions`, `operator_client_ideas`, `operator_client_lms`, `operator_set_board_visible`, `operator_schedule_draft`, `operator_approve_idea`, `operator_edit_draft_body`, `operator_set_lm_cover`, `operator_mark_actions_seen` (all `components/dashboard-v2/sections/clientops2/shared.tsx:310-547`, gated by `p_gate:'clientops'` constant `GATE`, line 21)

**Edge functions (`/functions/v1/...`, called via `fetch`, not `supabase.rpc`):**
- `lm-curator-feed`, `lm-curator-decide`, `idea-angle-summary` (`lib/ideaProjection.ts:14-16`)
- `lm-schedule` (`lib/studioActions.ts:389`)

**n8n webhooks fired from the dashboard (external automation, not Supabase):**
- `post-gen-v2` (`lib/studioActions.ts:15,454` — carousel + text/single-image generation)
- `publish-now` (`lib/studioActions.ts:278` — immediate LinkedIn publish)
- `video-gen-v2` (`lib/studioActions.ts:295` — animated video render)
- `lm-gen-v2` (`lib/studioActions.ts:341,400` — LM content/assets/repost phases)
- `lm-regen-cover-v2` (`lib/studioActions.ts:421`)
- `send-newsletter-test` (`lib/dashboardActions.ts:97`)
- Bridge workflow **`yzXqLDIpuNzuhUQq`** (named in comment only, not called directly by this repo — it's the n8n cron that reads `carousel_drafts.status='scheduled'` and inserts `scheduled_posts`; `Calendar.tsx:76-78,88`)
- Scheduled Post Publisher **`0Ym6bP7gEmskPJZn`** (named in comment only; `lib/studioActions.ts:270-271`)

## 7. Auth / key used for these reads/writes

- Single Supabase client, anon key only: `lib/supabase.ts:3-6`
  (`createClient(supabaseUrl, supabaseAnonKey)`, `VITE_SUPABASE_ANON_KEY`).
- **Ivan's own dashboard** (`PostWorkSurface`, `LmWorkSurface`, `Calendar`,
  `ClientOps`) sits behind Supabase **Auth** (magic-link/OTP): session check
  `components/dashboard/Dashboard.tsx:160`, sign-in flow
  `components/dashboard/DashboardAuth.tsx:33-72` (`signInWithOtp`/`verifyOtp`).
  Once signed in, table reads/writes from these surfaces run as Postgres role
  `authenticated`, gated by RLS (not the anon role) — confirmed indirectly by
  the comment in `lib/studioActions.ts:149-152` about the 2026-07-19 RLS
  lockdown removing the authenticated role's SELECT on `storage.objects` for
  the `post-stills` bucket, forcing a public-REST/anon-key workaround for
  listing.
- **Ivan's internal Client Ops surface** (`ClientOps.tsx` /
  `clientops2/shared.tsx`) additionally passes an app-level gate string
  `p_gate: 'clientops'` (`shared.tsx:21`, `GATE`) into every `operator_*` RPC —
  this is a **secondary, non-Supabase-Auth gate** checked inside the RPC body
  itself (RPC source not in this repo), layered on top of the signed-in
  session.
- **Client-facing board** (`ClientBoardPage.tsx`) uses NO Supabase Auth at all
  — the anon-key client calls RPCs carrying either a `?k=` query token
  (`p_token`) or a magic-link session token (`p_session`), and the RPC itself
  (server-side, not in this repo) is responsible for validating the
  token/session and scoping to that one client's `slug` before returning or
  mutating anything (`ClientBoardPage.tsx:7034-7057` comment: "Real,
  token-gated board action. Same anon-key RPC posture as get_client_board...
  The session token only travels in the RPC body — never a query param, log,
  or title.").

---

## Summary (10 lines)

1. One tenancy column, not separate tables: `carousel_drafts.client_id` / `lm_drafts_v2.client_id` — null = Ivan, set = client (Rise); Ivan's surfaces read with `.is('client_id', null)` (`hooks/useContentLibrary.ts:114`).
2. Status vocab differs per table: posts/LMs use `idea→generating→review→approved/disqualified→scheduled→published`(+`error`); the publish queue `scheduled_posts` uses `pending/queued_v2→posting→posted/failed/cancelled`.
3. The client board layers a SEPARATE derived vocabulary, `Stage = planned|drafted|review|scheduled|published` (`ClientBoardPage.tsx:71`), computed server-side inside `get_client_board`, not recomputed from raw `status` in this repo.
4. Verified trap: the client board's "needs review this week" ledger hard-filters `stage === 'review'` (`ClientBoardPage.tsx:2498,2503,2510,2590,8141`) — anything that has moved past review stage (e.g. scheduled) drops out of that view by design, matching the memory trap.
5. "Needs Ivan's attention" = `status='review'`/`'error'` on non-client rows, plus stuck-scheduled (past due, no LinkedIn URN) — all computed client-side in `PostWorkSurface.tsx`/`LmWorkSurface.tsx`.
6. Ivan's own "approve" on a post (`setStatus→'approved'`) does NOT itself publish; only `status='scheduled'`+`scheduled_at` (via the n8n Bridge `yzXqLDIpuNzuhUQq`) or the explicit `publish-now` webhook actually ship to LinkedIn.
7. LM "approve" in this surface (`status='approved'` direct write, `LmWorkSurface.tsx:174-180`) also does not itself publish — could not confirm the memory-trap "approved=publishes" for this specific lane; likely true elsewhere (client board RPCs, not in this repo).
8. Regen (`regenerateDraft`) only patches `status`+`taxonomy` client-side — no client-side evidence of image_urls being wiped; that must happen server-side in the n8n `post-gen-v2` workflow (UNKNOWN here, flagged not confirmed-false).
9. Calendar merges 3 sources (`carousel_drafts` scheduled posts, `scheduled_posts` LM rows, `scheduled_posts` other rows) with precedence post > lm > post-queue (`calendarItems.ts:54-65`).
10. Auth is three-tiered: Ivan's dashboard = Supabase Auth (OTP) + RLS; Client Ops adds an app-level `p_gate:'clientops'` string inside RPCs; the public client board uses the anon key only, gated entirely by a `?k=` token or magic-link session validated inside un-tracked RPC bodies.

## Exhaustive tables / RPCs / edge functions (for the access probe)

**Tables**: `carousel_drafts`, `lm_drafts_v2`, `scheduled_posts`, `image_edit_versions`, `client_boards` (RPC-only access), `client_ideas` (RPC-only access), storage buckets `client-photos`, `post-stills`.

**RPCs**: `dashboard_action`, `delete_scheduled_post`, `operator_set_lm_active_cover`, `newsletter_issue_upsert`, `newsletter_issue_approve`, `newsletter_issue_schedule`, `newsletter_issue_cancel`, `newsletter_issue_send_now`, `newsletter_issue_delete`, `get_client_board`, `get_client_board_by_session`, `redeem_board_login`, `client_board_action`, `client_board_action_v2`, `client_board_hide_draft`, `client_board_hide_draft_v2`, `client_board_set_schedule`, `client_board_set_schedule_v2`, `client_board_set_media`, `client_board_set_media_v2`, `client_board_edit_lm_promo`, `client_board_edit_lm_promo_v2`, `client_board_edit_draft`, `client_board_edit_draft_v2`, `client_board_draft_history`, `client_board_draft_history_v2`, `client_board_replacement_pool`, `client_board_replacement_pool_v2`, `client_board_slot_state`, `client_board_slot_state_v2`, `client_board_outreach_status`, `client_board_outreach_status_v2`, `client_board_outreach_log`, `client_board_outreach_log_v2`, `client_board_outreach_usage`, `client_board_outreach_usage_v2`, `client_board_schedule`, `client_board_schedule_v2`, `client_board_public_brand`, `get_board_team`, `invite_board_member`, `operator_client_outreach`, `operator_client_pending_drafts`, `operator_approve_rise_draft`, `operator_edit_rise_draft`, `operator_clients_overview`, `operator_client_drafts`, `operator_client_actions`, `operator_client_ideas`, `operator_client_lms`, `operator_set_board_visible`, `operator_schedule_draft`, `operator_approve_idea`, `operator_edit_draft_body`, `operator_set_lm_cover`, `operator_mark_actions_seen`.

**Edge functions**: `lm-curator-feed`, `lm-curator-decide`, `idea-angle-summary`, `lm-schedule`.

**n8n webhooks**: `post-gen-v2`, `publish-now`, `video-gen-v2`, `lm-gen-v2`, `lm-regen-cover-v2`, `send-newsletter-test`; workflows referenced by id only (not called from this repo): Bridge `yzXqLDIpuNzuhUQq`, Scheduled Post Publisher `0Ym6bP7gEmskPJZn`.
