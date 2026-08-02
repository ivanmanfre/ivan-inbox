# Phase 0 — real row counts per rendered lane

Supabase project `bjbvqvzbzczjbatgmccb`. URL + ANON_KEY found at `.env.local:1-2`
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`), wired into the app via
`src/lib/supabase.ts:1-5` (`createClient(import.meta.env.VITE_SUPABASE_URL,
import.meta.env.VITE_SUPABASE_ANON_KEY)`).

## Trap found before any counting could happen

The anon key **alone** (unauthenticated request) returns HTTP 200 with **zero
rows** on every RLS-protected table in this project (`content-range: */0`) —
not a 401/403, a *silent empty result*. Every list in this app requires the
real signed-in session (`src/screens/LoginScreen.tsx` — Supabase OTP email
login, single user `im@ivanmanfredi.com`), because RLS policies here gate on
`auth.uid()`, not just possession of the anon key. So "what the app itself
sees" is anon-key-as-bearer **plus** an authenticated JWT, not anon alone.

The repo already has first-party tooling for exactly this (`scripts/dev-login.mjs`,
gitignored, mints a real session for the sole app user via the Supabase
Management API + `auth/v1/admin/generate_link`, output written to the
gitignored `.session.json`). That token had expired from a previous run;
re-ran the script to mint a fresh one and used it as the `Authorization:
Bearer` value alongside the anon key as `apikey` — i.e. exactly the token the
browser holds in `localStorage` after Ivan logs in. No service_role key was
fetched or used directly by this scout (the script fetches it internally,
transiently, only to mint the magic-link — never printed or persisted here).

**Curl recipe used** (ANON_KEY = value at `.env.local:2`, SESSION_TOKEN = fresh
`access_token` from `.session.json` after running `node scripts/dev-login.mjs`):

```bash
curl -s "$URL/rest/v1/$TABLE?select=id&$FILTERS&limit=1" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -H "Prefer: count=exact" \
  -H "Range: 0-0" \
  -D - -o /dev/null | grep -i content-range
