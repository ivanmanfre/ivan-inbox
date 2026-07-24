-- Real (non-owner) scan-report opens per client. Definer rights so it reads the
-- service-role-only scan_opens under RLS, exposing only aggregates (mirrors
-- scan_open_stats). Self-clicks already excluded by is_owner + owner_ips.
-- Join (see db/NOTES-kpi-verification.md SLUG_JOIN): there is no scan_slug column.
--   scan_opens.company_slug -> scans.company_slug -> scans.prospect_token
--   -> outreach_prospects.id -> campaign_id -> outreach_campaigns.client_id.
-- Most scans are inbound with a null prospect_token, so LEFT joins + coalesce
-- attribute token-less/inbound opens to 'ivan' (the repo default-client convention).
create or replace view inbox_scan_opens_v with (security_invoker = off) as
with j as (
  select so.opened_at, so.company_slug,
         coalesce(c.client_id,'ivan') as client_id
  from scan_opens so
  left join scans sc             on sc.company_slug = so.company_slug
  left join outreach_prospects pr on pr.id = sc.prospect_token
  left join outreach_campaigns  c  on c.id = pr.campaign_id
  where so.is_owner = false
)
select client_id,
  count(*) filter (where opened_at >= now() - interval '7 days')  as opens_7d,
  count(*) filter (where opened_at >= now() - interval '30 days') as opens_30d,
  count(*)                                                        as opens_total,
  count(distinct company_slug)                                    as distinct_prospects,
  max(opened_at)                                                  as last_open
from j group by client_id;

grant select on inbox_scan_opens_v to anon, authenticated;
