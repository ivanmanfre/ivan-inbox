begin;
set local statement_timeout='20s'; set local lock_timeout='5s';
create table public.content_idea_expiry_snapshots (
 run_id uuid not null, idea_id uuid not null, client_id text not null,
 previous_status text not null, archived_at timestamptz not null default now(),
 primary key(run_id,idea_id)
);
alter table public.content_idea_expiry_snapshots enable row level security;
revoke all on public.content_idea_expiry_snapshots from public,anon,authenticated;
grant all on public.content_idea_expiry_snapshots to service_role;
create function public.expire_client_ideas() returns jsonb
language plpgsql security definer set search_path='public','pg_temp' as $fn$
declare v_run uuid := gen_random_uuid(); v_n int;
begin
 with candidates as (select i.id,i.client_id,i.status from public.client_ideas i where i.client_id in ('risedtc','arch') and i.status='staged'
    and i.created_at < now()-interval '30 days'
    and coalesce(i.meta->>'pinned','false') <> 'true'
    and coalesce(i.taxonomy->>'pinned','false') <> 'true'
    and coalesce(i.idea->>'pinned','false') <> 'true'
    and not exists(select 1 from public.editorial_source_curation c where c.client_id=i.client_id and c.state='pinned' and c.source_id in (i.id::text,i.source_ref,i.idea->>'id'))
    and not exists(select 1 from public.client_board_actions a where a.client_id=i.client_id and (a.ref in (i.id::text,i.source_ref,i.idea->>'id') or a.payload->>'idea_id'=i.id::text)) for update),
 snap as (insert into public.content_idea_expiry_snapshots(run_id,idea_id,client_id,previous_status)
 select v_run,id,client_id,status from candidates returning idea_id)
 update public.client_ideas i set status='archived' from snap where i.id=snap.idea_id;
 get diagnostics v_n=row_count;
 return jsonb_build_object('run_id',v_run,'archived',v_n);
