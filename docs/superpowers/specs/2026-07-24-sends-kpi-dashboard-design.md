# Sends tab → per-person Outbound Command Center + auth-lockout fix

**Date:** 2026-07-24
**Repo:** `ivan-inbox` (React + TS + Vite PWA, deployed to GitHub Pages)
**Status:** Approved design, ready for implementation plan

This is spec #1 of a decomposed effort. Spec #2 (fold the Claude Code web UI into the
inbox) is deferred and tracked separately — it hits a hard architectural wall (the
inbox is a static GitHub Pages site; the Claude Agent SDK needs a live Node/WebSocket
backend) and gets its own design.

---

## 1. Goal

Rebuild the **Sends** tab from a phone-style card list into a dense, per-person
outbound analytics dashboard that answers, at a glance and per account (Ivan / Rise):

- How much went out per channel (Connections, DMs, InMails, Emails) over a chosen window.
- Connection **acceptance rate** (7d, 30d, selectable).
- How the **governor** is throttling sends right now, and how much headroom is left.
- Whether there is **enough future pipeline** — sendable ICP runway by lane — and which
  lane recent leads are coming from.
- **Scan-resource opens** — how many prospects actually opened the `/scan/<slug>` report
  they were sent, per account (Ivan + Rise DTC), excluding Ivan's own clicks.
- Per-campaign breakdown.

Plus fix the recurring **auth lockout** that forces re-entering the email OTP code.

