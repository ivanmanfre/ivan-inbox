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

-- Task 6. Every page_opens row is labelled at insert (all pages, so shared pages are labelled too), and only a
-- 'human' SwishDM report open can ring. Started from the live body (defs.txt 2026-11-17); changes: the class step at
-- the top (above the page-shape guard) and the removal of the "org ~* '^microsoft'" line, which the class replaces.
-- A failure in the class step leaves the row unlabelled and silent; the insert always goes through.
create or replace function public.swishdm_report_open_notify()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
declare v_url text; v_secret text; v_tok text; v_pid uuid; v_brand text; v_page_url text; v_name text; v_company text;
        v_sent timestamptz; v_last timestamptz; v_day date; v_where text; v_fleet boolean;
begin
  begin
    -- page fleet: this (org, city) already opened 2+ OTHER pages in the last 90 days (3+ counting this row)
    v_fleet := new.org is not null and (
      select count(distinct o.page) from public.page_opens o
       where o.org = new.org and o.city is not distinct from new.city
         and o.created_at >= now() - interval '90 days' and o.page <> new.page) >= 2;
    select k.open_class, k.class_reason into new.open_class, new.class_reason
      from public.page_open_classify(new.is_external, new.org, new.user_agent, v_fleet) k;
    new.classified_at := now();
  exception when others then
    raise warning 'swishdm_report_open_notify classify failed: %', sqlerrm;
    new.open_class := null; new.class_reason := null; new.classified_at := null;
    return new;
  end;
  if new.page is null or new.page !~ '^swishdm/compare/[a-z2-7]{20}$' or not coalesce(new.is_external, false) then return new; end if;
  -- 2026-11-17: the class replaces the 11-09 Microsoft line. Scanner, own tool and owner rows are logged, never ring.
  if new.open_class is distinct from 'human' then return new; end if;
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
$function$;
revoke all on function public.swishdm_report_open_notify() from public, anon, authenticated;
grant execute on function public.swishdm_report_open_notify() to service_role;
drop trigger if exists swishdm_report_open_notify on public.page_opens;
create trigger swishdm_report_open_notify before insert on public.page_opens
  for each row execute function public.swishdm_report_open_notify();

-- Read by the SwishDM nudge drafter (jtsk91O6gXkUoj1C) in place of its two page_opens reads.
create or replace function public.swishdm_report_opened(p_token text, p_since timestamptz)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.page_opens o
                  where o.page = 'swishdm/compare/' || p_token and o.open_class = 'human' and o.created_at >= p_since)
$$;
revoke all on function public.swishdm_report_opened(text, timestamptz) from public, anon, authenticated;
grant execute on function public.swishdm_report_opened(text, timestamptz) to service_role;
