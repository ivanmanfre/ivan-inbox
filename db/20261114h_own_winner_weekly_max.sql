-- 20261114h: per-seat weekly own-winner max for the content brain (cb60 'lean on what worked').
-- Was a hard one own-winner pick per seat per week (db/278). Now integration_config
-- cb51_own_winner_weekly_max_<seat> (1 or 2, default 1). Set: risedtc 2, arch 2, ivan stays 1.
-- Evidence (7-14 day reads vs own trailing median, proxy-judge source labels, 2026-11-14):
--   RISE own-winner repurposes 2/3 beat (median 1.12x); RISE adaptations of other people's posts 2/12 (0.41x)
--   ARCH own-winner repurposes 2/3 beat (1.16x); ARCH call material 3/8 (0.96x)
-- Only the count changes; every other own-winner rule (real post of this seat, >=2x median, cooldown, redraft override) is untouched.
-- Rollback: 20261114h_own_winner_weekly_max_rollback.sql (restores the two functions verbatim).
begin;
create or replace function public.cb51_own_winner_weekly_max(p_client text)
returns integer language sql stable security definer set search_path to 'public','pg_temp'
as $$
  select case when v ~ '^[12]$' then v::int else 1 end
  from (select coalesce((select btrim(value) from public.integration_config where key = 'cb51_own_winner_weekly_max_' || p_client), '1') as v) z
$$;
revoke all on function public.cb51_own_winner_weekly_max(text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cb51_own_winners(p_client text, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH base AS (
    SELECT m.social_id, m.post_url, m.published_at, m.impressions, m.reactions, m.comments,
           nullif(btrim(coalesce(ft.t, m.meta ->> 'text')), '') AS body, substring(m.social_id FROM '([0-9]{6,})$') AS num
      FROM public.client_post_metrics m
      -- meta.text is cut at 500 chars; the full text lives in own_posts (Ivan) or client_post_state (client seats)
      LEFT JOIN LATERAL (
        SELECT t FROM (
          SELECT o.post_text AS t FROM public.own_posts o
           WHERE p_client = 'ivan' AND o.social_id ~ (':' || substring(m.social_id FROM '([0-9]{6,})$') || '$') AND coalesce(o.post_text, '') <> ''
          UNION ALL
          SELECT s.post_text FROM public.client_post_state s
           WHERE p_client <> 'ivan' AND s.client_id = p_client AND s.post_urn ~ (':' || substring(m.social_id FROM '([0-9]{6,})$') || '$') AND coalesce(s.post_text, '') <> ''
        ) z ORDER BY length(t) DESC LIMIT 1) ft ON true
     WHERE m.client_id = p_client AND p_client IN ('ivan', 'risedtc', 'arch')
       AND m.published_at > p_now - interval '90 days' AND m.published_at <= p_now
       AND m.impressions > 0
       AND coalesce(m.meta ->> 'is_repost', 'false') <> 'true'
       AND NOT coalesce(m.meta ? 'job_posting', false)
       -- 2026-11-06 build 09: a paid (boost-marked) post is not proof of what works organically; out of the median and the pool
       AND NOT EXISTS (SELECT 1 FROM public.own_post_boost_current_v bb
                        WHERE bb.client_id = p_client AND bb.boosted IS TRUE
                          AND bb.post_ref IN (substring(m.social_id FROM '([0-9]{16,20})$'), substring(coalesce(m.post_url, '') FROM 'activity[-:]([0-9]{16,20})')))),
  med AS (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY b.impressions)::numeric AS md, count(*) AS n
      FROM base b WHERE b.published_at < p_now - interval '3 days'),
  used AS (
    -- cb60 2026-11-14: the seat's weekly own-winner max (integration_config cb51_own_winner_weekly_max_<seat>, 1..2, default 1)
    SELECT (SELECT count(*) FROM public.cb34_p2_members x
             WHERE x.client_id = p_client AND x.source_ref LIKE 'outlier:linkedin:own-%'
               AND x.week_start = (date_trunc('week', p_now AT TIME ZONE 'UTC'))::date)
           >= public.cb51_own_winner_weekly_max(p_client) AS yes),
  cand AS (
    SELECT b.*, 'own-' || p_client || '-' || b.num AS ref, med.md
      FROM base b, med, used
     WHERE NOT used.yes AND med.n >= 5 AND med.md > 0 AND b.impressions >= 2 * med.md
       -- a stub caption (a video post's one-liner) holds nothing the text writer can learn from
       AND length(coalesce(b.body, '')) >= 150 AND b.num IS NOT NULL AND b.post_url ~* '^https://'
       AND public.cb35_live_source_draft(p_client, 'outlier:linkedin:own-' || p_client || '-' || b.num) IS NULL
       AND public.cb35_source_cooldown(p_client, 'outlier:linkedin:own-' || p_client || '-' || b.num, NULL, 21) IS NULL
     ORDER BY b.impressions DESC
     LIMIT 8)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'ref', c.ref, 'kind', 'own_winner',
           'author', CASE p_client WHEN 'ivan' THEN 'Ivan Manfredi' WHEN 'risedtc' THEN 'Mattan Danino' ELSE 'Davorin Smit' END || ' (own post)',
           'date', to_char(c.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
           'ratio', round(c.impressions / c.md, 2), 'likes', c.reactions, 'comments', c.comments,
           'impressions', c.impressions, 'median_impressions', round(c.md),
           'url', c.post_url, 'text', c.body, 'post_type', NULL)
         ORDER BY c.impressions DESC), '[]'::jsonb)
    FROM cand c
