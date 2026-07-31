# ACCESS-MATRIX — Phase 1e (probed live 2026-07-31)

Instruments: (1) PostgREST probe with the real shipped anon key (`scripts/probe-access.sh`), calibrated against a nonexistent-table control (404 PGRST205) and a known-populated table (`content_prompts` → 200/0 rows = RLS-filtered, not empty). (2) RLS policy extraction from applied migrations (`phase1e-rls-policies.md`). (3) Read-only service-key spot queries for population checks (key stays local, never in any bundle). (4) RPC probes.

**Instrument limitation (logged):** PostgREST returns identical PGRST202 for "RPC missing" vs "RPC exists, wrong args" (verified against `inbox_governor` control), so RPC existence rests on live-caller attestation (deployed app code paths) — marked `attested`.

## Verdict pattern
Post-closure RLS shape: **authenticated = full read/write, anon = none** on nearly everything. The inbox app runs authenticated (magic-link JWT) → **every table the new surfaces need is readable without any migration.** Zero new policies required. No T1 mutation needed.

## Per-object matrix (new-surface needs in bold)

| Object | Anon probe | RLS (from migrations) | New-surface use | Verdict |
|---|---|---|---|---|
| **n8nclaw_chat_messages** | 200/0 | authed full (closure:329) | AgentOps chat read | ✅ authed read |
| **n8nclaw_proactive_alerts** | 200/0 | authed full (closure:336) | AgentOps alerts + ack | ✅ authed read/write |
| **n8nclaw_reminders** | 200/0 | authed full (closure:337) | AgentOps reminders | ✅ authed read/write |
| **n8nclaw_daily_summaries** | 200/0 | authed full (closure:331) | AgentOps daily digest | ✅ authed read |
| **carousel_drafts** | 200/0 | authed full (closure:115-118) | Content queues both lanes; style previews | ✅ authed read (writes via existing status conventions only) |
| **lm_drafts_v2** | 200/0 | authed full (closure:232-234) | Resources list | ✅ authed read |
| **scheduled_posts** | 200/≥1 (scoped: posted) | anon posted-only; authed full (closure:363-365) | Content queue/calendar | ✅ authed read |
| **content_prompts** | 200/0 | authed full (closure:166-168) | Styles roster | ✅ authed read |
| **content_archetypes** | 200/0 | authed full (closure:154-156) | optional style metadata | ✅ authed read |
| **carousel_styles** | 200/0 | authed full (closure:127-129) | 1 active kit (editorial, 0 exemplars) — low value | ✅ authed read |
| ops_drafts | 200/0 | authed full (db/015) | existing Ops tab (unchanged) | ✅ already works |
| scans | 200/≥1 | anon complete-only | existing context lookups | ✅ unchanged |
| integration_config | 200/≥1 | anon non-secret only | seat health (unchanged) | ✅ unchanged |
| blueprints, paid_assessments, assessment_intakes | mixed | authed full | Agent-Ready panel — **DEFERRED** (retired offer) | ➖ not ported |
| outreach_link_clicks | 200/0 | authed full | click feed — deferred (outreach domain, already served by Sends/KPI) | ➖ not ported |
| client_boards / client_ideas | 200/0 | RPC-gated (SECURITY DEFINER), no policies in repo | NOT used — Rise lane reads carousel_drafts directly (authed) | ➖ avoided |
| inbox_* views | 200/0 (except scan_opens definer view) | security_invoker → authed | existing screens | ✅ unchanged |

## RPCs

| RPC | Evidence | New-surface use |
|---|---|---|
| `n8nclaw_dashboard_send` | attested (AgentPanel live path) | AgentOps chat send — **sole send path; the unauthenticated `webhook/n8nclaw-whatsapp` fallback is NOT ported** (phantom-publish skeptic verdict #3) |
| `dashboard_action` | body in repo (`migrations/client_autofix.sql:17`) | ONLY for `n8nclaw_proactive_alerts.sent` + `n8nclaw_reminders.status` acks — allowlist is wider (incl. outreach-arming fields, skeptic verdict #5) so the inbox wrapper hard-codes these two field names |
| `inbox_governor`, `inbox_range_kpis` | executed live this session (anon, read-only) | unchanged |
| `append_agent_log`, `get_recent_outreach_clicks`, `operator_set_lm_active_cover`, `get_client_board` | attested | not used by new surfaces |

## Skeptic-mandated DB checks (service key, read-only, run 2026-07-31)

1. **`carousel_drafts.client_id` values: `NULL` ×190 (Ivan), `'risedtc'` ×84.** No `'ivan'` literal exists → Ivan lane MUST filter `.is('client_id', null)`; a `eq.'ivan'` filter renders a blank board (blank-board skeptic #1 CONFIRMED, now neutralized).
2. **Approved-with-no-`scheduled_at` black hole: currently 0 rows** — structural trap confirmed in code but empty today; the Content section still gets an explicit `approved (unscheduled)` bucket so it can never silently hide a backlog (skeptic #3).
3. **`style_id` is dead (NULL on all recent published rows).** Style linkage is `taxonomy` — a JSONB (`structure_used`: "TEARDOWN"/"CASE STUDY"/"DATA-LED", `image_style`: "Concept Visual", …) that is sometimes a BARE STRING ("Teardown"). Preview matching must normalize both shapes (skeptic #4 CONFIRMED — the naive slug join would have returned empty previews).
4. **Live styles roster: 11 active `style-%` rows** (before-after, data-driven, educational-breakdown, framework-walkthrough, myth-busting, step-by-step, case-study, comic-explainer, teardown, founder-process, receipts) — not the 8+6 from stale memory, not the 15 from the orphaned panel. The Styles section enumerates LIVE rows, never a hardcoded list (same rationale as StylesLive).
5. **Preview supply (last 60 published):** Ivan single_image 24/25 have `image_urls`; Ivan carousels only 1/7; Rise 7/7. Assets live in public `ig-slides` storage bucket. UI must carry a designed "no recent example" state — verified empty ≠ broken.
6. **Ivan LM resources:** 8 published LMs with `resource_url`+`cover_url` (plus review/pending pipeline; columns: `topic`, `format`, `status`, `resource_url`, `cover_url`, `landing_slug`…). Real resources exist for the Styles/Resources surface.

## Auth verification plan for later phases
The service key can mint a one-time magic link for Ivan's own account via the Supabase admin API (local use only) → gives Playwright an authenticated session for candidate screenshots (Phase 2) and live deployed verification (Phase 4) without touching Ivan or shipping any secret.
