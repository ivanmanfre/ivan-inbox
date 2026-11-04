-- Rollback for db/20261105_swishdm_report_check.sql: restores the 11-05 notify function, drops the check pieces.
-- Test requests (is_test) still never push after a rollback.
-- The added columns are kept (dropping them would delete check results); drop them by hand if wanted.
begin;
select cron.unschedule('swishdm-report-check-sweep');
drop trigger if exists swishdm_report_request_prep on public.swishdm_lm_requests;
alter table public.swishdm_lm_requests drop constraint if exists swishdm_lm_requests_report_urgency_required;
revoke insert (urgency) on public.swishdm_lm_requests from anon;
CREATE OR REPLACE FUNCTION public.swishdm_report_request_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_url text; v_secret text; v_band text; v_recent int; v_body text;
begin
  begin
    select value into v_url from public.integration_config where key = 'inbox_notify_url';
    select value into v_secret from public.integration_config where key = 'inbox_push_secret';
    if v_url is null or v_secret is null then return new; end if;
    v_band := case new.sales_band
      when 'under_500k' then 'Under $500k' when '500k_1m' then '$500k to $1M'
      when '1m_5m' then '$1M to $5M' when '5m_plus' then '$5M+' else coalesce(new.sales_band, '?') end;
    -- Flood guard: the form is public, so past 10 requests in 10 minutes the cards still land but stop buzzing.
    select count(*) into v_recent from public.swishdm_lm_requests
      where lead_magnet = 'ai-search-report' and created_at > now() - interval '10 minutes';
    v_body := format(E'Name: %s\nBrand: %s\nStore: %s\nProduct page: %s\nYearly online sales: %s\nQualifies: %s\nEmail: %s\n\n%s',
      new.name, new.brand, new.product_url, coalesce(new.page_url, 'not given'), v_band,
      case when new.qualifies then 'yes, build the report (a person checks it before it goes out)'
           else 'no, under $1M (the page showed the thank-you and the free AI view guide)' end,
      new.email,
      'Requests: select * from swishdm_lm_requests where lead_magnet = ''ai-search-report'' and status = ''new''');
    perform net.http_post(url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-inbox-secret', v_secret),
      body := jsonb_build_object('family', 'lead_request_notice', 'source', 'db:swishdm_report_request',
        'dedupe_key', 'swishdm_report_request:' || new.id::text,
        'severity', case when new.qualifies then 'attention' else 'info' end,
        'title', left(format('SwishDM report request: %s, %s (%s)%s', new.name, new.brand, v_band,
                   case when new.qualifies then ', qualifies' else ', under $1M' end), 200),
        'body', left(v_body, 4000), 'url', './#exp/brain-b/today',
        'media', jsonb_build_object('kind', 'lead_request', 'lane', 'swishdm', 'request_id', new.id,
                   'qualifies', new.qualifies, 'sales_band', new.sales_band),
        'push', v_recent <= 10 and not coalesce(new.is_test, false)),
      timeout_milliseconds := 30000);
  exception when others then
    raise warning 'swishdm_report_request_notify failed: %', sqlerrm;
  end;
  return new;
end
$function$;
revoke all on function public.swishdm_report_request_notify() from public, anon, authenticated;
commit;
