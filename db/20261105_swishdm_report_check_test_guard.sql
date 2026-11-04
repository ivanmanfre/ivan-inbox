-- Test guard (Ivan 2026-11-05: test requests rang his phone). A request whose email is on a reserved test domain
-- (RFC 2606/6761: example.com/.net/.org, *.test, *.example, *.invalid, *.localhost) is a test: its card lands
-- feed-only and never pushes. Generated, so the public form cannot set or clear it.
-- Rollback: db/20261105_swishdm_report_check_rollback.sql (the column stays; drop it by hand if wanted).
begin;
alter table public.swishdm_lm_requests
  add column if not exists is_test boolean generated always as (
    lower(split_part(email, '@', 2)) ~ '(^|\.)(example\.(com|net|org)|[a-z0-9-]+\.(test|example|invalid|localhost)|test|example|invalid|localhost)$'
  ) stored;

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
commit;
