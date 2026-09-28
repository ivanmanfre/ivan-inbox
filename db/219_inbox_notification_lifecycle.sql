-- Four-hour visibility for important workflow alerts. Rows remain as incident history.
alter table public.inbox_notifications add column if not exists expires_at timestamptz;
alter table public.inbox_notifications add column if not exists incident_key text;

update public.inbox_notifications
   set expires_at = created_at + interval '4 hours'
 where family in ('system_infra_alarm', 'send_failed_alert', 'lane_supply_alarm')
   and expires_at is null;

create index if not exists inbox_notifications_incident_claim
  on public.inbox_notifications (incident_key, last_seen_at desc)
  where incident_key is not null;
create index if not exists inbox_notifications_expiry
  on public.inbox_notifications (expires_at)
  where expires_at is not null and dismissed_at is null;

create or replace view public.inbox_notifications_v with (security_invoker = on) as
  select id, family, source, dedupe_key, severity, title, body, url, media, group_key, tenant,
         count, first_seen_at, last_seen_at, created_at, read_at, dismissed_at, pushed_at,
         expires_at, incident_key
    from public.inbox_notifications;
revoke all on public.inbox_notifications_v from anon, authenticated;
grant select on public.inbox_notifications_v to authenticated;

-- A transaction lock covers the no-row case. The WHERE is exact even when two
-- unrelated keys hash to the same advisory lock; a collision only waits longer.
create or replace function public.claim_inbox_workflow_notification(p_alert jsonb)
returns table(id uuid, created boolean, expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_key text := nullif(p_alert->>'incident_key', '');
  v_family text := p_alert->>'family';
  v_now timestamptz := clock_timestamp();
  v_previous public.inbox_notifications%rowtype;
  v_id uuid;
  v_expires timestamptz;
begin
  if v_key is null or length(v_key) > 1000 then raise exception 'incident_key required'; end if;
  if v_family not in ('system_infra_alarm','send_failed_alert','lane_supply_alarm') then
    raise exception 'family is not a transient workflow alert';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));

  select * into v_previous from public.inbox_notifications n
   where n.incident_key = v_key order by n.last_seen_at desc, n.created_at desc limit 1 for update;
  if found and v_previous.last_seen_at > v_now - interval '24 hours' then
    update public.inbox_notifications n
       set last_seen_at = v_now, count = n.count + 1
     where n.id = v_previous.id;
    return query select v_previous.id, false, v_previous.expires_at;
    return;
  end if;

  insert into public.inbox_notifications
    (family, source, dedupe_key, incident_key, severity, title, body, url, media, group_key, tenant,
     first_seen_at, last_seen_at, created_at, expires_at)
  values
    (v_family, p_alert->>'source', p_alert->>'dedupe_key', v_key,
     coalesce(p_alert->>'severity','info'), p_alert->>'title', p_alert->>'body',
     p_alert->>'url', p_alert->'media', p_alert->>'group_key', p_alert->>'tenant',
     v_now, v_now, v_now, v_now + interval '4 hours')
  returning inbox_notifications.id, inbox_notifications.expires_at into v_id, v_expires;
  return query select v_id, true, v_expires;
end; $$;

revoke all on function public.claim_inbox_workflow_notification(jsonb) from public, anon, authenticated;
grant execute on function public.claim_inbox_workflow_notification(jsonb) to service_role;
