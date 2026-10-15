-- Rollback db/278: restore the pre-278 live bodies (captured 2026-10-15) and drop cb51_own_winners.
BEGIN;
CREATE OR REPLACE FUNCTION public.cb35_source_author(p_client text, p_ref text, p_hint text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT nullif(lower(btrim(coalesce(
    (SELECT s.author_ref FROM public.outlier_post_scores s
      WHERE s.client_id = p_client AND p_ref LIKE 'outlier:linkedin:%' AND s.post_ref = substr(p_ref, 18) AND s.author_ref IS NOT NULL
      ORDER BY s.created_at DESC LIMIT 1),
    p_hint, ''))), '')
$function$
;


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
    AND public.cb35_live_source_draft(p_client, 'outlier:linkedin:' || s.post_ref) IS NULL
    -- db/277: nor a winner whose post or author this seat drafted in the last 21 days
    AND public.cb35_source_cooldown(p_client, 'outlier:linkedin:' || s.post_ref, s.author_ref, 21) IS NULL;
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


CREATE OR REPLACE FUNCTION public.cb51_brain_enqueue_v3(p_client text, p_run text, p_pick jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '20s'
 SET lock_timeout TO '2s'
AS $function$
DECLARE live_src uuid; cool jsonb; idea uuid := gen_random_uuid(); draft uuid := gen_random_uuid();
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


CREATE OR REPLACE FUNCTION public.content_plan_post_evidence(p_draft uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare d public.carousel_drafts%rowtype; ev jsonb := '[]'::jsonb; ci public.client_ideas%rowtype; call_title text; call_at timestamptz; ts text;
  m record; o record;
begin
  select * into d from public.carousel_drafts where id = p_draft;
  if not found then return ev; end if;
  if d.taxonomy ? 'lead_magnet' then
    ev := ev || jsonb_build_array(jsonb_build_object('type','lead_magnet','label','Lead magnet launch'
      || case when (d.taxonomy->>'paid_boost') = 'true' then ', boosted with paid ads' else '' end));
  end if;
  if jsonb_typeof(d.source_detail) = 'object' and d.source_detail->>'kind' = 'user_approved_series' then
    ev := ev || jsonb_build_array(jsonb_build_object('type','series','label','Series you approved, part ' || coalesce(d.source_detail->>'option','?')));
  end if;
  if d.taxonomy->>'source' = 'ivan-film-script' then
    ev := ev || jsonb_build_array(jsonb_build_object('type','own_source','label','Your own words from the service-film script'));
  end if;
  if d.client_idea_id is not null then
    select * into ci from public.client_ideas where id = d.client_idea_id;
    if found then
      ts := ci.meta->>'source_ts';
      if ci.lane in ('sales_call','fireflies_call') or ci.source_ref ~ '^(fc|ffc|ffr)-' then
        if ts ~ '\|' then
          begin call_at := split_part(ts,'|',2)::timestamptz; exception when others then call_at := null; end;
        end if;
        if call_at is not null then
          select t.title into call_title from public.transcripts t
           where t.source in ('fathom-risedtc','fireflies-arch') and t.date between call_at - interval '3 minutes' and call_at + interval '3 minutes'
           order by abs(extract(epoch from t.date - call_at)) limit 1;
        end if;
        -- The transcript lookup can miss (hand-staged ideas): fall back to the call the idea itself records.
        if call_title is null then call_title := nullif(coalesce(ci.idea->'source_detail'->>'call_title', ci.meta->'source_detail'->>'call_title'),''); end if;
        if call_at is null then
          begin call_at := coalesce(ci.idea->'source_detail'->>'call_date', ci.meta->'source_detail'->>'call_date')::date::timestamptz; exception when others then call_at := null; end;
        end if;
        ev := ev || jsonb_build_array(jsonb_build_object('type','call','label',
          case when call_title is null and call_at is null then 'From a client call' else 'From the call' end
          || coalesce(' "' || call_title || '"','') || coalesce(' on ' || to_char(call_at at time zone 'Europe/Warsaw','FMDD Mon'),''),
          'at', call_at, 'ref', ci.source_ref));
      elsif ci.lane = 'winner_repurpose' or ci.source_label ilike '%winner%' then
        ev := ev || jsonb_build_array(jsonb_build_object('type','past_winner','label','Re-run of a past winner'));
      elsif ci.source_label is not null then
        ev := ev || jsonb_build_array(jsonb_build_object('type','idea','label',ci.source_label));
      end if;
    end if;
  end if;
  select mm.source_ref, mm.brief into m from public.cb34_p2_members mm where mm.draft_id = d.id order by mm.created_at desc limit 1;
  if found and m.source_ref like 'outlier:linkedin:%' then
    select os.ratio into o from public.outlier_post_scores os
     where os.client_id = coalesce(d.client_id,'ivan') and os.post_ref = split_part(m.source_ref, ':', 3) order by os.created_at desc limit 1;
    ev := ev || jsonb_build_array(jsonb_build_object('type','outlier','label','Niche outlier the Content Brain adapted'
      || case when o.ratio is not null then ', ' || round(o.ratio::numeric,1) || 'x its author''s usual' else '' end, 'ref', m.source_ref));
  elsif found then
    ev := ev || jsonb_build_array(jsonb_build_object('type','brain','label','Content Brain draft', 'ref', m.source_ref));
  end if;
  if d.source_label = 'proven-winner-mirror' or d.taxonomy->>'source' = 'proven-winner-mirror' then
    ev := ev || jsonb_build_array(jsonb_build_object('type','past_winner','label','Mirror of a proven winner'));
  end if;
  if d.taxonomy->>'pillar' = 'personal' then
    ev := ev || jsonb_build_array(jsonb_build_object('type','founder','label','Founder story (max 2 a week)'));
  end if;
  if jsonb_array_length(ev) = 0 then
    if (d.taxonomy->>'approval') like 'explicit-user%' or (jsonb_typeof(d.source_detail) = 'object' and d.source_detail ? 'authorization') or d.source_label = 'manual' then
      ev := jsonb_build_array(jsonb_build_object('type','approved','label','Written by hand and approved by you'));
    elsif d.source_label is not null then
      ev := jsonb_build_array(jsonb_build_object('type','idea','label',d.source_label));
    elsif d.taxonomy->>'pillar' is not null then
      ev := jsonb_build_array(jsonb_build_object('type','pillar','label','Pillar: ' || replace(d.taxonomy->>'pillar','_',' ')));
    end if;
  end if;
  return ev;
end $function$
;


CREATE OR REPLACE FUNCTION public.content_plan_week(p_account text, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '15s'
AS $function$
declare
  cfg public.content_plan_config%rowtype;
  v_today date := (p_now at time zone 'Europe/Warsaw')::date;
  w0 date; target int; lm_target int; pol jsonb;
  weeks jsonb := '[]'::jsonb; wk date; i int; posts jsonb; planned jsonb; n_posts int; n_planned int; target_week date := null;
  done jsonb; supply jsonb; warnings jsonb := '[]'::jsonb; last_run jsonb; n int; open_target int := 0;
  founder_n int; photos int; fresh_proof int; r record;
  -- db/259: brain data
  v_done_ids uuid[]; v_ids uuid[]; v_brain jsonb; v_blank jsonb; v_med numeric; v_items jsonb; v_xdays jsonb := '[]'::jsonb; v_strip jsonb;
  b_weeks jsonb; b_supply jsonb; b_warn jsonb; b_done jsonb; v_rule record; v_max int; v_min int; v_err text;
  v_tz text := case when p_account = 'risedtc' then 'America/Los_Angeles' else 'Europe/Warsaw' end;
begin
  if not public.cb39_lane_ok(p_account) then raise exception 'unknown seat'; end if;
  select * into cfg from public.content_plan_config where account = p_account;
  if not found then raise exception 'no plan config for %', p_account; end if;
  w0 := v_today - (extract(isodow from v_today)::int - 1);
  if p_account = 'ivan' then
    select (variables[1])::jsonb into pol from public.content_prompts where slug = 'format-mix-policy-2026' and is_active order by updated_at desc limit 1;
  end if;
  target := coalesce(cfg.posts_per_week, (pol->>'max_posts_per_week')::int);
  lm_target := coalesce(cfg.lm_per_week, (pol->>'lm_carousel_per_week')::int, 0);
  if target is null then raise exception 'no cadence for %', p_account; end if;

  for i in 0..2 loop
    wk := w0 + 7*i;
    -- Posts already holding a slot: dated drafts on the Warsaw week, plus Ivan's publish-queue rows with no draft.
    select coalesce(jsonb_agg(x.j order by x.at), '[]'::jsonb), count(*) into posts, n_posts from (
      select coalesce(d.published_at, d.scheduled_at) at, jsonb_build_object(
        'kind','post','draft_id', d.id, 'title', coalesce(nullif(d.title,''), left(d.post_body, 80)),
        'day', (coalesce(d.published_at, d.scheduled_at) at time zone 'Europe/Warsaw')::date,
        'at', coalesce(d.published_at, d.scheduled_at), 'status', d.status,
        'format', d.type, 'lead_magnet', d.taxonomy ?| array['lead_magnet','lead_magnet_slug','gate_keyword'] or exists (select 1 from public.scheduled_posts q0
            where q0.clickup_task_id = d.id::text and (q0.post_kind = 'capture' or q0.lead_magnet_slug is not null)),
        'founder', d.taxonomy->>'pillar' = 'personal',
        'picture', case when d.type in ('carousel','pdf') then 'carousel deck' when d.type = 'video' then 'video'
                        when coalesce(array_length(d.image_urls,1),0) > 0 then 'picture' else 'no picture' end,
        'board_visible', d.board_visible,
        'evidence', public.content_plan_post_evidence(d.id)) j
      from public.carousel_drafts d
      where (case when p_account = 'ivan' then d.client_id is null else d.client_id = p_account end)
        and d.status in ('review','approved','scheduled','published')
        and not coalesce((d.taxonomy->>'deleted_by_operator') = 'true', false)
        and coalesce(d.published_at, d.scheduled_at) >= (wk::timestamp at time zone 'Europe/Warsaw')
        and coalesce(d.published_at, d.scheduled_at) < ((wk + 7)::timestamp at time zone 'Europe/Warsaw')
      union all
      select q.scheduled_at, jsonb_build_object('kind','post','queue_id', q.id, 'title', left(q.post_text, 80),
        'day', (q.scheduled_at at time zone 'Europe/Warsaw')::date, 'at', q.scheduled_at, 'status', q.status,
        'format', q.post_format, 'lead_magnet', q.post_kind = 'capture' or q.lead_magnet_slug is not null, 'founder', false,
        'picture', case when q.post_format in ('carousel','pdf') then 'carousel deck' when q.post_format = 'video' then 'video'
                        when coalesce(array_length(q.media_urls,1),0) > 0 then 'picture' else 'no picture' end,
        'evidence', jsonb_build_array(jsonb_build_object('type','queue','label','In the publish queue')))
      from public.scheduled_posts q
      where p_account = 'ivan' and q.platform = 'linkedin' and q.status in ('pending','posted') and coalesce(q.is_repost,false) = false
        and q.scheduled_at >= (wk::timestamp at time zone 'Europe/Warsaw') and q.scheduled_at < ((wk + 7)::timestamp at time zone 'Europe/Warsaw')
        and not exists (select 1 from public.carousel_drafts d2 where d2.client_id is null and d2.status in ('review','approved','scheduled','published')
                          and (d2.scheduled_at = q.scheduled_at or d2.published_at = q.posted_at))
    ) x;

    -- Planned slots of this week that have not become a dated post yet.
    select coalesce(jsonb_agg(y.j order by y.created_at), '[]'::jsonb), count(*) into planned, n_planned from (
      select s.created_at, jsonb_build_object('kind','planned','slot_id', s.id, 'topic', s.topic, 'why_now', s.why_now,
        'evidence', s.evidence, 'format', s.format, 'picture', s.picture, 'idea_source', s.idea_source, 'idea_ref', s.idea_ref,
        'proposal', cfg.proposals_only and st.status = 'proposal', 'status', st.status, 'status_label', st.label, 'draft_id', st.draft_id) j
      from public.content_plan_slots s
      cross join lateral (
        select case
          when s.idea_source = 'carousel_drafts' then (select case when d.status = 'review' then 'waiting_review' else 'dropped' end from public.carousel_drafts d where d.id::text = s.idea_ref and d.scheduled_at is null)
          when s.idea_source = 'lm_idea_candidates' then (select case when l.status in ('reviewing','pending') then case when s.status = 'requested' then 'requested' else 'planned' end
                                                                       when l.status in ('promoted','approved') then 'drafting' else 'dropped' end from public.lm_idea_candidates l where l.id::text = s.idea_ref)
          else (select case when ci.status = 'staged' then 'proposal'
                            when ci.status in ('approved','live') then
                              case when exists (select 1 from public.carousel_drafts cd where cd.client_idea_id = ci.id)
                                        and not exists (select 1 from public.carousel_drafts cd where cd.client_idea_id = ci.id and cd.status not in ('error','archived')) then 'failed'
                                   when exists (select 1 from public.carousel_drafts cd where cd.client_idea_id = ci.id and cd.status = 'review') then 'waiting_review'
                                   else 'drafting' end
                            else 'dropped' end from public.client_ideas ci where ci.id::text = s.idea_ref)
        end as status0,
        (select coalesce(case when s.idea_source = 'carousel_drafts' then s.idea_ref::uuid end,
                         (select l.promoted_draft_id from public.lm_idea_candidates l where s.idea_source = 'lm_idea_candidates' and l.id::text = s.idea_ref),
                         (select d.id from public.carousel_drafts d where s.idea_source = 'client_ideas' and d.client_idea_id::text = s.idea_ref order by d.created_at desc limit 1))) as draft_id
      ) st0
      cross join lateral (
        select coalesce(st0.status0, 'dropped') as status, st0.draft_id,
          case coalesce(st0.status0,'dropped') when 'waiting_review' then 'Draft waiting in Review' when 'planned' then 'Planned, draft not written yet'
            when 'requested' then 'Draft requested' when 'drafting' then 'Draft being written or waiting in Review'
            when 'proposal' then case when cfg.auto_generate then 'Draft is requested at the next planner run' else 'Waiting for you to generate the draft' end
            else 'Dropped' end as label
      ) st
      where s.account = p_account and s.week_start = wk and s.status in ('planned','proposal','requested')
        and coalesce(st.status,'dropped') not in ('dropped','failed')
        and not exists (select 1 from public.carousel_drafts d where d.id = st.draft_id and d.scheduled_at is not null)
    ) y;

    -- Each planned slot shows the day it is meant for: the first free weekday of its week, in slot order.
    -- A day with a dated post is taken; days before today are gone. No free weekday left = no day (warned below).
    if n_planned > 0 then
      select coalesce(jsonb_agg(e.j || jsonb_build_object('day', free.gd) order by e.ord), '[]'::jsonb) into planned
        from jsonb_array_elements(planned) with ordinality as e(j, ord)
        left join lateral (
          select f.gd from (
            select g::date as gd, row_number() over (order by g) as rn from generate_series(wk::timestamp, (wk + 4)::timestamp, interval '1 day') g
             where g::date >= v_today
               and not exists (select 1 from jsonb_array_elements(posts) pp where (pp->>'day')::date = g::date)
          ) f where f.rn = e.ord
        ) free on true;
    end if;

    if i >= 1 and target_week is null and n_posts + n_planned < target then target_week := wk; open_target := target - n_posts - n_planned; end if;
    weeks := weeks || jsonb_build_array(jsonb_build_object('start', wk, 'which', case i when 0 then 'this' when 1 then 'next' else 'after' end,
      'target', target, 'posts', posts, 'planned', planned, 'filled', n_posts + n_planned, 'dated', n_posts,
      'no_day', (select count(*) from jsonb_array_elements(planned) pl where pl->>'day' is null),
      'open', greatest(target - n_posts - n_planned, 0),
      'lead_magnets', (select count(*) from jsonb_array_elements(posts) p where (p->>'lead_magnet')::boolean),
      'founder', (select count(*) from jsonb_array_elements(posts) p where (p->>'founder')::boolean)));
  end loop;

  -- Topics already done: published in the last 8 weeks, with their results (db/259).
  select array_agg(d.id) into v_done_ids from (select d.id from public.carousel_drafts d where (case when p_account = 'ivan' then d.client_id is null else d.client_id = p_account end)
            and d.status = 'published' and d.published_at >= p_now - interval '56 days' order by d.published_at desc limit 40) d;
  select coalesce(jsonb_agg(jsonb_build_object('title', coalesce(nullif(d.title,''), left(d.post_body,80)), 'day', (d.published_at at time zone 'Europe/Warsaw')::date,
           'format', d.type, 'pillar', d.taxonomy->>'pillar',
           'draft_id', d.id, 'impressions', null, 'reactions', null, 'comments', null) order by d.published_at desc), '[]'::jsonb) into done
    from public.carousel_drafts d
   where d.id = any(coalesce(v_done_ids, '{}'::uuid[]));

  -- Written drafts waiting in Review with no date: the first supply for an open slot.
  select coalesce(jsonb_agg(jsonb_build_object('draft_id', d.id, 'title', coalesce(nullif(d.title,''), left(d.post_body,80)), 'format', d.type,
           'created_at', d.created_at, 'brain', exists(select 1 from public.cb34_p2_members m where m.draft_id = d.id and m.state = 'released'),
           'evidence', public.content_plan_post_evidence(d.id)) order by d.created_at desc), '[]'::jsonb) into supply
    from (select * from public.carousel_drafts d where (case when p_account = 'ivan' then d.client_id is null else d.client_id = p_account end)
            and d.status = 'review' and d.scheduled_at is null and d.created_at >= p_now - interval '30 days'
            and not coalesce((d.taxonomy->>'deleted_by_operator') = 'true', false)
            and not exists (select 1 from public.cb39_draft_verdicts v where v.draft_id = d.id and v.verdict = 'drop')
          order by d.created_at desc limit 25) d;

  -- db/262: last_run ships only the run reason, never the planner's candidate list.
  select to_jsonb(r0) into last_run from (select cr.ran_at, cr.target_week, cr.open_before, cr.picked, jsonb_build_object('reason', cr.outcome->'reason') as outcome from public.content_plan_runs cr where cr.account = p_account order by cr.ran_at desc limit 1) r0;

  -- Warnings only. Each names a real gap and stays silent otherwise. Plain words (spec R4).
  if target_week is not null and last_run is not null and coalesce((last_run->>'picked')::int,0) < coalesce((last_run->>'open_before')::int,0)
     and (last_run->>'target_week')::date = target_week and coalesce(last_run->'outcome'->>'reason','') = 'no_candidates' then
    warnings := warnings || jsonb_build_array(jsonb_build_object('code','empty_topic_area','text','Not enough ideas to fill the week of ' || to_char(target_week,'FMDD Mon')));
  end if;
  for r in select (x->>'start')::date as ws, (x->>'no_day')::int as nd from jsonb_array_elements(weeks) x where (x->>'no_day')::int > 0 loop
    warnings := warnings || jsonb_build_array(jsonb_build_object('code','no_day','text',
      r.nd || ' planned post' || case when r.nd = 1 then '' else 's' end || ' in the week of ' || to_char(r.ws,'FMDD Mon') || ' ha' || case when r.nd = 1 then 's' else 've' end || ' no free weekday'));
  end loop;
  if target_week is not null then
    select count(*) into n from public.content_plan_slots s
      join public.client_ideas ci on s.idea_source = 'client_ideas' and ci.id::text = s.idea_ref
     where s.account = p_account and s.status in ('planned','proposal','requested') and s.week_start >= w0
       and ci.status in ('approved','live')
       and exists (select 1 from public.carousel_drafts cd where cd.client_idea_id = ci.id and cd.status = 'error')
       and not exists (select 1 from public.carousel_drafts cd where cd.client_idea_id = ci.id and cd.status not in ('error','archived'));
    if n > 0 then
      warnings := warnings || jsonb_build_array(jsonb_build_object('code','draft_failed','text',
        n || ' planned draft' || case when n = 1 then '' else 's' end || ' failed the quality check. The planner is picking a new topic.'));
    end if;
  end if;
  if p_account <> 'ivan' then
    for r in
      select d.taxonomy->>'pillar' pillar, count(*) n from public.carousel_drafts d
       where d.client_id = p_account and d.status = 'published' and d.published_at >= p_now - interval '56 days' and d.taxonomy->>'pillar' is not null
         -- db/271: only topic types the idea bank uses; 'demand'/'reach' are funnel tags no idea carries, so they warned forever.
         and exists (select 1 from public.client_ideas ci2 where ci2.client_id = p_account and ci2.pillar = d.taxonomy->>'pillar')
       group by 1 having count(*) >= 2
    loop
      select count(*) into n from public.client_ideas ci where ci.client_id = p_account and ci.status = 'staged' and ci.pillar = r.pillar
        and (ci.eligible_at is null or ci.eligible_at <= p_now);
      if n = 0 then
        warnings := warnings || jsonb_build_array(jsonb_build_object('code','empty_topic_area','topic', r.pillar, 'text','Out of ideas for '
          || case r.pillar when 'demand' then 'sales posts' when 'reach' then 'posts that bring new followers' when 'case_study' then 'case studies'
               when 'teardown' then 'teardowns' when 'personal' then 'founder stories' when 'how_to' then 'how-to posts' when 'opinion' then 'opinion posts'
               when 'trust' then 'trust posts' when 'authority' then 'expert posts' else replace(r.pillar,'_',' ') || ' posts' end
          || ' (' || r.n || ' used in 8 weeks)'));
      end if;
    end loop;
    select count(*) into fresh_proof from public.client_ideas ci where ci.client_id = p_account
      and (ci.lane in ('sales_call','fireflies_call') or ci.source_ref ~ '^(fc|ffc|ffr)-') and ci.created_at >= p_now - interval '21 days';
  else
    select count(*) into fresh_proof from public.lm_idea_candidates l where l.source in ('ivan_call','calls','kyle_call','claude_sessions')
      and l.status in ('reviewing','pending') and l.created_at >= p_now - interval '21 days';
  end if;
  if fresh_proof = 0 then
    warnings := warnings || jsonb_build_array(jsonb_build_object('code','no_fresh_proof',
      'text', case when p_account = 'ivan' then 'No new ideas from calls or your own work in 3 weeks' else 'No new ideas from a client call in 3 weeks' end));
  end if;
  if p_account = 'ivan' then
    select count(*) into photos from public.ivan_photo_candidates_v1();
    if photos < target then
      warnings := warnings || jsonb_build_array(jsonb_build_object('code','no_photos','text', 'Only ' || photos || ' fitting photo' || case when photos = 1 then '' else 's' end || ' left in your library'));
    end if;
  end if;
  if lm_target > 0 then
    for i in 1..2 loop
      if coalesce((weeks->i->>'lead_magnets')::int,0) < lm_target then
        warnings := warnings || jsonb_build_array(jsonb_build_object('code','lm_due','text','No lead magnet in the week of ' || to_char((weeks->i->>'start')::date,'FMDD Mon')));
      end if;
    end loop;
  end if;
  founder_n := coalesce((weeks->1->>'founder')::int,0);
  if founder_n > cfg.founder_story_max then
    warnings := warnings || jsonb_build_array(jsonb_build_object('code','founder_cap','text', founder_n || ' founder stories next week. Your limit is ' || cfg.founder_story_max));
  end if;

  -- db/259: the content brain data. Fail-safe: a brain error never breaks the plan read (content_plan_apply reads it too).
  begin
    select array_agg(distinct (x->>'draft_id')::uuid) into v_ids from (
      select p as x from jsonb_array_elements(weeks) w, jsonb_array_elements(w->'posts') p
      union all select p from jsonb_array_elements(weeks) w, jsonb_array_elements(w->'planned') p
      union all select s from jsonb_array_elements(supply) s) t
     where x->>'draft_id' ~ '^[0-9a-fA-F-]{36}$';
    select coalesce(jsonb_object_agg(b.draft_id::text, b.brain), '{}'::jsonb) into v_brain
      from public.content_plan_brain_items(p_account, coalesce(v_ids, '{}'::uuid[]), p_now) b;

    v_blank := jsonb_build_object('draft_id', null, 'words', null, 'edited', false, 'thumb', null, 'body_head', null, 'first_line', null, 'has_link', false,
      'flags', jsonb_build_object('lm', false, 'boosted', false, 'founder', false, 'carousel', false, 'weekend', false, 'failed', false, 'low_score', false, 'fact_fail', false),
      'qa', null, 'facts', null, 'angle', null, 'trait', null, 'read', null, 'brief', null, 'quote', null, 'quote_pending', false,
      'photo', null, 'replaced', null, 'result', null, 'time_set_by', null);

    select coalesce(jsonb_agg(w.j || jsonb_build_object(
        'posts', (select coalesce(jsonb_agg(p.j || jsonb_build_object('brain',
                    case when v_brain ? (p.j->>'draft_id') then
                           (v_brain->(p.j->>'draft_id')) || jsonb_build_object('flags', (v_brain->(p.j->>'draft_id'))->'flags'
                             || jsonb_build_object('weekend', coalesce(extract(isodow from coalesce(((p.j->>'at')::timestamptz at time zone v_tz)::date, (p.j->>'day')::date)) >= 6, false)))
                         else v_blank || jsonb_build_object('flags', (v_blank->'flags') || jsonb_build_object(
                             'lm', coalesce((p.j->>'lead_magnet')::boolean, false), 'founder', coalesce((p.j->>'founder')::boolean, false),
                             'carousel', coalesce(p.j->>'format' in ('carousel','pdf','document'), false),
                             'weekend', coalesce(extract(isodow from coalesce(((p.j->>'at')::timestamptz at time zone v_tz)::date, (p.j->>'day')::date)) >= 6, false))) end) order by p.o), '[]'::jsonb)
                  from jsonb_array_elements(w.j->'posts') with ordinality p(j, o)),
        'planned', (select coalesce(jsonb_agg(p.j || jsonb_build_object('brain',
                    case when v_brain ? (p.j->>'draft_id') then
                           (v_brain->(p.j->>'draft_id')) || jsonb_build_object('flags', (v_brain->(p.j->>'draft_id'))->'flags'
                             || jsonb_build_object('weekend', coalesce(extract(isodow from coalesce(((p.j->>'at')::timestamptz at time zone v_tz)::date, (p.j->>'day')::date)) >= 6, false)))
                         else v_blank || jsonb_build_object('read', nd.rd, 'quote', nd.quote, 'quote_pending', coalesce(nd.src is not null and nd.quote is null, false),
                             'replaced', nd.rp,
                             'flags', (v_blank->'flags') || jsonb_build_object('weekend', coalesce(extract(isodow from coalesce(((p.j->>'at')::timestamptz at time zone v_tz)::date, (p.j->>'day')::date)) >= 6, false))) end) order by p.o), '[]'::jsonb)
                  from jsonb_array_elements(w.j->'planned') with ordinality p(j, o)
                  left join lateral (
                    -- db/261: the read stored on the slot at pick time; the live read only when the slot has none.
                    select case when p.j->>'idea_source' = 'client_ideas' then coalesce(
                             (select ps.pick_snapshot->'read' from public.content_plan_slots ps
                               where ps.id = (p.j->>'slot_id')::uuid and jsonb_typeof(ps.pick_snapshot->'read') = 'object'),
                             public.content_plan_read_shape(public.cb33_idea_read(p_account, p.j->>'idea_ref'))) end as rd,
                           qs.src,
                           case when qs.src is not null and ci.quote_en_src = qs.src then nullif(btrim(ci.quote_en), '') end as quote,
                           (select jsonb_build_object('title', coalesce(nullif(od.title, ''), left(od.post_body, 80), os.topic), 'on', (rr.requested_at at time zone 'Europe/Warsaw')::date)
                              from public.content_plan_slots ns
                              join public.content_plan_replans rr on rr.account = p_account and rr.requested_at <= ns.created_at and ns.created_at < rr.requested_at + interval '12 hours'
                              join public.content_plan_slots os on os.id = rr.slot_id and os.week_start = ns.week_start and os.id <> ns.id
                              left join public.carousel_drafts od on od.id = rr.draft_id
                             where ns.id::text = p.j->>'slot_id' order by rr.requested_at desc limit 1) as rp
                      from (select 1) one
                      left join public.client_ideas ci on p.j->>'idea_source' = 'client_ideas' and ci.id = case when p.j->>'idea_ref' ~ '^[0-9a-fA-F-]{36}$' then (p.j->>'idea_ref')::uuid end
                      left join lateral (select public.content_plan_source_quote(ci.id) as src where ci.id is not null) qs on true
                     where not (v_brain ? coalesce(p.j->>'draft_id', ''))
                  ) nd on true)
      ) order by w.o), '[]'::jsonb) into b_weeks
      from jsonb_array_elements(weeks) with ordinality w(j, o);

    select coalesce(jsonb_agg(s.j || jsonb_build_object('brain_draft', s.j->'brain', 'brain', coalesce(v_brain->(s.j->>'draft_id'), v_blank)) order by s.o), '[]'::jsonb)
      into b_supply from jsonb_array_elements(supply) with ordinality s(j, o);

    -- Rule breaks become warnings (spec R3.2), only for rules in force.
    b_warn := warnings;
    select b.rule_id, b.effect_pct into v_rule from public.brain_rules b where b.rule_id = 'R08-frequency-' || p_account and b.status = 'live';
    if found then
      v_max := coalesce((pol->>'max_posts_per_week')::int, target); v_min := (pol->>'min_posts_per_week')::int;
      for r in select (x->>'start')::date as ws, (x->>'filled')::int as f from jsonb_array_elements(b_weeks) x where (x->>'filled')::int > v_max order by 1 loop
        b_warn := b_warn || jsonb_build_array(jsonb_build_object('code','over_rule','text',
          'Week of ' || to_char(r.ws,'FMDD Mon') || ' has ' || r.f || ' posts. Your rule is '
          || case when v_min is not null then v_min || ' to ' || v_max else 'at most ' || v_max end || '.'
          || case when v_rule.effect_pct is not null then ' Each extra post costs ' || round(abs(v_rule.effect_pct)) || '% of views.' else '' end));
      end loop;
    end if;
    if exists (select 1 from public.brain_rules b where b.rule_id = 'R11-weekend-' || p_account and b.status = 'live') then
      for r in select distinct z.dd
                 from jsonb_array_elements(b_weeks) w,
                 lateral (select coalesce(((x->>'at')::timestamptz at time zone v_tz)::date, (x->>'day')::date) as dd
                            from (select x from jsonb_array_elements(w->'posts') x union all select x from jsonb_array_elements(w->'planned') x) xx(x)) z
                where z.dd is not null and z.dd >= v_today and extract(isodow from z.dd) >= 6 order by 1 loop
        b_warn := b_warn || jsonb_build_array(jsonb_build_object('code','weekend_post','text', to_char(r.dd,'Dy FMDD Mon') || ': a post on a weekend. Your rule is weekdays only.'));
      end loop;
    end if;

    select percentile_cont(0.5) within group (order by m.impressions) into v_med
      from public.client_post_metrics m where m.client_id = p_account and m.published_at >= p_now - interval '90 days' and m.impressions is not null;
    if p_account = 'ivan' then
      select coalesce(jsonb_agg(distinct ((a->>'at')::timestamptz at time zone 'Europe/Warsaw')::date), '[]'::jsonb) into v_xdays
        from jsonb_array_elements(public.x_calendar(w0::timestamp at time zone 'Europe/Warsaw', (w0 + 21)::timestamp at time zone 'Europe/Warsaw')) a
       where a->>'at' is not null;
    end if;
    select coalesce(jsonb_agg(z.p order by w.wo, z.k, z.o), '[]'::jsonb) into v_items
      from jsonb_array_elements(b_weeks) with ordinality w(j, wo),
      lateral (select x.p, 0 as k, x.o from jsonb_array_elements(w.j->'posts') with ordinality x(p, o)
               union all select x.p, 1, x.o from jsonb_array_elements(w.j->'planned') with ordinality x(p, o)) z;
    v_strip := public.content_plan_brain_strip(p_account, v_items, p_now);

    -- Results of the topics already done (fix1: inside the fail-safe).
    select coalesce(jsonb_agg(x.j || jsonb_build_object('impressions', mt.views, 'reactions', mt.reactions, 'comments', mt.comments) order by x.o), '[]'::jsonb)
      into b_done
      from jsonb_array_elements(done) with ordinality x(j, o)
      left join public.content_plan_draft_metrics(p_account, coalesce(v_done_ids, '{}'::uuid[])) mt on mt.draft_id::text = x.j->>'draft_id';

    weeks := b_weeks; supply := b_supply; warnings := b_warn; done := b_done;
  exception when others then
    v_strip := null; v_err := left(sqlerrm, 200);
  end;

  return jsonb_build_object('ok', true, 'account', p_account, 'today', v_today, 'target', target,
    'target_week', target_week, 'open', open_target,
    'state', case when target_week is null then 'two_weeks_planned' else 'planning' end,
    'proposals_only', cfg.proposals_only, 'auto_generate', cfg.auto_generate, 'founder_story_max', cfg.founder_story_max,
    'cadence_source', cfg.cadence_source, 'lm_per_week', lm_target,
    'weeks', weeks, 'done', done, 'supply', supply, 'warnings', warnings, 'last_run', last_run,
    'done_median', round(v_med),
    'tz', case when p_account = 'risedtc' then jsonb_build_object('name','America/Los_Angeles','label','PT') else jsonb_build_object('name','Europe/Warsaw','label','Warsaw') end,
    'x_days', v_xdays,
    'brain_strip', v_strip)
    || case when v_err is not null then jsonb_build_object('brain_error', v_err) else '{}'::jsonb end;
end $function$
;


DROP FUNCTION IF EXISTS public.cb51_own_winners(text, timestamptz);
COMMIT;
