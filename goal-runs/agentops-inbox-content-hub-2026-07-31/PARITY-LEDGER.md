# PARITY-LEDGER — agentops-inbox-content-hub-2026-07-31

Verifies 100% capability mapping from the Phase 1 dashboard audits
(phase1a-agentops-map.md, phase1b-content-map.md, phase1c-styles-map.md) against
the actual new code: `src/lib/{agent,content,styles}.ts`,
`src/hooks/{useAgent,useContent,useStyles}.ts`, and both tournament finalists
`src/exp/cand-a/` and `src/exp/cand-b/`. Decisions D1-D11 and the danger
register are from `AUDIT.md`.

Status values: **PORTED** (both finalists) / **PORTED-A-ONLY** / **PORTED-B-ONLY** /
**DEFERRED** (AUDIT.md reason) / **UNCHANGED-ELSEWHERE** (already lives in the
inbox via an existing house convention/screen).

---

## 1. AgentOps — phase1a's capability table (all 25 rows)

| # | Capability | Dashboard source | Inbox status | Where (file) / Reason if deferred |
|---|---|---|---|---|
| 1 | Total/today/this-week message stat cards | `useAgentData.ts:50-54`, 3x count queries | PORTED | `src/lib/agent.ts` `fetchChat`; `useAgent.ts`. Reduced form: neither finalist shows the 3 separate total/today/week counters — `AgentScreen.tsx`/`StudioScreen.tsx` show a last-message preview + reminders/summaries counts instead. Chat volume is visible, the specific stat-card chrome isn't reproduced 1:1 — flagged ambiguous. |
| 2 | Alerts stat card + detail list + type-breakdown badge | `useAgentData.ts:46-47,194-200` | PORTED | `src/lib/agent.ts` `fetchAlerts`; `cand-a/AgentScreen.tsx` (`AlertRow`), `cand-b/StudioScreen.tsx` (`AlertCard`). The list + ack is ported in both; the `alertsByType` breakdown badge is not recomputed anywhere in the new code (grep-confirmed absent) — flagged ambiguous. |
| 3 | "Ack" button on an alert | `useAgentData.ts:202-211`, `client_autofix.sql:24` allowlist | PORTED | `src/lib/agent.ts` `ackAlert`/`dashboardAction` (hard-coded table+field, D4); `cand-a/AgentScreen.tsx` `AlertRow` (confirm-gated); `cand-b/StudioScreen.tsx` `ackAlert()` (confirm-gated). |
| 4 | Reminders stat card + detail list | `useAgentData.ts:48-49` | PORTED | `src/lib/agent.ts` `fetchReminders`; `cand-a/AgentScreen.tsx` `ReminderRow`; `cand-b/RemindersScreen.tsx` + `StudioScreen.tsx` nav row. |
| 5 | "Mark complete" button on a reminder | `useAgentData.ts:213-223`, `client_autofix.sql:25` | PORTED | `src/lib/agent.ts` `ackReminder`; `cand-a/AgentScreen.tsx` `ReminderRow.onDone`; `cand-b/RemindersScreen.tsx` `RemRow.complete`. |
| 6 | Summaries panel (daily digest cards, topics chips) | `useAgentData.ts:55-56`; `action_items` fetched but never rendered by either dashboard component | PORTED | `src/lib/agent.ts` `fetchDailySummaries`; `cand-b/SummariesScreen.tsx` renders topics chips **and** `action_items` (a dashboard-dead field, now actually shown); `cand-a/AgentScreen.tsx` `SummarySection` renders date+summary text only, **no topic chips** — a completeness gap vs. cand-b, flagged ambiguous. |
| 7 | Chat feed (paginated, 50/page) | `useAgentData.ts:57-58,106-124`, fetches 51 to detect `hasMore` | PORTED | `src/lib/agent.ts` `fetchChat` (`CHAT_PAGE_SIZE=50`), `fetchChatBefore` (older-page cursor) both exist; `cand-a/AgentChatScreen.tsx` and `cand-b/ChatScreen.tsx` both render `agent.messages` only — **neither wires a "load older messages" control to `fetchChatBefore`** (grep-confirmed: function is unused in both `useAgent.ts` and both candidates). Base 50-message feed is ported; pagination beyond it is not — flagged ambiguous. |
| 8 | Send message (chat input + Send) | `useAgentData.ts:136-153` RPC + unauthenticated webhook fallback | PORTED | `src/lib/agent.ts` `sendChat` — RPC-only, throws on error (D3). The webhook fallback (`webhook/n8nclaw-whatsapp`, spoofed WhatsApp inbound) is explicitly **not ported** — DEFERRED, reason: ghost-WhatsApp-send danger (AUDIT.md danger register #1 / D3), neutralized by grep-gating the literal out of `src/`. |
| 9 | Sending/typing indicator + 45s timeout + escalating poll (2s→2s→3s→3s→5s) | `useAgentData.ts:167-192` | UNCHANGED-ELSEWHERE | No poll/timeout/typing-indicator code in `lib/agent.ts`, `useAgent.ts`, or either chat screen (grep-confirmed). Superseded by the inbox's pre-existing realtime-channel convention (`useInbox.ts`'s `outreach_messages` subscription is the same pattern) — a reply lands via the `useAgent.ts` realtime subscription (row 12), not a bespoke poll. |
| 10 | Header refresh button / `RefreshIndicator` | `AgentPanel.tsx:213`, `useAutoRefresh` | UNCHANGED-ELSEWHERE | No header refresh button in either candidate. `PullIndicator`/`usePullToRefresh` is the pre-existing house convention every inbox screen already uses (`useInbox`, `useOps`, `useToday`); `AgentScreen.tsx`/`StudioScreen.tsx` just reuse it rather than rebuilding a header button. |
| 11 | Auto-poll every `refreshRate` (default 60,000ms) | `useAutoRefresh.ts:43-48`, `DashboardContext.tsx:52` | UNCHANGED-ELSEWHERE | No `setInterval`/poll-rate code found in `useAgent.ts` (grep-confirmed). Superseded by the same realtime-subscription + `window.addEventListener('focus', refresh)` convention already used by every other inbox hook — no interval timer reintroduced. |
| 12 | Realtime refresh trigger on new alert/chat row | `AgentPanel.tsx:108`, `subscriptionManager.ts:16-27` | PORTED | `src/hooks/useAgent.ts:44-55` — one `supabase.channel()` per mount (`useId()`-namespaced per the 754d32d two-mount-collision fix), subscribed to `n8nclaw_chat_messages` + `n8nclaw_proactive_alerts`, full refetch on any change. Applied identically in both candidates via the shared hook. |
| 13 | **[AgentLogFeed]** Agent run-log timeline | `AgentLogFeed.tsx`, prop-driven, generic | DEFERRED | AUDIT.md: "AgentLogFeed — generic agent-run log component. Ships where useful, not a section of its own." Not built into either candidate's Content cards this run (grep-confirmed no `AgentLogFeed`/agent-log-timeline component in `src/exp`). |
| 14 | **[AgentLogFeed]** "Add a note" composer (`append_agent_log` RPC) | `AgentLogFeed.tsx:166-171` | DEFERRED | Same reasoning as #13 — `append_agent_log` is never called anywhere in `src/` (grep-confirmed). Out of this run's scope. |
| 15 | **[Agent-Ready]** Blueprint pipeline stat cards | `useAgentReady.ts:53-61` | DEFERRED | AUDIT.md / phase1a: "Agent-Ready — the retired $2k Blueprint sales pipeline... Offer retired 2026-07-10... DEFERRED, with reason, in the parity ledger." |
| 16 | **[Agent-Ready]** Stage-distribution bar + filter | `AgentReadyPanel.tsx:85-104,156-166` | DEFERRED | Agent-Ready pipeline retired. |
| 17 | **[Agent-Ready]** Advance-stage buttons | `useAgentReady.ts:100-107` | DEFERRED | Agent-Ready pipeline retired. |
| 18 | **[Agent-Ready]** Private notes textarea + Save | `AgentReadyPanel.tsx:219-226` | DEFERRED | Agent-Ready pipeline retired. |
| 19 | **[Agent-Ready]** Blueprint pipeline block | `AgentReadyPanel.tsx:352-357` | DEFERRED | Agent-Ready pipeline retired. |
| 20 | **[Agent-Ready]** "Generate Pre-Call Brief" / "Regenerate" | `AgentReadyPanel.tsx:362-382` (already dead/guarded upstream, retired 2026-07-10) | DEFERRED | Agent-Ready pipeline retired; was already dead code in the dashboard itself. |
| 21 | **[Agent-Ready]** "Open" link to blueprint editor | `AgentReadyPanel.tsx:403-408,441-446` | DEFERRED | Agent-Ready pipeline retired. |
| 22 | **[Agent-Ready]** "Stripe session" link | `AgentReadyPanel.tsx:285-287` | DEFERRED | Agent-Ready pipeline retired. |
| 23 | **[Agent-Ready]** Outreach Link Opens section | `hooks/useOutreachClicks.ts:25-27`, RPC `get_recent_outreach_clicks` | DEFERRED | ACCESS-MATRIX: "click feed — deferred (outreach domain, already served by Sends/KPI)." `src/lib/sends.ts` (`outreach_campaigns` join) is the inbox's existing outreach-visibility surface. |
| 24 | **[Agent-Ready]** Free Audits section (`scans`) + test-submission toggle | `hooks/useScansList.ts:41-53` | DEFERRED | Bundled under the retired Agent-Ready panel (phase1a row 24 is tagged `[Agent-Ready]`) — Agent-Ready pipeline retired. |
| 25 | **[Agent-Ready]** Scan row → "Open scan report" link | `AgentReadyPanel.tsx:625,659-668` | DEFERRED | Agent-Ready pipeline retired. |