end $fn$;
revoke all on function public.expire_client_ideas() from public,anon,authenticated;
grant execute on function public.expire_client_ideas() to service_role;
create function public.operator_ranked_ideas(p_gate text,p_client text) returns jsonb
language plpgsql stable security definer set search_path='public','pg_temp' as $fn$
declare v_rows jsonb; v_inputs jsonb;
begin
 if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
 if p_client is null or p_client not in ('ivan','risedtc','arch') or not public.lane_allowed(p_client) then raise exception 'unknown seat'; end if;
 v_inputs := public.cb22_inputs(p_gate,p_client);
 with banks as (
  select l.id::text id,to_jsonb(l) bank,coalesce(l.ingested_at,l.created_at) stamped,
   case l.source when 'x_viral' then 'X' when 'x_search' then 'X' when 'ivan_call' then 'Your calls' when 'kyle_call' then 'Kyle’s calls' when 'claude_sessions' then 'Sessions' when 'reddit_se' then 'Reddit' else coalesce(initcap(replace(l.source,'_',' ')),'Idea bank') end src,l.source_ref,
   coalesce(case when jsonb_typeof(l.evidence)='array' then l.evidence->0 end,'{}') e,
   '{}'::jsonb meta, '{}'::jsonb idea
  from public.lm_idea_candidates l where p_client='ivan' and l.status='reviewing' and l.content_type is distinct from 'lead_magnet'
   and (l.source_ref is null or l.source_ref !~ '^(outlier|cb22):(linkedin|x):[0-9]+$' or exists(select 1 from jsonb_array_elements(v_inputs->'top') t where l.source_ref in ('outlier:'||(t->>'platform')||':'||(t->>'post_id'),'cb22:'||(t->>'platform')||':'||(t->>'post_id'))))
  union all
  select i.id::text,to_jsonb(i),i.created_at,coalesce(i.source_label,'Idea bank'),i.source_ref,
   coalesce(i.score_breakdown,'{}') || coalesce(case when jsonb_typeof(i.meta->'evidence')='array' then i.meta->'evidence'->0 end,'{}'),
   coalesce(i.meta,'{}'),coalesce(i.idea,'{}')
  from public.client_ideas i where i.client_id=p_client and i.status='staged' and (i.eligible_at is null or i.eligible_at<=now())
   and (i.created_at >= now()-interval '30 days' or coalesce(i.meta->>'pinned','false')='true' or coalesce(i.taxonomy->>'pinned','false')='true' or coalesce(i.idea->>'pinned','false')='true' or exists(select 1 from public.editorial_source_curation c where c.client_id=i.client_id and c.state='pinned' and c.source_id in (i.id::text,i.source_ref,i.idea->>'id')))
   and (i.source_ref is null or i.source_ref !~ '^(outlier|cb22):(linkedin|x):[0-9]+$' or exists(select 1 from jsonb_array_elements(v_inputs->'top') t where i.source_ref in ('outlier:'||(t->>'platform')||':'||(t->>'post_id'),'cb22:'||(t->>'platform')||':'||(t->>'post_id'))))
 ), bank_unique as (
  select distinct on (coalesce(case when source_ref ~ '^(outlier|cb22):(linkedin|x):[0-9]+$' then regexp_replace(source_ref,'^(outlier|cb22):','') end,id)) * from banks
  order by coalesce(case when source_ref ~ '^(outlier|cb22):(linkedin|x):[0-9]+$' then regexp_replace(source_ref,'^(outlier|cb22):','') end,id),stamped,id
 ), raw as (
  select 'bank'::text kind,id,bank,null::jsonb outlier,stamped,src,e,meta,idea from bank_unique
  union all
  select 'outlier',r->>'platform'||':'||(r->>'post_id'),null,r,(r->>'published_at')::timestamptz,
   case when r->>'platform'='x' then 'X' else 'LinkedIn' end,r,'{}','{}'
  from jsonb_array_elements(v_inputs->'top') r
  where (r->'idea' is null or r->'idea'='null'::jsonb or (p_client='ivan' and r->'idea'->>'status'='pending'))
    and not exists(select 1 from public.lm_idea_candidates l where p_client='ivan' and l.status<>'pending' and l.source_ref in ('outlier:'||(r->>'platform')||':'||(r->>'post_id'),'cb22:'||(r->>'platform')||':'||(r->>'post_id')))
    and not exists(select 1 from public.client_ideas i where i.client_id=p_client and i.source_ref in ('outlier:'||(r->>'platform')||':'||(r->>'post_id'),'cb22:'||(r->>'platform')||':'||(r->>'post_id')))
 ), measured as (
  select *,case when e->>'lift' ~ '^[0-9]+(\.[0-9]+)?$' then (e->>'lift')::numeric end lift,
   case when meta->>'original_comments' ~ '^[0-9]+$' then (meta->>'original_comments')::int end winner_comments,
   (select count(distinct value #>> '{}') from jsonb_array_elements(case
     when jsonb_typeof(idea->'source_detail'->'call_ids')='array' then idea->'source_detail'->'call_ids'
     when jsonb_typeof(meta->'source_detail'->'call_ids')='array' then meta->'source_detail'->'call_ids'
     else '[]' end) c where jsonb_typeof(c.value)='string' and btrim(c.value #>> '{}')<>'') call_n,
   coalesce(nullif(e->>'quote',''),nullif(e->>'anchor_quote',''),nullif(e->>'verbatim_quote',''),nullif(idea->>'verbatim_quote',''),nullif(idea->>'anchor_quote',''),nullif(idea->'source_detail'->>'quote',''),nullif(meta->'source_detail'->>'quote','')) quote
  from raw
 ), ranked as (
 select *,
  (case when lift>0 then 1+ln(1+least(lift,100)) when call_n>0 then 1+ln(1+call_n)
    when winner_comments is not null then 1+ln(1+winner_comments)
    when quote is not null then 1.5 else 1 end)
  / (1+greatest(0,extract(epoch from now()-stamped)/86400)/7) rank,
  case when lift>0 then round(lift,1)::text||'× its author’s usual engagement'
    when call_n>0 then 'Recorded in '||call_n||case when call_n=1 then ' call' else ' calls' end
    when winner_comments is not null then 'Your past winner · '||winner_comments||' comments'
    when quote is not null then src||' · “'||left(quote,150)||case when length(quote)>150 then '…' else '' end||'”'
    else src end proof
 from measured
 ) select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'id',id,'bank',bank,'outlier',outlier,'proof',proof,'rank',rank)
   order by rank desc,stamped desc,id),'[]') into v_rows from ranked;
 return jsonb_build_object('ok',true,'client',p_client,'rows',v_rows,'best_count',5);
