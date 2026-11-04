-- Sol r2 fixes (2026-11-05): budget counts attempts (#1), sweep heals a card a late pending notice folded over (#3).
begin;

create or replace function public.swishdm_report_check_claim(p_id uuid)
returns setof public.swishdm_lm_requests
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  -- One claim at a time, so the budget counts cannot race.
  perform pg_advisory_xact_lock(hashtext('swishdm_report_check_claim'));
  if (select count(*) from public.swishdm_lm_requests
       where lead_magnet = 'ai-search-report' and check_state = 'running' and check_started_at > now() - interval '10 minutes') >= 3
     -- every attempt on a row started in the last hour counts (conservative; a retry replaces check_started_at)
     or (select coalesce(sum(check_attempts), 0) from public.swishdm_lm_requests
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
  -- A late "checking" notice can fold over a card that already shows the result (pg_net queue delay): mark
  -- those results unsynced so the card is written again below (Sol r2 #3).
  update public.swishdm_lm_requests q
     set card_synced_at = null
    from public.inbox_notifications n
   where n.dedupe_key = 'swishdm_report_request:' || q.id::text
     and q.lead_magnet = 'ai-search-report' and q.card_synced_at is not null
     and q.created_at > now() - interval '2 days'
     and (q.check_state = 'checked' or (q.check_state = 'unchecked' and q.check_attempts >= 3))
     and n.media->>'check_state' = 'pending';
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
