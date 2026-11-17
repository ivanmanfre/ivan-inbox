-- Rollback 305: the live bodies read 2026-11-17 (pg_get_viewdef / pg_get_functiondef). Apply before 304/303 rollbacks.
-- create or replace cannot drop the two appended columns of scan_open_stats, so that view is dropped and recreated with its grants.
drop view if exists public.scan_open_stats;
create view public.scan_open_stats as
 SELECT company_slug,
    count(*) FILTER (WHERE (NOT is_owner)) AS real_opens,
    count(*) AS total_opens,
    max(opened_at) FILTER (WHERE (NOT is_owner)) AS last_real_open,
    count(DISTINCT date_trunc('day'::text, opened_at)) FILTER (WHERE (NOT is_owner)) AS real_open_days
   FROM scan_opens
  GROUP BY company_slug;
revoke all on public.scan_open_stats from anon, authenticated;
grant all on public.scan_open_stats to service_role;

create or replace view public.inbox_scan_opens_v with (security_invoker = off) as
 WITH j AS (
         SELECT so.opened_at,
            so.company_slug,
            COALESCE(c.client_id,
                CASE
                    WHEN (sc.wordmark = 'RISE DTC'::text) THEN 'risedtc'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN (so.company_slug ~~ 'arch-%'::text) THEN 'arch'::text
                    ELSE NULL::text
                END, 'ivan'::text) AS client_id
           FROM (((scan_opens so
             LEFT JOIN ( SELECT DISTINCT ON (scans.company_slug) scans.company_slug,
                    scans.prospect_token,
                    (((scans.report_json -> 'dtc'::text) -> 'brand'::text) ->> 'wordmark'::text) AS wordmark
                   FROM scans
                  ORDER BY scans.company_slug, scans.prospect_token) sc ON ((sc.company_slug = so.company_slug)))
             LEFT JOIN outreach_prospects pr ON (((pr.id)::text = sc.prospect_token)))
             LEFT JOIN outreach_campaigns c ON ((c.id = pr.campaign_id)))
          WHERE (so.is_owner = false)
        )
 SELECT client_id,
    count(*) FILTER (WHERE (opened_at >= (now() - '7 days'::interval))) AS opens_7d,
    count(*) FILTER (WHERE (opened_at >= (now() - '30 days'::interval))) AS opens_30d,
    count(*) AS opens_total,
    count(DISTINCT company_slug) AS distinct_prospects,
    max(opened_at) AS last_open
   FROM j
  GROUP BY client_id;
