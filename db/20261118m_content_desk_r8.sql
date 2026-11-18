-- Content Desk, Sol desk-backend r7 fixes (2026-11-18).
--
-- 1. A lock wait or deadlock inside an app-RPC block is RE-RAISED (not answered in place), so the
--    function's top-level handler rolls back the WHOLE body before it returns 'changed'. For
--    desk_delete this includes the delete-reason stamp written before the delete (Sol r7 #4).
-- 2. desk_redo_release answers 'busy' (not 'changed') when it cannot get its locks, so the edge
--    function can tell "try again" from "no longer our claim" and retry (Sol r7 #5).
-- Bodies are otherwise those of db/20261118m_content_desk_r7.sql.


create or replace function public.desk_set_date(p_draft uuid, p_expected_updated_at timestamptz,
                                                p_expected_status text, p_at timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
set lock_timeout = '1s'
as $$
declare d public.carousel_drafts; v_rpc jsonb; v_hint text; a public.carousel_drafts;
begin
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or d.updated_at is distinct from p_expected_updated_at
     or d.status is distinct from p_expected_status then
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
end $$;

create or replace function public.desk_set_photos(p_draft uuid, p_expected_updated_at timestamptz,
                                                  p_expected_status text, p_add_url text)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
set lock_timeout = '1s'
as $$
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
end $$;

create or replace function public.desk_pull(p_draft uuid, p_expected_updated_at timestamptz, p_queue_ids uuid[],
                                            p_next_queue uuid, p_next_slot timestamptz, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
set lock_timeout = '1s'
as $$
declare d public.carousel_drafts; v_rpc jsonb; v_hint text;
begin
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or d.updated_at is distinct from p_expected_updated_at or d.status is distinct from 'scheduled' then
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  if public.desk_queue_ids(p_draft) is distinct from coalesce((select array_agg(x order by x) from unnest(p_queue_ids) x), '{}') then
    return jsonb_build_object('ok', false, 'error', 'queue_changed');
  end if;
  if public.desk_posting(p_draft) then return jsonb_build_object('ok', false, 'error', 'posting_now'); end if;
  begin
    if p_next_queue is not null then
      if not exists (select 1 from public.scheduled_posts q where q.id = p_next_queue and q.clickup_task_id = p_draft::text
                        and q.platform = 'linkedin' and q.status = 'pending' and coalesce(q.is_repost, false) = false
                        and q.scheduled_at = p_next_slot) then
        return jsonb_build_object('ok', false, 'error', 'queue_changed');
      end if;
      v_rpc := public.content_next_pull(p_next_queue, p_next_slot, p_reason);
    else
      v_rpc := public.operator_set_schedule_date('clientops', p_draft, null);
    end if;
    if coalesce(v_rpc->>'ok', 'false') <> 'true' then
      return jsonb_build_object('ok', false, 'error', coalesce(v_rpc->>'error', 'refused'));
    end if;
  exception when others then
    if sqlstate in ('55P03', '40P01') then raise; end if;   -- the top-level handler rolls back the whole body
    get stacked diagnostics v_hint = pg_exception_hint;
    return jsonb_build_object('ok', false, 'error', coalesce(nullif(v_hint, ''), 'refused'));
  end;
  return jsonb_build_object('ok', true, 'rpc', v_rpc);
exception when lock_not_available or deadlock_detected then
  -- the desk yields first (1 s); Postgres rolled back everything this call did
  return jsonb_build_object('ok', false, 'error', 'changed');
end $$;

create or replace function public.desk_keep(p_draft uuid, p_expected_updated_at timestamptz, p_expected_status text)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
set lock_timeout = '1s'
as $$
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
end $$;

create or replace function public.desk_delete(p_draft uuid, p_expected_updated_at timestamptz, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
set lock_timeout = '1s'
as $$
declare d public.carousel_drafts; v_tax jsonb; v_reason text := nullif(left(btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g')), 200), '');
begin
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or d.updated_at is distinct from p_expected_updated_at
     or d.status not in ('review', 'error') or d.scheduled_at is not null then
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  if cardinality(public.desk_queue_ids(p_draft)) > 0 then return jsonb_build_object('ok', false, 'error', 'queue_still_live'); end if;
  v_tax := case jsonb_typeof(d.taxonomy)
             when 'object' then d.taxonomy
             when 'string' then case when btrim(d.taxonomy #>> '{}') = '' then '{}'::jsonb
                                     else jsonb_build_object('structure_used', btrim(d.taxonomy #>> '{}')) end
             else '{}'::jsonb end;
  if v_reason is not null then
    v_tax := v_tax || jsonb_build_object('delete_reason', v_reason);
    update public.carousel_drafts set taxonomy = v_tax where id = p_draft;
  end if;
  begin
    delete from public.carousel_drafts where id = p_draft;
    if found then return jsonb_build_object('ok', true, 'outcome', 'deleted'); end if;
  exception when others then
    if sqlstate in ('55P03', '40P01') then raise; end if;   -- the top-level handler rolls back the whole body
    null;   -- the delete and anything it did are rolled back; archive below
  end;
  update public.carousel_drafts
     set status = 'disqualified', taxonomy = v_tax || jsonb_build_object('deleted_by_operator', true, 'deleted_at', now())
   where id = p_draft;
  return jsonb_build_object('ok', true, 'outcome', 'disqualified');
exception when lock_not_available or deadlock_detected then
  -- the desk yields first (1 s); Postgres rolled back everything this call did
  return jsonb_build_object('ok', false, 'error', 'changed');
end $$;

create or replace function public.desk_undo_schedule_v2(p_draft uuid, p_applied timestamptz, p_applied_status text,
                                                        p_applied_updated_at timestamptz, p_prev timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
set lock_timeout = '1s'
as $$
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
end $$;

create or replace function public.desk_undo_photos_v2(p_draft uuid, p_applied text[], p_applied_status text,
                                                      p_applied_updated_at timestamptz, p_prev text[])
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
set lock_timeout = '1s'
as $$
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
end $$;

create or replace function public.desk_redo_release(p_draft uuid, p_started_at text, p_status text)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
set lock_timeout = '1s'
as $$
declare d public.carousel_drafts; v_n int;
begin
  if p_status not in ('review', 'error', 'approved') then return jsonb_build_object('ok', false, 'error', 'bad_status'); end if;
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if d.status is distinct from 'generating' or d.taxonomy->>'generating_started_at' is distinct from p_started_at then
    return jsonb_build_object('ok', false, 'error', 'changed');
  end if;
  update public.carousel_drafts set status = p_status, taxonomy = taxonomy - 'generating_started_at'
   where id = p_draft and status = 'generating' and taxonomy->>'generating_started_at' = p_started_at;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n = 1);
exception when lock_not_available or deadlock_detected then
  return jsonb_build_object('ok', false, 'error', 'busy');
end $$;
