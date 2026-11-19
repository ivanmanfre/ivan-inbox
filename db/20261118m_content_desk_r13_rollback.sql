-- Rollback for 20261118m_content_desk_r13.sql: drop the new functions and signatures, restore the r12/r11/r7 bodies (snapshot 20261118m_r13_pre.json).
drop function if exists public.desk_undo_date_v3(uuid, jsonb, jsonb);
drop function if exists public.desk_undo_photos_v3(uuid, jsonb, jsonb);
drop function if exists public.desk_claim_commit(uuid, uuid);
drop function if exists public.desk_set_photos(uuid, timestamptz, text, text, timestamptz);
drop function if exists public.desk_approve(uuid, timestamptz, text, timestamptz);
drop function if exists public.desk_keep(uuid, timestamptz, text, timestamptz);
drop function if exists public.desk_redo_claim(uuid, timestamptz, text, text, timestamptz);
drop function if exists public.desk_set_date(uuid, timestamptz, text, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.desk_approve(p_draft uuid, p_expected_updated_at timestamp with time zone, p_expected_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_n int;
begin
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or d.updated_at is distinct from p_expected_updated_at
     or d.status is distinct from p_expected_status or d.status not in ('review', 'error') then
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  if public.desk_posting(p_draft) then return jsonb_build_object('ok', false, 'error', 'posting_now'); end if;
  update public.carousel_drafts set status = 'approved'
   where id = p_draft and client_id is null and status = p_expected_status and updated_at = p_expected_updated_at;
  get diagnostics v_n = row_count;
  if v_n <> 1 then return jsonb_build_object('ok', false, 'error', 'changed'); end if;
  return jsonb_build_object('ok', true, 'approved', p_draft);
exception when lock_not_available or deadlock_detected then
  -- the desk yields first (1 s); Postgres rolled back everything this call did
  return jsonb_build_object('ok', false, 'error', 'changed');
end $function$;

CREATE OR REPLACE FUNCTION public.desk_keep(p_draft uuid, p_expected_updated_at timestamp with time zone, p_expected_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_rpc jsonb; v_hint text;
begin
  d := public.desk_lock_draft(p_draft, true);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or d.updated_at is distinct from p_expected_updated_at
     or d.status is distinct from p_expected_status or d.status not in ('review', 'error') then
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  if public.desk_posting(p_draft) then return jsonb_build_object('ok', false, 'error', 'posting_now'); end if;
  begin
    v_rpc := public.cb39_verdict_set(p_draft, 'keep', '{}'::text[], null, null, null);
  exception when others then
    if sqlstate in ('55P03', '40P01') then raise; end if;   -- the top-level handler rolls back the whole body
    get stacked diagnostics v_hint = pg_exception_hint;
    return jsonb_build_object('ok', false, 'error', coalesce(nullif(v_hint, ''), 'refused'));
  end;
  return jsonb_build_object('ok', true, 'rpc', v_rpc);
exception when lock_not_available or deadlock_detected then
  -- the desk yields first (1 s); Postgres rolled back everything this call did
  return jsonb_build_object('ok', false, 'error', 'changed');
end $function$;

CREATE OR REPLACE FUNCTION public.desk_live_drafts(p_fixtures boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'status', d.status, 'type', d.type, 'scheduled_at', d.scheduled_at, 'published_at', d.published_at,
           'body_head', left(coalesce(d.post_body, ''), 1200), 'updated_at', d.updated_at, 'created_at', d.created_at,
           'fixture', d.taxonomy->>'desk_eval_fixture') order by d.id), '[]'::jsonb)
    from public.carousel_drafts d
   where d.client_id is null
     and (d.status in ('review', 'approved', 'error', 'generating', 'scheduled')
          or (d.status = 'published' and d.published_at > now() - interval '31 days'))
     and ((d.taxonomy->>'desk_eval_fixture') is not null) = coalesce(p_fixtures, false)
     and (d.status not in ('review', 'approved', 'error', 'generating')
          or (d.taxonomy->>'desk_eval_fixture') is not null
          or exists (select 1 from public.cb34_p2_safe_drafts v where v.id = d.id))
$function$;

CREATE OR REPLACE FUNCTION public.desk_redo_claim(p_draft uuid, p_expected_updated_at timestamp with time zone, p_expected_status text, p_started_at text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_tax jsonb; v_n int;
begin
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or d.updated_at is distinct from p_expected_updated_at
     or d.status is distinct from p_expected_status or d.status not in ('review', 'error', 'approved') then
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  if cardinality(public.desk_queue_ids(p_draft)) > 0 then return jsonb_build_object('ok', false, 'error', 'queue_still_live'); end if;
  if coalesce(d.taxonomy->>'human_edited', '') = 'true' then return jsonb_build_object('ok', false, 'error', 'human_edited'); end if;
  v_tax := case jsonb_typeof(d.taxonomy)
             when 'object' then d.taxonomy
             when 'string' then case when btrim(d.taxonomy #>> '{}') = '' then '{}'::jsonb
                                     else jsonb_build_object('structure_used', btrim(d.taxonomy #>> '{}')) end
             else '{}'::jsonb end;
  update public.carousel_drafts set status = 'generating', taxonomy = v_tax || jsonb_build_object('generating_started_at', p_started_at)
   where id = p_draft and client_id is null and status = p_expected_status and updated_at = p_expected_updated_at;
  get diagnostics v_n = row_count;
  if v_n <> 1 then return jsonb_build_object('ok', false, 'error', 'changed'); end if;
  return jsonb_build_object('ok', true, 'before_status', d.status, 'type', d.type, 'topic', d.topic, 'title', d.title);
exception when lock_not_available or deadlock_detected then
  return jsonb_build_object('ok', false, 'error', 'changed');
end $function$;

CREATE OR REPLACE FUNCTION public.desk_set_date(p_draft uuid, p_expected_updated_at timestamp with time zone, p_expected_status text, p_at timestamp with time zone, p_expected_scheduled_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_rpc jsonb; v_hint text; a public.carousel_drafts;
begin
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or d.updated_at is distinct from p_expected_updated_at
     or d.status is distinct from p_expected_status
     or d.scheduled_at is distinct from p_expected_scheduled_at then   -- the source date the card showed (round 12)
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  if public.desk_posting(p_draft) then return jsonb_build_object('ok', false, 'error', 'posting_now'); end if;
  -- removing the date from a scheduled post is a pull (desk_pull), never this path
  if p_at is null and d.status = 'scheduled' then return jsonb_build_object('ok', false, 'error', 'bad_status'); end if;
  begin
    v_rpc := public.operator_set_schedule_date('clientops', p_draft, p_at);
    if coalesce(v_rpc->>'ok', 'false') <> 'true' then
      return jsonb_build_object('ok', false, 'error', coalesce(v_rpc->>'error', 'refused'));
    end if;
  exception when others then
    if sqlstate in ('55P03', '40P01') then raise; end if;   -- the top-level handler rolls back the whole body
    get stacked diagnostics v_hint = pg_exception_hint;
    return jsonb_build_object('ok', false, 'error', coalesce(nullif(v_hint, ''), 'refused'));
  end;
  select * into a from public.carousel_drafts where id = p_draft;
  return jsonb_build_object('ok', true, 'before', d.scheduled_at, 'applied', a.scheduled_at, 'applied_status', a.status,
                            'applied_updated_at', a.updated_at, 'rpc', v_rpc);
exception when lock_not_available or deadlock_detected then
  -- the desk yields first (1 s); Postgres rolled back everything this call did
  return jsonb_build_object('ok', false, 'error', 'changed');
end $function$;

CREATE OR REPLACE FUNCTION public.desk_set_photos(p_draft uuid, p_expected_updated_at timestamp with time zone, p_expected_status text, p_add_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_rpc jsonb; v_hint text; a public.carousel_drafts; v_before text[];
begin
  if p_add_url is null or p_add_url = '' then return jsonb_build_object('ok', false, 'error', 'bad_url'); end if;
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or d.updated_at is distinct from p_expected_updated_at
     or d.status is distinct from p_expected_status then
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  if public.desk_posting(p_draft) then return jsonb_build_object('ok', false, 'error', 'posting_now'); end if;
  v_before := coalesce(d.image_urls, '{}');
  begin
    v_rpc := public.operator_set_draft_photos('clientops', p_draft, v_before || p_add_url);
    if coalesce(v_rpc->>'ok', 'false') <> 'true' then
      return jsonb_build_object('ok', false, 'error', coalesce(v_rpc->>'error', 'refused'));
    end if;
  exception when others then
    if sqlstate in ('55P03', '40P01') then raise; end if;   -- the top-level handler rolls back the whole body
    get stacked diagnostics v_hint = pg_exception_hint;
    return jsonb_build_object('ok', false, 'error', coalesce(nullif(v_hint, ''), 'refused'));
  end;
  select * into a from public.carousel_drafts where id = p_draft;
  return jsonb_build_object('ok', true, 'before', to_jsonb(v_before), 'applied', to_jsonb(coalesce(a.image_urls, '{}')),
                            'applied_status', a.status, 'applied_updated_at', a.updated_at, 'rpc', v_rpc);
exception when lock_not_available or deadlock_detected then
  -- the desk yields first (1 s); Postgres rolled back everything this call did
  return jsonb_build_object('ok', false, 'error', 'changed');
end $function$;

CREATE OR REPLACE FUNCTION public.desk_undo_photos_v2(p_draft uuid, p_applied text[], p_applied_status text, p_applied_updated_at timestamp with time zone, p_prev text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_rpc jsonb; v_hint text;
begin
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if coalesce(d.image_urls, '{}') is distinct from coalesce(p_applied, '{}') or d.status is distinct from p_applied_status
     or d.updated_at is distinct from p_applied_updated_at then
    return jsonb_build_object('ok', false, 'error', 'changed_since');
  end if;
  if public.desk_posting(p_draft) then return jsonb_build_object('ok', false, 'error', 'changed_since'); end if;
  begin
    v_rpc := public.operator_set_draft_photos('clientops', p_draft, coalesce(p_prev, '{}'));
  exception when others then
    if sqlstate in ('55P03', '40P01') then raise; end if;   -- the top-level handler rolls back the whole body
    get stacked diagnostics v_hint = pg_exception_hint;
    return jsonb_build_object('ok', false, 'error', coalesce(nullif(v_hint, ''), 'undo_failed'));
  end;
  return v_rpc;
exception when lock_not_available or deadlock_detected then
  -- the desk yields first (1 s); Postgres rolled back everything this call did
  return jsonb_build_object('ok', false, 'error', 'changed_since');
end $function$;

CREATE OR REPLACE FUNCTION public.desk_undo_schedule_v2(p_draft uuid, p_applied timestamp with time zone, p_applied_status text, p_applied_updated_at timestamp with time zone, p_prev timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_rpc jsonb; v_hint text;
begin
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if d.scheduled_at is distinct from p_applied or d.status is distinct from p_applied_status or d.updated_at is distinct from p_applied_updated_at then
    return jsonb_build_object('ok', false, 'error', 'changed_since');
  end if;
  if public.desk_posting(p_draft) then return jsonb_build_object('ok', false, 'error', 'changed_since'); end if;
  begin
    v_rpc := public.operator_set_schedule_date('clientops', p_draft, p_prev);
  exception when others then
    if sqlstate in ('55P03', '40P01') then raise; end if;   -- the top-level handler rolls back the whole body
    get stacked diagnostics v_hint = pg_exception_hint;
    return jsonb_build_object('ok', false, 'error', coalesce(nullif(v_hint, ''), 'undo_failed'));
  end;
  return v_rpc;
exception when lock_not_available or deadlock_detected then
  -- the desk yields first (1 s); Postgres rolled back everything this call did
  return jsonb_build_object('ok', false, 'error', 'changed_since');
end $function$;

drop function if exists public.desk_date_image(uuid);
drop function if exists public.desk_photo_image(uuid);
grant execute on function public.desk_set_photos(uuid, timestamptz, text, text) to authenticated;
grant execute on function public.desk_approve(uuid, timestamptz, text) to authenticated;
grant execute on function public.desk_keep(uuid, timestamptz, text) to authenticated;
grant execute on function public.desk_redo_claim(uuid, timestamptz, text, text) to authenticated;
grant execute on function public.desk_set_date(uuid, timestamptz, text, timestamptz, timestamptz) to authenticated;
