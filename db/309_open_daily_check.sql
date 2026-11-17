-- 309 open tracking truth, part 7: a daily check that the classifier still tells the truth. Plan Task 10.
-- Reads the last 24 hours (and the 14 days before, for the "usually" figure). Posts ONE feed alert when a check fails.
-- Limits come from the 2026-11-17 read: scanner after 88% of LinkedIn link sends; 1 fast bare desktop human in 7 weeks.

create or replace function public.open_tracking_daily_check()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_unclassified int; v_sends int; v_covered int; v_base_sends int; v_base_covered int; v_fast int;
  v_new_fleet int; v_fleet_names text; v_rows int; v_failed int;
  v_checks jsonb := '[]'::jsonb; v_lines text[] := '{}'; v_url text; v_secret text; v_alerted boolean := false;
begin
  -- 1. every open older than 15 minutes carries a class
  select count(*) into v_unclassified from public.scan_opens
   where opened_at > now() - interval '24 hours' and opened_at <= now() - interval '15 minutes' and open_class is null;

  -- 2. the link checker still shows up after LinkedIn link sends (one row per link message)
  with sends as (
    select m.sent_at, coalesce(lower(substring(m.message_text from '/scan/([A-Za-z0-9_-]+)')),
                               'arch-' || lower(substring(m.message_text from 'madebyarch\.com/([A-Za-z0-9_-]+-audit)'))) as slug
      from public.outreach_messages m
     where m.direction = 'outbound' and m.sent_at is not null and coalesce(m.channel, 'linkedin') <> 'email'
       and m.sent_at > now() - interval '15 days' and m.sent_at <= now() - interval '15 minutes'
       and m.message_text ~ '(/scan/[A-Za-z0-9_-]+|madebyarch\.com/[A-Za-z0-9_-]+-audit)'),
  s as (
    select sends.sent_at > now() - interval '24 hours' - interval '15 minutes' as recent,
           exists (select 1 from public.scan_opens o
                    where lower(o.company_slug) = sends.slug and o.open_class = 'link_scanner'
                      and o.opened_at between sends.sent_at and sends.sent_at + interval '15 minutes') as covered
      from sends)
  select count(*) filter (where recent), count(*) filter (where recent and covered),
         count(*) filter (where not recent), count(*) filter (where not recent and covered)
    into v_sends, v_covered, v_base_sends, v_base_covered from s;

  -- 3. people who look like the checker: desktop, no referrer, inside 5 minutes of a LinkedIn link send
  select count(*) into v_fast from public.scan_opens o
   where o.opened_at > now() - interval '24 hours' and o.open_class = 'human' and o.device_type = 'desktop'
     and nullif(o.referrer_host, '') is null
     and exists (select 1 from public.outreach_messages m
                  where m.direction = 'outbound' and m.sent_at is not null and coalesce(m.channel, 'linkedin') <> 'email'
                    and m.sent_at between o.opened_at - interval '5 minutes' and o.opened_at
                    and lower(m.message_text) ~ ('/scan/' || regexp_replace(lower(o.company_slug), '([^a-z0-9_-])', '\\\1', 'g') || '([^a-z0-9_-]|$)'));

  -- 4. a hash that reached 3 distinct scans in the last day on a network we do not know
  with h as (
    select o.ip_hash,
           count(distinct lower(o.company_slug)) filter (where o.opened_at > now() - interval '90 days') as slugs_now,
           count(distinct lower(o.company_slug)) filter (where o.opened_at > now() - interval '90 days' and o.opened_at <= now() - interval '24 hours') as slugs_before
      from public.scan_opens o
     where o.ip_hash is not null and o.is_owner = false
       and o.ip_hash in (select ip_hash from public.scan_opens where opened_at > now() - interval '24 hours' and ip_hash is not null)
     group by o.ip_hash),
  f as (
    select h.ip_hash, n.asn, coalesce(n.org, 'unknown network') as org
      from h left join public.open_networks n on n.ip_hash = h.ip_hash
     where h.slugs_now >= 3 and h.slugs_before < 3
       and (n.asn is null or n.asn not in (select asn from public.open_known_networks)))
  select count(*), string_agg(distinct org || coalesce(' (AS' || asn || ')', ''), ', ') into v_new_fleet, v_fleet_names from f;

  -- 5. the network lookup still works (owners are never looked up, so they do not count)
  select count(*), count(*) filter (where net_org is null) into v_rows, v_failed from public.scan_opens
   where opened_at > now() - interval '24 hours' and ip_hash is not null and is_owner = false;

  v_checks := jsonb_build_array(
    jsonb_build_object('name', 'unclassified', 'value', v_unclassified, 'limit', 0, 'ok', v_unclassified = 0),
    jsonb_build_object('name', 'scanner_coverage', 'value', case when v_sends > 0 then round(100.0 * v_covered / v_sends) else null end,
                       'limit', 50, 'ok', v_sends < 8 or v_covered * 2 >= v_sends),
    jsonb_build_object('name', 'fast_bare_desktop_humans', 'value', v_fast, 'limit', 2, 'ok', v_fast < 3),
    jsonb_build_object('name', 'new_fleet_hash', 'value', v_new_fleet, 'limit', 0, 'ok', v_new_fleet = 0),
    jsonb_build_object('name', 'lookup_failures', 'value', case when v_rows > 0 then round(100.0 * v_failed / v_rows) else null end,
                       'limit', 30, 'ok', v_rows < 10 or v_failed * 10 <= v_rows * 3));

  if v_unclassified > 0 then
    v_lines := v_lines || format('%s scan opens from the last day still have no label after 15 minutes. The scan-open function or scan_open_finalize may be failing.', v_unclassified);
  end if;
  if not (v_sends < 8 or v_covered * 2 >= v_sends) then
    v_lines := v_lines || format('Scanner seen after %s of %s LinkedIn link sends yesterday (usually about %s in 10). Opens may be counting the link checker as people.',
      v_covered, v_sends, case when v_base_sends > 0 then round(10.0 * v_base_covered / v_base_sends)::text else '9' end);
  end if;
  if v_fast >= 3 then
    v_lines := v_lines || format('%s desktop opens with no referrer came in within 5 minutes of a LinkedIn link send and were counted as people (usually about 1 in 7 weeks). The link checker may be on a new network.', v_fast);
  end if;
  if v_new_fleet > 0 then
    v_lines := v_lines || format('An address on a network we do not know opened 3 or more different scans in a day: %s. A burst inside 10 minutes is already left out of the counts; a slower spread still counts as people. Read the rows.', v_fleet_names);
  end if;
  if not (v_rows < 10 or v_failed * 10 <= v_rows * 3) then
    v_lines := v_lines || format('The network lookup failed on %s of %s opens yesterday. New opens are labelled without their network.', v_failed, v_rows);
  end if;

  if array_length(v_lines, 1) > 0 then
    select value into v_url from public.integration_config where key = 'inbox_notify_url';
    select value into v_secret from public.integration_config where key = 'inbox_push_secret';
    if v_url is not null and v_secret is not null then
      perform net.http_post(url := v_url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-inbox-secret', v_secret),
        body := jsonb_build_object('family', 'system_infra_alarm', 'source', 'db:open_tracking_check',
          'dedupe_key', 'open_tracking_check:' || current_date::text,
          'severity', 'attention',
          'title', 'Open tracking needs a look',
          'body', left(array_to_string(v_lines, E'\n'), 4000)),
        timeout_milliseconds := 30000);
      v_alerted := true;
    end if;
  end if;
  return jsonb_build_object('checks', v_checks, 'alerted', v_alerted);
end $$;
revoke all on function public.open_tracking_daily_check() from public, anon, authenticated;
grant execute on function public.open_tracking_daily_check() to service_role;

select cron.schedule('open-tracking-daily-check', '50 7 * * *', 'select public.open_tracking_daily_check()');
