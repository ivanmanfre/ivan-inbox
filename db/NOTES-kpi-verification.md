# KPI Dashboard — Live-Data Verification Findings (Task 1)

Read-only verification pass against live Supabase (`bjbvqvzbzczjbatgmccb`) on 2026-07-24.
No views created, no DDL applied. Tasks 2–5 read this file to author SQL.

> **BIG DELTA up front:** `outreach_prospects` has **no `source` column** and **no `client_id` column**.
> Lanes are driven by the **campaign name** (`outreach_campaigns.name`); client scoping is via
> `coalesce(outreach_campaigns.client_id, 'ivan')` (already the convention in `001_inbox.sql` / `003_sends_views.sql`).
> The score field is `icp_score`, not `score`. Details per-interface below.

---

## Resolved Interface values

### ACCEPT_SIGNAL — CONFIRMED
- Column: **`outreach_prospects.connected_at`** (timestamptz).
- Verified: all sampled `stage='connected'` rows have `connected_at` populated (e.g. `2026-07-04T19:31:14Z`).
  Companion column `connection_sent_at` exists too (may be null on legacy imports).
- Predicate for "accepted": `connected_at is not null`.
- Matches brief. ✅

### PRECONTACT_STAGES — DELTA
- Brief expected `('enriched','review')`.
- Live stage counts (exact, via `Prefer: count=exact`):
  `enriched=324`, `identified=52`, **`review=0`**, `scored=0`, `queued=0`, `ballot_hold=129`,
  `connection_sent=137`, `connected=9`, `dm_sent=121`, `replied=42`, `archived=4634`, `skipped=796`.
- **Real precontact set = `('enriched','identified')`.** `review` is a valid enum value but currently holds **0 rows**;
  `scored`/`queued` are also empty. Safe to keep `'review'` in the set for forward-compat, but `'identified'` is the
  populated pre-contact stage the brief omitted.
- ⚠ FLAG: `review` empty; add `identified`.