$function$;

CREATE OR REPLACE FUNCTION public.cb51_brain_enqueue_v3(p_client text, p_run text, p_pick jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '20s'
 SET lock_timeout TO '2s'
AS $function$
DECLARE live_src uuid; cool jsonb; v_own boolean; v_num text; idea uuid := gen_random_uuid(); draft uuid := gen_random_uuid();
  ref text := p_pick->>'source_ref'; url text := p_pick->>'source_url'; title text := btrim(coalesce(p_pick->>'title',''));
  hook text := btrim(coalesce(p_pick->>'hook', p_pick->>'title','')); why text := btrim(coalesce(p_pick->>'why_this_post',''));
  peer text := coalesce(p_pick->>'source_text',''); packet text := coalesce(p_pick->>'packet','');
  checksrc text := coalesce(p_pick->>'check_source',''); pillar text := coalesce(nullif(p_pick->>'pillar',''),'authority');
  contract jsonb := p_pick->'brief_v3'; own jsonb := coalesce(p_pick->'own_quotes','[]'::jsonb);
  author text; notes text; brief jsonb; tax jsonb; payload jsonb; hookurl text; week date := (date_trunc('week', now() AT TIME ZONE 'UTC'))::date;
BEGIN
  IF p_client NOT IN ('ivan','risedtc','arch') THEN RAISE EXCEPTION 'unknown client'; END IF;
  IF p_run IS NULL OR p_run !~ '^cb35-' THEN RAISE EXCEPTION 'run id must start cb35-'; END IF;
  IF ref IS NULL OR ref !~ '^outlier:linkedin:[A-Za-z0-9_-]+$' THEN RAISE EXCEPTION 'bad source_ref %', ref; END IF;
  IF url IS NULL OR url !~* '^https://' THEN RAISE EXCEPTION 'source_url must be https'; END IF;
  IF title='' OR why='' OR length(peer)<50 OR length(packet)<200 OR length(checksrc)<50 THEN RAISE EXCEPTION 'brief incomplete'; END IF;
  IF contract IS NULL OR jsonb_typeof(contract)<>'object' OR jsonb_typeof(contract->'claims')<>'array' OR coalesce(contract#>>'{borrow,format}','')='' THEN RAISE EXCEPTION 'brief_v3 contract incomplete'; END IF;
  IF pillar NOT IN ('authority','personal','proof','claim','demand','reach') THEN RAISE EXCEPTION 'bad pillar'; END IF;
  IF jsonb_typeof(own) <> 'array' THEN RAISE EXCEPTION 'own_quotes must be an array'; END IF;
  IF EXISTS (SELECT 1 FROM cb34_p2_members WHERE client_id=p_client AND source_ref=ref AND run_id=p_run) THEN RAISE EXCEPTION 'already enqueued in this run'; END IF;
  -- db/278: an own-winner pick must name a real post of THIS seat, and a seat gets at most one own-winner pick per week
  -- (a deliberate redraft naming an earlier draft of the same source in redraft_of is the override, as in db/274).
  v_own := ref LIKE 'outlier:linkedin:own-%';
  IF v_own THEN
    v_num := substring(ref FROM '^outlier:linkedin:own-' || p_client || '-([0-9]{6,})$');
    IF v_num IS NULL OR NOT EXISTS (SELECT 1 FROM client_post_metrics cm WHERE cm.client_id = p_client AND cm.social_id ~ (':' || v_num || '$')) THEN
      RAISE EXCEPTION 'own winner % is not a post of %', ref, p_client;
    END IF;
    IF (SELECT count(*) FROM cb34_p2_members ow WHERE ow.client_id = p_client AND ow.week_start = week AND ow.source_ref LIKE 'outlier:linkedin:own-%')
         >= public.cb51_own_winner_weekly_max(p_client)  -- cb60 2026-11-14: per-seat max, default 1
       AND NOT EXISTS (SELECT 1 FROM carousel_drafts rd LEFT JOIN cb34_p2_members rm ON rm.draft_id = rd.id
                        WHERE rd.id::text = nullif(p_pick->>'redraft_of','') AND coalesce(rd.client_id,'ivan') = p_client
                          AND (rm.source_ref = ref OR rd.taxonomy->>'source_ref' = ref OR rd.source_post_id = ref)) THEN
      RAISE EXCEPTION 'own winner weekly max (%) already picked this week for %', public.cb51_own_winner_weekly_max(p_client), p_client;
    END IF;
  END IF;
  -- db/274: one live draft per source post per account, across runs (the per-run check above missed the 10-09 re-drafts).
  -- A deliberate side-by-side redraft must name the live draft it is redrafting in p_pick.redraft_of.
  live_src := public.cb35_live_source_draft(p_client, ref);
  IF live_src IS NOT NULL AND live_src::text IS DISTINCT FROM nullif(p_pick->>'redraft_of','') THEN
    RAISE EXCEPTION 'source already drafted: % has live draft %', ref, live_src;
  END IF;
  -- db/277: 21-day cooldown per seat on the same source post or the same author; redraft_of naming an earlier
  -- draft of this same source is the deliberate-redraft override.
  cool := public.cb35_source_cooldown(p_client, ref, p_pick->>'source_author', 21);
  IF cool IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM carousel_drafts rd LEFT JOIN cb34_p2_members rm ON rm.draft_id = rd.id
       WHERE rd.id::text = nullif(p_pick->>'redraft_of','') AND coalesce(rd.client_id,'ivan') = p_client
         AND (rm.source_ref = ref OR rd.taxonomy->>'source_ref' = ref OR rd.source_post_id = ref)) THEN
    RAISE EXCEPTION 'source on cooldown: % (% rule, earlier draft %, free after %)', ref, cool->>'rule', cool->>'draft_id', cool->>'until';
  END IF;

  author := CASE p_client WHEN 'ivan' THEN 'Ivan' WHEN 'risedtc' THEN 'Mattan Danino (Rise DTC)' ELSE 'Davorin Smit (ARCH)' END;
  notes := packet || E'\nSource: ' || url;
  brief := jsonb_build_object('source_url',url,'source_ref',ref,'why_this_post',why,'shape',contract#>>'{borrow,format}','slot','winner',
    'angle_check','n/a','source_author',p_pick->>'source_author','source_date',p_pick->>'source_date','source_ratio',p_pick->'source_ratio',
    'plan_slot',p_pick->>'plan_slot','topic_class',NULL,'fact_ids',coalesce(p_pick->'fact_ids','[]'::jsonb),'point',NULL,
    'brief_version','cb51-v3','brief_v3',contract,'check_source',checksrc,'pick_note',p_pick->'pick_note');
  IF v_own THEN brief := brief || jsonb_build_object('source_kind','own_winner'); END IF;  -- db/278
  tax := jsonb_build_object('source','content-brain','source_ref',ref,'pillar',pillar,'brain_brief',brief - 'check_source',
    'content_brain',jsonb_build_object('run_id',p_run,'week_start',week,'validation_pending',true,'brief_version','cb51-v3'));

  IF p_client='ivan' THEN
    INSERT INTO lm_idea_candidates(id,source,raw_topic,evidence,raw_context,status,content_type,source_ref,lane,planned_format,promoted_draft_id,promoted_draft_table)
    VALUES (idea,'manual',title,(SELECT coalesce(jsonb_agg(jsonb_build_object('who','Ivan','tier','FACT','quote',f #>> '{}','source','content-brain:'||ref)),'[]') FROM jsonb_array_elements(own) f),
            notes,'promoted','post',ref,'content_brain','text',draft,'carousel_drafts');
    tax := tax || jsonb_build_object('source_candidate_id',idea);
    INSERT INTO carousel_drafts(id,title,topic,type,status,client_id,board_visible,scheduled_at,description,source_label,taxonomy,key_points)
    VALUES (draft,title,hook,'text','planned',NULL,false,NULL,notes,'Content brain',tax,NULL);
    hookurl := 'https://n8n.ivanmanfredi.com/webhook/post-gen-v2';
    payload := jsonb_build_object('draft_id',draft,'title',title,'topic',hook,'author','Ivan','source','content-brain',
      'post_format','Text Post','post_format_details','standard text post','include_image','No','editorial_notes',notes,
      'brief_v3',jsonb_build_object('version','cb51-v3','format',contract#>>'{borrow,format}','structure',coalesce(contract->'structure','[]'::jsonb),
        'packet',packet,'own_lines',coalesce(p_pick->'own_lines','[]'::jsonb),'winner_line',p_pick->>'winner_line'));
  ELSE
    INSERT INTO client_ideas(id,client_id,hook,title,source_label,source_ref,pillar,format,status,idea,taxonomy,meta,lane,planned_format,approved_at)
    VALUES (idea,p_client,hook,title,'Content brain',ref||'#'||left(idea::text,8),pillar,'text','live',
            jsonb_build_object('specifics',own,'story',NULL,'brief',brief - 'check_source'),
            jsonb_build_object('source','content-brain','brain_brief',brief - 'check_source'),
            jsonb_build_object('editorial_brief',notes,'content_brain_run',p_run),'content_brain','text',now());
    INSERT INTO carousel_drafts(id,client_id,title,topic,type,status,board_visible,scheduled_at,description,source_post_id,source_label,source_detail,client_idea_id,taxonomy)
    VALUES (draft,p_client,title,hook,'text','planned',false,NULL,notes,ref,'Content brain',
            CASE WHEN p_client='risedtc' THEN jsonb_build_object('kind','idea','label','Content brain','sourced_at',to_char(now(),'YYYY-MM-DD'),
              'internal_only','true','brain_held',true) END,idea,tax);
    hookurl := CASE p_client WHEN 'risedtc' THEN 'https://n8n.ivanmanfredi.com/webhook/rise-dtc-post-gen-v2-max' ELSE 'https://n8n.ivanmanfredi.com/webhook/arch-post-gen-v2' END;
    payload := jsonb_build_object('draft_id',draft,'title',title,'topic',hook,'source','client-'||p_client,'author',author,
      'include_image','No','keep_gate',true,'post_format','text','post_format_details','',
      'editorial_notes','pillar: '||pillar||E'\n'||notes,'register',NULL,'story_ref',NULL,'consent_tier',NULL,'client_id',p_client,
      'brand',CASE p_client WHEN 'risedtc' THEN jsonb_build_object('wordmark_html','RISE DTC','domain','risedtc.com') ELSE jsonb_build_object('wordmark_html','ARCH','domain','arch.agency') END,
      'brief_v3',jsonb_build_object('version','cb51-v3','format',contract#>>'{borrow,format}','structure',coalesce(contract->'structure','[]'::jsonb)));
  END IF;

  INSERT INTO cb34_p2_members(draft_id,client_id,run_id,week_start,candidate_id,client_idea_id,source_ref,source_text,owned_source,brief,state)
  VALUES (draft,p_client,p_run,week,CASE WHEN p_client='ivan' THEN idea END,CASE WHEN p_client<>'ivan' THEN idea END,ref,peer,
          checksrc, brief || jsonb_build_object('notes',notes,'author',author,'webhook',hookurl,'payload',payload),'held');
  RETURN jsonb_build_object('draft_id',draft,'idea_id',idea,'webhook',hookurl,'payload',payload);
END $function$;

insert into public.integration_config (key, value) values ('cb51_own_winner_weekly_max_risedtc','2'),('cb51_own_winner_weekly_max_arch','2')
  on conflict (key) do update set value = excluded.value, updated_at = now();
commit;
