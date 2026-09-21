-- Run 5 additive: terminal reconciliation for a dispatched editorial native draft.
-- db/107 claims a native object and dispatches it; nothing in the schema could
-- settle that dispatch. Without this, a claimed row can only be read as claimed
-- or forced to 'complete' by a blind update, and the QA-selected final copy never
-- reaches the native row under an identity check.
--
-- Rules enforced here, not in the caller:
--   * an already-failed dispatch is retained as failed; a corrected final never
--     overwrites a failed original
--   * a replay of an identical completed request writes nothing and reports
--     idempotent_replay
--   * a completed row whose stored copy differs from the submitted final copy is
--     a conflict, never an overwrite
--   * no release side effect: board_visible, scheduled_at, published_at and
--     approved state are untouched by this function
create or replace function public.editorial_complete_native_draft(
  p_gate text, p_client_id text, p_artifact_id text, p_request_id text,
  p_expected_hash text, p_final_copy text, p_assessment_id text, p_qa jsonb)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $function$
declare v_row public.editorial_native_draft_dispatches%rowtype;
  v_format text; v_stored text; v_stored_assessment text;
begin
  perform public.editorial_guard(p_gate,p_client_id);
  if nullif(btrim(coalesce(p_final_copy,'')),'') is null then
    raise exception 'no QA-selected final copy to persist'; end if;
  if nullif(btrim(coalesce(p_assessment_id,'')),'') is null then
    raise exception 'final copy needs its QA assessment identity'; end if;
  select * into v_row from public.editorial_native_draft_dispatches
    where artifact_id=p_artifact_id for update;
  if not found then raise exception 'no claimed native dispatch for this artifact'; end if;
  if v_row.client_id<>p_client_id or v_row.request_id<>p_request_id
    or v_row.brief_hash is distinct from p_expected_hash then
    raise exception 'native dispatch identity conflict'; end if;

  select payload#>>'{editorial_direction,format}' into v_format
    from public.editorial_brief_versions
    where client_id=v_row.client_id and brief_id=v_row.brief_id and version=v_row.brief_version;

  if v_row.dispatch_state='failed' then
    return jsonb_build_object('artifact_id',p_artifact_id,'native_draft_id',v_row.native_draft_id,
      'dispatch_state','failed','persisted',false,'decision','failed_original_retained',
      'last_error',v_row.last_error);
  end if;

  if v_format='video' then
    select script, editorial_qa#>>'{assessment_id}' into v_stored, v_stored_assessment
      from public.video_ideas where id=v_row.native_draft_id;
  elsif v_format in ('resource','lm_promo') then
    select post_body, qa#>>'{assessment_id}' into v_stored, v_stored_assessment
      from public.lm_drafts_v2 where id=v_row.native_draft_id;
  else
    select post_body, qa#>>'{assessment_id}' into v_stored, v_stored_assessment
      from public.carousel_drafts where id=v_row.native_draft_id;
  end if;

  if v_row.dispatch_state='complete' then
    if v_stored is not distinct from p_final_copy
      and v_stored_assessment is not distinct from p_assessment_id then
      return jsonb_build_object('artifact_id',p_artifact_id,'native_draft_id',v_row.native_draft_id,
        'dispatch_state','complete','persisted',false,'decision','idempotent_replay');
    end if;
    return jsonb_build_object('artifact_id',p_artifact_id,'native_draft_id',v_row.native_draft_id,
      'dispatch_state','complete','persisted',false,'decision','persisted_copy_conflict');
  end if;

  if v_format='video' then
    update public.video_ideas set script=p_final_copy,
      editorial_qa=coalesce(p_qa,'{}'::jsonb)||jsonb_build_object('assessment_id',p_assessment_id)
      where id=v_row.native_draft_id;
  elsif v_format in ('resource','lm_promo') then
    update public.lm_drafts_v2 set post_body=p_final_copy,
      qa=coalesce(p_qa,'{}'::jsonb)||jsonb_build_object('assessment_id',p_assessment_id)
      where id=v_row.native_draft_id;
  else
    update public.carousel_drafts set post_body=p_final_copy,
      qa=coalesce(p_qa,'{}'::jsonb)||jsonb_build_object('assessment_id',p_assessment_id)
      where id=v_row.native_draft_id;
  end if;

  update public.editorial_native_draft_dispatches
    set dispatch_state='complete', completed_at=now(), last_error=null
    where artifact_id=p_artifact_id;

  return jsonb_build_object('artifact_id',p_artifact_id,'native_draft_id',v_row.native_draft_id,
    'dispatch_state','complete','persisted',true,'decision','persist_final');
end;$function$;

revoke all on function public.editorial_complete_native_draft(text,text,text,text,text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.editorial_complete_native_draft(text,text,text,text,text,text,text,jsonb)
  to service_role;
