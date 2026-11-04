-- SwishDM AI search report requests (madebyswishdm.com/ai-search-report/): urgency question + automatic brand check.
-- Builds on ~/.claude/backups/swishdm-ai-search-report-2026-11-05/mig.sql (sales_band, page_url, qualifies, notify trigger).
-- Rollback: db/20261105_swishdm_report_check_rollback.sql
begin;

-- 1. Urgency (the form asks "When do you want this sorted?"). Anon may insert it, nothing else new.
alter table public.swishdm_lm_requests
  add column if not exists urgency text,
  add column if not exists check_state text,
  add column if not exists check_attempts int not null default 0,
  add column if not exists check_started_at timestamptz,
  add column if not exists checked_at timestamptz,
  add column if not exists brand_check jsonb,
  add column if not exists fit text,
  add column if not exists fit_why text;

alter table public.swishdm_lm_requests
  add constraint swishdm_lm_requests_urgency_check
    check (urgency is null or urgency in ('this_month', 'next_3_months', 'just_curious')),
  add constraint swishdm_lm_requests_check_state_check
    check (check_state is null or check_state in ('pending', 'running', 'checked', 'unchecked')),
  add constraint swishdm_lm_requests_fit_check
    check (fit is null or fit in ('yes', 'maybe', 'no')),
  add constraint swishdm_lm_requests_fit_why_check
    check (fit_why is null or char_length(fit_why) <= 400);

grant insert (urgency) on public.swishdm_lm_requests to anon;

-- 2. Every new report request starts 'pending'. The check columns are never anon's to set (no column grant),
--    and this also clears them on insert in case a future grant widens.
create or replace function public.swishdm_report_request_prep()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $$
begin
  new.check_state := 'pending';
  new.check_attempts := 0;
  new.check_started_at := null;
  new.checked_at := null;
  new.brand_check := null;
  new.fit := null;
  new.fit_why := null;
  return new;
end $$;
revoke all on function public.swishdm_report_request_prep() from public, anon, authenticated;

create trigger swishdm_report_request_prep
  before insert on public.swishdm_lm_requests
  for each row when (new.lead_magnet = 'ai-search-report')
  execute function public.swishdm_report_request_prep();

-- 3. The check's own URL: the inbox-notify URL's sibling.
create or replace function public.swishdm_report_check_url()
returns text language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select regexp_replace(value, '/inbox-notify/?$', '/swishdm-report-check')
    from public.integration_config where key = 'inbox_notify_url' and value ~ '/inbox-notify/?$'
$$;
revoke all on function public.swishdm_report_check_url() from public, anon, authenticated;