Non-goals (YAGNI): editing caps from the UI, per-campaign governor, historical governor
timeline, acceptance for non-connection channels (only connections have an accept event),
the Claude Code UI (spec #2).

---

## 2. Screen structure

The Sends tab keeps its `Ivan / Rise / All` chips and gains a **timeframe selector**
(`7d · 30d · 90d · All`). Segmented sub-views become:

**`Overview` (new default) · `Lanes` (existing health view) · `Log` (existing feed)**

The `Overview` stacks five blocks, all scoped to the selected person + timeframe:

1. **KPI row** — 4 cards: Connections, DMs, InMails, Emails. Each: window count, a
   small today/24h figure, and a sparkline. Desktop = one row of 4; mobile = 2×2.
2. **Engagement panel** — two downstream signals side by side:
   - **Acceptance** — connection acceptance % for 7d and 30d (and the selected window),
     each with raw `accepted / sent` beneath, plus an accept-trend sparkline. Carries an
     explicit cohort-lag caption (a connection sent yesterday hasn't had time to accept
     yet) so the number isn't misread.
   - **Scan opens** — real (non-owner) opens of `/scan/<slug>` reports for this account,
     windowed (7d / 30d / selected), plus distinct prospects who opened and last-open
     time. Reuses the existing `is_owner` / `owner_ips` exclusion, so Ivan's own clicks
     never count (§3.5).
3. **Governor panel** — see §4. The "how it's limiting me" view.
4. **Pipeline runway** — see §5. Sendable ICP by lane + recent sourcing mix.
5. **Campaigns table** — per campaign for the selected person: name, active/paused,
   sends in window, accept %.

Desktop density: on wide screens the blocks use multi-column layouts (KPI row of 4,
governor gauges side by side); mobile keeps them single-column and scrollable.

---

## 3. Data layer

All grounded in tables that already exist. Two genuinely new server-side pieces are
called out; both get a **verification-against-live-Supabase task as the first step of
the plan** before any UI is built on them.

### 3.1 KPI cards — no new SQL
`inbox_sends_v` is already grouped by `client_id` + `message_type`, so per-person
channel counts (24h/7d/30d/total) just filter by the selected person. Widen
`inbox_sends_daily_v` from a 14-day to a 90-day window so the timeframe selector and
sparklines have data. Both views already collapse the historical phantom-duplicate
insert loop via `distinct on (prospect_id, message_text, sent_at)` — preserve that.

### 3.2 Acceptance — new view `inbox_accept_v`
Per `client_id`: join deduped `connection_note` sends against
`outreach_prospects.connected_at` (accept signal; `stage='connected'` corroborates).
Returns `sent_7d / accepted_7d / rate_7d`, same for 30d and all-time, plus a daily
accept series for the sparkline. Trailing style — accepts-in-window ÷ sends-in-window —
so the displayed % matches the number the governor reacts to.

### 3.3 Governor — new normalized endpoint `inbox_governor()` (RPC or view)
Returns one row per person with a common shape:
`{ client_id, model, cap, used, window, mode, daily_used, daily_cap, accept_rate, headroom }`.
- **Ivan row** reuses the live `outreach_sender_health` RPC logic: `cap` (weekly, ramps
  35→100 on trailing accept), `weekly_sends`, `warm_only`, `warm_cap`, `warm_sends_7d`,
  `accept_rate`; plus today's connection count vs the hard **20/day** brake.
- **Rise row** reads the client monthly cap from `integration_config` and counts
  month-to-date connection sends. No adaptive ramp.
**Verify task:** confirm `outreach_sender_health` output fields and the
`integration_config` monthly-cap field name against live Supabase before wiring UI.

### 3.4 Pipeline — new view `inbox_pipeline_v`
Per `client_id` × lane, returns `sendable` (future runway) and `sent_in_window`
(sourcing mix).
- **Sendable ICP filter:** `score ≥ 7` AND stage is pre-contact (`enriched` / `review`,
  not yet `connection_sent`) AND campaign `is_active` AND `blacklisted = false` AND NOT
  archived AND NOT `ballot_hold`. This is the "ICP pipeline, not the scored-and-archived
  pile" cut — archived and ballot_hold are excluded by definition.
- **Lane classifier (per person — see §5):** buckets `outreach_prospects.source`
  (+ `trigger_confidence`) into that account's lanes.
**Verify task:** enumerate the live `source` values per `client_id` and confirm the
lane mapping + the exact pre-contact stage set before building the view.

### 3.5 Scan opens — new view `inbox_scan_opens_v`
The `scan_opens` table + `scan-open` edge function already log every `/scan/<slug>` open
and stamp `is_owner` (owner_flag OR request IP in `owner_ips`; authed opens self-seed
Ivan's IPs, so raw link clicks from his phone are excluded too). The existing
`scan_open_stats` view exposes only all-time per-slug aggregates and no `client_id`, so
add a **security-definer** view `inbox_scan_opens_v` (same definer pattern as
`scan_open_stats`, raw table stays service-role-only) that:
- filters `not is_owner` (self-clicks already handled — no new logic),
- maps `company_slug → client_id` via the scan/prospect registry,
- returns per `client_id`: `opens_7d / opens_30d / opens_total`, `distinct_prospects`,
  `last_open`, and a daily series for the sparkline.
**Verify task:** confirm how a scan `company_slug` ties back to a client (slug→prospect
/campaign/client_id mapping) — Rise scans live under resources.risedtc.com, Ivan's under
resources.ivanmanfredi.com, but the join key must be confirmed against live data.

---

## 4. Governor panel

The two accounts run different governor models; the panel reflects each honestly.

**Ivan — weekly adaptive account governor:**
- Weekly cap gauge: `weekly_sends / cap` with cap plotted on the 35→100 ramp and a
  one-line reason ("cap at 84 because trailing accept 31%").
- Daily brake: today's connection sends vs the hard `20/day` ceiling.
- Mode badge: Normal · **Warm-only (cold-recovery)** · Cold-paused, driven by
  `warm_only` / `accept_rate < 12%`. In warm-only, show `warm_sends_7d / warm_cap`.
- Headroom: "N left this week / M left today" — the actionable number.

**Rise — client monthly cap:**
- Monthly cap gauge: month-to-date connection sends vs the client's monthly seat cap
  from `integration_config`.
- Accept rate for context, labelled "fixed monthly cap, not adaptive" so no ramp is
  looked for.

---

## 5. Pipeline runway block

**Lanes are per-person.** Ivan and Rise do not share a lane set; the block renders
whichever lanes that account actually has, bucketed into a normalized set. Starting
buckets and their source→lane mapping (to be confirmed per person in the §3.4 verify
task):

| Lane | Maps from (source / signal) |
|---|---|
| **Cold** | `apollo_discovery_*`, `manual_icp_discovery`, cold / `trigger_confidence IS NULL` |
| **Warm / Orbit** | `unipile-orbit-*`, `warm`, `your calendar`, `your assessments`, `trigger_confidence ≥ 3` |
| **Engager** | engagers of *that account's own content* — for a client, ICPs harvested by scraping the client's (e.g. Mattan/Rise) profile + posts; for Ivan, engagers of Ivan's content. Sources like `engager_mining_*`, `like`, `comment`, `client-<id>` |

If an account has a distinct lane that doesn't fit (e.g. Kyle warm/InMail-first), it
surfaces as its own bucket rather than being force-fit.

**Two halves:**
- **Future runway — sendable ICP by lane:** count per lane (using the §3.4 sendable
  filter), plus overall **runway = sendable ÷ current daily send rate ≈ N days left**.
  A starved lane flags amber/red using the same dot language as the Lanes view.
- **Recent sourcing mix:** of connections actually *sent* in the window, the same
  per-lane split — showing what is feeding the pipe vs what is queued.

---

## 6. Auth lockout fix

Root cause: the Supabase client (`src/lib/supabase.ts`) is created with no explicit
persistence config, and installed iOS PWAs get storage evicted / refresh tokens expired
when backgrounded. Three-part fix:

1. **Durable session:** configure `createClient` explicitly (`persistSession: true`,
   `autoRefreshToken: true`, stable `storageKey`) and call `navigator.storage.persist()`
   so the browser stops evicting the token.
2. **Foreground re-validation:** on `visibilitychange` / app resume, call `getSession()`
   and silently refresh if the token is near expiry — reopening refreshes instead of
   dumping to login.
3. **One-tap re-auth:** remember the last email locally and pre-fill it on the login
   screen; offer a **magic link** fallback so re-entry is a single tap rather than
   email-then-code. Note (out of code scope): lengthen the refresh-token expiry in the
   Supabase dashboard project auth settings.

---

## 7. Testing

- Pure functions get unit tests beside existing `src/lib/sends.test.ts` /
  `src/lib/inbox.test.ts`: accept-rate math, governor headroom/mode derivation, lane
  classification, timeframe bucketing, runway (days-left) calc.
- New SQL views (`inbox_accept_v`, `inbox_pipeline_v`, widened `inbox_sends_daily_v`,
  `inbox_governor`, `inbox_scan_opens_v`) ship with documented verification queries under
  `db/`, matching the style of `db/003_sends_views.sql`.
- Screens verified with `scripts/shot.mjs` at mobile + desktop widths.

---

## 8. Build order (for the plan)

1. **Data verification pass** (no UI, via Supabase API / service key): confirm
   `outreach_sender_health` fields, `integration_config` monthly-cap field, live
   `source` values per `client_id`, the pre-contact stage set, and the scan
   `company_slug → client_id` mapping. Adjust §3.3–§3.5 mappings to reality.
2. SQL: widen `inbox_sends_daily_v`; add `inbox_accept_v`, `inbox_pipeline_v`,
   `inbox_governor`, `inbox_scan_opens_v`.
3. Data lib (`src/lib/sends.ts` + new modules): fetchers + pure derivations + tests.
4. UI: Overview blocks (KPI row → Acceptance → Governor → Pipeline → Campaigns),
   timeframe selector, responsive desktop density; keep Lanes + Log intact.
5. Auth lockout fix (`src/lib/supabase.ts`, `App.tsx`, `LoginScreen.tsx`).
6. Screenshot verification + tests green.