---

## 2. Content — phase1b's capability set

| # | Capability | Dashboard source | Inbox status | Where (file) / Reason if deferred |
|---|---|---|---|---|
| 26 | Tenancy split: `carousel_drafts.client_id` NULL=Ivan / `'risedtc'`=Rise | `useContentLibrary.ts:70,114` | PORTED | `src/lib/content.ts` `laneFilter`/`draftLane` (D2 — no `'ivan'` literal, `.is(null)`); `cand-a/ContentQueue.tsx` lane chips; `cand-b/StudioScreen.tsx` lane chips. |
| 27 | Status vocabulary / "needs attention" triage (review, error, stuck-scheduled, generating, scheduled, published, disqualified, unknown) | `PostWorkSurface.tsx:100-120` | PORTED | `src/lib/content.ts` `bucketDrafts`/`isStuckScheduled` (D5); `cand-a/ContentQueue.tsx` Sections; `cand-b/QueueScreen.tsx` `ORDER`. |
| 28 | Client-review count shown to Ivan, non-actionable (Rise lane oversight) | `clientops2/shared.tsx:187-190` | PORTED | D7 — `cand-a/ContentQueue.tsx`/`cand-b/ContentCard.tsx` render the Rise lane fully but hide Approve/Skip (`lane === 'ivan'` gate) — a full read view instead of just a count, but the "visible, non-actionable" contract matches. |
| 29 | Idea-stage lane (`lm_idea_candidates` / `lm-curator-feed` + `lm-curator-decide`: approve/defer/reject) | `lib/ideaProjection.ts:125-229` | DEFERRED | Ideas-candidate promote/defer/kill pipeline is out of this run's scope — the inbox works directly off `carousel_drafts.status` rows only; no idea-candidate table/edge-function call anywhere in `src/`. |
| 30 | Approve review draft (`status='approved'`) | `lib/studioActions.ts:250-255` | PORTED | `src/lib/content.ts` `approveDraft` (D6: status write only, does not publish); `cand-a` `QueueCard`, `cand-b` `ContentCard`. |
| 31 | Reject review draft (`status='disqualified'`) | `PostWorkSurface.tsx:231-238` | PORTED | `src/lib/content.ts` `skipDraft` (`SKIP_STATUS`); same components, "Skip" button, confirm-gated. |
| 32 | Edit body (`saveDraft`) | `lib/studioActions.ts:90-122` | DEFERRED | D6: "read + approve/status parity only" — no edit-draft-body write or UI in `content.ts`/either candidate. |
| 33 | Disqualify stuck (bulk) | `PostWorkSurface.tsx:257-264` | DEFERRED | Stuck/error/approved-unscheduled buckets are visibility-only in both candidates (`actionable = status==='review'` gate) — mutation scope this run is the review bucket only (D5/D6). |
| 34 | Reschedule (Calendar drag) | `Calendar.tsx:65-109` | DEFERRED | D6: "no new publish/schedule affordances this run; scheduling stays on the dashboard/board flows." No calendar/drag surface in `src/exp`. |
| 35 | Regenerate/re-author draft (`post-gen-v2` webhook) | `lib/studioActions.ts:52-88` | DEFERRED | Generation-trigger webhooks out of this run's scope; not called anywhere in `src/`. |
| 36 | Schedule directly (`scheduleCarousel`) | `lib/studioActions.ts:259-267` | DEFERRED | D6 — publish/schedule affordances excluded. |
| 37 | Publish now (explicit webhook) | `lib/studioActions.ts:269-289` | DEFERRED | D6 — publish/schedule affordances excluded. |
| 38 | Image edit / revert | `lib/studioActions.ts:484-506` | DEFERRED | Not in scope this run; no image-edit write path in `content.ts`. |
| 39 | Video sub-pipeline (redo video / approve video, `video_status`) | `lib/studioActions.ts:300-338` | DEFERRED | Video generation/review is out of this run's scope entirely — no `video_status` handling anywhere in `src/lib/content.ts`. |
| 40 | LM lane mutations — approve & build assets / approve status-only / reject / retry generation / save edit / schedule LM promo / repost LM / regen cover / set active cover (9 actions) | `LmWorkSurface.tsx`, `lib/studioActions.ts:362-528` | DEFERRED | D6: "LM approve semantics are UNVERIFIABLE from repos (possible n8n watcher on `approved`) → LM rows are read-only in the inbox this run." `src/lib/styles.ts` `fetchResources` is explicitly commented READ ONLY. |
| 41 | Calendar 3-source merge (post / lm / post-queue chips) + drag reschedule | `Calendar.tsx`/`calendarItems.ts:54-115` | DEFERRED | D6 — no calendar/schedule screen built this run. |
| 42 | `scheduled_posts` publish-queue read (status vocab: pending/queued_v2/posting/posted/failed/cancelled) | `useContentPipeline.ts:34-37` | DEFERRED | `src/lib/content.ts` `fetchScheduledQueue`/`ScheduledQueueRow`/`QUEUE_STATUSES` **exist but are never called** by any hook or `src/exp` screen (grep-confirmed) — written in scope for D6 but left unwired; no queue/calendar UI ships this run. |
| 43 | Client board mutations (`client_board_action[_v2]`, `set_schedule`, `set_media`, `edit_draft`, `edit_lm_promo`, `hide_draft`, etc.) | `ClientBoardPage.tsx:7034-7451` | DEFERRED | D7: client-facing actions stay on the client board with its own gates; the inbox's Rise lane is read-only ambient visibility only. |
| 44 | Client Ops `operator_*` RPC suite (`operator_client_drafts`, `operator_approve_rise_draft`, `operator_schedule_draft`, `operator_set_board_visible`, `operator_client_ideas`, etc.) | `clientops2/shared.tsx:310-547` | DEFERRED | Same as #43 — client-board/Client-Ops actions stay on the dashboard's own oversight surface (D7); not called anywhere in `src/`. |

