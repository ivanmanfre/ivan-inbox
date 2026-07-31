# AgentOps Capability Map — personal-site dashboard

Repo: `/Users/ivanmanfredi/Desktop/personal-site` (read-only audit; no edits made)

Scope covered:
- `components/dashboard/AgentPanel.tsx` (v1 "n8nClaw" panel — chat + stats + alerts/reminders/summaries)
- `components/dashboard/AgentReadyPanel.tsx` ("Agent-Ready" $2k Blueprint pipeline panel — separate feature, unrelated data domain, but requested explicitly)
- `components/dashboard/AgentLogFeed.tsx` (generic agent-run-log timeline component, reused across content editors, not n8nClaw-specific)
- `components/dashboard-v2/sections/rebuilt/AgentRebuilt.tsx` (Black-Box-v4 visual rebuild of AgentPanel — same hook, same data, different chrome)
- `components/dashboard-v2/sections/rebuilt/agent/agent.css` (styles only, no data logic — confirmed, not read in full)
- `hooks/useAgentData.ts` (the n8nClaw data/actions hook shared by AgentPanel + AgentRebuilt)
- Supporting hooks pulled in by `AgentReadyPanel.tsx`: `hooks/useAgentReady.ts`, `hooks/useScansList.ts`, `hooks/useOutreachClicks.ts`, `hooks/useAutoRefresh.ts`, `hooks/useContentLibrary.ts` (for `AgentLogEntry` type only)
- `lib/supabase.ts` (client construction), `lib/dashboardActions.ts` (`dashboard_action` RPC wrapper + toast helpers), `lib/subscriptionManager.ts` (realtime dedup), `contexts/DashboardContext.tsx` (refresh rate / timezone)
- `migrations/client_autofix.sql` (only file in-repo that defines the body of `dashboard_action`)
- `supabase/migrations/20260719_rls_closure_waves.sql` (confirms `append_agent_log`, `get_recent_outreach_clicks`, `n8nclaw_dashboard_send` exist server-side as SECURITY DEFINER functions — bodies NOT in this repo, defined directly in Supabase)

**Important scope note:** "AgentOps" as a single surface is really TWO unrelated features sharing this file set:
1. **n8nClaw** — the WhatsApp-mirrored personal AI assistant chat (AgentPanel / AgentRebuilt / useAgentData).
2. **Agent-Ready Blueprint pipeline** — the $2,000 paid audit/Blueprint sales funnel (AgentReadyPanel + its 3 sub-hooks). No shared table, RPC, or hook between the two beyond generic dashboard plumbing (`dashboardAction`, `useAutoRefresh`, `supabase` client).
`AgentLogFeed` is a third, fully generic component (agent QA/generation run-log timeline) used elsewhere in the content pipeline (carousel/LM drafts) — it has no n8nClaw or Blueprint-specific wiring; included here only because it was named in scope.

---

## Supabase client construction

`lib/supabase.ts:1-6`
```ts
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://bjbvqvzbzczjbatgmccb.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```
- Single client instance, imported everywhere (`AgentReadyPanel.tsx:4`, `AgentLogFeed.tsx:9`, `useAgentData.ts:2`, `useAgentReady.ts:2`, `useScansList.ts:2`, `useOutreachClicks.ts:2`, `lib/dashboardActions.ts:2`).
- **Key used: browser-exposed ANON key only** (`VITE_SUPABASE_ANON_KEY`, built into the client bundle). No service-role key, no edit token, anywhere in this surface.
- All privileged/allowlisted writes go through **`SECURITY DEFINER` RPCs** (`dashboard_action`, `append_agent_log`, `n8nclaw_dashboard_send`) rather than direct table writes — except `paid_assessments` (direct `.update()`, see row 9 below) and `blueprints` (direct `.select()`, read-only).
- No `.env` file was read (not needed — this only documents which var name is used); actual anon key value is not this task's concern.

---

## Capability table

