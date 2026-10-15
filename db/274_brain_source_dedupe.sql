-- 274: content brain never adapts the same winner post twice while an earlier draft of it is live.
-- Before: cb51_brain_enqueue_v3 / cb35_brain_enqueue only refused a source_ref already enqueued IN THE SAME run_id,
-- so any new run (weekly, manual, or the 10-09 compare-writer10b re-fire) could re-draft a winner that already had a
-- draft in review. Adds helper cb35_live_source_draft, guards both enqueue paths, and drops live-drafted winners from
-- cb51_brain_inputs' pool so the picker does not waste a pick on them. Rollback: 274_brain_source_dedupe_rollback.sql.
BEGIN;
CREATE OR REPLACE FUNCTION public.cb35_live_source_draft(p_client text, p_ref text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- oldest live draft adapted from this outlier source post for this account, or NULL.
  -- live = not archived/rejected/error/disqualified, not held for good ('final:' hold), not an internal test row.
  -- published/scheduled count as live: the same winner post is never adapted twice.
  SELECT d.id
  FROM carousel_drafts d
  LEFT JOIN cb34_p2_members m ON m.draft_id = d.id
  WHERE p_ref LIKE 'outlier:%'
    AND coalesce(d.client_id, 'ivan') = p_client
    AND (m.source_ref = p_ref OR d.taxonomy->>'source_ref' = p_ref OR d.source_post_id = p_ref)
    AND d.status NOT IN ('archived', 'rejected', 'error', 'disqualified')
    AND coalesce(m.hold_reason, '') NOT LIKE 'final:%'
    AND coalesce(d.taxonomy->>'internal_test', 'false') <> 'true'
  ORDER BY d.created_at
  LIMIT 1
$function$;
REVOKE ALL ON FUNCTION public.cb35_live_source_draft(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb35_live_source_draft(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.cb51_brain_enqueue_v3(p_client text, p_run text, p_pick jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '20s'
 SET lock_timeout TO '2s'
AS $function$
DECLARE live_src uuid; idea uuid := gen_random_uuid(); draft uuid := gen_random_uuid();
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
  -- db/274: one live draft per source post per account, across runs (the per-run check above missed the 10-09 re-drafts).
  -- A deliberate side-by-side redraft must name the live draft it is redrafting in p_pick.redraft_of.
  live_src := public.cb35_live_source_draft(p_client, ref);
  IF live_src IS NOT NULL AND live_src::text IS DISTINCT FROM nullif(p_pick->>'redraft_of','') THEN
    RAISE EXCEPTION 'source already drafted: % has live draft %', ref, live_src;
  END IF;

  author := CASE p_client WHEN 'ivan' THEN 'Ivan' WHEN 'risedtc' THEN 'Mattan Danino (Rise DTC)' ELSE 'Davorin Smit (ARCH)' END;
  notes := packet || E'\nSource: ' || url;
  brief := jsonb_build_object('source_url',url,'source_ref',ref,'why_this_post',why,'shape',contract#>>'{borrow,format}','slot','winner',
    'angle_check','n/a','source_author',p_pick->>'source_author','source_date',p_pick->>'source_date','source_ratio',p_pick->'source_ratio',
    'plan_slot',p_pick->>'plan_slot','topic_class',NULL,'fact_ids',coalesce(p_pick->'fact_ids','[]'::jsonb),'point',NULL,
    'brief_version','cb51-v3','brief_v3',contract,'check_source',checksrc,'pick_note',p_pick->'pick_note');
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

CREATE OR REPLACE FUNCTION public.cb35_brain_enqueue(p_client text, p_run text, p_pick jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '20s'
 SET lock_timeout TO '2s'
AS $function$
DECLARE live_src uuid; pat cb33_pattern_rates%ROWTYPE; idea uuid := gen_random_uuid(); draft uuid := gen_random_uuid();
  ref text := p_pick->>'source_ref'; url text := p_pick->>'source_url'; title text := btrim(coalesce(p_pick->>'title',''));
  hook text := btrim(coalesce(p_pick->>'hook', p_pick->>'title','')); why text := btrim(coalesce(p_pick->>'why_this_post',''));
  shape text := btrim(coalesce(p_pick->>'shape','')); peer text := coalesce(p_pick->>'source_text','');
  facts jsonb := coalesce(p_pick->'facts','[]'::jsonb); pillar text := coalesce(nullif(p_pick->>'pillar',''),'authority');
  author text; facts_txt text; notes text; brief jsonb; tax jsonb; payload jsonb; hookurl text; week date := (date_trunc('week', now() AT TIME ZONE 'UTC'))::date;
BEGIN
  IF p_client NOT IN ('ivan','risedtc','arch') THEN RAISE EXCEPTION 'unknown client'; END IF;
  IF p_run IS NULL OR p_run !~ '^cb35-' THEN RAISE EXCEPTION 'run id must start cb35-'; END IF;
  IF ref IS NULL OR ref !~ '^(outlier:(linkedin|x):[A-Za-z0-9_-]+|pattern:[a-z_]+=[a-z_]+)$' THEN RAISE EXCEPTION 'bad source_ref %', ref; END IF;
  IF url IS NULL OR url !~* '^https://' THEN RAISE EXCEPTION 'source_url must be https'; END IF;
  IF title='' OR why='' OR shape='' OR length(peer)<50 THEN RAISE EXCEPTION 'brief incomplete'; END IF;
  IF pillar NOT IN ('authority','personal','proof','claim','demand','reach') THEN RAISE EXCEPTION 'bad pillar'; END IF;
  SELECT * INTO pat FROM cb33_pattern_rates WHERE client_id=p_client AND active AND n>=25
    AND dimension=p_pick#>>'{pattern,dimension}' AND value=p_pick#>>'{pattern,value}';
  IF NOT FOUND THEN RAISE EXCEPTION 'pattern not a supported cell'; END IF;
  IF jsonb_typeof(facts) <> 'array' THEN RAISE EXCEPTION 'facts must be an array'; END IF;
  IF EXISTS (SELECT 1 FROM cb34_p2_members WHERE client_id=p_client AND source_ref=ref AND run_id=p_run) THEN RAISE EXCEPTION 'already enqueued in this run'; END IF;
  -- db/274: one live draft per source post per account, across runs (the per-run check above missed the 10-09 re-drafts).
  -- A deliberate side-by-side redraft must name the live draft it is redrafting in p_pick.redraft_of.
  live_src := public.cb35_live_source_draft(p_client, ref);
  IF live_src IS NOT NULL AND live_src::text IS DISTINCT FROM nullif(p_pick->>'redraft_of','') THEN
    RAISE EXCEPTION 'source already drafted: % has live draft %', ref, live_src;
  END IF;

  author := CASE p_client WHEN 'ivan' THEN 'Ivan' WHEN 'risedtc' THEN 'Mattan Danino (Rise DTC)' ELSE 'Davorin Smit (ARCH)' END;
  SELECT coalesce(string_agg('- "'||(f #>> '{}')||'"', E'\n'),'') INTO facts_txt FROM jsonb_array_elements(facts) f;
  notes := 'Content brain brief. Borrow the STRUCTURE only from a breakout post by ' || coalesce(p_pick->>'source_author','another creator')
    || ': ' || shape || E'\nWhy this post: ' || why
    || E'\nPattern: ' || pat.dimension || '=' || pat.value || ' (n=' || pat.n || ', breakout rate ' || round(pat.rate*100,1) || '% vs base ' || round(pat.base_rate*100,1) || '%). Niche evidence, never the author''s own result.'
    || CASE WHEN facts_txt<>'' THEN E'\nThe author''s own facts you may use (verbatim records):\n' || facts_txt ELSE E'\nNo author facts supplied: write opinion or how-to, no first-person results.' END
    || E'\nUse no other numbers, names, dates, results or events. Never present the peer post''s story, numbers or clients as the author''s.'
    || E'\nSource: ' || url;
  brief := jsonb_build_object('source_url',url,'source_ref',ref,'why_this_post',why,'shape',shape,'slot',p_pick->>'slot',
    'angle_check',p_pick->>'angle_check','source_author',p_pick->>'source_author',
    'plan_slot',p_pick->>'plan_slot','topic_class',CASE WHEN p_pick#>>'{pattern,dimension}'='topic_class' THEN p_pick#>>'{pattern,value}' END,
    'fact_ids',coalesce(p_pick->'fact_ids','[]'::jsonb),'point',p_pick->'point',
    'pattern',jsonb_build_object('dimension',pat.dimension,'value',pat.value,'n',pat.n,'rate',pat.rate,'base_rate',pat.base_rate,'lift',pat.lift,'study_id',pat.study_id));
  tax := jsonb_build_object('source','content-brain','source_ref',ref,'pillar',pillar,'brain_brief',brief,
    'content_brain',jsonb_build_object('run_id',p_run,'week_start',week,'validation_pending',true));

  IF p_client='ivan' THEN
    INSERT INTO lm_idea_candidates(id,source,raw_topic,evidence,raw_context,status,content_type,source_ref,lane,planned_format,promoted_draft_id,promoted_draft_table)
    VALUES (idea,'manual',title,(SELECT coalesce(jsonb_agg(jsonb_build_object('who','Ivan','tier','FACT','quote',f #>> '{}','source','content-brain:'||ref)),'[]') FROM jsonb_array_elements(facts) f),
            notes,'promoted','post',ref,'content_brain','text',draft,'carousel_drafts');
    tax := tax || jsonb_build_object('source_candidate_id',idea);
    INSERT INTO carousel_drafts(id,title,topic,type,status,client_id,board_visible,scheduled_at,description,source_label,taxonomy,key_points)
    VALUES (draft,title,hook,'text','planned',NULL,false,NULL,notes,'Content brain',tax,NULL);
    hookurl := 'https://n8n.ivanmanfredi.com/webhook/post-gen-v2';
    payload := jsonb_build_object('draft_id',draft,'title',title,'topic',hook,'author','Ivan','source','content-brain',
      'post_format','Text Post','post_format_details','standard text post','include_image','No','editorial_notes',notes);
  ELSE
    INSERT INTO client_ideas(id,client_id,hook,title,source_label,source_ref,pillar,format,status,idea,taxonomy,meta,lane,planned_format,approved_at)
    VALUES (idea,p_client,hook,title,'Content brain',ref||'#'||left(idea::text,8),pillar,'text','live',  -- (client_id, source_ref) is unique; canonical ref lives on the draft + member
            jsonb_build_object('specifics',facts,'story',NULL,'brief',brief),
            jsonb_build_object('source','content-brain','brain_brief',brief),
            jsonb_build_object('editorial_brief',notes,'content_brain_run',p_run),'content_brain','text',now());
    INSERT INTO carousel_drafts(id,client_id,title,topic,type,status,board_visible,scheduled_at,description,source_post_id,source_label,source_detail,client_idea_id,taxonomy)
    VALUES (draft,p_client,title,hook,'text','planned',false,NULL,notes,ref,'Content brain',
            -- cb41 item 4: Rise's Fetch Past Posts skips internal_only='true' (text compare). The STRING keeps every JS reader
            -- (=== true) unchanged; the rest is the exact object backfill_draft_provenance would write. Release removes the marker.
            CASE WHEN p_client='risedtc' THEN jsonb_build_object('kind','idea','label','Content brain','sourced_at',to_char(now(),'YYYY-MM-DD'),
              'internal_only','true','brain_held',true) END,idea,tax);
    hookurl := CASE p_client WHEN 'risedtc' THEN 'https://n8n.ivanmanfredi.com/webhook/rise-dtc-post-gen-v2-max' ELSE 'https://n8n.ivanmanfredi.com/webhook/arch-post-gen-v2' END;
    payload := jsonb_build_object('draft_id',draft,'title',title,'topic',hook,'source','client-'||p_client,'author',author,
      'include_image','No','keep_gate',true,'post_format','text','post_format_details','',
      'editorial_notes','pillar: '||pillar||E'\n'||notes,'register',NULL,'story_ref',NULL,'consent_tier',NULL,'client_id',p_client,
      'brand',CASE p_client WHEN 'risedtc' THEN jsonb_build_object('wordmark_html','RISE DTC','domain','risedtc.com') ELSE jsonb_build_object('wordmark_html','ARCH','domain','arch.agency') END);
  END IF;

  INSERT INTO cb34_p2_members(draft_id,client_id,run_id,week_start,candidate_id,client_idea_id,source_ref,source_text,owned_source,brief,state)
  VALUES (draft,p_client,p_run,week,CASE WHEN p_client='ivan' THEN idea END,CASE WHEN p_client<>'ivan' THEN idea END,ref,peer,
          CASE WHEN jsonb_array_length(facts)>0 THEN facts::text ELSE 'no owned facts supplied' END,
          brief || jsonb_build_object('notes',notes,'author',author,'webhook',hookurl,'payload',payload),'held');
  RETURN jsonb_build_object('draft_id',draft,'idea_id',idea,'webhook',hookurl,'payload',payload);
END $function$;

CREATE OR REPLACE FUNCTION public.cb51_brain_inputs(p_client text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '30s'
AS $function$
DECLARE pool jsonb; facts jsonb; cf text; last3 jsonb; v_slug text;
BEGIN
  IF p_client NOT IN ('ivan','risedtc','arch') THEN RAISE EXCEPTION 'unknown client'; END IF;
  v_slug := CASE p_client WHEN 'ivan' THEN 'ivan-company-facts' WHEN 'risedtc' THEN 'rise-company-facts' ELSE 'arch-company-facts' END;
  SELECT coalesce(jsonb_agg(jsonb_build_object('ref', s.post_ref, 'author', s.author_ref, 'date', to_char(s.published_at AT TIME ZONE 'UTC','YYYY-MM-DD'),
      'ratio', round(s.ratio::numeric,2), 'likes', s.likes, 'comments', s.comments, 'url', v.source_url, 'text', v.post_text, 'post_type', v.post_type)
      ORDER BY s.ratio DESC), '[]'::jsonb) INTO pool
  FROM outlier_post_scores s
  JOIN outlier_current_study_v cs ON cs.client_id=s.client_id AND cs.study_id=s.study_id
  JOIN outlier_corpus_v v ON v.client_id=s.client_id AND v.post_ref=s.post_ref
  WHERE s.client_id=p_client AND s.is_outlier_3x AND s.published_at > now() - interval '45 days' AND coalesce(btrim(v.post_text),'') <> ''
    -- db/274: a winner that already has a live draft for this account never re-enters the picker's pool
    AND public.cb35_live_source_draft(p_client, 'outlier:linkedin:' || s.post_ref) IS NULL;
  -- the two 08-11 lines filed as Ivan's stay out until he confirms them (open fact question)
  SELECT coalesce(jsonb_agg(jsonb_build_object('fact_id', f.fact_id, 'tier', f.tier, 'topic', f.topic, 'who', f.who, 'ownership', f.ownership,
      'source_table', f.source_table, 'sd', to_char(f.source_date AT TIME ZONE 'UTC','YYYY-MM-DD'), 'quote', f.quote) ORDER BY f.source_date DESC, f.fact_id), '[]'::jsonb) INTO facts
  FROM cb38_fact_packs f
  WHERE f.client_id=p_client AND f.active AND NOT coalesce(f.hypothetical,false) AND f.public_ok
    AND f.fact_id <> 'ivan-3aab9091ea' AND f.quote !~* 'greatest markets for influencer';
  SELECT body INTO cf FROM content_prompts WHERE slug=v_slug LIMIT 1;
  IF p_client='ivan' THEN
    SELECT coalesce(jsonb_agg(t ORDER BY at DESC), '[]'::jsonb) INTO last3 FROM (
      SELECT at, t FROM (
        SELECT o.posted_at AS at, left(o.post_text,1200) AS t FROM own_posts o WHERE coalesce(o.post_text,'')<>'' AND o.posted_at > now() - interval '60 days'
        UNION ALL
        SELECT d.scheduled_at, left(d.post_body,1200) FROM carousel_drafts d WHERE d.client_id IS NULL AND d.status='scheduled' AND coalesce(d.post_body,'')<>''
      ) u ORDER BY at DESC NULLS LAST LIMIT 3) z;
  ELSE
    SELECT coalesce(jsonb_agg(t ORDER BY at DESC), '[]'::jsonb) INTO last3 FROM (
      SELECT coalesce(d.scheduled_at, d.published_at) AS at, left(d.post_body,1200) AS t FROM carousel_drafts d
      WHERE d.client_id=p_client AND d.status IN ('published','scheduled') AND coalesce(d.post_body,'')<>''
      ORDER BY coalesce(d.scheduled_at, d.published_at) DESC NULLS LAST LIMIT 3) z;
  END IF;
  RETURN jsonb_build_object('pool', pool, 'facts', facts, 'company_facts', coalesce(cf,''), 'history', public.cb51_brain_history(p_client, false), 'last3', last3);
END $function$;

COMMIT;