---

## 3. Styles + Resources — phase1c's capability set

| # | Capability | Dashboard source | Inbox status | Where (file) / Reason if deferred |
|---|---|---|---|---|
| 45 | Live style roster enumeration (`content_prompts` `style-%`, no hardcoded catalogue) | `StylesLive.tsx:87-92` | PORTED | `src/lib/styles.ts` `fetchStyleRoster` (D8); `cand-a/ContentStyles.tsx`; `cand-b/StudioScreen.tsx` + `StylesGridScreen.tsx`. |
| 46 | Post-image style family (`image-style-%` prompts) | Only ever rendered by the **orphaned** `StyleGalleryPanel.tsx:84-89` — the live `StylesLive.tsx` queried `'style-%'` only and never showed these | PORTED | `src/lib/styles.ts` `styleFamilyOf`/family-qualified roster fetch closes a gap the *live* dashboard actually had. Ported both (`ContentStyles.tsx`, `StudioScreen.tsx`/`StylesGridScreen.tsx`) — flagged ambiguous since the antecedent was dead code, not the live surface. |
| 47 | Carousel visual identity kits (`carousel_styles`, `exemplar_urls`) | `useCarouselStyles.ts` | DEFERRED | ACCESS-MATRIX: "1 active kit (editorial, 0 exemplars) — low value." Not read anywhere in `src/lib/styles.ts` (grep-confirmed no `carousel_styles` reference). |
| 48 | `content_archetypes` rotation-constraint catalog (`post_structure`/`carousel_style` rows) | `hooks/useContentArchetypes.ts` | DEFERRED | ACCESS-MATRIX: "optional style metadata" — feeds n8n's Rotation Constraints router only; not used by any inbox surface. |
| 49 | Lead magnet full data model / editing (`resource_html`, `email_copy`, `spec.dm_template_a/b`, cover regen, inline edit-token reveal) | `LeadMagnetStudioPanel.tsx`, `LeadMagnetEditor.tsx`, `lm-edit-token-reveal` | DEFERRED | D6/D9 — LM rows are read-only in the inbox; `src/lib/styles.ts` `fetchResources` selects only `id, topic, format, status, resource_url, cover_url, landing_slug, updated_at`, no edit path. |
| 50 | Resources = published Ivan LMs (list, cover, format chip, link-out) | (no direct dashboard equivalent — LM resource URL is only ever displayed inline on the editor) | PORTED | D9 — `src/lib/styles.ts` `fetchResources` (`client_id IS NULL`, `resource_url` present); `cand-a/ContentStyles.tsx` Resources section; `cand-b/StudioScreen.tsx` Resources section. |
| 51 | LM idea-stage (`lm_idea_candidates` via `useLeadMagnetIdeas`/`decideIdea`) | `LeadMagnetStudioPanel.tsx:81-85,150-157` | DEFERRED | Same reasoning as content row #29/#40 — ideas-candidate pipeline and LM mutations are both out of this run's scope. |
| 52 | Text-post styles gallery (6 hook patterns + 5 pillars) | `StyleGalleryPanel.tsx:109-129` (orphaned) | DEFERRED | Source component itself is dead/orphaned in the dashboard (not reachable from the live shell) — out of scope for a parity port. |
| 53 | `carousel-style-create` webhook (new style kit from reference images) | `StyleGalleryPanel.tsx:34-37` (orphaned surface only) | DEFERRED | Same as #47/#52 — orphaned dashboard surface, low value, not ported. |