-- 4. The insert card (unchanged in shape) now names the urgency, and the same trigger starts the check.
create or replace function public.swishdm_report_request_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_url text; v_secret text; v_band text; v_urg text; v_recent int; v_body text; v_check text;
begin
  begin
    select value into v_url from public.integration_config where key = 'inbox_notify_url';
    select value into v_secret from public.integration_config where key = 'inbox_push_secret';
    if v_url is null or v_secret is null then return new; end if;
    v_band := case new.sales_band
      when 'under_500k' then 'Under $500k' when '500k_1m' then '$500k to $1M'
      when '1m_5m' then '$1M to $5M' when '5m_plus' then '$5M+' else coalesce(new.sales_band, '?') end;
    v_urg := case new.urgency
      when 'this_month' then 'This month' when 'next_3_months' then 'In the next 3 months'
      when 'just_curious' then 'Just curious' else 'not given' end;
    -- Test requests (reserved test email domains, column is_test) land feed-only and never buzz the phone.
    -- Flood guard: the form is public, so past 10 requests in 10 minutes the cards still land but stop buzzing.
    select count(*) into v_recent from public.swishdm_lm_requests
      where lead_magnet = 'ai-search-report' and created_at > now() - interval '10 minutes';
    v_body := format(E'Brand check: running, the fit read lands on this card in about a minute.\nUrgency: %s\nYearly online sales (they said): %s\nQualifies: %s\nStore: %s\nEmail: %s\nName: %s\nProduct page: %s\n\nNothing was sent to them.\nRequest: select * from swishdm_lm_requests where id = ''%s''',
      v_urg, v_band,
      case when new.qualifies then 'yes, $1M+ (the page promised a report, a person checks it before it goes out)'
           else 'no, under $1M (the page showed the thank-you and the free AI view guide)' end,
      new.product_url, new.email, new.name, coalesce(new.page_url, 'not given'), new.id);
    perform net.http_post(url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-inbox-secret', v_secret),
      body := jsonb_build_object('family', 'lead_request_notice', 'source', 'db:swishdm_report_request',
        'dedupe_key', 'swishdm_report_request:' || new.id::text,
        'severity', case when new.qualifies then 'attention' else 'info' end,
        'title', left(format('SwishDM report request: %s, %s (%s, %s), checking', new.name, new.brand, v_band, lower(v_urg)), 200),
        'body', left(v_body, 4000), 'url', './#exp/brain-b/today',
        'media', jsonb_build_object('kind', 'lead_request', 'lane', 'swishdm', 'request_id', new.id,
                   'qualifies', new.qualifies, 'sales_band', new.sales_band, 'urgency', new.urgency, 'check_state', 'pending'),
        'push', v_recent <= 10 and not coalesce(new.is_test, false)),
      timeout_milliseconds := 30000);
    -- The brand check. Past the flood guard it waits for the sweep, so a burst cannot fan out model calls.
    v_check := public.swishdm_report_check_url();
    if v_check is not null and v_recent <= 10 then
      perform net.http_post(url := v_check,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-inbox-secret', v_secret),
        body := jsonb_build_object('request_id', new.id),
        timeout_milliseconds := 30000);
    end if;
  exception when others then
    raise warning 'swishdm_report_request_notify failed: %', sqlerrm;
  end;
  return new;
end
$function$;
revoke all on function public.swishdm_report_request_notify() from public, anon, authenticated;

-- 5. Claim one request for a check run (service role only). A run that died on 'running' is reclaimable after 10 min.
create or replace function public.swishdm_report_check_claim(p_id uuid)
returns setof public.swishdm_lm_requests
language sql security definer set search_path to 'public', 'pg_temp' as $$
  update public.swishdm_lm_requests
     set check_state = 'running', check_attempts = check_attempts + 1, check_started_at = now()
   where id = p_id and lead_magnet = 'ai-search-report' and check_attempts < 3
     and (check_state in ('pending', 'unchecked')
          or (check_state = 'running' and check_started_at < now() - interval '10 minutes'))
  returning *
$$;
revoke all on function public.swishdm_report_check_claim(uuid) from public, anon, authenticated;
grant execute on function public.swishdm_report_check_claim(uuid) to service_role;

-- 6. Retry sweep: unchecked or stuck requests from the last 2 days, at most 3 tries each, at most 5 per tick.
create or replace function public.swishdm_report_check_sweep()
returns int language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare v_url text; v_secret text; r record; n int := 0;
begin
  v_url := public.swishdm_report_check_url();
  select value into v_secret from public.integration_config where key = 'inbox_push_secret';
  if v_url is null or v_secret is null then return 0; end if;
  for r in
    select id from public.swishdm_lm_requests
     where lead_magnet = 'ai-search-report' and check_attempts < 3 and created_at > now() - interval '2 days'
       and ((check_state = 'pending' and created_at < now() - interval '3 minutes')
            or (check_state = 'unchecked' and coalesce(check_started_at, created_at) < now() - interval '8 minutes')
            or (check_state = 'running' and check_started_at < now() - interval '10 minutes'))
     order by created_at limit 5
  loop
    perform net.http_post(url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-inbox-secret', v_secret),
      body := jsonb_build_object('request_id', r.id), timeout_milliseconds := 30000);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.swishdm_report_check_sweep() from public, anon, authenticated;

select cron.schedule('swishdm-report-check-sweep', '4-59/10 * * * *', 'select public.swishdm_report_check_sweep()');

commit;
