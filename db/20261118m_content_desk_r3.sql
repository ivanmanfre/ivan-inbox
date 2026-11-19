-- Content Desk, Sol desk-backend r2 fixes (2026-11-18).
--
-- 1) Undo through the app's own RPCs, but only while the value is still the one the desk applied,
--    checked and written in ONE statement under a row lock. SECURITY INVOKER: they run as Ivan's
--    session (the same JWT the app uses), so the app RPCs apply their own checks unchanged.
-- 2) desk_patch_action_echo: update one action echo inside desk_messages.meta atomically.
-- 3) desk_fire_trigger: claim a proactive trigger under the weekly cap AND write its message in
--    one transaction (dedupe + Warsaw-week cap + message). t3_done is counted, never blocked
--    (Ivan asked for that job), and gets no message here (the report RPC already wrote it).

create or replace function public.desk_undo_schedule(p_draft uuid, p_applied timestamptz, p_prev timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare v_cur timestamptz; v_found boolean;
begin
  select true, d.scheduled_at into v_found, v_cur from public.carousel_drafts d
   where d.id = p_draft and d.client_id is null for update;
  if not coalesce(v_found, false) then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if v_cur is distinct from p_applied then return jsonb_build_object('ok', false, 'error', 'changed_since'); end if;
  return public.operator_set_schedule_date('clientops', p_draft, p_prev);
end $$;

create or replace function public.desk_undo_photos(p_draft uuid, p_applied text[], p_prev text[])
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare v_cur text[]; v_found boolean;
begin
  select true, d.image_urls into v_found, v_cur from public.carousel_drafts d
   where d.id = p_draft and d.client_id is null for update;
  if not coalesce(v_found, false) then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if coalesce(v_cur, '{}') is distinct from coalesce(p_applied, '{}') then return jsonb_build_object('ok', false, 'error', 'changed_since'); end if;
  return public.operator_set_draft_photos('clientops', p_draft, coalesce(p_prev, '{}'));
end $$;

revoke all on function public.desk_undo_schedule(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.desk_undo_schedule(uuid, timestamptz, timestamptz) to authenticated;
revoke all on function public.desk_undo_photos(uuid, text[], text[]) from public, anon;
grant execute on function public.desk_undo_photos(uuid, text[], text[]) to authenticated;

create or replace function public.desk_patch_action_echo(p_message uuid, p_action text, p_patch jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.desk_messages m
     set meta = jsonb_set(m.meta, '{actions}', coalesce((
           select jsonb_agg(case when x->>'id' = p_action then x || p_patch else x end order by o)
             from jsonb_array_elements(coalesce(m.meta->'actions', '[]'::jsonb)) with ordinality t(x, o)), '[]'::jsonb)),
         updated_at = now()
   where m.id = p_message
  returning to_jsonb(m.*)
$$;
revoke all on function public.desk_patch_action_echo(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.desk_patch_action_echo(uuid, text, jsonb) to service_role;

create or replace function public.desk_fire_trigger(p_kind text, p_dedupe_key text, p_payload jsonb, p_cap integer,
                                                    p_user uuid, p_body text, p_meta jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_week_start timestamptz := (date_trunc('week', now() at time zone 'Europe/Warsaw')) at time zone 'Europe/Warsaw';
  v_count integer; v_trigger uuid; v_msg uuid;
begin
  perform pg_advisory_xact_lock(hashtext('desk_claim_trigger'));
  if exists (select 1 from public.desk_triggers where dedupe_key = p_dedupe_key) then
    return jsonb_build_object('fired', false, 'why', 'dedupe');
  end if;
  select count(*) into v_count from public.desk_triggers where fired_at >= v_week_start and suppressed is null;
  if p_kind <> 't3_done' and v_count >= greatest(coalesce(p_cap, 5), 0) then
    return jsonb_build_object('fired', false, 'why', 'cap');
  end if;
  insert into public.desk_triggers (kind, dedupe_key, payload)
  values (p_kind, p_dedupe_key, coalesce(p_payload, '{}'::jsonb)) returning id into v_trigger;
  if p_body is not null and p_kind <> 't3_done' then
    insert into public.desk_messages (user_id, role, origin, body, meta)
    values (p_user, 'assistant', 'proactive', p_body, coalesce(p_meta, '{}'::jsonb)) returning id into v_msg;
    update public.desk_triggers set message_id = v_msg where id = v_trigger;
  end if;
  return jsonb_build_object('fired', true, 'trigger_id', v_trigger, 'message_id', v_msg);
end $$;
revoke all on function public.desk_fire_trigger(text, text, jsonb, integer, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.desk_fire_trigger(text, text, jsonb, integer, uuid, text, jsonb) to service_role;
