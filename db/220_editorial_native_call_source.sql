-- 220: an editorial native draft names the call it came from (Ivan 2026-09-29,
-- "make sure inbox shows the call it came from").
--
-- editorial_begin_native_draft stamped only brief lineage (brief_id, hash,
-- request_id) into source_detail, so the draft window's Source block had no
-- call to show: the Leighton call (2026-09-18) behind brief-ivan-05 was
-- reachable only through editorial_brief_sources -> editorial_sources ->
-- transcripts. The draft window already renders kind (chip), label,
-- quote + call_title (blockquote) from source_detail, so the fix is to stamp
-- those keys at creation and backfill the rows already written.
--
-- quote = this brief's own excerpt only. editorial_sources.passage concatenates
-- every brief that cited the source, each segment tagged
-- "[<brief_id> v<version> / <evidence_id>]". Internal display only: the copy
-- rules (paraphrase, permission_state) are unchanged.

create or replace function public.editorial_call_source_detail(
  p_client_id text, p_brief_id text, p_version integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare r record; v_tag text; v_at int; v_rest text; v_end int; v_quote text;
  v_title text; v_date timestamptz;
begin
  select s.evidence_id, e.source_id, e.passage, e.source_published_at, e.permission_state
    into r
    from public.editorial_brief_sources s
    join public.editorial_sources e
      on e.client_id=s.client_id and e.source_id=s.source_id and e.seen_version=s.seen_version
   where s.client_id=p_client_id and s.brief_id=p_brief_id and s.version=p_version
     and e.source_kind='call'
   order by s.evidence_id
   limit 1;
  if not found then return '{}'::jsonb; end if;

  select coalesce(nullif(btrim(cr.meeting_title),''), t.title), coalesce(cr.meeting_date, t.date)
    into v_title, v_date
    from public.transcripts t
    left join public.call_reports cr on cr.transcript_id::text=t.id::text
   where t.id::text=r.source_id
   order by cr.created_at desc nulls last
   limit 1;
  v_date := coalesce(v_date, r.source_published_at);

  v_tag := '['||p_brief_id||' v'||p_version||' / '||r.evidence_id||']';
  v_at := position(v_tag in coalesce(r.passage,''));
  if v_at > 0 then
    v_rest := substr(r.passage, v_at + length(v_tag));
    v_end := position(E'\n\n[' in v_rest);
    v_quote := btrim(case when v_end > 0 then substr(v_rest, 1, v_end - 1) else v_rest end, E' \n\r\t');
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'kind','call',
    'label', 'Call' || coalesce(' with '||v_title,'') || coalesce(', '||to_char(v_date,'DD Mon YYYY'),''),
    'call_title', v_title,
    'call_date', to_char(v_date,'YYYY-MM-DD'),
    'transcript_id', r.source_id,
    'quote', nullif(v_quote,''),
    'permission_state', r.permission_state));
end;$function$;

revoke all on function public.editorial_call_source_detail(text,text,integer) from public, anon, authenticated;

-- editorial_begin_native_draft: identical to the live body except v_detail now
-- merges editorial_call_source_detail(...) and carousel rows carry source_label.
create or replace function public.editorial_begin_native_draft(p_gate text, p_client_id text, p_artifact_id text, p_brief_id text, p_version integer, p_expected_hash text, p_request_id text, p_title text, p_format text, p_topic text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_link public.editorial_brief_artifacts%rowtype;
  v_brief public.editorial_brief_versions%rowtype;
  v_existing public.editorial_native_draft_dispatches%rowtype;
  v_native uuid; v_hex text; v_detail jsonb; v_call jsonb;
begin
  perform public.editorial_guard(p_gate,p_client_id);
  -- cb15e (Ivan 2026-09-24, "we don't do video"): native video is refused for EVERY client, Ivan
  -- included, before any write. db/227 had closed it for every client except Ivan.
  if p_format='video' then
    raise exception 'native video is refused for every client'; end if;
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
       case when p_format in('text','carousel','single_image') then 'post'
         when p_format='video' then 'video_script'
         when p_format='lm_promo' then 'promotion'
         else 'resource' end) then
    raise exception 'native format differs from reserved artifact role'; end if;
  if p_format not in('text','single_image','carousel','video','resource','lm_promo') then
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
  v_call:=public.editorial_call_source_detail(p_client_id,p_brief_id,p_version);
  v_detail:=v_call || jsonb_build_object('editorial_artifact_id',p_artifact_id,
    'brief_id',p_brief_id,'brief_version',p_version,'brief_hash',p_expected_hash,
    'request_id',p_request_id,'source_format',p_format,'internal_only',true);
  if p_format='video' then
    insert into public.video_ideas(id,client_id,title,description,status,
        editorial_brief_artifact_id)
      values(v_native,p_client_id,p_title,p_topic,'idea',p_artifact_id);
  elsif p_format in('resource','lm_promo') then
    insert into public.lm_drafts_v2(id,client_id,topic,format,status,spec,editorial_brief_artifact_id)
      values(v_native,p_client_id,p_topic,
        case when p_format='lm_promo' then 'promo' else 'editorial_resource' end,
        'draft',v_detail,p_artifact_id);
  else
    insert into public.carousel_drafts(id,client_id,title,type,topic,description,status,
        source_detail,source_label,editorial_brief_artifact_id,scheduled_at,published_at,board_visible)
      values(v_native,p_client_id,p_title,
        case when p_format='carousel' then 'carousel' else 'text' end,
        p_topic,p_topic,'draft',v_detail,v_call->>'label',p_artifact_id,null,null,false);
  end if;
  insert into public.editorial_native_draft_dispatches(client_id,artifact_id,native_draft_id,
      request_id,brief_id,brief_version,brief_hash)
    values(p_client_id,p_artifact_id,v_native,p_request_id,p_brief_id,p_version,p_expected_hash);
  return jsonb_build_object('artifact_id',p_artifact_id,'native_draft_id',v_native,
    'should_dispatch',true,'dispatch_state','claimed','idempotent_replay',false);
end;$function$;

-- Backfill: every editorial carousel_drafts row whose brief cites a call.
-- A row's client_id is NULL on Ivan's lane in some writers; the brief tables key him as 'ivan'.
update public.carousel_drafts c
   set source_detail = x.call || c.source_detail,
       source_label  = coalesce(c.source_label, x.call->>'label')
  from (
    select c2.id,
           public.editorial_call_source_detail(coalesce(c2.client_id,'ivan'),
             c2.source_detail->>'brief_id', (c2.source_detail->>'brief_version')::int) call
      from public.carousel_drafts c2
     where c2.editorial_brief_artifact_id is not null
       and jsonb_typeof(c2.source_detail)='object'
       and c2.source_detail ? 'brief_id'
       and not (c2.source_detail ? 'call_title')
  ) x
 where c.id=x.id and x.call <> '{}'::jsonb;

-- Re-run safety: trim quotes stamped before the whitespace fix.
update public.carousel_drafts
   set source_detail = jsonb_set(source_detail,'{quote}',to_jsonb(btrim(source_detail->>'quote',E' \n\r\t')))
 where editorial_brief_artifact_id is not null and source_detail ? 'quote'
   and source_detail->>'quote' <> btrim(source_detail->>'quote',E' \n\r\t');
