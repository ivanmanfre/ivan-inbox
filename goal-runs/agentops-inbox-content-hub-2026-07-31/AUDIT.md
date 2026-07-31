# AUDIT.md — Phase 1 synthesis (2026-07-31)

Sources: phase1a-agentops-map.md · phase1b-content-map.md · phase1c-styles-map.md · phase1d-inbox-architecture.md · phase1e-rls-policies.md · ACCESS-MATRIX.md · skeptic artifacts (phantom-publish, blank-board). Every claim below is cited in those files.

## What "AgentOps" actually is (1a)
Three unrelated things share the dashboard's Agent section:
1. **n8nClaw** — WhatsApp-mirrored AI assistant chat + proactive alerts + reminders + daily summaries. LIVE, daily-used. **This is the port target.**
2. **Agent-Ready** — the retired $2k Blueprint sales pipeline (paid_assessments et al). Offer retired 2026-07-10; panel's brief-gen is dead code. **DEFERRED, with reason, in the parity ledger.**
3. **AgentLogFeed** — generic agent-run log component. Ships where useful, not a section of its own.

## Decisions locked by audit evidence (each traces to a skeptic verdict or DB check)
- **D1. Reads = authenticated PostgREST, same as every existing inbox hook.** RLS post-closure grants authed full read on all needed tables; zero migrations needed (ACCESS-MATRIX).
- **D2. Ivan lane = `client_id IS NULL`; Rise lane = `client_id = 'risedtc'`.** No `'ivan'` literal exists in content tables (DB check 1).
- **D3. n8nClaw send ports the RPC path ONLY.** The dashboard's unauthenticated `webhook/n8nclaw-whatsapp` fallback (fires on ANY rpc error, spoofs an inbound WhatsApp message) is NOT ported — a stray retry from a phone would ghost-message the real assistant loop (phantom-publish #3, #6).
- **D4. Alert/reminder acks call `dashboard_action` with the two field names hard-coded** (`n8nclaw_proactive_alerts.sent`, `n8nclaw_reminders.status`). The RPC's allowlist is wider and includes outreach-arming fields (`outreach_campaigns.is_active`, `outreach_prospects.stage`) — the inbox wrapper must make misuse impossible (phantom-publish #5).
- **D5. Content queues bucket by: review · error · stuck-scheduled (past-due, unpublished) · approved-unscheduled (the proven black-hole bucket, currently 0 rows) · generating · scheduled · published.** Nothing filtered invisible (blank-board #3).
- **D6. Approve in the Ivan lane is a status write and does NOT publish** (publish = `scheduled`+bridge or explicit `publish-now` webhook; 1b). The inbox Content section ships **read + approve/status parity only** — no new publish/schedule affordances this run; scheduling stays on the dashboard/board flows. LM approve semantics are UNVERIFIABLE from repos (possible n8n watcher on `approved`) → LM rows are **read-only** in the inbox this run (phantom-publish #2).
- **D7. Rise lane is read-only ambient visibility for Ivan** (client-facing actions stay on the client board with its gates; client-artifact handover rules apply). Raw authed read of Rise rows must be VERIFIED live before relying on it (blank-board #2) — if RLS blocks, fall back to the `operator_client_drafts` RPC attested in 1b.
- **D8. Styles = live enumeration of `content_prompts` `style-%` (11 active today) + previews aggregated from published `carousel_drafts` matched on normalized `taxonomy` (`structure_used` / `image_style` / bare-string) — never `style_id` (dead column), never a hardcoded roster.** Designed empty-state for styles with no recent example (DB checks 3-5).
- **D9. Resources = published Ivan LMs** (`lm_drafts_v2`, `client_id IS NULL`, `resource_url` present) with cover, format chip, and link-out (8 live today).
- **D10. Every new lib fetcher distinguishes empty-vs-broken**: scoped queries pair with an unscoped probe count (or PostgREST `count=exact`) so a filtered-to-zero bug can't render as a calm empty state; errors surface, not swallow (blank-board #5 — neither repo does this today; the new code does).
- **D11. New-surface writes are limited to:** n8nclaw chat send (RPC), alert/reminder ack (D4), Ivan-lane post status writes that mirror existing dashboard semantics exactly (approve→'approved', skip). All behind `useConfirm()` per house rule 8 (1d §8b).

## Constraints the tournament must respect (1d)
- TabBar = fixed 6 slots, full. Tab enum duplicated in 3 files (App.tsx / TabBar.tsx / route.ts) — the build should introduce the shared source the checklist recommends.
- Every candidate follows the 15-point native-feel checklist (1d §8b): hook template w/ `useId()` realtime namespacing, pure-fn + vitest w/ incident comments, single-glyph icons, severity palette, 34px/800 titles, `.5px` hairlines, skeletons, pull-to-refresh, `useConfirm` for consequential writes, `dt-full` vs split decision, relative `./#hash` deep links, NULL→lane coalescing at the query layer.
- PWA: Workbox precache-only; no sw changes needed for new screens (only if new push kinds are added — none this run).

## Danger register (carried to build + verification)
| # | Danger | Neutralization |
|---|---|---|
| 1 | Ghost WhatsApp sends via webhook fallback | D3: fallback not ported; grep gate in Phase 4 (no `n8nclaw-whatsapp` literal in ivan-inbox src) |
| 2 | dashboard_action misuse arming outreach | D4 wrapper; Phase 4 grep: only two field literals |
| 3 | Blank Ivan lane from `eq.'ivan'` | D2; unit test pins `.is null` |
| 4 | Empty style previews from slug-join drift | D8 normalizer + test against real taxonomy fixtures pulled this session |
| 5 | LM approve possibly publishing via watcher | D6: LMs read-only |
| 6 | Existing Ops tab regression (two-mount channel collision, `754d32d`) | candidates reuse `useOps` as-is; Phase 4 re-runs its test + manual mount check |
| 7 | Rise raw-read RLS surprise | D7 live probe before wiring; RPC fallback named |
| 8 | 1000-row PostgREST cap truncating "full population" checks | Phase 4 uses `count=exact` + range loops (pattern already in `inbox.ts:135-150`) |

## Parity baseline for Phase 4 ledger
The full capability inventory lives in phase1a (AgentOps: 9 tables, 4 RPCs, per-capability table) and 1b/1c (content + styles). PARITY-LEDGER.md maps each to: ported / deferred-with-reason (Agent-Ready pipeline, outreach click feed, LM mutations, client-board actions) / unchanged-elsewhere.
