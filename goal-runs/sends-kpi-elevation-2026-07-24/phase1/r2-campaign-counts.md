# F2 — Campaigns block counts sends inside a recent window, not all-time

Read-only audit against live Supabase (`bjbvqvzbzczjbatgmccb`), 2026-07-24. All numbers below are from live
queries executed during this run (see raw curl/python transcript summarized inline); re-run to reconfirm if
sends continue to accrue.

## 1. Live measurement — the truncation is real, and worse than the code comment describes

`src/lib/sends.ts` `fetchCampaignSends` (:180-218) requests
`.order('sent_at', { ascending: false }).limit(4000)` against `inbox_messages_v`.

- `outreach_messages` total outbound rows with `sent_at is not null`: **1423** (`content-range: 0-0/1423`, exact
  count via `Prefer: count=exact`).
- `inbox_messages_v` (same filter): **1408–1409** (moved by 1 between queries as new sends landed live). The gap
  vs. 1423 is the inner-join drop — see §3.
- **The `.limit(4000)` request is silently capped to 1000 rows by PostgREST's server-side max-rows setting.**
  Verified directly: `Range: 0-3999` on the identical query returns `content-range: 0-999/1409` — i.e. Supabase
  is handing back only the newest **1000** rows no matter what limit the client code asks for. This is a bigger
  defect than "4000-row window truncates all-time counts eventually" — it is truncating **today**, live, by
  ~29% of all-time volume (409 of 1409 rows dropped every single load).
- The suspected phantom-duplicate burst ("~587 identical rows eating the window", per the `003_sends_views.sql`
  comment) is **not present in current data**: deduping the full 1423-row pull by `(prospect_id, message_text,
  sent_at)` removes **0** rows. Either that historical burst was already cleaned out of `outreach_messages`, or
  it never existed among *sent* (non-blocked) rows. It is not contributing to today's undercount — the 1000-row
  server cap is doing all of the damage on its own.

## 2. Ground truth vs. current-UI reality (live diff)

Ground truth = full 1423-row pull of `outreach_messages` (`direction=outbound`, `sent_at not null`), paginated
1000/page, joined in Python to `outreach_prospects` (1118 distinct referenced prospects, fetched in 200-id
batches) and all 27 `outreach_campaigns` rows, deduped by `(prospect_id, message_text, sent_at)` (0 dupes found),
grouped by `campaign_id`.

"Current UI" = the *actual* row set the app receives today: `inbox_messages_v`, `direction=outbound`,
`sent_at not null`, `order sent_at.desc`, capped at 1000 by the server (replicated exactly, not simulated),
same client-side dedup + group-by-`campaign_name` as the real `fetchCampaignSends`.

