-- Speaker-bound call evidence. This migration is additive: the legacy linkage RPC
-- remains available for rollback, but the bridge moves to this stricter contract.

create or replace function public.editorial_attributed_call_passages(
  p_gate text,p_client_id text,p_candidate_ids text[])
returns table(candidate_id text,transcript_id text,transcript_date timestamptz,
  transcript_sha256 text,transcript_text_sha256 text,transcript_json_sha256 text,
  excerpt text,excerpt_sha256 text,permission_state text,
  participants text[],transcript_source text,speaker_name text,speaker_role text,
  attribution_state text,segment_index integer,segment_start text,segment_end text,
  quote_start integer,quote_end integer)
language plpgsql stable security definer set search_path to 'public' as $function$
begin
  perform public.editorial_guard(p_gate,p_client_id);
  if p_client_id not in ('ivan','risedtc','arch') then raise exception 'unsupported editorial client'; end if;
  if cardinality(p_candidate_ids)>500 then raise exception 'call attribution request exceeds 500 candidates'; end if;
  return query
  with candidates as (
    select c.id::text candidate_id,t.id::text transcript_id,t.date transcript_date,
      t.transcript_text,t.transcript_json,t.participants,t.source transcript_source,
      coalesce(c.evidence->0->>'quote',c.evidence->0->>'anchor_quote') excerpt,
      'unknown'::text permission_state
    from public.lm_idea_candidates c join public.transcripts t
      on p_client_id='ivan' and t.source='ivan-listener'
      and (c.source_ref=t.id::text or c.source_ref=t.fireflies_id)
    where p_client_id='ivan' and c.id::text=any(p_candidate_ids) and c.source in('ivan_call','calls')
    union all
    select i.id::text,t.id::text,t.date,t.transcript_text,t.transcript_json,t.participants,t.source,
      i.score_breakdown->>'why',
      case when coalesce(i.meta->>'consent_tier',i.score_breakdown->>'consent_tier','')
        in('public','granted','approved') then 'granted' else 'unknown' end
    from public.client_ideas i join public.transcripts t
      on p_client_id in('risedtc','arch')
      and t.source=case p_client_id when 'risedtc' then 'fathom-risedtc' else 'fireflies-arch' end
      and split_part(i.meta->>'source_ts','|',1)=t.transcript_json->>'recording_id'
    where p_client_id in('risedtc','arch') and i.client_id=p_client_id
      and i.id::text=any(p_candidate_ids)
      and i.source_label=case p_client_id when 'risedtc' then 'From your sales calls' else 'From your calls' end
  ), segments as (
    select c.*, (seg.ord-1)::integer segment_index,seg.item->>'text' segment_text,
      case when jsonb_typeof(seg.item->'speaker')='object'
        then coalesce(seg.item#>>'{speaker,display_name}',seg.item#>>'{speaker,name}',seg.item#>>'{speaker,label}')
        else seg.item->>'speaker' end speaker_name,
      coalesce(seg.item->>'start',seg.item->>'start_time',seg.item->>'timestamp') segment_start,
      coalesce(seg.item->>'end',seg.item->>'end_time') segment_end
    from candidates c cross join lateral jsonb_array_elements(
      case when jsonb_typeof(c.transcript_json)='array' then c.transcript_json
        when jsonb_typeof(c.transcript_json->'transcript')='array' then c.transcript_json->'transcript'
        else '[]'::jsonb end) with ordinality seg(item,ord)
    union all
    select c.*, (line.ord-1)::integer,
      regexp_replace(line.value,'^[^:]{1,80}:\s*',''),
      btrim(substring(line.value from '^([^:]{1,80}):')),
      null::text,null::text
    from candidates c cross join lateral regexp_split_to_table(c.transcript_text,E'\\r?\\n')
      with ordinality line(value,ord)
    where jsonb_typeof(c.transcript_json)<>'array'
      and coalesce(jsonb_typeof(c.transcript_json->'transcript'),'null')<>'array'
      and line.value ~ '^[^:]{1,80}:\s*'
  ), matches as (
    select s.*,position(s.excerpt in s.segment_text)-1 q_start,
      count(*) over(partition by s.candidate_id) match_count
    from segments s where nullif(s.excerpt,'') is not null
      and position(s.excerpt in s.segment_text)>0
  ), classified as (
    select m.*,
      case
        when nullif(btrim(m.speaker_name),'') is null
          or btrim(m.speaker_name) ~* '^(unattributed|unknown|speaker( [0-9]+)?|speaker ?[a-z]|n/a)$'
          then 'ambiguous'
        when (p_client_id='ivan' and lower(btrim(m.speaker_name))='ivan manfredi')
          or (p_client_id='risedtc' and lower(btrim(m.speaker_name))='mattan danino')
          or (p_client_id='arch' and lower(btrim(m.speaker_name))='davorin smit') then 'author'
        else 'third_party' end role
    from matches m
  )
  select c.candidate_id,c.transcript_id,c.transcript_date,
    encode(sha256(convert_to(coalesce(c.transcript_text,'')||E'\n--TRANSCRIPT-JSON--\n'||
      coalesce(c.transcript_json,'null'::jsonb)::text,'UTF8')),'hex'),
    encode(sha256(convert_to(coalesce(c.transcript_text,''),'UTF8')),'hex'),
    encode(sha256(convert_to(coalesce(c.transcript_json,'null'::jsonb)::text,'UTF8')),'hex'),c.excerpt,
    encode(sha256(convert_to(c.excerpt,'UTF8')),'hex'),c.permission_state,c.participants,
    c.transcript_source,btrim(c.speaker_name),c.role,'verified'::text,c.segment_index,
    c.segment_start,c.segment_end,c.q_start,c.q_start+length(c.excerpt)
  from classified c where c.match_count=1 and c.role in('author','third_party')
  order by c.candidate_id;
end;$function$;

revoke all on function public.editorial_attributed_call_passages(text,text,text[]) from public,anon,authenticated;
grant execute on function public.editorial_attributed_call_passages(text,text,text[]) to service_role;

create or replace view public.editorial_attribution_safe_sources_v
with (security_invoker=true) as
with checked as (
  select s.*,
    coalesce(s.source_kind<>'call' or (
      jsonb_typeof(s.candidate_fields->'passage_attributions')='array'
      and jsonb_array_length(case when jsonb_typeof(s.candidate_fields->'passage_attributions')='array' then s.candidate_fields->'passage_attributions' else '[]'::jsonb end)>0
      and coalesce(s.candidate_fields->>'transcript_sha256','') ~ '^[0-9a-f]{64}$'
      and coalesce(s.candidate_fields->>'transcript_text_sha256','') ~ '^[0-9a-f]{64}$'
      and coalesce(s.candidate_fields->>'transcript_json_sha256','') ~ '^[0-9a-f]{64}$'
      and encode(sha256(convert_to(coalesce(s.passage,''),'UTF8')),'hex')=coalesce(s.body_sha256,'')
      and (select string_agg(x.item->>'excerpt',E'\n\n[Verified separate passage from the same call]\n\n'
          order by x.ord)
        from jsonb_array_elements(case when jsonb_typeof(s.candidate_fields->'passage_attributions')='array' then s.candidate_fields->'passage_attributions' else '[]'::jsonb end) with ordinality x(item,ord))=s.passage
      and not exists (
        select 1 from jsonb_array_elements(case when jsonb_typeof(s.candidate_fields->'passage_attributions')='array'
          then s.candidate_fields->'passage_attributions' else '[]'::jsonb end) a
        where not coalesce(
          jsonb_typeof(a)='object'
          and a->>'attribution_state'='verified'
          and a->>'speaker_role' in('author','third_party')
          and jsonb_typeof(a->'speaker_name')='string' and nullif(btrim(a->>'speaker_name'),'') is not null
          and a->>'transcript_sha256'=s.candidate_fields->>'transcript_sha256'
          and a->>'transcript_text_sha256'=s.candidate_fields->>'transcript_text_sha256'
          and a->>'transcript_json_sha256'=s.candidate_fields->>'transcript_json_sha256'
          and jsonb_typeof(a->'excerpt')='string' and nullif(a->>'excerpt','') is not null
          and coalesce(a->>'excerpt_sha256','') ~ '^[0-9a-f]{64}$'
          and encode(sha256(convert_to(coalesce(a->>'excerpt',''),'UTF8')),'hex')=a->>'excerpt_sha256'
          and jsonb_typeof(a->'segment_index')='number' and (a->>'segment_index') ~ '^[0-9]{1,9}$'
          and jsonb_typeof(a->'quote_start')='number' and (a->>'quote_start') ~ '^[0-9]{1,9}$'
          and jsonb_typeof(a->'quote_end')='number' and (a->>'quote_end') ~ '^[0-9]{1,9}$'
          and case when (a->>'quote_start') ~ '^[0-9]{1,9}$' and (a->>'quote_end') ~ '^[0-9]{1,9}$'
            then (a->>'quote_end')::integer>(a->>'quote_start')::integer
              and (a->>'quote_end')::integer-(a->>'quote_start')::integer=length(coalesce(a->>'excerpt',''))
            else false end, false)
      )
    ),false) attribution_safe,
    coalesce(s.source_kind='call' and jsonb_typeof(s.candidate_fields->'passage_attributions')='array'
      and jsonb_array_length(case when jsonb_typeof(s.candidate_fields->'passage_attributions')='array' then s.candidate_fields->'passage_attributions' else '[]'::jsonb end)>0
      and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(s.candidate_fields->'passage_attributions')='array' then s.candidate_fields->'passage_attributions' else '[]'::jsonb end) a
        where (a->>'speaker_role'='author') is not true),false) author_only
  from public.editorial_sources s
)
select client_id,source_id,seen_version,source_kind,source_client_scope,source_url,excerpt_pointer,owner,
  source_published_at,published_date_state,captured_at,
  case when attribution_safe then body_sha256 else null end body_sha256,
  case when attribution_safe then passage else null end passage,retained_context,
  case when attribution_safe then limitation else btrim(coalesce(limitation,'')||' Call passage lacks verified speaker attribution and cannot support synthesis.') end limitation,
  independent,derived_from,case when attribution_safe then permission_state else 'unknown' end permission_state,
  case when attribution_safe then gap_state else jsonb_build_object('reason','partial','detail',
    'Call passage is quarantined until exact speaker and quote-range attribution is verified.') end gap_state,
  coalesce(candidate_fields,'{}'::jsonb)||jsonb_build_object(
    'first_person_eligible',attribution_safe and author_only,
    'attribution_use',case when not attribution_safe then 'quarantined'
      when author_only then 'author_experience' else 'attributed_research_only' end) candidate_fields,
  snapshot_hash,created_at
from checked;

revoke all on public.editorial_attribution_safe_sources_v from public,anon,authenticated;
grant select on public.editorial_attribution_safe_sources_v to service_role;