---

## New capabilities in the inbox with NO dashboard antecedent

Found while reading the actual code, not present (even conceptually) in any of the
phase1a/1b/1c dashboard maps:

1. **Bucket tiles** (`cand-a/ContentQueue.tsx` `BucketTiles`, `cand-b/StudioScreen.tsx` `ov-kpis` tile row) — tappable stat tiles for review/error/stuck/approved-unscheduled that scroll to the matching section. No dashboard equivalent (the dashboard's queues were plain lists, no tile summary).
2. **Older-alerts count** (`ALERT_WINDOW_DAYS`/`alertWindowCutoff`/`olderUnsent` in `src/lib/agent.ts`, surfaced in both `AgentScreen.tsx` and `StudioScreen.tsx`) — a 14-day alert window with a summarized backlog count. The dashboard capped the alert *list* to 20 rendered rows but had no windowing or "N older" count at all.
3. **Approved-unscheduled "black hole" bucket** (`src/lib/content.ts` `bucketDrafts` → `approvedUnscheduled`) — the dashboard never surfaced this state anywhere (its review lane only shows `status='review'`, its calendar only shows rows with a `scheduled_at`); AUDIT.md calls this "the proven black-hole bucket." Built explicitly to close a structural gap, not to port an existing screen.
4. **Lane probe / empty-vs-broken distinction** (`fetchLaneProbe` — `scoped` vs `total` counts, `nothingMatched`/`filteredAway` in `ContentQueue.tsx`, `brokenEmpty`/`genuineEmpty` in `QueueScreen.tsx`) — D10's "an empty screen and a broken filter must never render the same" pattern. No dashboard surface distinguished these.
5. **Real per-style image preview via taxonomy join** (`previewsByStyle`/`styleKeysOf`/`previewKeyFor` in `src/lib/styles.ts`) — `StylesLive.tsx` (the live dashboard surface) shows **zero** image previews, only text rows; only the orphaned `useStyleUsage.ts` did a partial version for single-image styles alone. The family-qualified, both-family, carousel-and-single-image preview join is new engineering built for this run.
6. **Confirm-sheet gating on every consequential write** (`useConfirm()` wrapping ack/complete/approve/skip in both candidates) — the dashboard's Ack/Complete/Approve buttons fire immediately with no confirmation step.
7. **Pull-to-refresh gesture** (`usePullToRefresh`/`PullIndicator`) replacing the dashboard's header refresh button on every new screen.

---

## Counts

- **Total capability rows mapped**: 53 (25 from phase1a's table + 28 from phase1b/1c's capability sets)
- **PORTED**: 20 (rows 1,2,3,4,5,6,7,8,12,26,27,28,30,31,45,46,50 — 17 clean + 3 flagged ambiguous-but-still-ported: rows 1, 2, 6, 7 have completeness caveats noted inline but are ported in substance)
  - Re-count precisely: PORTED = rows 1,2,3,4,5,6,7,8,12 (9) + rows 26,27,28,30,31,45,46,50 (8) = **17**
- **UNCHANGED-ELSEWHERE**: 3 (rows 9, 10, 11 — superseded by the inbox's pre-existing realtime-channel + pull-to-refresh + focus-refetch conventions)
- **DEFERRED**: 33 (rows 13-25 = 13, rows 29,32-44 = 14, rows 47-49,51-53 = 6 → 13+14+6 = **33**)
- **PORTED-A-ONLY / PORTED-B-ONLY**: none found — every ported capability is backed by the shared `src/lib`/`src/hooks` layer and both finalists wire it, differing only in IA/chrome (tab-per-surface in cand-a vs. one Studio hub in cand-b), not in which capability is present.
- 17 + 3 + 33 = 53 ✓

---

## Ambiguous mappings (flagged inline above, repeated here for visibility)

1. **Row 1** (message stat cards) — chat volume is visible via the feed/last-message preview in both finalists, but the specific "total/today/this-week" 3-counter chrome from the dashboard isn't reproduced anywhere; called PORTED on substance, not on literal UI parity.
2. **Row 2** (alerts type-breakdown badge) — the alert list + Ack is fully ported; the `alertsByType` aggregation/badge is dropped in both candidates (grep-confirmed absent).
3. **Row 6** (summaries topic chips) — `cand-b/SummariesScreen.tsx` renders topics chips (and `action_items`, which the dashboard itself never rendered); `cand-a/AgentScreen.tsx`'s `SummarySection` shows only date+summary text, no chips — a real A/B completeness gap, not called out as PORTED-B-ONLY because cand-a still ships *a* summaries panel.
4. **Row 7** (chat pagination) — `fetchChatBefore` (the "load older messages" cursor fetch) is fully implemented in `src/lib/agent.ts` but is dead code today: neither `useAgent.ts` nor either chat screen calls it.
5. **Row 46** (image-style family) — the antecedent for this capability is the dashboard's *dead* `StyleGalleryPanel.tsx`, not the live `StylesLive.tsx` surface (which never showed image styles at all) — porting it arguably makes the inbox capability-richer than the live dashboard ever was, not a strict 1:1 port.
6. **Row 42** (`scheduled_posts` queue) — the fetcher exists in `src/lib/content.ts` (written, typed, presumably staged for a future calendar screen) but is unwired to any UI this run — worth flagging since it reads as "half-shipped" rather than a clean scope cut.
