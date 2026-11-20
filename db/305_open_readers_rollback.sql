-- Rollback 305: the live bodies read 2026-11-17 (pg_get_viewdef / pg_get_functiondef). Apply before 304/303 rollbacks.
-- create or replace cannot drop appended columns, so scan_open_stats and inbox_scan_opens_v are dropped and recreated
-- with their live grants (scan_open_stats: service role only; inbox_scan_opens_v: signed-in app + service role, never
-- the public key, as after db/20261115l).
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

drop view if exists public.inbox_scan_opens_v;
create view public.inbox_scan_opens_v with (security_invoker = off) as
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
revoke all on public.inbox_scan_opens_v from anon;
grant select on public.inbox_scan_opens_v to authenticated;
grant all on public.inbox_scan_opens_v to service_role;

-- Trigger function: live body 2026-11-17.
CREATE OR REPLACE FUNCTION public.swishdm_report_open_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_url text; v_secret text; v_tok text; v_pid uuid; v_brand text; v_page_url text; v_name text; v_company text;
        v_sent timestamptz; v_last timestamptz; v_day date; v_where text;
begin
  if new.page is null or new.page !~ '^swishdm/compare/[a-z2-7]{20}$' or not coalesce(new.is_external, false) then return new; end if;
  -- 2026-11-09 (Ivan: "seen report notifs... might be the automated linkedin link checker"): LinkedIn's link scanner runs on
  -- Microsoft networks (Des Moines, 1-5 min after each send; 4 of the 6 alerts ever). Logged, never rings.
  if coalesce(new.org, '') ~* '^microsoft' then return new; end if;
  begin
    v_tok := substring(new.page from '^swishdm/compare/([a-z2-7]{20})$');
    select prospect_id, brand, url into v_pid, v_brand, v_page_url
      from public.swishdm_comparison_pages where token = v_tok and status = 'published' limit 1;
    if v_pid is null then return new; end if;
    select min(m.sent_at) into v_sent from public.outreach_messages m
     where m.prospect_id = v_pid and m.direction = 'outbound' and m.sent_at is not null and m.sent_at <= now()
       and position(v_tok in coalesce(m.message_text, '')) > 0
       and (m.unipile_message_id is not null or m.channel = 'email' or m.message_type = 'email');
    if v_sent is null then return new; end if;
    -- an open within 2 minutes of a delivery of this link is our own preview / Jonathan checking it: logged, no ring
    select max(m.sent_at) into v_last from public.outreach_messages m
     where m.prospect_id = v_pid and m.direction = 'outbound' and m.sent_at is not null and m.sent_at <= now()
       and position(v_tok in coalesce(m.message_text, '')) > 0
       and (m.unipile_message_id is not null or m.channel = 'email' or m.message_type = 'email');
    if v_last > now() - interval '2 minutes' then return new; end if;
    v_day := (now() at time zone 'Europe/London')::date;
    -- claim token+day atomically: a concurrent open of the same page holds the lock and rings; this one stays silent.
    -- After that transaction commits its alerted row, later opens see it below (each plpgsql statement takes a new
    -- snapshot under READ COMMITTED).
    if not pg_try_advisory_xact_lock(hashtextextended('swishdm_report_open:' || v_tok || ':' || v_day::text, 0)) then return new; end if;
    if exists (select 1 from public.page_opens o where o.page = new.page and o.alerted
                and (o.created_at at time zone 'Europe/London')::date = v_day) then return new; end if;
    select value into v_url from public.integration_config where key = 'inbox_notify_url';
    select value into v_secret from public.integration_config where key = 'inbox_push_secret';
    if v_url is null or v_secret is null then return new; end if;
    select name, company into v_name, v_company from public.outreach_prospects where id = v_pid;
    v_where := nullif(concat_ws(', ', new.city, new.country), '');
    perform net.http_post(url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-inbox-secret', v_secret),
      body := jsonb_build_object('family', 'page_open_notice', 'source', 'db:swishdm_report_open',
        'dedupe_key', 'swishdm_report_open:' || v_tok || ':' || v_day::text,
        'severity', 'attention',
        'title', left(format('SwishDM: %s opened their report', coalesce(v_name, 'a prospect')), 200),
        'body', left(format(E'%s (%s) opened the AI search report Jonathan sent on %s.\n%s\nWhere: %s%s\n\nNothing was sent to them. Further opens today are logged without another alert.',
                 coalesce(v_name, '?'), coalesce(v_company, v_brand, '?'), to_char(v_sent at time zone 'Europe/London', 'DD Mon'),
                 coalesce(v_page_url, 'https://madebyswishdm.com/compare/' || v_tok || '/'), coalesce(v_where, 'unknown'),
                 case when new.org is not null then ' (' || new.org || ')' else '' end), 4000),
        'url', './#exp/brain-b/today',
        'media', jsonb_build_object('kind', 'report_open', 'lane', 'swishdm', 'prospect_id', v_pid, 'token', v_tok),
        'push', true),
      timeout_milliseconds := 30000);
    new.alerted := true;
  exception when others then
    raise warning 'swishdm_report_open_notify failed: %', sqlerrm;
  end;
  return new;
end
$function$
;
drop function if exists public.swishdm_report_opened(text, timestamptz);
