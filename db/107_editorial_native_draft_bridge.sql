-- Run 2 staged release: exact editorial reservation -> native internal draft.
-- No trigger, schedule, approval or publication side effect.
alter table public.carousel_drafts
  add column if not exists editorial_brief_artifact_id text;

create unique index if not exists carousel_drafts_editorial_artifact_uq
  on public.carousel_drafts(editorial_brief_artifact_id)
  where editorial_brief_artifact_id is not null;

alter table public.video_ideas
  add column if not exists editorial_brief_artifact_id text;
alter table public.video_ideas
  add column if not exists client_id text;
create unique index if not exists video_ideas_editorial_artifact_uq
  on public.video_ideas(editorial_brief_artifact_id)
  where editorial_brief_artifact_id is not null;

create table if not exists public.editorial_native_draft_dispatches (
  client_id text not null,
  artifact_id text primary key,
  native_draft_id uuid not null unique,
  request_id text not null,
  brief_id text not null,
  brief_version integer not null,
  brief_hash text not null,
  dispatch_state text not null default 'claimed'
    check (dispatch_state in ('claimed','complete','failed')),
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  last_error text,
  unique(client_id,request_id)
);

revoke all on public.editorial_native_draft_dispatches from public,anon,authenticated;
grant select,insert,update on public.editorial_native_draft_dispatches to service_role;

create or replace function public.editorial_begin_native_draft(
  p_gate text,p_client_id text,p_artifact_id text,p_brief_id text,
  p_version integer,p_expected_hash text,p_request_id text,p_title text,
  p_format text,p_topic text)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $function$
declare v_link public.editorial_brief_artifacts%rowtype;
  v_brief public.editorial_brief_versions%rowtype;
  v_existing public.editorial_native_draft_dispatches%rowtype;
  v_native uuid; v_hex text; v_detail jsonb;
begin
  perform public.editorial_guard(p_gate,p_client_id);
  select * into v_link from public.editorial_brief_artifacts
    where client_id=p_client_id and artifact_id=p_artifact_id
      and brief_id=p_brief_id and version=p_version and request_id=p_request_id;
  if not found or v_link.artifact_kind<>'draft' then
    raise exception 'exact editorial reservation required'; end if;
  select * into v_brief from public.editorial_brief_versions
    where client_id=p_client_id and brief_id=p_brief_id and version=p_version;
  if not found or v_brief.content_hash is distinct from p_expected_hash then
    raise exception 'brief version/hash mismatch'; end if;
  if v_brief.payload#>>'{editorial_direction,format}' is distinct from p_format then
    raise exception 'native format differs from reserved brief'; end if;
  if v_link.artifact_role not in(p_format,'internal_copy',
       case when p_format='text' then 'post' else 'video_script' end) then
    raise exception 'native format differs from reserved artifact role'; end if;
  if p_format not in('text','carousel','video') then
    raise exception 'unsupported native draft format'; end if;
  if nullif(btrim(p_title),'') is null or nullif(btrim(p_topic),'') is null then
    raise exception 'native draft needs title and topic'; end if;
  select * into v_existing from public.editorial_native_draft_dispatches
    where artifact_id=p_artifact_id for update;
  if found then
    if v_existing.client_id<>p_client_id or v_existing.brief_id<>p_brief_id
      or v_existing.brief_version<>p_version or v_existing.brief_hash<>p_expected_hash
      or v_existing.request_id<>p_request_id then
      raise exception 'native dispatch identity conflict'; end if;
    return jsonb_build_object('artifact_id',p_artifact_id,'native_draft_id',v_existing.native_draft_id,
      'should_dispatch',false,'dispatch_state',v_existing.dispatch_state,'idempotent_replay',true);
  end if;
  v_hex:=encode(sha256(convert_to('editorial-native|'||p_artifact_id,'UTF8')),'hex');
  v_native:=(substr(v_hex,1,8)||'-'||substr(v_hex,9,4)||'-'||substr(v_hex,13,4)||'-'||
    substr(v_hex,17,4)||'-'||substr(v_hex,21,12))::uuid;
  v_detail:=jsonb_build_object('editorial_artifact_id',p_artifact_id,
    'brief_id',p_brief_id,'brief_version',p_version,'brief_hash',p_expected_hash,
    'request_id',p_request_id,'internal_only',true);
  if p_format='video' then
    insert into public.video_ideas(id,client_id,title,description,status,
        editorial_brief_artifact_id)
      values(v_native,p_client_id,p_title,p_topic,'idea',p_artifact_id);
  else
    insert into public.carousel_drafts(id,client_id,title,type,topic,description,status,
        source_detail,editorial_brief_artifact_id,scheduled_at,published_at,board_visible)
      values(v_native,p_client_id,p_title,
        case when p_format='carousel' then 'carousel' else 'text' end,
        p_topic,p_topic,'draft',v_detail,p_artifact_id,null,null,false);
  end if;
  insert into public.editorial_native_draft_dispatches(client_id,artifact_id,native_draft_id,
      request_id,brief_id,brief_version,brief_hash)
    values(p_client_id,p_artifact_id,v_native,p_request_id,p_brief_id,p_version,p_expected_hash);
  return jsonb_build_object('artifact_id',p_artifact_id,'native_draft_id',v_native,
    'should_dispatch',true,'dispatch_state','claimed','idempotent_replay',false);
end;$function$;

revoke all on function public.editorial_begin_native_draft(text,text,text,text,integer,text,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.editorial_begin_native_draft(text,text,text,text,integer,text,text,text,text,text)
  to service_role;