| Campaign | Client | Active | Current UI | Ground truth | Delta |
|---|---|---|---:|---:|---:|
| Agency-Focused Consultants & Fractionals | ivan | true | 199 | 331 | **-132** |
| Warm - Kyle Engagers | ivan | true | 156 | 156 | 0 |
| Accounting & Tax Advisory Firms | ivan | false | 85 | 153 | **-68** |
| Agency Owners & Ops Leaders | ivan | true | 123 | 123 | 0 |
| Warm - LM Anchor Engagers | ivan | true | 89 | 89 | 0 |
| Research Firms & Insights Practices | ivan | false | 49 | 80 | **-31** |
| Warm - Engagement Harvest | ivan | true | 64 | 64 | 0 |
| Warm - Hiring Signal | ivan | false | 64 | 64 | 0 |
| Coaches & Advisors (Boutique Practices) | ivan | false | 44 | 51 | **-7** |
| Consultancies & Strategy Firms | ivan | false | 21 | 42 | **-21** |
| RiseDTC — Cold (DTC Sales Nav) | risedtc | true | 42 | 42 | 0 |
| Marketing & Creative Agencies | ivan | false | 30 | 41 | **-11** |
| RiseDTC — Client Orbit (clients' networks) | risedtc | true | 32 | 33 | **-1** |
| Manufacturing & Industrial Ops | ivan | false | 0 | 29 | **-29 (shows ZERO)** |
| Real Estate Brokerages | ivan | false | 0 | 26 | **-26 (shows ZERO)** |
| Property Management Companies | ivan | false | 0 | 24 | **-24 (shows ZERO)** |
| Construction & Trades | ivan | false | 0 | 24 | **-24 (shows ZERO)** |
| Staffing & Recruiting Firms | ivan | false | 0 | 21 | **-21 (shows ZERO)** |
| Architecture & Interior Design Firms | ivan | false | 0 | 12 | **-12 (shows ZERO)** |
| Law Firms (Boutique) | ivan | false | 0 | 2 | **-2 (shows ZERO)** |
| RiseDTC — Network Activation (ICP connections) | risedtc | false | 2 | 2 | 0 |
| Email Lane — Agencies (Cold) | ivan | false | 0 | 0 | 0 |
| Profile View — Ivan | ivan | true | 0 | 0 | 0 |
| RiseDTC — Warm (his engagers) | risedtc | true | 0 | 0 | 0 |
| Creative & Brand Agencies | ivan | false | 0 | 0 | 0 |
| RiseDTC — Profile View | risedtc | true | 0 | 0 | 0 |
| Paid-Media & Performance Agencies | ivan | false | 0 | 0 | 0 |

**Totals: current-UI sum = 1000, ground-truth sum = 1409 (delta reconciles exactly to the 409-row server cap —
no double-counting or off-by-one drift).**

12 of 27 campaigns are misreported; 8 of those show a hard **zero** for campaigns that actually sent 2–29
messages all-time (all are paused/inactive verticals — the oldest sends age out of the newest-1000 window
first). The 6 still-active campaigns among the misreported set are undercounted 1–132 sends, worst being
"Agency-Focused Consultants & Fractionals" at -132 (331 real vs. 199 shown, a 40% undercount on the
highest-volume active campaign).

## 3. Other defects found

**Uncounted sends (missing campaign attribution):** 14 deduped sends (all `message_type='dm'`, all sent on
2026-07-17 between 19:06–19:20 UTC) belong to prospects whose `outreach_prospects.campaign_id` is **NULL**.
These are dropped by the `INNER JOIN outreach_campaigns` in `inbox_messages_v` (`db/001_inbox.sql:14-15`) and
by every dependent view (`inbox_sends_v`, `inbox_accept_v`, `inbox_pipeline_v`, `inbox_governor()`) — not just
the Campaigns block. They vanish from every KPI surface, silently, with no error. Sample prospect_ids:
`3b32cc9c-a533-4fc8-8a30-892181f6d6ae`, `b4ec14f2-15f0-4103-91c3-471d3bbf4b53`,
`f1a8088d-bcd1-40ba-9b4e-0fb3feddf456` (full list of 14 in run transcript).

There were **zero** prospects referencing a `campaign_id` that no longer exists in `outreach_campaigns`
(`missing_campaign_row = 0`) — the only attribution gap is the NULL-campaign_id case above.

**Campaign name collisions:** none. All 27 `outreach_campaigns.name` values are unique — the name-based
join in `fetchCampaignSends` (:209-216) is not currently at risk of cross-client collision, but it is a latent
landmine: nothing in the schema enforces name uniqueness, and the fix below removes the dependency on it
entirely by joining on `campaign_id`.

**Scope drift vs. sibling views:** `fetchCampaignSends`'s message query has no `message_type` filter, while
`inbox_sends_v`/`inbox_sends_daily_v`/`inbox_accept_v` all restrict to
`message_type in ('connection_note','dm','inmail','email')`. Live data has 2 rows with
`message_type = 'audit_delivery'` that the other KPI views exclude but the Campaigns block would silently
include. Minor today (2 rows) but worth aligning so "sent" means the same thing everywhere.

## 4. Recommended fix

Replace the 1000-row-capped client-side fetch+dedup+join with a server-side view, matching the pattern and
`security_invoker=on` style already established in `db/003_sends_views.sql` / `db/005_kpi_accept.sql`. This
computes the phantom-duplicate `distinct on` collapse and the campaign join once, in Postgres, over the full
population — no row cap possible since PostgREST returns one aggregated row per campaign, not one row per
message.

```sql
-- db/009_kpi_campaigns.sql
-- Per-campaign send totals for the Overview -> Campaigns block. Replaces the
-- client-side fetchCampaignSends window (inbox_messages_v, capped by
-- PostgREST's server max-rows to the newest 1000 sent messages — verified live
-- 2026-07-24 to undercount 12 of 27 campaigns, 8 of them down to a hard zero).
-- Joins on campaign_id (not name) so a future name collision can never
-- misattribute sends. Same distinct-on phantom-duplicate collapse as
-- inbox_sends_v; message_type restricted to the same 4 real send channels so
-- "sent" means the same thing across every KPI surface.
create or replace view inbox_campaign_sends_v with (security_invoker = on) as
with dedup as (
  select distinct on (m.prospect_id, m.message_text, m.sent_at)
    p.campaign_id, m.sent_at
  from outreach_messages m
  join outreach_prospects p on p.id = m.prospect_id
  where m.direction = 'outbound'
    and m.sent_at is not null
    and m.message_type in ('connection_note', 'dm', 'inmail', 'email')
  order by m.prospect_id, m.message_text, m.sent_at, m.id
)
select
  c.id as campaign_id,
  c.name as campaign_name,
  coalesce(c.client_id, 'ivan') as client_id,
  c.is_active,
  count(d.sent_at) as sent_total,
  count(d.sent_at) filter (where d.sent_at >= now() - interval '7 days')  as sent_7d,
  count(d.sent_at) filter (where d.sent_at >= now() - interval '30 days') as sent_30d,
  max(d.sent_at) as last_sent
from outreach_campaigns c
left join dedup d on d.campaign_id = c.id
group by c.id, c.name, c.client_id, c.is_active;
```

Note: this view does not solve the 14 NULL-`campaign_id` orphan sends (they have no campaign to join to, by
definition) — that needs a data fix (backfill `campaign_id` on those 14 prospects, or accept an explicit
"Uncategorized" bucket) rather than a view change, and is common to every KPI surface, not just Campaigns.

**`sends.ts` change sketch** — replace `fetchCampaignSends` (:180-218) with a straight `select *` off the new
view, dropping the two round trips, the 4000-row fetch, and the client-side dedup/group/join entirely:

```ts
export async function fetchCampaignSends(
  client: 'all' | 'ivan' | 'risedtc',
): Promise<CampaignSend[]> {
  let q = supabase.from('inbox_campaign_sends_v').select('*')
  if (client !== 'all') q = q.eq('client_id', client)
  const { data, error } = await q
  if (error) throw error
  type Row = { campaign_id: string; campaign_name: string; client_id: string; is_active: boolean; sent_total: number }
  return ((data ?? []) as Row[])
    .map(r => ({ campaign_id: r.campaign_id, campaign_name: r.campaign_name, is_active: r.is_active, sent: r.sent_total }))
    .sort((a, b) => b.sent - a.sent)
}
```

`CampaignSend` type is unchanged; callers (`Block 5 Campaigns`) need no changes. `sent_7d`/`sent_30d`/`last_sent`
are exposed by the view for a possible Phase-2 UX upgrade (recency badge) but are not required to fix F2.