end $fn$;
revoke all on function public.operator_ranked_ideas(text,text) from public,anon;
grant execute on function public.operator_ranked_ideas(text,text) to authenticated,service_role;
CREATE OR REPLACE FUNCTION public.operator_outlier_use(p_gate text, p_client text, p_platform text, p_post_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ref text; v_row jsonb; v_id uuid; v_first text; v_author text; v_src text; v_lines text[]; v_i int; v_status text; v_table text;
begin
  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
  if p_client is null or p_client not in ('ivan', 'risedtc', 'arch') or not public.lane_allowed(p_client) then
    raise exception 'unknown seat';
  end if;
  if coalesce(p_platform, '') not in ('linkedin', 'x') or p_post_id is null or p_post_id !~ '^[0-9]+$' then
    raise exception 'bad outlier reference';
  end if;
  v_ref := 'outlier:' || p_platform || ':' || p_post_id;
  select r into v_row from jsonb_array_elements(public.cb22_inputs(p_gate,p_client)->'top') r
   where r->>'post_id'=p_post_id and r->>'platform'=p_platform limit 1;
  perform pg_advisory_xact_lock(hashtext('operator_outlier_use:' || p_client || ':' || v_ref));

  if p_client = 'ivan' then
    select l.id,l.status,l.source_ref into v_id,v_status,v_ref from public.lm_idea_candidates l where l.source_ref in (v_ref,'cb22:'||p_platform||':'||p_post_id) order by l.created_at,l.id limit 1;
  else
    select ci.id,ci.status,ci.source_ref into v_id,v_status,v_ref from public.client_ideas ci where ci.client_id = p_client and ci.source_ref in (v_ref,'cb22:'||p_platform||':'||p_post_id) order by ci.created_at,ci.id limit 1;
  end if;
  v_table := case when p_client='ivan' then 'lm_idea_candidates' else 'client_ideas' end;
  if v_id is not null then
    if p_client='ivan' and v_status='pending' then
      if v_row is null then raise exception 'not a current accepted idea of this client'; end if;
      update public.lm_idea_candidates set status='reviewing' where id=v_id and status='pending';
      v_status := 'reviewing';
    end if;
    return jsonb_build_object('ok', true, 'created', false, 'id', v_id, 'status',v_status,'table',v_table, 'source_ref', v_ref);
  end if;

  v_ref := 'outlier:'||p_platform||':'||p_post_id;
  if v_row is null then raise exception 'not a current accepted idea of this client'; end if;
  -- The current accepted source is the authorization; keep fuller stored outlier
  -- evidence where available, and the accepted search/steady source otherwise.
  select coalesce((select r from jsonb_array_elements(public.operator_outliers(p_gate,p_client,p_platform,null)->'rows') r
   where r->>'post_id'=p_post_id and r->>'platform'=p_platform limit 1),v_row) into v_row;

  v_lines := array(select btrim(l) from unnest(string_to_array(regexp_replace(coalesce(v_row ->> 'text', ''), E'\\r', '', 'g'), E'\n')) l
                    where btrim(l) <> '');
  v_first := coalesce(v_lines[1], '');
  v_i := 2;
  while length(v_first) < 40 and v_i <= coalesce(array_length(v_lines, 1), 0) loop
    v_first := v_first || ' ' || v_lines[v_i]; v_i := v_i + 1;
  end loop;
  v_first := left(v_first, 200);
  v_author := v_row ->> 'author';
  v_src := case when p_platform = 'x' then 'x_viral' else 'competitor' end;

  if p_client = 'ivan' then
    insert into public.lm_idea_candidates (source, raw_topic, normalized_topic, evidence, status, content_type, source_ref, raw_context)
    values (v_src, left(coalesce(v_row ->> 'text', v_first), 4000), v_first,
      jsonb_build_array(jsonb_build_object(
        'who', v_author, 'tier', 'OBSERVATION', 'author', v_author, 'platform', p_platform,
        'excerpt', left(coalesce(v_row ->> 'text', ''), 600), 'url', v_row ->> 'url',
        'likes', v_row -> 'likes', 'reposts', v_row -> 'reposts', 'comments', v_row -> 'comments',
        'lift', v_row -> 'lift', 'baseline', v_row -> 'baseline', 'baseline_n', v_row -> 'baseline_n',
        'buyer', v_row -> 'buyer', 'traits', v_row -> 'traits', 'picked_via', 'inbox outliers: Use this')),
      'reviewing', 'post', v_ref,
      'Outlier from ' || v_author || ' (' || (v_row ->> 'lift') || 'x its author''s own median). Picked in the inbox Outliers view.')
    returning id into v_id;
    return jsonb_build_object('ok', true, 'created', true, 'id', v_id, 'table', 'lm_idea_candidates', 'status','reviewing', 'source_ref', v_ref);
  end if;

  insert into public.client_ideas (client_id, hook, title, source_label, source_ref, format, status, idea, score_breakdown, meta)
  values (p_client, v_first, left('Outlier from ' || v_author || ': ' || v_first, 140),
    case when p_platform = 'x' then 'From outliers (X)' else 'From outliers (LinkedIn)' end,
    v_ref, 'post', 'staged',
    jsonb_build_object('id', v_ref, 'kind', 'post', 'hook', v_first, 'status', 'idea', 'source_url', v_row ->> 'url',
                       'source_label', case when p_platform = 'x' then 'From outliers (X)' else 'From outliers (LinkedIn)' end,
                       'sourced_at', now()),
    jsonb_build_object('source_author', v_author, 'lift', v_row -> 'lift', 'baseline', v_row -> 'baseline',
                       'baseline_n', v_row -> 'baseline_n', 'likes', v_row -> 'likes', 'buyer', v_row -> 'buyer',
                       'traits', v_row -> 'traits'),
    jsonb_build_object('picked_via', 'inbox outliers: Use this', 'platform', p_platform, 'post_id', p_post_id, 'lane', 'outlier'))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'created', true, 'id', v_id, 'table', 'client_ideas', 'status','staged', 'source_ref', v_ref);
end;
$function$
;
select public.expire_client_ideas();
select cron.schedule('content-idea-expiry-weekly','15 7 * * 1','select public.expire_client_ideas();');
commit;
