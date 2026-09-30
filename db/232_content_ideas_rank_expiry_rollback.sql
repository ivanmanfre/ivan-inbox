begin;
select cron.unschedule(jobid) from cron.job where jobname='content-idea-expiry-weekly';
update public.client_ideas i set status=s.previous_status from public.content_idea_expiry_snapshots s where i.id=s.idea_id and i.status='archived';
drop function public.expire_client_ideas();
drop function public.operator_ranked_ideas(text,text);
drop table public.content_idea_expiry_snapshots;
CREATE OR REPLACE FUNCTION public.operator_outlier_use(p_gate text, p_client text, p_platform text, p_post_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ref text; v_row jsonb; v_id uuid; v_first text; v_author text; v_src text; v_lines text[]; v_i int;
begin
  if not public.operator_gate_ok(p_gate) then raise exception 'unauthorized'; end if;
  if p_client is null or p_client not in ('ivan', 'risedtc', 'arch') or not public.lane_allowed(p_client) then
    raise exception 'unknown seat';
  end if;
  if coalesce(p_platform, '') not in ('linkedin', 'x') or p_post_id is null or p_post_id !~ '^[0-9]+$' then
    raise exception 'bad outlier reference';
  end if;
  v_ref := 'outlier:' || p_platform || ':' || p_post_id;
  perform pg_advisory_xact_lock(hashtext('operator_outlier_use:' || p_client || ':' || v_ref));

  if p_client = 'ivan' then
    select l.id into v_id from public.lm_idea_candidates l where l.source_ref = v_ref order by l.created_at limit 1;
  else
    select ci.id into v_id from public.client_ideas ci where ci.client_id = p_client and ci.source_ref = v_ref;
  end if;
  if v_id is not null then
    return jsonb_build_object('ok', true, 'created', false, 'id', v_id, 'source_ref', v_ref);
  end if;

  select r into v_row
    from jsonb_array_elements(public.operator_outliers(p_gate, p_client, p_platform, null) -> 'rows') r
   where r ->> 'post_id' = p_post_id and r ->> 'platform' = p_platform
   limit 1;
  if v_row is null then raise exception 'not an outlier of this client'; end if;

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
      'pending', 'post', v_ref,
      'Outlier from ' || v_author || ' (' || (v_row ->> 'lift') || 'x its author''s own median). Picked in the inbox Outliers view.')
    returning id into v_id;
    return jsonb_build_object('ok', true, 'created', true, 'id', v_id, 'table', 'lm_idea_candidates', 'source_ref', v_ref);
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
  return jsonb_build_object('ok', true, 'created', true, 'id', v_id, 'table', 'client_ideas', 'source_ref', v_ref);
end;
$function$
;
commit;
