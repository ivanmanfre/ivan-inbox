# Phase 1 — Accuracy Audit: findings, adversarial verdicts, decisions

6 researchers + 4 named skeptics, all against live data (evidence: `phase1/r*.md`, `phase1/s*.md`). Every decision below is gated on a live query, not balloted. Skeptics overturned or materially corrected 3 of 6 findings — the audit earned its cost.

## F1 — Acceptance rate mixes cohorts → REPLACE VIEW (CONFIRMED by skeptic)
- Trailing view counts accepts-landing-in-window over sends-in-window: ivan 7d reads 29.3% but cohort-true is **19.5%** (4 of 12 counted accepts were from notes sent before the window; row-exact reproduction by both researcher and skeptic). >100% structurally reachable in any throttle week.
- **Decision:** replace `inbox_accept_v` with cohort semantics — denominator = notes sent in window, numerator = those with `connected_at >= sent_at`. Column shape identical (frontend-safe, verified against `AcceptRow` + Engagement card usage). Skeptic correction adopted: cohort rate is a right-censored FLOOR (median accept lag 0.49d, 89.9% within 7d) → ship caption: *"Share of notes sent in each window that got accepted. Recent sends are still maturing — this rate only rises."*
- SQL: `phase1/s1-cohort-skeptic.md` (skeptic's corrected header). MUST update `db/APPLY-kpi-views.sql` in the same commit (else the apply block silently reverts).
- Known 1-row edge cases (documented, not fixed): 1 pre-connected re-send, 1 double-credited prospect (2 notes, 1 connect).

## F2 — Campaigns block drops 29% of sends → NEW VIEW (CONFIRMED incl. authed role)
- PostgREST hard-caps responses at 1000 rows regardless of `.limit(4000)` — **proven for the app's actual authed role**, not just service. 1409 ground-truth rows vs 1000 fetched; 12/27 campaigns misreported (8 paused campaigns show 0 vs 2-29 real; worst active: Agency-Focused Consultants 199 shown vs 331 real).
- 587-duplicate contradiction RESOLVED: phantom rows were hard-deleted from `outreach_messages` between 07-22 and 07-24; 0 dupes among sent rows today. Dedup guard stays (free).
- **Decision:** new `inbox_campaign_sends_v` (server-side full-population aggregate: campaign_id, campaign_name, client_id, is_active, sent_total, sent_7d, sent_30d, last_sent; join by id not name; message_type filter aligned with `inbox_sends_v`). `fetchCampaignSends` becomes a thin select. Acceptance check: "Warm - Engagement Harvest" expects **62** (2 `audit_delivery` rows correctly excluded vs raw 64).
- Handed to watch-first: 14 orphan DM sends (2026-07-17, campaign_id NULL prospects) invisible on ALL surfaces via `inbox_messages_v` inner join.

## F3 — Scan-open attribution → VIEW FIX, researcher's "true distribution" verdict REFUTED
- 19/19 open-bearing slugs token-null CONFIRMED — but the skeptic found **47/149 scans are RISE-branded** (`report_json->'dtc'->'brand'->>'wordmark' = 'RISE DTC'`) and one open-bearing slug (`neve-foods-7f` = Nora Fierman, RiseDTC — Client Orbit, DM'd 07-22, first open **25s after the DM**) is genuinely Rise. Correct attribution today: **ivan 64 / risedtc 3**, not 67/0.
- **Decision:** extend `inbox_scan_opens_v`'s client derivation: campaign client → else RISE-wordmark branch → else 'ivan'. Post-apply gate: view must return ivan 64 / risedtc 3 (at today's data). Optional operator backfill (commented in the SQL, not auto-run): set `scans.prospect_token` for neve-foods-7f → `bb842d9a-daa5-42fa-ad62-9336e68e704c`.
- Watch-first: 90 owner-opens already sit on the other 46 Rise scans — every future non-owner open there would have silently inflated ivan.

## F4 — Lane bucketing → lane_of() mechanically correct, semantically REFUTED for ivan
- Skeptic proved Ivan's "Engager" lane is **0% own-content** (Kyle's audience 14/64, other creators' LM-anchor posts 69/38, competitor-post harvest 9/20 — sendable/sent_30d). Operator's model says engager = own-content engagers; the current display credits his content with supply it doesn't produce.
- **Decision:** add a `harvest` branch to `lane_of()` BEFORE engager: `%kyle engagers%|%anchor%|%engagement harvest%` → `'harvest'`; label "Harvested" in `laneLabel()`. Rise "his engagers" + profile-view stay Engager (genuinely own-presence). "Warm - Hiring Signal" misbucket noted but dead (retired, blacklisted, 0 in-window) — no change.

## F6 — Note-vs-no-note (operator-reported) → NO false notes today; n8n write-back is the real fix (out of T2 scope)
- The sender (n8n `Outreach - Connection Request Sender` 5ZXtArhobWrDDpfJ, node "Send Connection") try/catches UniPile invite-with-note; on note-rejection it retries bare, tags `note_variant='F'`, and **skips the message insert** — so a no-note invite produces NO log row (never a false note). That branch has fired **zero times** ever (0 `note_variant='F'`, 0 `note_quota_fallback` log entries) despite 57 Rise notes this month.
- Every CONN row in the log = UniPile accepted the call WITH the note. Residual risk: LinkedIn silently stripping notes server-side — invisible to any instrument we have.
- **Decision:** no dashboard data change is honest or possible. Ship a one-line Log caption ("notes shown were accepted by the API; silent LinkedIn strips aren't detectable"). Watch-first hand-off: (a) n8n write-back — on bare fallback, INSERT a message row flagged no-note so the log can show "connection sent without note"; (b) latent bug: `already_invited`/422 treated as full success in the same node.

## F7 — Governor cross-checks → 2 real bugs + labeling (researcher + live n8n proof)
- **F7a Ivan-row contamination (real bug, live now):** `outreach_sender_health()` no-arg applies NO client filter → Ivan's "98/50 used" is actually 41 ivan + 57 rise. Ivan's true week: **41/50 (9 headroom)**. Worse: Ivan's sender branch gates on the same unfiltered counter (`weekly_sends >= cap` → 98 ≥ 50), so Ivan's cold sends are being skipped by Rise's volume. The operator's raised-cap stance stands, but the number he was reading was contaminated.
  **Decision:** do NOT touch `outreach_sender_health` (shared enforcement function — blast radius). `inbox_governor()` v2 computes per-client `used`/`cohort`/`accepted`/`accept_rate` itself from `outreach_engagement_log` (client scope: campaigns.client_id NULL=ivan / 'risedtc'), and ALSO returns the raw enforcement view (`gov_used`, `gov_cap`) so the UI can show: "41 sent this week · governor counter reads 98/50 (shared with Rise — cold sends gated)". Requires DROP FUNCTION + recreate (return-type change) + GovernorRow/UI update. The sender_health scoping fix itself → watch-first (operator/n8n-side, touches enforcement).
- **F7b Rise cap (real bug):** enforced weekly cap is **100** (config override in the sender since 07-23, proven live: 57 sends past the RPC's 35 without a pause), but `inbox_governor()` shows the RPC's adaptive placeholder 35. **Decision:** `cap := coalesce(integration_config.risedtc_connect_weekly_cap, h.cap)` — mirrors what the code already does for daily/monthly.
- **F7c labels (both correct, different questions):** governor accept = matured cohort (sends 3-18d old; ivan 16.6% exact-reproduced) vs acceptance card trailing/cohort windows. Ship labels: governor line "cohort accept (3-18d matured)"; Rise while cohort=0 → "not enough data yet (cohort opens ~07-27)" instead of 0.0% (emit null, not 0).
- Mode logic verified correct for both (normal/normal, warm_only false live).

## Fix set → Phase 3 tasks
| # | Change | Files |
|---|---|---|
| X1 | Cohort acceptance view + caption | `db/009_accept_cohort.sql`, OverviewView caption, APPLY block |
| X2 | Campaign sends view + thin fetcher | `db/010_campaign_sends.sql`, `sends.ts`, OverviewView Campaigns (show all-time + 7d), APPLY |
| X3 | Scan-open RISE-wordmark attribution | `db/011_scan_client_attr.sql` (replaces 007 view), APPLY |
| X4 | Governor v2 RPC (per-client scoping + enforcement view + Rise cap 100 + null-when-immature) | `db/012_governor_v2.sql`, `kpis.ts` GovernorRow, GovGauge copy, APPLY |
| X5 | Harvest lane | `db/013_lane_harvest.sql` (lane_of + recreate pipeline view dependency-safe), `kpis.ts` laneLabel |
| X6 | Log caption honesty (F6) | SendsScreen Log copy only |

Post-apply gates (Phase 4): X1 → ivan 8/41·19.5% & 52/250; X2 → Agency-Focused 331, Harvest 62, Manufacturing 29; X3 → ivan 64 / risedtc 3; X4 → ivan used 41, gov_used 98, rise cap 100, rise accept null; X5 → ivan pipeline rows split engager→harvest(92 sendable)/engager(0).
