-- Per-campaign send totals for the Overview -> Campaigns block. Replaces the
-- client-side fetchCampaignSends window (src/lib/sends.ts, querying
-- inbox_messages_v ordered by sent_at desc, limit 4000) — PostgREST silently
-- caps that request's response to the newest 1000 rows server-side regardless
-- of the client .limit(), verified live 2026-07-24 for the app's actual authed
-- role (1409 ground-truth rows vs 1000 fetched). That undercounted 12 of 27
-- campaigns, 8 of them down to a hard zero (all paused/inactive verticals —
-- the oldest sends age out of the newest-1000 window first); worst active
-- campaign ("Agency-Focused Consultants & Fractionals") read 199 vs 331 real.
-- See goal-runs/sends-kpi-elevation-2026-07-24/phase1/r2-campaign-counts.md.
--
-- This view computes the phantom-duplicate collapse and the campaign join once,
-- in Postgres, over the full population — PostgREST returns one aggregated row
-- per campaign, not one row per message, so the 1000-row cap can never bite.
-- Joins on campaign_id (never name) — no live collision today, but nothing in
-- the schema enforces name uniqueness, so this removes the dependency entirely.
-- LEFT JOIN from outreach_campaigns so a campaign with zero sends still appears
-- with 0s (needed for "Manufacturing & Industrial Ops" etc., which show 0 today
-- but have 29 real all-time sends aged out of the old window).
-- message_type filter is IDENTICAL to inbox_sends_v (db/003_sends_views.sql):
-- ('connection_note','dm','inmail','email') — this excludes 2 live
-- 'audit_delivery' rows the old client-side fetch had no filter for at all, so
-- "sent" now means the same thing on every KPI surface (e.g. "Warm - Engagement
-- Harvest" expects 62, not the raw 64 that includes the 2 audit rows).
-- Does NOT fix the 14 orphan DM sends (2026-07-17, campaign_id NULL) — they
-- have no campaign to join to by definition; that needs a data backfill or an
-- explicit "Uncategorized" bucket, common to every KPI surface, out of scope here.
-- No explicit grant statement: security_invoker=on views in this repo (005, 006)
-- rely on the same default privileges as inbox_accept_v / inbox_pipeline_v —
-- matching that pattern rather than adding a one-off grant here.
-- Expected values at authoring time (2026-07-24): Agency-Focused Consultants &
-- Fractionals sent_total=331; Warm - Engagement Harvest sent_total=62;
-- Manufacturing & Industrial Ops sent_total=29.
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
