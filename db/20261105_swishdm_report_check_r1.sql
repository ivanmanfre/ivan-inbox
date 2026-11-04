-- Sol r1 fixes (2026-11-05). Applied live after 20261105_swishdm_report_check.sql + _test_guard.sql.
--  #1 model calls have a hard shared budget inside the claim (one lock, max 3 running, max 40 started per hour);
--     the trigger posts nothing past 60 requests an hour.
--  #5 claim returns the attempt number the worker must hold to save or release.
--  #6 a run that dies on its last attempt is closed as unchecked by the sweep.
--  #7/#8 the card is its own step (card_synced_at); the sweep retries unsynced results without a model call.
begin;

alter table public.swishdm_lm_requests add column if not exists card_synced_at timestamptz;

create or replace function public.swishdm_report_check_claim(p_id uuid)
returns setof public.swishdm_lm_requests
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  -- One claim at a time, so the budget counts cannot race.
  perform pg_advisory_xact_lock(hashtext('swishdm_report_check_claim'));
  if (select count(*) from public.swishdm_lm_requests
       where lead_magnet = 'ai-search-report' and check_state = 'running' and check_started_at > now() - interval '10 minutes') >= 3
     or (select count(*) from public.swishdm_lm_requests
       where lead_magnet = 'ai-search-report' and check_started_at > now() - interval '1 hour') >= 40 then
    return;   -- over budget: the row keeps its state and the sweep offers it again later
  end if;
  return query
  update public.swishdm_lm_requests
     set check_state = 'running', check_attempts = check_attempts + 1, check_started_at = now()
   where id = p_id and lead_magnet = 'ai-search-report' and check_attempts < 3
     and (check_state = 'pending'
          or (check_state = 'unchecked' and coalesce(check_started_at, created_at) < now() - interval '5 minutes')
          or (check_state = 'running' and check_started_at < now() - interval '10 minutes'))
  returning *;
end $$;
revoke all on function public.swishdm_report_check_claim(uuid) from public, anon, authenticated;
grant execute on function public.swishdm_report_check_claim(uuid) to service_role;

create or replace function public.swishdm_report_request_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_url text; v_secret text; v_band text; v_urg text; v_recent int; v_hour int; v_body text; v_check text;
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
    -- Hard cap (Sol r1 #1): past 60 requests in an hour the row is kept but nothing is posted at all. The sweep
    -- checks it later at its own fixed pace and raises a silent card for it, so a flood cannot fan out HTTP calls.
    select count(*) into v_hour from public.swishdm_lm_requests
      where lead_magnet = 'ai-search-report' and created_at > now() - interval '1 hour';
    if v_hour > 60 then return new; end if;
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

create or replace function public.swishdm_report_check_sweep()
returns int language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare v_url text; v_secret text; r record; n int := 0;
begin
  v_url := public.swishdm_report_check_url();
  select value into v_secret from public.integration_config where key = 'inbox_push_secret';
  if v_url is null or v_secret is null then return 0; end if;
  -- A run that died on its last attempt: close it as unchecked; the card is synced below on a later tick.
  update public.swishdm_lm_requests
     set check_state = 'unchecked', checked_at = now(), card_synced_at = null,
         brand_check = coalesce(brand_check, '{}'::jsonb) || jsonb_build_object('note', 'the check stopped before it finished, 3 tries used')
   where lead_magnet = 'ai-search-report' and check_state = 'running' and check_attempts >= 3
     and check_started_at < now() - interval '10 minutes';
  for r in
    select id from public.swishdm_lm_requests
     where lead_magnet = 'ai-search-report' and created_at > now() - interval '2 days'
       and ((check_attempts < 3 and (
              (check_state = 'pending' and created_at < now() - interval '3 minutes')
              or (check_state = 'unchecked' and coalesce(check_started_at, created_at) < now() - interval '8 minutes')
              or (check_state = 'running' and check_started_at < now() - interval '10 minutes')))
         -- a finished result whose card write has not landed: synced without a model call
         or ((check_state = 'checked' or (check_state = 'unchecked' and check_attempts >= 3))
              and card_synced_at is null and checked_at < now() - interval '3 minutes'))
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

commit;