| # | Capability | Read/Mutate | Data source (file:line) | Auth used | Notes/gotchas |
|---|---|---|---|---|---|
| 1 | Total/today/this-week message stat cards | Read | `n8nclaw_chat_messages` — 3x `count:'exact', head:true` queries, `hooks/useAgentData.ts:50-54` | anon key | Today boundary computed client-side per `userTimezone` (`useAgentData.ts:29-42`); 3 separate count queries, not 1. |
| 2 | Alerts stat card + Alerts detail list + type-breakdown badge | Read | `n8nclaw_proactive_alerts` — `select('id, alert_type, title, body, sent, sent_at, created_at')`, limit 50, `hooks/useAgentData.ts:46-47` | anon key | `alertsByType` computed client-side (`useAgentData.ts:194-200`); list capped to first 20 for render (`AgentPanel.tsx:397`, `AgentRebuilt.tsx:367`). |
| 3 | "Ack" button on an alert | Mutate | RPC `dashboard_action(p_table='n8nclaw_proactive_alerts', p_field='sent', p_value='true')` via `lib/dashboardActions.ts:11-19`, called from `hooks/useAgentData.ts:202-211`; UI in `AgentPanel.tsx:414-421`, `AgentRebuilt.tsx:377-379` | anon key → SECURITY DEFINER RPC | Allowlist enforced server-side in `migrations/client_autofix.sql:24` (`n8nclaw_proactive_alerts` + field `sent` only). Optimistic local update, rolled back on RPC error (`useAgentData.ts:203-210`). |
| 4 | Reminders stat card + Reminders detail list | Read | `n8nclaw_reminders` — `select('id, reminder_text, remind_at, status, recurrence, created_at').eq('status','pending')`, `hooks/useAgentData.ts:48-49` | anon key | Only pending reminders are ever fetched — "all reminders" is not a capability here. |
| 5 | "Mark complete" button on a reminder | Mutate | RPC `dashboard_action(p_table='n8nclaw_reminders', p_field='status', p_value='completed')`, `lib/dashboardActions.ts:11-19` called from `hooks/useAgentData.ts:213-223`; UI `AgentPanel.tsx:446-453`, `AgentRebuilt.tsx:399-407` | anon key → SECURITY DEFINER RPC | Allowlist: `migrations/client_autofix.sql:25` (`n8nclaw_reminders` field `status` only); PK is **integer** (special-cased in the RPC body, `client_autofix.sql:53-55`, and cast in `dashboardAction` call site as `String(id)`→`p_id::integer`). |
| 6 | Summaries panel (daily digest cards, topics chips) | Read | `n8nclaw_daily_summaries` — `select('id, date, summary, topics, action_items, message_count, created_at').order('date',{ascending:false}).limit(7)`, `hooks/useAgentData.ts:55-56` | anon key | `action_items` fetched but **never rendered** in either AgentPanel or AgentRebuilt (dead field on the client side — confirmed by reading both render paths in full). |
| 7 | Chat feed (paginated, 50/page) | Read | `n8nclaw_chat_messages` — `select('id, role, content, created_at').order(...).limit(51)`, `hooks/useAgentData.ts:57-58`; "Load older messages" re-queries with `.lt('created_at', oldest)`, `useAgentData.ts:106-124` | anon key | Fetches `CHAT_PAGE_SIZE+1` (51) to detect `hasMore` (`useAgentData.ts:6, 81, 119`). |
| 8 | Send message to n8nClaw (chat input + Send button) | Mutate + **EXTERNAL** | Primary path: RPC `n8nclaw_dashboard_send(p_message)` (`hooks/useAgentData.ts:136-138`). Fallback on RPC error: direct `fetch()` POST to `https://n8n.ivanmanfredi.com/webhook/n8nclaw-whatsapp` (`useAgentData.ts:142-153`), spoofing a WhatsApp inbound-message payload (`remoteJid: '5491159385939@s.whatsapp.net'`) | anon key (RPC) **or no auth at all** (raw webhook POST, no header/secret) | 🔴 **EXTERNAL SIDE EFFECT**: this is a live send into the n8nClaw WhatsApp agent pipeline — a message typed in the dashboard is indistinguishable from a real WhatsApp message from Ivan's own number once it hits the webhook fallback. The webhook URL and hardcoded `remoteJid` are visible in client-side JS (`dist/assets/useAgentData-*.js`), unauthenticated. Body of `n8nclaw_dashboard_send` RPC not in this repo (defined directly in Supabase per `20260719_rls_closure_waves.sql:450`) — could not verify what auth/validation happens server-side. |
| 9 | Sending/typing indicator + 45s timeout + escalating poll (2s→2s→3s→3s→5s) while awaiting reply | Read (polling) | Re-invokes the same `fetch()` (`useAgentData.ts:167-180`) on an interval; detects new assistant row by `id` bump (`useAgentData.ts:90-97`) to clear `sending` state; hard 45s timeout also clears it (`useAgentData.ts:183-192`) | anon key | Not a distinct data source — same `n8nclaw_chat_messages` query as #7, just re-run on a schedule. |
| 10 | Header refresh button / `RefreshIndicator` | Read | Calls `refresh` = `hooks/useAgentData.ts`'s `fetch` via `useAutoRefresh`, `AgentPanel.tsx:213`, `AgentRebuilt.tsx:215-217` | anon key | Re-runs the full `Promise.all` batch (rows 1,2,4,6,7 all at once). |
| 11 | Auto-poll every `refreshRate` (default 60,000ms) | Read | `hooks/useAutoRefresh.ts:43-48`, rate sourced from `contexts/DashboardContext.tsx:52` (default `60000`, no UI control found to change it in this surface) | anon key | Paused globally while any component calls `pauseRefresh()` (`useAutoRefresh.ts:6-18`) — e.g. while editing a field elsewhere in the dashboard. |
| 12 | Realtime refresh trigger on new alert/chat row | Read (realtime→refetch, not a live diff) | `useAutoRefresh(refresh, { realtimeTables: ['n8nclaw_proactive_alerts', 'n8nclaw_chat_messages'] })`, `AgentPanel.tsx:108`, `AgentRebuilt.tsx:113` → `hooks/useAutoRefresh.ts:53-62` → `lib/subscriptionManager.ts:16-27` (channel name `dash-sub-<table>`, `postgres_changes` event `*`, dedup'd across all subscribers of that table) | anon key (Supabase Realtime under RLS) | On any INSERT/UPDATE/DELETE to either table, the callback just re-runs the *entire* `fetch()` — no incremental patch. |
| 13 | **[AgentLogFeed]** Agent run-log timeline (icon/verdict-colored nodes, expand/collapse) | Read | Renders `entries: AgentLogEntry[]` **passed in as a prop** — not fetched by this component. Type defined in `hooks/useContentLibrary.ts:4-10`. Caller-supplied, so actual table is whichever caller reads (carousel_drafts.agentLog / lm_drafts_v2 / client_ideas — not traced further, out of the AgentOps n8nClaw/Blueprint scope) | n/a (prop-driven) | Not part of the n8nClaw/AgentReady data domain at all — a shared UI component. |
| 14 | **[AgentLogFeed]** "Add a note" composer (⌘/Ctrl+Enter to post) | Mutate | RPC `append_agent_log(p_table, p_id, p_agent:'Ivan', p_body)`, `components/dashboard/AgentLogFeed.tsx:166-171` | anon key → SECURITY DEFINER RPC (confirmed exists per `20260719_rls_closure_waves.sql:450`; body not in repo) | Gated to `table ∈ {'carousel_drafts','lm_drafts_v2','client_ideas'}` by the TS prop type (`AgentLogFeed.tsx:120`) — client-side only; whether the RPC itself enforces the same allowlist is UNKNOWN (server body not readable from this repo). |
| 15 | **[Agent-Ready]** Blueprint pipeline stat cards (Total paid / Active / Awaiting intake / Converted / Revenue) | Read | `paid_assessments` joined to `assessment_intakes` (1:1 embed) — `select('stripe_session_id, email, name, amount_cents, ..., assessment_intakes(status, answers, submitted_at)')`, `hooks/useAgentReady.ts:53-61` | anon key | `pipeline_stage` is **derived client-side** by `computeStage()` (`useAgentReady.ts:36-44`) when the DB's own `pipeline_stage` column is still `'paid'` — i.e. stage shown can diverge from the literal DB value by design. |
| 16 | **[Agent-Ready]** Stage-distribution bar + Active/Awaiting/Converted/All filter | Read | Same `rows` as #15, filtered client-side, `AgentReadyPanel.tsx:85-104, 156-166` | anon key | Pure client-side derivation, no extra query. |
| 17 | **[Agent-Ready]** Advance-stage buttons (Day 2 scheduled / Day 2 done / Follow-up done / Converted) | Mutate | Direct table write: `supabase.from('paid_assessments').update(patch).eq('stripe_session_id', sessionId)`, `hooks/useAgentReady.ts:100-107`, invoked via `markStage()` `AgentReadyPanel.tsx:215-217, 266-277` | **anon key, DIRECT table UPDATE (no RPC, no allowlist)** | 🔴 Notably different auth pattern from rows 3/5: this bypasses `dashboard_action`'s allowlist entirely — relies purely on Postgres RLS policy on `paid_assessments` to gate which columns/rows an anon-keyed client may update. Whether RLS actually restricts this is UNKNOWN from this repo (no RLS policy SQL for `paid_assessments` found in the files read). |
| 18 | **[Agent-Ready]** Private notes textarea + Save | Mutate | Same direct `.update()` path as #17 (`patch = { notes }`), `AgentReadyPanel.tsx:219-226` | anon key, direct table UPDATE | Same RLS-only-gate caveat as #17. |
| 19 | **[Agent-Ready]** Blueprint pipeline block (Pre-Call Brief / Blueprint v2 status + Open links) | Read | `blueprints` — `select('id, status, kind, stage, updated_at, version').eq('stripe_session_id', sessionId)`, `AgentReadyPanel.tsx:352-357` (component-local `refresh()` inside `BlueprintDraftBlock`) | anon key | Fetched once per row on mount/sessionId change (`useEffect`, `AgentReadyPanel.tsx:360`) — not part of the `useAgentReady` batch, not on the auto-refresh/realtime timer. |
| 20 | **[Agent-Ready]** "Generate Pre-Call Brief" / "Regenerate" buttons | **Dead/disabled — no longer fires externally** | `AgentReadyPanel.tsx:362-382`. `generateV1()` sets a static error message and `return`s **before** reaching the `fetch()` call (line 366-367, `eslint-disable-next-line no-unreachable` on the dead code below) | n/a (unreachable) | 🔴 Explicitly retired 2026-07-10 per inline comment (`AgentReadyPanel.tsx:362-364`): "offer replaced by the $2k inbound engine; wf `zfSvH4mgXqWwkchu` deactivated + prompt row `is_active=false`." Dead POST target (if ever re-enabled) would be `https://n8n.ivanmanfredi.com/webhook/blueprint-generate` (line 372) — this would be an EXTERNAL call once un-guarded, flagged for awareness even though currently inert. |
| 21 | **[Agent-Ready]** "Open" link to blueprint editor | Read (navigation) | Client-side route `Link to={/dashboard/blueprints/${sessionId}}`, `AgentReadyPanel.tsx:403-408, 441-446` | n/a | Not a data call from this file; downstream editor page not read (out of scope). |
| 22 | **[Agent-Ready]** "Stripe session" link | Read (navigation) | Static URL `https://dashboard.stripe.com/payments/${stripe_session_id}`, `AgentReadyPanel.tsx:285-287` | n/a | External link, opens Stripe's own dashboard in a new tab — not an API call from this app. |
| 23 | **[Agent-Ready]** Outreach Link Opens section (stat cards + row list) | Read | RPC `get_recent_outreach_clicks(p_limit: 30)`, `hooks/useOutreachClicks.ts:25-27` | anon key → SECURITY DEFINER RPC (confirmed exists, `20260719_rls_closure_waves.sql:450`; body not in repo) | Realtime refresh on INSERT to `outreach_link_clicks` (see Realtime section below) triggers a full RPC re-call, not incremental. |
| 24 | **[Agent-Ready]** Free Audits section (stat cards + row list) + "Show test submissions" toggle | Read | `scans` table — `select(COLUMNS).order('created_at',{ascending:false}).limit(30)`, `hooks/useScansList.ts:41-53`; toggle adds `.neq('email', IVAN_EMAIL).not('email','ilike','%@ivanmanfredi.com')` filter when hiding test rows (`useScansList.ts:47-51`) | anon key, direct table SELECT | Ivan-email filtering is done via query predicate, not RLS — the underlying rows ARE readable via anon key regardless of the toggle; toggle only changes what's displayed. |
| 25 | **[Agent-Ready]** Scan row → "Open scan report" link | Read (navigation) | Static route `/scan/${company_slug}`, only enabled when `status === 'complete'`, `AgentReadyPanel.tsx:625, 659-668` | n/a | Opens the public `/scan/:slug` report page in a new tab — out of scope for this file set. |

---

## Realtime / polling summary

| Surface | Mechanism | Tables/channel | Interval |
|---|---|---|---|
| n8nClaw (AgentPanel/AgentRebuilt) | Polling | `useAutoRefresh` default rate | 60,000ms (`contexts/DashboardContext.tsx:52`), paused during any dashboard "editing" state |
| n8nClaw (AgentPanel/AgentRebuilt) | Polling (send-in-flight only) | Re-fetch on escalating backoff while `sending=true` | 2s, 2s, 3s, 3s, then 5s repeating, capped by 45s hard timeout (`hooks/useAgentData.ts:167-192`) |
| n8nClaw (AgentPanel/AgentRebuilt) | Realtime (Supabase `postgres_changes`, event `*`) | `n8nclaw_proactive_alerts`, `n8nclaw_chat_messages` via `lib/subscriptionManager.ts` channel `dash-sub-<table>` | Event-driven, triggers full refetch |
| Agent-Ready (Blueprint pipeline) | Polling | `useAutoRefresh` default rate | 60,000ms |
| Agent-Ready (Blueprint pipeline) | Realtime | `paid_assessments`, `assessment_intakes` via same `subscribeToTable` mechanism (`AgentReadyPanel.tsx:73`) | Event-driven, triggers full refetch |
| Agent-Ready → Outreach Opens | Realtime, dedicated channel (bypasses `subscriptionManager`) | `outreach_link_clicks`, channel `outreach-clicks-list`, `hooks/useOutreachClicks.ts:40-47` | INSERT-only, event-driven |
| Agent-Ready → Free Audits | Realtime, dedicated channel (bypasses `subscriptionManager`) | `scans`, channel `scans-list`, `hooks/useScansList.ts:67-87` | INSERT + UPDATE, event-driven, patches local state directly (only capability in this surface that does an incremental patch instead of a full refetch) |
| Agent-Ready → Blueprint block | None | `blueprints` fetched once per row on mount only (`AgentReadyPanel.tsx:360`) | n/a |

---

## Actions that fire something EXTERNAL

1. 🔴 **Chat send (row 8)** — `n8nclaw_dashboard_send` RPC, with an **unauthenticated raw-webhook fallback** to `https://n8n.ivanmanfredi.com/webhook/n8nclaw-whatsapp` that impersonates an inbound WhatsApp message from Ivan's own number (`5491159385939@s.whatsapp.net`). This is a live trigger into the n8nClaw agent chain exactly as if sent from WhatsApp. `hooks/useAgentData.ts:136-155`.
2. 🔴 **"Generate Pre-Call Brief" (row 20)** — currently **dead** (hard-coded early return, `AgentReadyPanel.tsx:362-367`), but the code path still targets `https://n8n.ivanmanfredi.com/webhook/blueprint-generate` and would fire an external n8n workflow if the guard were ever removed. Flagged so a later access-probe doesn't miss it just because it's presently inert.
3. Everything else in this surface (Ack alert, Complete reminder, Save notes, Advance stage) writes only to Supabase (via RPC or direct table update) — no external HTTP call, no message/publish side effect.

---

## Tables/RPCs/Functions (exhaustive)

**Tables (direct `.from()` reads/writes):**
- `n8nclaw_proactive_alerts`
- `n8nclaw_reminders`
- `n8nclaw_daily_summaries`
- `n8nclaw_chat_messages`
- `paid_assessments`
- `assessment_intakes` (read only, via embedded join on `paid_assessments`)
- `blueprints`
- `scans`
- (realtime-only, no direct select in this file set) `outreach_link_clicks` — read via RPC `get_recent_outreach_clicks`, but also subscribed to directly for realtime INSERT events

**RPCs (`supabase.rpc(...)`):**
- `n8nclaw_dashboard_send` — send chat message (body defined server-side, not in this repo)
- `dashboard_action` — generic allowlisted field-update RPC (body IS in this repo: `migrations/client_autofix.sql:17`); used here for `n8nclaw_proactive_alerts.sent` and `n8nclaw_reminders.status`
- `append_agent_log` — used by `AgentLogFeed.tsx` (body not in this repo)
- `get_recent_outreach_clicks` — used by `useOutreachClicks.ts` (body not in this repo)

**Edge functions / external webhooks (HTTP, non-Supabase-RPC):**
- `https://n8n.ivanmanfredi.com/webhook/n8nclaw-whatsapp` — chat-send fallback (no auth header found)
- `https://n8n.ivanmanfredi.com/webhook/blueprint-generate` — dead/guarded code path, not currently reachable

No `supabase/functions/*` edge function in this repo is called by any file in scope (checked directory listing: `stripe-webhook`, `clickup-pages`, `intake-voice-signed-url`, `scorecard-*`, `n8n-toggle`, `sync-linkedin-followers`, `client-photo-delete`, `blueprint-send-email`, `blueprint-publish`, `calendly-webhook`, `send-push-notification`, `img-segment`, `img-edit`, `idea-angle-summary`, `scan-open`, `intake-llm-webhook`, `board-magic-link`, `assessment-intake`, `assessment-intake-chat`, `img-board-commit`, `seed-idea-from-post`, `recording-auto-title` — none referenced from AgentPanel/AgentReadyPanel/AgentLogFeed/AgentRebuilt/useAgentData or their direct hook dependencies).
