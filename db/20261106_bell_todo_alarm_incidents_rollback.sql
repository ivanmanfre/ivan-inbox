-- Rollback for db/20261106_bell_todo_alarm_incidents.sql: the live claim function as it was before
-- (dumped 2026-11-06 from pg_get_functiondef), then the new triggers, functions and index dropped.
-- Rows the new code closed stay closed; db/20261106_bell_todo_cleanup_undo.sql reopens the one-time cleanup.
CREATE OR REPLACE FUNCTION public.claim_inbox_workflow_notification(p_alert jsonb)
 RETURNS TABLE(id uuid, created boolean, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_key text := nullif(p_alert->>'incident_key', '');
  v_family text := p_alert->>'family';
  v_now timestamptz := clock_timestamp();
  v_previous public.inbox_notifications%rowtype;
  v_id uuid;
  v_expires timestamptz;
  v_text text := coalesce(p_alert->>'title', '') || ' ' || coalesce(p_alert->>'body', '');
  v_name text;
  v_quiet boolean := false;
begin
  if v_key is null or length(v_key) > 1000 then raise exception 'incident_key required'; end if;
  if v_family not in ('system_infra_alarm','send_failed_alert','lane_supply_alarm') then
    raise exception 'family is not a transient workflow alert';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));

  -- A recipient LinkedIn will not deliver to (blocked us, cannot receive messages) is not a failure (Ivan 10-21).
  if v_family = 'send_failed_alert' then
    v_name := nullif(btrim(substring(v_text from ' to (.+?)\. Row reset')), '');
    v_quiet := public.is_unreachable_recipient_reason(v_text)
      or (v_name is not null and v_text ~ '\m422\M' and exists (
        select 1
          from public.outreach_messages m
          join public.outreach_prospects p on p.id = m.prospect_id
         where m.direction = 'outbound' and m.sent_at is null
           and m.send_blocked_at > v_now - interval '30 minutes'
           and lower(btrim(p.name)) = lower(v_name)
           and (public.is_unreachable_recipient_reason(m.send_blocked_reason)
             or exists (select 1 from public.outreach_message_revisions r
                         where r.message_id = m.id and public.is_unreachable_recipient_reason(r.old_send_blocked_reason)))));
  end if;

  select * into v_previous from public.inbox_notifications n
   where n.incident_key = v_key order by n.last_seen_at desc, n.created_at desc limit 1 for update;
  if found and v_previous.last_seen_at > v_now - interval '24 hours' then
    update public.inbox_notifications n
       set last_seen_at = v_now, count = n.count + 1,
           dismissed_at = case when v_quiet then coalesce(n.dismissed_at, v_now) else n.dismissed_at end
     where n.id = v_previous.id;
    return query select v_previous.id, false, v_previous.expires_at;
    return;
  end if;

  insert into public.inbox_notifications
    (family, source, dedupe_key, incident_key, severity, title, body, url, media, group_key, tenant,
     first_seen_at, last_seen_at, created_at, expires_at, read_at, dismissed_at)
  values
    (v_family, p_alert->>'source', p_alert->>'dedupe_key', v_key,
     coalesce(p_alert->>'severity','info'), p_alert->>'title', p_alert->>'body',
     p_alert->>'url', p_alert->'media', p_alert->>'group_key', p_alert->>'tenant',
     v_now, v_now, v_now, v_now + interval '4 hours',
     case when v_quiet then v_now end, case when v_quiet then v_now end)
  returning inbox_notifications.id, inbox_notifications.expires_at into v_id, v_expires;
  -- Recorded, never rung: created=false keeps notify.ts from pushing it.
  return query select v_id, not v_quiet, v_expires;
end; $function$;

revoke all on function public.claim_inbox_workflow_notification(jsonb) from public, anon, authenticated;
grant execute on function public.claim_inbox_workflow_notification(jsonb) to service_role;

drop trigger if exists inbox_notifications_shape on public.inbox_notifications;
drop trigger if exists inbox_draft_notice_close_upd on public.outreach_messages;
drop trigger if exists inbox_draft_notice_close_del on public.outreach_messages;
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('inbox-draft-notice-sweep', 'inbox-watchdog-incident-close');
  end if;
end $$;
drop function if exists public.inbox_notifications_shape();
drop function if exists public.inbox_draft_notice_close_trg();
drop function if exists public.inbox_sweep_draft_notices();
drop function if exists public.inbox_close_draft_notices(uuid);
drop function if exists public.inbox_close_quiet_watchdog_incidents();
drop function if exists public.inbox_draft_notice_prospect(text, timestamptz);
drop function if exists public.inbox_inbound_notice_prospect(text, timestamptz);
drop function if exists public.inbox_prospect_has_waiting_draft(uuid);
drop function if exists public.inbox_watchdog_check_key(text, text);
drop function if exists public.inbox_lane_alarm_key(text, text, text, text);
drop function if exists public.inbox_lane_incident_key(text, text, text);
drop function if exists public.inbox_severity_rank(text);
drop index if exists public.inbox_notifications_draft_prospect;
drop index if exists public.outreach_prospects_name_norm;
