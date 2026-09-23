-- Proof-only transcript retrieval. The legacy match_documents overloads remain unchanged.
-- A vector chunk is eligible only when its tenant ownership and exact speaker-bound
-- excerpt both survive the db207 attribution-safe contract.

create or replace function public.editorial_match_proof_transcripts(
  query_embedding extensions.vector,
  p_client_id text,
  match_count integer default 15)
returns table(id uuid,content text,metadata jsonb,similarity double precision)
language plpgsql stable security definer set search_path to 'public','extensions' as $function$
begin
  if p_client_id is null or p_client_id not in ('ivan','risedtc','arch') then
    raise exception 'proof transcript retrieval: unsupported client' using errcode='22023';
  end if;
  if match_count is null or match_count<1 or match_count>15 then
    raise exception 'proof transcript retrieval: match_count must be 1..15' using errcode='22023';
  end if;
  if query_embedding is null then
    raise exception 'proof transcript retrieval: query embedding required' using errcode='22023';
  end if;

  return query
  with latest_heads as (
    select distinct on (s.client_id,s.source_id)
      s.*
    from public.editorial_attribution_safe_sources_v s
    where s.client_id=p_client_id
    order by s.client_id,s.source_id,s.seen_version desc
  ), latest_safe as (
    select s.client_id,s.source_id,s.seen_version,s.permission_state,s.candidate_fields
    from latest_heads s
    where s.source_kind='call' and s.source_client_scope=p_client_id and s.source_id !~ '^urn:transcript:'
      and s.passage is not null and s.gap_state is null
      and jsonb_typeof(s.candidate_fields->'passage_attributions')='array'
      and jsonb_array_length(s.candidate_fields->'passage_attributions')>0
  ), eligible as (
    select tc.id,tc.chunk_text,tc.embedding,tc.transcript_id,tc.chunk_index,t.source,
      s.source_id,s.seen_version,s.permission_state,s.candidate_fields,a.item attribution,
      count(*) over(partition by tc.id) attribution_matches
    from public.transcript_chunks tc
    join public.transcripts t on t.id=tc.transcript_id
    join latest_safe s on s.source_id=t.id::text
    cross join lateral jsonb_array_elements(s.candidate_fields->'passage_attributions') a(item)
    where tc.embedding is not null and tc.quarantine_reason is null
      and t.source=case p_client_id when 'ivan' then 'ivan-listener'
        when 'risedtc' then 'fathom-risedtc' when 'arch' then 'fireflies-arch' end
      and cardinality(tc.speaker)=1 and nullif(btrim(tc.speaker[1]),'') is not null
      and jsonb_typeof(a.item)='object' and a.item->>'attribution_state'='verified'
      and a.item->>'speaker_role' in('author','third_party')
      and nullif(btrim(a.item->>'speaker_name'),'') is not null
      and lower(btrim(a.item->>'speaker_name'))=lower(btrim(tc.speaker[1]))
      and a.item->>'transcript_id'=t.id::text
      and s.candidate_fields->>'transcript_text_sha256'=
        encode(sha256(convert_to(coalesce(t.transcript_text,''),'UTF8')),'hex')
      and s.candidate_fields->>'transcript_json_sha256'=
        encode(sha256(convert_to(coalesce(t.transcript_json,'null'::jsonb)::text,'UTF8')),'hex')
      and s.candidate_fields->>'transcript_sha256'=encode(sha256(convert_to(
        coalesce(t.transcript_text,'')||E'\n--TRANSCRIPT-JSON--\n'||
        coalesce(t.transcript_json,'null'::jsonb)::text,'UTF8')),'hex')
      and a.item->>'transcript_sha256'=s.candidate_fields->>'transcript_sha256'
      and a.item->>'transcript_text_sha256'=s.candidate_fields->>'transcript_text_sha256'
      and a.item->>'transcript_json_sha256'=s.candidate_fields->>'transcript_json_sha256'
      and coalesce(a.item->>'excerpt_sha256','') ~ '^[0-9a-f]{64}$'
      and encode(sha256(convert_to(coalesce(a.item->>'excerpt',''),'UTF8')),'hex')=a.item->>'excerpt_sha256'
      and nullif(a.item->>'excerpt','') is not null
      and position(a.item->>'excerpt' in tc.chunk_text)>0
  )
  select e.id,e.attribution->>'excerpt' content,
    jsonb_build_object(
      'client_id',p_client_id,'transcript_id',e.transcript_id,'chunk_index',e.chunk_index,
      'transcript_source',e.source,'source_id',e.source_id,'source_seen_version',e.seen_version,
      'speaker',jsonb_build_array(e.attribution->>'speaker_name'),
      'speaker_name',e.attribution->>'speaker_name','speaker_role',e.attribution->>'speaker_role',
      'attribution_state','verified','ownership_state','verified_client_registry_source',
      'excerpt_sha256',e.attribution->>'excerpt_sha256',
      'transcript_sha256',e.attribution->>'transcript_sha256',
      'permission_state',e.permission_state,
      'first_person_eligible',coalesce((e.candidate_fields->>'first_person_eligible')::boolean,false)
        and e.attribution->>'speaker_role'='author',
      'attribution_use',case when coalesce((e.candidate_fields->>'first_person_eligible')::boolean,false)
          and e.attribution->>'speaker_role'='author' then 'author_experience'
        else 'attributed_research_only' end,
      'retrieval_limitation','Internal proof excerpt only; speaker attribution does not grant public quote or identity permission.'
    ) metadata,
    (1-(e.embedding <=> query_embedding))::double precision similarity
  from eligible e where e.attribution_matches=1
  order by e.embedding <=> query_embedding,e.id
  limit match_count;
end;$function$;

revoke all on function public.editorial_match_proof_transcripts(extensions.vector,text,integer)
  from public,anon,authenticated;
grant execute on function public.editorial_match_proof_transcripts(extensions.vector,text,integer)
  to service_role;