### SCORE_FIELD + floor — DELTA
- Field: **`outreach_prospects.icp_score`** (there is **no** plain `score` column — probe 400'd `column ... score does not exist`).
- Floor `icp_score >= 7`: 1,569 rows qualify. Floor semantics unchanged.
- ⚠ FLAG: field name is `icp_score`, not `score`.

### ARCHIVED_PRED — DELTA / clarified
- Dead/parked are expressed via **`stage`**, not a boolean. Relevant stages present live:
  `archived` (4,634 rows), `skipped` (796), `ballot_hold` (129 — born-dead / gold reserve).
- **No boolean `archived` column on `outreach_prospects`.** (The `archived` boolean lives on
  `outreach_campaigns`, not on prospects.) A boolean **`blacklisted`** *does* exist on prospects (228 true / 772 false in a 1k sample).
- Recommended "alive" predicate: `stage not in ('archived','skipped','ballot_hold') and blacklisted is not true`.
  (Brief only excluded `archived` + `ballot_hold`; **also exclude `skipped`**, and optionally `blacklisted`.)
- ⚠ FLAG: no boolean `archived` on prospects; add `skipped` to the exclusion; `blacklisted` boolean available.

### MONTHLY_CAP — DELTA (key/value store, no client_id column)
- `integration_config` is a **key/value table** — columns `key, value, updated_at, is_secret`. **No `client_id` column.**
- Rise monthly connection cap: **`key = 'risedtc_connect_monthly_cap'`, `value = '400'`** (string).
- Scoping to the client is by the **`risedtc_` key prefix**, NOT a `client_id` row field.
- Related caps in the same table (for reference): `risedtc_connect_weekly_cap=100`, `risedtc_connect_daily_cap=20`,
  `risedtc_inmail_monthly_cap=100`, `risedtc_inmail_daily_cap=4`, `risedtc_openprofile_daily_cap=5`.
- Read pattern: `select value from integration_config where key = 'risedtc_connect_monthly_cap'` (cast to int).
- Ivan (personal) has **no** equivalent `*_connect_monthly_cap` key — his cap surfaces via the RPC (`cap`), see below.
- ⚠ FLAG: scoping is key-prefix, not a `client_id` column; value is TEXT (cast needed).

### SLUG_JOIN — DELTA (multi-hop, no `scan_slug`, no `client_id` on scan tables)
- `outreach_prospects.scan_slug` **does not exist** (probe 400'd).
- `scans` table exists (public.scans) with `company_slug, prospect_token, source, report_url, ...` — but **no `client_id`**.
- `scan_opens.company_slug` values are LinkedIn person-slugs (e.g. `nick-fouriezos-62`, `william-brown-14`) and **match `scans.company_slug`** exactly (verified `nick-fouriezos-62` present in `scans`).
- The only client-bearing link is via the prospect token:
  **`scan_opens.company_slug` = `scans.company_slug` → `scans.prospect_token` = `outreach_prospects.id` → `outreach_prospects.campaign_id` → `outreach_campaigns.client_id`.**
  (Verified: `scans` row `andyalagappan` has `prospect_token=01ae433b-…` which is a real `outreach_prospects.id`.)
- Caveat: `scans.source` distribution = `inbound (147)`, `outreach (1)`, `hypertarget_pilot (1)`. **Most scans are `inbound` with `prospect_token = null`**, so they have no prospect → no derivable client. Attribute token-less / `inbound` scans to the default client **`ivan`** (consistent with `coalesce(...,'ivan')`).
- ⚠ FLAG: there is NO direct slug→client column anywhere; client is only derivable for scans that carry a `prospect_token`. Everything else defaults to `ivan`.

### SENDER_HEALTH_FIELDS — DELTA (superset) + client-parameterized
- `POST /rpc/outreach_sender_health` with body `{}` → HTTP 200, returns:
  ```json
  {"cap":50,"cohort":139,"accepted":23,"warm_cap":25,"warm_only":false,
   "accept_rate":0.1655,"weekly_sends":92,"warm_sends_7d":24}
  ```
- Actual keys: **`cap, cohort, accepted, warm_cap, warm_only, accept_rate, weekly_sends, warm_sends_7d`** (8 keys).
- Brief expected 6 (`cap, weekly_sends, warm_only, warm_cap, warm_sends_7d, accept_rate`) — all present; reality **adds `cohort` and `accepted`**.
- The RPC accepts a **`p_client_id`** argument: `{"p_client_id":"risedtc"}` → 200 with different values (`cap:35, cohort:0, warm_sends_7d:0, weekly_sends:51`). So it is per-client callable (default `{}` = Ivan's seat).
- ⚠ FLAG: +2 extra keys (`cohort`, `accepted`); pass `p_client_id` to scope to Rise.

---

## LANE_MAP — per client (driver = `outreach_campaigns.name`, NOT a `source` column)

Client is `coalesce(outreach_campaigns.client_id,'ivan')`. Rows with `client_id = null` → **ivan**; `client_id = 'risedtc'` → **risedtc**.
Secondary hint available on prospects: `trigger_type` (`engaged_post`, `hiring`, `industry_signal`, `company_news`, `content_engagement`, `room_census`) and `preferred_channel` (`linkedin`/`email`) — but campaign name is authoritative for the lane.

### client_id = `ivan` (campaign `client_id` is NULL)
| Campaign name | Lane |
|---|---|
| Marketing & Creative Agencies | Cold |
| Creative & Brand Agencies | Cold |
| Paid-Media & Performance Agencies | Cold |
| Construction & Trades | Cold |
| Real Estate Brokerages | Cold |
| Staffing & Recruiting Firms | Cold |
| Property Management Companies | Cold |
| Manufacturing & Industrial Ops | Cold |
| Law Firms (Boutique) | Cold |
| Architecture & Interior Design Firms | Cold |
| Coaches & Advisors (Boutique Practices) | Cold |
| Accounting & Tax Advisory Firms | Cold |
| Research Firms & Insights Practices | Cold |
| Consultancies & Strategy Firms | Cold |
| Agency Owners & Ops Leaders | Cold |
| Agency-Focused Consultants & Fractionals | Cold |
| Email Lane — Agencies (Cold) | Cold |
| Warm - Hiring Signal | Warm |
| Warm - Engagement Harvest | Engager ⚠(Warm vs Engager) |
| Warm - Kyle Engagers | Engager |
| Warm - LM Anchor Engagers | Engager |
| Profile View — Ivan | Engager ⚠(profile-view signal; could be Other) |

### client_id = `risedtc`
| Campaign name | Lane |
|---|---|
| RiseDTC — Cold (DTC Sales Nav) | Cold |
| RiseDTC — Client Orbit (clients' networks) | Warm |
| RiseDTC — Network Activation (ICP connections) | Warm |
| RiseDTC — Warm (his engagers) | Engager ⚠(named "Warm" but = his post engagers) |
| RiseDTC — Profile View | Engager ⚠(profile-view signal; could be Other) |

**Bucketing rule for Tasks 2–5 (implement in SQL via `name ILIKE`):**
1. `name ILIKE '%cold%'` OR name is a bare vertical/industry campaign (no `Warm`/`Profile View`/`Orbit`/`Network Activation` marker) → **Cold**
2. `name ILIKE '%engager%'` OR `%engagement harvest%` OR `%anchor%` OR `%profile view%` → **Engager**
3. `name ILIKE '%warm%'` (and not caught above) OR `%orbit%` OR `%network activation%` → **Warm**
4. else → **Other**

**⚠ Ambiguous buckets to confirm with Ivan (picked the more conservative/engagement bucket):**
- `Warm - Engagement Harvest` and `RiseDTC — Warm (his engagers)` are named "Warm" but are engagement-harvested people → bucketed **Engager**.
- `Profile View — Ivan` / `RiseDTC — Profile View` → bucketed **Engager** (profile-view intent); could arguably be **Other**.

---

## Probe log (status + one-line outcome)
| Probe | HTTP | Outcome |
|---|---|---|
| `outreach_prospects?select=source,...` | 400 | `column outreach_prospects.source does not exist` → no source col; use campaign name |
| `outreach_prospects?select=*` (keys) | 200 | 90-col schema; has `icp_score, connected_at, connection_sent_at, blacklisted, campaign_id, trigger_type, preferred_channel`; no `client_id/source/score/scan_slug/archived` |
| prospects stage/trigger/channel tally (1k) | 200 | stages skew archived; trigger_type top: engaged_post/hiring/industry_signal; pref_channel linkedin/email |
| `outreach_campaigns?select=*` | 200 | 27 campaigns; `client_id` NULL (ivan) or `risedtc`; lane readable from `name`; has `archived` bool |
| `stage=eq.connected` connected_at | 200 | `connected_at` populated on connected rows → ACCEPT_SIGNAL confirmed |
| precontact stage counts | 200 | enriched=324, identified=52, review=0, scored=0, ballot_hold=129 |
| `integration_config?select=*` | 200 | key/value table, no client_id; found `risedtc_connect_monthly_cap=400` + weekly/daily caps |
| `outreach_prospects?select=scan_slug` | 400 | `column ... scan_slug does not exist` |
| `scan_opens?select=*` | 200 | cols `company_slug,opened_at,is_owner,device_type,referrer_host,ip_hash,user_agent`; person-slugs |
| `scan_open_stats` view | 200 | `company_slug,real_opens,total_opens,last_real_open,real_open_days` |
| `scans?select=*` | 200 | exists; `company_slug,prospect_token,source,report_url,...`; **no client_id** |
| `scans?company_slug=eq.nick-fouriezos-62` | 200 | matches a scan_opens slug → join key confirmed |
| `scans?prospect_token=not.is.null` | 200 | `prospect_token` = `outreach_prospects.id` (verified `andyalagappan`) |
| `rpc/outreach_sender_health` `{}` | 200 | 8 keys incl. extra `cohort,accepted`; Ivan seat |
| `rpc/outreach_sender_health` `{"p_client_id":"risedtc"}` | 200 | different values → RPC is client-parameterized |
| stage exact counts (count=exact) | 200 | archived=4634, skipped=796, enriched=324, ballot_hold=129, connection_sent=137, connected=9, dm_sent=121, replied=42 |
| `icp_score=gte.7` count | 200 | 1,569 rows qualify |
| `outreach_prospects?select=score` | 400 | no `score` col → use `icp_score` |
| `client_registry?select=*` | 200 | exists (`client_id, display_name, github_repo, n8n_url,...`) — canonical client list |

## Unresolved / for Ivan
- Lane bucket of the four ⚠ "Warm"-named engagement/profile-view campaigns (see LANE_MAP) — defaulted to Engager, confirm.
- No blocker encountered; key is live (no 401 anywhere).
