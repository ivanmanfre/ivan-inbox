-- Run 7 additive: make QA acceptance an enforced persistence precondition.
-- Every attempted final is retained for diagnosis, while only an externally
-- evidenced accepted review of the exact submitted bytes may complete a dispatch.
create table if not exists public.editorial_native_draft_qa_attempts (
  attempt_id bigint generated always as identity primary key,
  client_id text not null,
  artifact_id text not null references public.editorial_native_draft_dispatches(artifact_id),
  native_draft_id uuid not null,
  assessment_id text not null,
  candidate_copy text not null,
  candidate_copy_sha256 text not null,
  verdict text,
  reviewed_copy_sha256 text,
  reviewer_response_id text,
  reviewer_provenance text,
  accepted boolean not null,
  rejection_reason text,
  qa jsonb not null,
  attempted_at timestamptz not null default now()
);
alter table public.editorial_native_draft_qa_attempts enable row level security;
revoke all on public.editorial_native_draft_qa_attempts from public,anon,authenticated;
grant select,insert on public.editorial_native_draft_qa_attempts to service_role;

create or replace function public.editorial_complete_native_draft(
  p_gate text, p_client_id text, p_artifact_id text, p_request_id text,
  p_expected_hash text, p_final_copy text, p_assessment_id text, p_qa jsonb)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $function$
declare v_row public.editorial_native_draft_dispatches%rowtype;
  v_format text; v_stored text; v_stored_assessment text;
  v_native_client text; v_native_artifact text; v_native_found boolean; v_affected integer;
  v_copy_hash text; v_verdict text; v_reviewed_hash text;
  v_response_id text; v_provenance text; v_rejection text;
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

  select payload#>>'{editorial_direction,format}' into v_format from public.editorial_brief_versions
    where client_id=v_row.client_id and brief_id=v_row.brief_id and version=v_row.brief_version;
  if v_format is null then raise exception 'native dispatch brief version not found'; end if;
  if v_format='video' then
    select script,editorial_qa#>>'{assessment_id}',client_id,editorial_brief_artifact_id
      into v_stored,v_stored_assessment,v_native_client,v_native_artifact
      from public.video_ideas where id=v_row.native_draft_id for update;
  elsif v_format in ('resource','lm_promo') then
    select post_body,qa#>>'{assessment_id}',client_id,editorial_brief_artifact_id
      into v_stored,v_stored_assessment,v_native_client,v_native_artifact
      from public.lm_drafts_v2 where id=v_row.native_draft_id for update;
  else
    select post_body,qa#>>'{assessment_id}',client_id,editorial_brief_artifact_id
      into v_stored,v_stored_assessment,v_native_client,v_native_artifact
      from public.carousel_drafts where id=v_row.native_draft_id for update;
  end if;
  v_native_found:=found;

  v_copy_hash:=encode(sha256(convert_to(p_final_copy,'UTF8')),'hex');
  v_verdict:=p_qa->>'verdict';
  v_reviewed_hash:=p_qa->>'reviewed_copy_sha256';
  v_response_id:=p_qa->>'reviewer_response_id';
  v_provenance:=p_qa->>'reviewer_provenance';
  if not v_native_found then v_rejection:='linked native draft not found';
  elsif v_native_client is distinct from p_client_id or v_native_artifact is distinct from p_artifact_id then
    v_rejection:='linked native draft identity mismatch';
  elsif p_qa->>'assessment_id' is distinct from p_assessment_id then
    v_rejection:='assessment_identity_mismatch';
  elsif v_verdict is distinct from 'accepted' then v_rejection:='accepted QA verdict required';
  elsif v_reviewed_hash is distinct from v_copy_hash then v_rejection:='QA review does not match final copy';
  elsif nullif(btrim(coalesce(v_response_id,'')),'') is null then v_rejection:='reviewer response id required';
  elsif v_provenance is distinct from 'provider_response' then v_rejection:='trusted reviewer provenance required';
  end if;

  insert into public.editorial_native_draft_qa_attempts(client_id,artifact_id,native_draft_id,
    assessment_id,candidate_copy,candidate_copy_sha256,verdict,reviewed_copy_sha256,
    reviewer_response_id,reviewer_provenance,accepted,rejection_reason,qa)
  values(p_client_id,p_artifact_id,v_row.native_draft_id,p_assessment_id,p_final_copy,v_copy_hash,
    v_verdict,v_reviewed_hash,v_response_id,v_provenance,v_rejection is null,v_rejection,coalesce(p_qa,'{}'::jsonb));
  if v_rejection is not null then
    return jsonb_build_object('artifact_id',p_artifact_id,'native_draft_id',v_row.native_draft_id,
      'dispatch_state',v_row.dispatch_state,'persisted',false,'decision','qa_rejected',
      'rejection_reason',v_rejection,'candidate_copy_sha256',v_copy_hash);
  end if;

  if v_row.dispatch_state='failed' then
    return jsonb_build_object('artifact_id',p_artifact_id,'native_draft_id',v_row.native_draft_id,
      'dispatch_state','failed','persisted',false,'decision','failed_original_retained','last_error',v_row.last_error);
  end if;
  if v_row.dispatch_state='complete' then
    if v_stored is not distinct from p_final_copy and v_stored_assessment is not distinct from p_assessment_id then
      return jsonb_build_object('artifact_id',p_artifact_id,'native_draft_id',v_row.native_draft_id,
        'dispatch_state','complete','persisted',false,'decision','idempotent_replay'); end if;
    return jsonb_build_object('artifact_id',p_artifact_id,'native_draft_id',v_row.native_draft_id,
      'dispatch_state','complete','persisted',false,'decision','persisted_copy_conflict');
  end if;
  p_qa:=p_qa||jsonb_build_object('assessment_id',p_assessment_id,'final_copy_sha256',v_copy_hash);
  if v_format='video' then update public.video_ideas set script=p_final_copy,editorial_qa=p_qa
    where id=v_row.native_draft_id and client_id=p_client_id and editorial_brief_artifact_id=p_artifact_id;
  elsif v_format in ('resource','lm_promo') then update public.lm_drafts_v2 set post_body=p_final_copy,qa=p_qa
    where id=v_row.native_draft_id and client_id=p_client_id and editorial_brief_artifact_id=p_artifact_id;
  else update public.carousel_drafts set post_body=p_final_copy,qa=p_qa
    where id=v_row.native_draft_id and client_id=p_client_id and editorial_brief_artifact_id=p_artifact_id; end if;
  get diagnostics v_affected = row_count;
  if v_affected<>1 then raise exception 'linked native draft write affected % rows',v_affected; end if;
  update public.editorial_native_draft_dispatches set dispatch_state='complete',completed_at=now(),last_error=null
    where artifact_id=p_artifact_id and client_id=p_client_id and dispatch_state='claimed';
  get diagnostics v_affected = row_count;
  if v_affected<>1 then raise exception 'native dispatch completion affected % rows',v_affected; end if;
  return jsonb_build_object('artifact_id',p_artifact_id,'native_draft_id',v_row.native_draft_id,
    'dispatch_state','complete','persisted',true,'decision','persist_final','final_copy_sha256',v_copy_hash);
end;$function$;