```

The number after the `/` in `content-range: 0-0/N` is the real exact count.
`content-range: */0` with HTTP 200 means the filter matched zero rows (not an
error). A table that 401/403s isn't present below — none did once
authenticated; all reads below are real RLS-permitted reads.

---

## Table-by-table counts

| table/view | queried from (file:line) | app filter | real count | notes |
|---|---|---|---|---|
| `carousel_drafts` | `src/lib/content.ts:186` (`fetchContentDrafts`), `:316` (`fetchLaneProbe`), `:342/356` (writes), `:513` (detail), `src/exp/v2c/useContentBadge.ts:21` | none (raw total) | **285** | Two-tenant table, split by nullable `client_id` (never a literal `'ivan'`). |
| `carousel_drafts` | `content.ts:87-89` `laneFilter('ivan')` → `.is('client_id', null)` | `client_id IS NULL` (Ivan lane) | **201** | |
| `carousel_drafts` | `content.ts:87-89` `laneFilter('risedtc')` → `.eq('client_id','risedtc')` | `client_id = 'risedtc'` (Mattan lane) | **84** | |
| `carousel_drafts` | `content.ts:104` `ACTIVE_STATUSES`, rendered via `bucketDrafts`/`groupByStage` | `status = 'review'` | **88** | Biggest single triage bucket. |
| `carousel_drafts` | same | `status = 'error'` | **6** | |
| `carousel_drafts` | same | `status = 'generating'` | **0** | |
| `carousel_drafts` | same | `status = 'approved'` | **0** | Bucket splits this further into scheduled-with-date vs `approvedUnscheduled`; currently moot, both 0. |
| `carousel_drafts` | same | `status = 'scheduled'` | **2** | Further split client-side into `stuckScheduled` vs `scheduled` by `isStuckScheduled()` (content.ts:164). |
| `carousel_drafts` | same | `status = 'published'` | **118** | Largest bucket overall — this is the one styles.ts:180-203 pulls preview images from. |
| `carousel_drafts` | same | `status = 'disqualified'` | **71** | Rolls into `archived` bucket together with `skipped`. |
| `carousel_drafts` | same | `status = 'skipped'` | **0** | |
| `carousel_drafts` | same | `status = 'draft'` | **0** | Vocabulary value the dashboard writes; none live right now. |
| `carousel_drafts` | same | `status = 'idea'` | **0** | Same. |
| `carousel_drafts` | `content.ts:104` `ACTIVE_STATUSES.join(',')`, i.e. `status IN (review,error,generating,approved,scheduled)` | recent-or-active queue filter (`fetchContentDrafts`, both lanes combined) | **96** | This is the actual "queue" query the screen runs (`updated_at >= 60d ago OR status IN (...)`) — 96 is a superset upper bound; true count needs the `updated_at` OR too (see caveat below). |
| `carousel_drafts` | `src/exp/v2c/useContentBadge.ts:22-24` | `client_id IS NULL AND status='review'` (head-count badge, Ivan lane only) | **18** | This is the literal number that renders as the nav badge today. |
| `lm_idea_candidates` | `content.ts:291` `fetchIdeaCandidates` | none (raw total) | **1716** | No tenancy column — Ivan's by construction (content.ts:242-245). |
| `lm_idea_candidates` | `content.ts:293` `.eq('status', IDEA_STATUS)` | `status = 'reviewing'` | **59** | This is what the Ideas lane actually renders (limit 500, so 59 fits in one page — no truncation risk yet). |
| `ops_drafts` | `src/lib/ops.ts:114` `fetchOpsDrafts` (limit 300) | none (raw total) | **18** | Small table; limit(300) never truncates today. |
| `ops_drafts` | `ops.ts:83-86` `pendingOps` | `approved_at IS NULL AND sent_at IS NULL AND send_blocked_reason IS NULL` | **4** | SQL approximation — real `pendingOps` also excludes stale comment cards (`isStaleComment`, needs `context->>posted_at`, not expressible as a plain column filter); true rendered count is ≤ 4. |
| `ops_drafts` | `ops.ts:91-95` `claimingOps` | `approved_at NOT NULL AND sent_at IS NULL AND send_blocked_reason IS NULL` | **0** | |
| `ops_drafts` | `ops.ts:98-103` `sentOps` (capped at 10 in UI) | `sent_at NOT NULL` | **4** | Under the UI cap of 10, so all 4 render. |
| `ops_drafts` | `ops.ts:107-111` `blockedOps` | `send_blocked_reason NOT NULL AND != 'discarded_by_operator'` | **3** | |
| `ops_drafts` | `ops.ts:3` `OpsKind` breakdown | `kind='comment_reply'` / `escalation'` / `'update'` / `'newsjack'` / `'weekly_report'` | **8 / 1 / 1 / 2 / 2** | Sums to 14 of 18 (4 rows carry a kind outside these five or overlap — not re-verified further). |
| `scheduled_posts` | `content.ts:223` `fetchScheduledQueue` (limit 500) | `status IN (pending,queued_v2,posting,posted,failed,cancelled)` | **152** | No `client_id` column at all — Ivan's by construction (content.ts:221). Well under the 500 cap. |
| `scheduled_posts` | same, per-status | `pending` / `queued_v2` / `posting` / `posted` / `failed` / `cancelled` | **2 / 0 / 0 / 135 / 0 / 15** | `posted` dominates — this is a historical log more than a live queue. |
| `scheduled_posts` | `content.ts:236-238` `queueFailed()` | `error_message IS NOT NULL AND trim() != ''` | **11** | The one place a publish failure is recorded (comment at content.ts:232-234 said "9 rows live" as of an earlier date — now 11). |
| `scans` | `src/lib/context.ts:54/61` `fetchScan` | none (raw total) | **144** | |
| `scans` | same | `status = 'complete'` | **144** | Every scan row is already `complete` — the `status='complete'` filter in the query is currently a no-op. |
| `outreach_prospects` | `src/lib/context.ts:42` `fetchProspectContext` (single-row lookup by id, not a list) | none (raw total) | **6829** | Largest table in the app by far. Not rendered as a list anywhere itself — it's the join target for `inbox_messages_v` prospect fields and the per-prospect context sheet. |
| `outreach_prospects` | referenced by `inbox.ts:73/108-110` (`stage === 'archived'` / `'connection_sent'`) | `stage = 'connection_sent'` | **222** | These are the "invite sent, nobody accepted yet" rows `isConversation()` (inbox.ts:108-111) hides from the Inbox thread list unless a reply/draft exists — i.e. up to 222 threads are deliberately suppressed from the main Inbox view and live only in Sends → Log. |
| `outreach_campaigns` | `src/lib/sends.ts:222` `fetchCampaignSendsLegacy` | none (raw total) | **30** | |
| `outreach_campaigns` | same | `is_active = true` | **13** | This is the count of live/active campaign rows the Overview → Campaigns block would enumerate. |
| `lm_drafts_v2` | `src/lib/styles.ts:238` `fetchResources` (limit 200) | none (raw total) | **127** | READ ONLY surface, resources/LM pages. |
| `lm_drafts_v2` | `styles.ts:240` `laneFilter('ivan')` | `client_id IS NULL` | **121** | |
| `lm_drafts_v2` | `styles.ts:240` `laneFilter('risedtc')` | `client_id = 'risedtc'` | **5** | Comment at styles.ts:230-234 said "Mattan's 5 rows" — still 5, matches. |
| `content_prompts` | `src/lib/styles.ts:40` `fetchStyleRoster` | none (raw total) | **129** | |
| `content_prompts` | same | `is_active = true` | **124** | |
| `content_prompts` | `styles.ts:46-47` `.or('slug.like.style-*,slug.like.image-style-*').eq('is_active', true)` — structure family | `is_active=true AND slug LIKE 'style-%'` | **11** | Matches the file comment "11 + 6 rows are active as of 2026-07-31" (styles.ts:10) — still 11. |
| `content_prompts` | same — image family | `is_active=true AND slug LIKE 'image-style-%'` | **6** | Also still matches the 6 from the comment. |
| `integration_config` | `src/lib/seatHealth.ts:19` `fetchSeatHealth` (single key lookup, `.maybeSingle()`) | none (raw total) | **175** | Only ONE row (`key='seat_health_summary'`) is ever actually read — 175 is the full table's unrelated key/value rows, not what renders. |
| `push_subscriptions` | `src/lib/push.ts:33/49` (writes only — upsert/delete, never listed/rendered) | none (raw total) | **3** | Never queried as a list by the app; included for completeness only. |
| `n8nclaw_chat_messages` | `src/lib/agent.ts:56/66` `fetchChat`/`fetchChatBefore` (paged 50 at a time) | none (raw total) | **1078** | Largest "chat history" surface; paginated, so no single-request truncation risk, but this is the real scroll depth if a user paged to the bottom. |
| `n8nclaw_proactive_alerts` | `agent.ts:102-113` `fetchAlerts` | none (raw total) | **20** | |
| `n8nclaw_proactive_alerts` | `agent.ts:110-113` head-count for `olderUnsent` | `sent IS NULL OR sent = false` | **20** | Every alert row is currently unsent — `sent=true` explicit filter returned 0. |
| `n8nclaw_reminders` | `agent.ts:124` `fetchReminders` | none (raw total) | **35** | |
| `n8nclaw_reminders` | `agent.ts:126` `.eq('status','pending')` | `status = 'pending'` | **11** | This is what actually renders in the Reminders list. |
| `n8nclaw_daily_summaries` | `agent.ts:133` `fetchDailySummaries` (limit 7 in the fn, but table itself is bigger) | none (raw total) | **63** | App only ever pages the most recent 7; 63 is the true underlying depth if that cap were lifted. |
| `inbox_messages_v` | `src/lib/inbox.ts:141` `fetchMessages` (paged 1000/request, no server cap), also `today.ts:456/504`, `sends.ts:120/123/146/223` | none (raw total) | **2154** | The single largest, most load-bearing view in the app — every Inbox thread, Sends log/lane, and reply-count read comes from this view. |
| `inbox_messages_v` | `inbox.ts` grouping (`direction`) | `direction = 'inbound'` | **158** | |
| `inbox_messages_v` | same | `direction = 'outbound'` | **1996** | |
| `inbox_messages_v` | `sends.ts:120-122` `fetchSendLog` "sent" query | `direction='outbound' AND sent_at NOT NULL` | **1752** | Fetched with `.limit(limit*3)` = 360 by default (only the newest 360 of 1752 are ever pulled) — real depth is 4.9x what a `limit=120` UI page requests. |
| `inbox_messages_v` | `sends.ts:123-125` `fetchSendLog` "failed" query | `direction='outbound' AND send_blocked_at NOT NULL` | **246** | Fetched with a hardcoded `.limit(60)` — only the newest 60 of 246 (24%) are ever visible via this path. |
| `inbox_messages_v` | `inbox.ts:31-33` `isDraft()`, rendered as the pending-draft badge | `direction='outbound' AND sent_at IS NULL AND approved_at IS NULL AND send_blocked_at IS NULL` | **0** | No live undispatched drafts at probe time — a real empty state, not a query bug. |
| `inbox_messages_v` | `today.ts:199` `rowClient` coalescing, `Filter` type (inbox.ts:29) | `client_id = 'ivan'` | **1895** | View pre-coalesces NULL→'ivan' (unlike `carousel_drafts`/`lm_drafts_v2` which store raw NULL). |
| `inbox_messages_v` | same | `client_id = 'risedtc'` | **259** | |
| `inbox_messages_v` | `inbox.ts:29` `Filter` type, `'email'` value; `inbox.ts:131` | `channel = 'email'` | **116** | |
| `inbox_messages_v` | `inbox.ts:87` unread count per thread | `direction='inbound' AND read_at IS NULL` | **76** | |
| `outreach_messages` (raw table) | `inbox.ts:173/180/187/202` (writes: approve/discard/insert/mark-read only, never listed directly) | none (raw total) | **2179** | 25 rows more than the `inbox_messages_v` total (2154) — the view likely drops orphan rows (e.g. a join to a deleted prospect); worth a closer look before treating the view as "everything". |
| `inbox_sends_v` | `src/lib/sends.ts:47` `fetchSends` | none (raw total) | **10** | Pre-aggregated view (grouped by client_id × message_type) — small by design, not a per-message list. |
| `inbox_sends_daily_v` | `sends.ts:53` `fetchSendsDaily` | none (raw total) | **78** | Grouped by client_id × message_type × day; feeds the 14-day sparkline. |
| `inbox_campaign_sends_v` | `sends.ts:187` `fetchCampaignSends` | none (raw total) | **30** | One row per campaign — matches `outreach_campaigns` total exactly (30), confirming the view is a straight per-campaign aggregate. |
| `inbox_accept_v2` | `src/lib/kpis.ts:43` (`selectAll`) | none (raw total) | **2** | One row per client (`ivan`, `risedtc`). |
| `inbox_pipeline_v` | `kpis.ts:44` | none (raw total) | **7** | Grouped by client × lane. |
| `inbox_scan_opens_v` | `kpis.ts:45` | none (raw total) | **2** | One row per client. |
| `inbox_outcomes_v` | `kpis.ts:46` | none (raw total) | **2** | One row per client. |
| `inbox_range_kpis` (RPC) | `kpis.ts:54` | n/a — RPC, not countable via REST count | — | Called with `p_from`/`p_to`, returns one row per client for the selected range. Not a table probe. |
| `inbox_governor` (RPC) | `kpis.ts:60` | n/a — RPC | — | Same; not a table probe. |
| `n8nclaw_dashboard_send` (RPC) | `agent.ts:160` | n/a — RPC (write, sends a WhatsApp message) | — | Not probed (write action, not a read). |
| `dashboard_action` (RPC) | `agent.ts:180` | n/a — RPC (generic SECURITY DEFINER field-setter) | — | Not probed (write action). |

