-- 305 open tracking truth, part 3: readers count people. Plan Tasks 5 and 6. Requires 303 + 304 (rows labelled).
-- Rollback: db/305_open_readers_rollback.sql (live bodies as of 2026-11-17).

-- Task 5. Same four columns, same names and types; "real" now means open_class = 'human'. Two columns appended.
create or replace view public.scan_open_stats as
 select company_slug,
    count(*) filter (where open_class = 'human') as real_opens,
    count(*) as total_opens,
    max(opened_at) filter (where open_class = 'human') as last_real_open,
    count(distinct date_trunc('day'::text, opened_at)) filter (where open_class = 'human') as real_open_days,
    count(*) filter (where open_class = 'link_scanner') as scanner_opens,
    count(*) filter (where open_class = 'own_tool') as own_tool_opens
   from public.scan_opens
  group by company_slug;

-- Same six columns; the inner filter becomes open_class = 'human' (was is_owner = false).
create or replace view public.inbox_scan_opens_v with (security_invoker = off) as
 with j as (
         select so.opened_at,
            so.company_slug,
            coalesce(c.client_id,
                case
                    when (sc.wordmark = 'RISE DTC'::text) then 'risedtc'::text
                    else null::text
                end,
                case
                    when (so.company_slug ~~ 'arch-%'::text) then 'arch'::text
                    else null::text
                end, 'ivan'::text) as client_id
           from (((public.scan_opens so
             left join ( select distinct on (scans.company_slug) scans.company_slug,
                    scans.prospect_token,
                    (((scans.report_json -> 'dtc'::text) -> 'brand'::text) ->> 'wordmark'::text) as wordmark
                   from public.scans
                  order by scans.company_slug, scans.prospect_token) sc on ((sc.company_slug = so.company_slug)))
             left join public.outreach_prospects pr on (((pr.id)::text = sc.prospect_token)))
             left join public.outreach_campaigns c on ((c.id = pr.campaign_id)))
          where (so.open_class = 'human'::text)
        )
 select client_id,
    count(*) filter (where (opened_at >= (now() - '7 days'::interval))) as opens_7d,
    count(*) filter (where (opened_at >= (now() - '30 days'::interval))) as opens_30d,
    count(*) as opens_total,
    count(distinct company_slug) as distinct_prospects,
    max(opened_at) as last_open
   from j
  group by client_id;
