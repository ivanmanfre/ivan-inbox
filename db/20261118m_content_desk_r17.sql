-- Content Desk, Sol desk-backend r16 fixes (2026-11-18), round 17.
--
-- Redo is ONE forward step (r16 C): the dispatch row, its resume and its reconcile are removed. The commit
-- runs the 'generating' claim under the lock (lane, revision, status, source date, no live queue row) and the
-- action stays 'committing'; then the edge calls the writer once:
--   affirmative accept      -> desk_redo_finish(accepted)    -> done
--   timeout / network / 5xx -> desk_redo_finish(unconfirmed) -> 'unconfirmed' (never re-sent, never resumed)
--   4xx                     -> desk_redo_refused: the refusal AND the release in ONE transaction -> failed
-- A row left 'committing' past the 2 minute lease may be claimed again, but the redo claim then finds the
-- draft 'generating' and refuses ('changed'): no second writer job can start.

-- the writer's answer for a held redo: only over this claim, only from 'committing'
create or replace function public.desk_redo_finish(p_action uuid, p_claim uuid, p_outcome text, p_http int)
returns text language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_n int; v_state text;
begin
  if p_outcome not in ('accepted', 'unconfirmed') then return 'bad_outcome'; end if;
  v_state := case p_outcome when 'accepted' then 'done' else 'unconfirmed' end;
  update public.desk_actions
     set result = result || jsonb_build_object('state', v_state, 'writer_http', p_http)
                 || case when v_state = 'done' then jsonb_build_object('committed_at', now()) else '{}'::jsonb end
   where id = p_action and result->>'state' = 'committing' and result->>'claim_token' = p_claim::text;
  get diagnostics v_n = row_count;
  return case when v_n = 1 then v_state else 'lost' end;
end $$;

-- a writer refusal: release the draft (if it is still this claim's 'generating') and record the refusal,
-- in ONE transaction, only over this claim
create or replace function public.desk_redo_refused(p_action uuid, p_claim uuid, p_draft uuid, p_started_at text, p_status text, p_http int)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public set lock_timeout = '1s' as $$
declare d public.carousel_drafts; v_released boolean := false; v_n int;
begin
  if p_status not in ('review', 'error', 'approved') then return jsonb_build_object('ok', false, 'error', 'bad_status'); end if;
  if public.desk_act_as(p_action, p_draft, array['committing'], p_claim) is null then return jsonb_build_object('ok', false, 'error', 'no_action'); end if;
  d := public.desk_lock_draft(p_draft);
  if d.id is not null and d.status = 'generating' and d.taxonomy->>'generating_started_at' = p_started_at then
    update public.carousel_drafts set status = p_status, taxonomy = taxonomy - 'generating_started_at'
     where id = p_draft and status = 'generating' and taxonomy->>'generating_started_at' = p_started_at;
    get diagnostics v_n = row_count;
    v_released := v_n = 1;
  end if;
  update public.desk_actions set result = result || jsonb_build_object('state', 'failed', 'error', 'writer_refused', 'writer_http', p_http, 'released', v_released)
   where id = p_action and result->>'state' = 'committing' and result->>'claim_token' = p_claim::text;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'desk_claim_lost'; end if;
  return jsonb_build_object('ok', true, 'released', v_released);
exception when lock_not_available or deadlock_detected then
  return jsonb_build_object('ok', false, 'error', 'busy');
end $$;

CREATE OR REPLACE FUNCTION public.desk_redo_claim(p_action uuid, p_claim uuid, p_draft uuid, p_expected_updated_at timestamp with time zone, p_expected_status text, p_started_at text, p_expected_scheduled_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
declare d public.carousel_drafts; v_tax jsonb; v_n int;
begin
  if public.desk_act_as(p_action, p_draft, array['committing'], p_claim) is null then return jsonb_build_object('ok', false, 'error', 'no_action'); end if;
  d := public.desk_lock_draft(p_draft);
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p_expected_updated_at is null or d.updated_at is distinct from p_expected_updated_at
     or d.status is distinct from p_expected_status or d.status not in ('review', 'error', 'approved')
     or d.scheduled_at is distinct from p_expected_scheduled_at then
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
  -- the action stays 'committing': done only on the writer's affirmative accept (round 17)
  return jsonb_build_object('ok', true, 'before_status', d.status, 'type', d.type, 'topic', d.topic, 'title', d.title);
exception when lock_not_available or deadlock_detected then
  return jsonb_build_object('ok', false, 'error', 'changed');
end $function$;

-- the dispatch row logic is gone (round 17 C)
drop function if exists public.desk_redo_reconcile(uuid, uuid, uuid);
drop function if exists public.desk_redo_result(uuid, uuid, text, int);
drop function if exists public.desk_redo_send(uuid, uuid);
drop function if exists public.desk_mark_dispatching(uuid, uuid, uuid, text, jsonb);
do $$ begin
  -- the table goes only while empty; a row in it would be kept for inspection, never dropped
  if to_regclass('public.desk_redo_dispatch') is not null and not exists (select 1 from public.desk_redo_dispatch) then
    drop table public.desk_redo_dispatch;
  end if;
end $$;

revoke execute on function public.desk_redo_finish(uuid, uuid, text, int) from public, anon, authenticated;
grant execute on function public.desk_redo_finish(uuid, uuid, text, int) to service_role;
revoke execute on function public.desk_redo_refused(uuid, uuid, uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.desk_redo_refused(uuid, uuid, uuid, text, text, int) to service_role;