## Caveats / things a redesign should know

1. **PostgREST's 1000-row cap is real and already fought in three places**
   (`inbox.ts:136-149` pages `inbox_messages_v` manually in blocks of 1000;
   `content.ts:179-181` and `content.ts:312-326` explicitly document count vs
   rows.length drift). None of the counts above were read off `data.length` —
   every number came from `Prefer: count=exact` per the goal-run's instruction.
2. **`carousel_drafts` "queue" density (96)** is an upper bound: the real
   query ORs `updated_at >= 60d ago` with `status IN ACTIVE_STATUSES`, and a
   plain `status IN (...)` filter (what curl can express in one shot) doesn't
   capture rows that are outside `ACTIVE_STATUSES` but were updated in the
   last 60 days. The true number is ≥ 96.
3. **Two lane-scoping conventions coexist**: `inbox_messages_v` pre-coalesces
   `client_id` NULL→`'ivan'` at the view layer, but `carousel_drafts` and
   `lm_drafts_v2` store raw NULL and every consumer coalesces at read time
   (`content.ts:75-90`, `styles.ts` `laneFilter`). A naive `.eq('client_id',
   'ivan')` against the latter two returns 0 rows, not the real count — this
   already bit the app once per its own comments.
4. **Sent/failed send-log queries are truncated by design, not by accident**:
   `fetchSendLog`'s "failed" query only ever pulls the newest 60 of 246 real
   blocked-send rows (`sends.ts:125`), and the "sent" query pulls the newest
   360 of 1752 (`sends.ts:122`, `limit * 3` with `limit=120` default). A
   redesign that assumes "the log shows everything" would be wrong by a wide
   margin on the failed side especially (76% invisible).
5. **`outreach_prospects` (6829 rows) and `outreach_messages` (2179 raw rows)**
   are the true scale of the underlying data even though neither renders as a
   flat list anywhere — `outreach_prospects` is a single-row lookup and
   `outreach_messages` is only ever read through the `inbox_messages_v`
   view/pagination. If a redesign ever adds a raw prospect browser, 6829 is
   the number to design density against, not the ~8-row demo assumption.
