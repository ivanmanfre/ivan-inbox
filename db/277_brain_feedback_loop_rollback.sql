-- Rollback for db/277_brain_feedback_loop.sql: restores the function bodies live before 277, drops the new objects.
-- Implicit verdict rows are deleted (the old source CHECK does not allow them; they are re-derivable from actions).
BEGIN;
DROP TRIGGER IF EXISTS cb39_implicit_verdict ON public.carousel_drafts;
DROP TRIGGER IF EXISTS cb39_implicit_verdict_delete ON public.carousel_drafts;
DROP VIEW IF EXISTS public.cb34_p2_review_held_v;
CREATE OR REPLACE FUNCTION public.cb53_capture_author_rejection()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare p uuid;
begin
 if new.verdict='drop' and new.client_id in ('ivan','risedtc','arch') then
 select id into p from content_prompts where scope='client:'||new.client_id and slug='cb53-candidate-refill-'||new.client_id||'-v1' and not is_active limit 1;
 insert into content_candidate_decisions(client_id,picker,source_ref,source_sha256,decision,rejection_reason,rejection_kind,exclusion,prompt_id,prompt_version,execution_id,source_receipt,decided_at)
 values(new.client_id,'weekly','draft:'||new.draft_id,coalesce(new.body_sha256,encode(sha256(convert_to(coalesce(new.body_snapshot,''),'UTF8')),'hex')),
 'reject',jsonb_build_object('reasons',new.reasons,'note',new.note)::text,'revision','none',p,1,'cb39-verdict-'||new.verdict_id||'-'||txid_current(),
 jsonb_build_object('origin','cb39_draft_verdicts','verdict_id',new.verdict_id,'draft_id',new.draft_id,'source',new.source,'author',new.decided_by,'brief',new.brief,'original_prompt_version',new.brief->'pipeline_version'),new.decided_at);
 end if;return new;
end $function$;
CREATE OR REPLACE FUNCTION public.cb39_verdict_set(p_draft uuid, p_verdict text, p_reasons text[] DEFAULT '{}'::text[], p_note text DEFAULT NULL::text, p_invocation uuid DEFAULT NULL::uuid, p_ms_to_verdict integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '20s'
 SET lock_timeout TO '2s'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v public.cb39_draft_verdicts%ROWTYPE;
  d public.carousel_drafts%ROWTYPE;
  m public.cb34_p2_members%ROWTYPE;
  o public.cb39_draft_body_origin%ROWTYPE;
  v_has_member boolean := false; v_has_origin boolean := false;
  v_lane text; v_tax jsonb; v_brief jsonb; v_how text; v_action text; v_sha text; v_final text;
  v_skip boolean := false;
  v_reasons text[] := coalesce(p_reasons, '{}');
  v_note text := nullif(btrim(coalesce(p_note,'')), '');
  v_ms int := CASE WHEN p_ms_to_verdict BETWEEN 0 AND 86400000 THEN p_ms_to_verdict END;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  IF p_draft IS NULL OR p_verdict IS NULL OR p_verdict NOT IN ('keep','drop') THEN
    RAISE EXCEPTION 'verdict must be keep or drop' USING ERRCODE = '22023'; END IF;
  IF p_verdict = 'keep' AND cardinality(v_reasons) > 0 THEN RAISE EXCEPTION 'approve takes no reason' USING ERRCODE = '22023'; END IF;
  IF 'skip' = ANY (v_reasons) THEN
    IF cardinality(v_reasons) > 1 THEN RAISE EXCEPTION 'skip stands alone' USING ERRCODE = '22023'; END IF;
    v_skip := true; v_reasons := '{}';
  END IF;
  IF NOT (v_reasons <@ ARRAY['invented_fact','not_my_voice','generic','wrong_topic','too_long','already_said','other','needs_proof','weak_hook']) OR cardinality(v_reasons) > 8 THEN
    RAISE EXCEPTION 'unknown reason for %', p_verdict USING ERRCODE = '22023'; END IF;
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN RAISE EXCEPTION 'note too long' USING ERRCODE = '22023'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('cb39-verdict:' || p_draft::text, 0));

  SELECT * INTO v FROM public.cb39_draft_verdicts WHERE draft_id = p_draft FOR UPDATE;
  IF FOUND THEN
    IF NOT public.cb39_lane_ok(v.client_id) THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
    IF (v.verdict = 'drop') <> (p_verdict = 'drop') THEN
      RAISE EXCEPTION 'already judged %', CASE WHEN v.verdict = 'drop' THEN 'drop' ELSE 'keep' END USING ERRCODE = 'P0001', HINT = 'cb39_already_judged'; END IF;
    UPDATE public.cb39_draft_verdicts
       SET reasons = CASE WHEN cardinality(v_reasons) > 0 THEN v_reasons WHEN v_skip THEN '{}' ELSE reasons END,
           reason_skipped = CASE WHEN v_skip THEN true WHEN cardinality(v_reasons) > 0 THEN false ELSE reason_skipped END,
           note = coalesce(v_note, note),
           updated_at = CASE WHEN cardinality(v_reasons) > 0 OR v_note IS NOT NULL OR v_skip THEN clock_timestamp() ELSE updated_at END
     WHERE draft_id = p_draft RETURNING * INTO v;
    RETURN (to_jsonb(v) - 'body_snapshot' - 'brief' - 'body_before' - 'body_after') || jsonb_build_object('replayed', true);
  END IF;

  SELECT * INTO d FROM public.carousel_drafts WHERE id = p_draft FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'draft not found' USING ERRCODE = 'P0002'; END IF;
  IF d.client_id = 'ivan' THEN RAISE EXCEPTION 'This post could not be updated from here.' USING ERRCODE = '42501'; END IF;
  v_lane := coalesce(d.client_id, 'ivan');
  IF NOT public.cb39_lane_ok(v_lane) OR NOT public.cb34_p2_operator_lane_allowed(v_lane) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  IF d.published_at IS NOT NULL OR d.status NOT IN ('review','error') THEN
    RAISE EXCEPTION 'Not in review any more (it is %).', d.status USING ERRCODE = 'P0001', HINT = 'cb39_not_in_review'; END IF;
  IF p_verdict = 'drop' AND d.client_id IS NOT NULL AND d.board_visible IS TRUE THEN
    RAISE EXCEPTION 'This draft is on the client''s board. Take it off the board first.' USING ERRCODE = 'P0001', HINT = 'cb39_on_board'; END IF;

  SELECT * INTO m FROM public.cb34_p2_members WHERE draft_id = p_draft;
  v_has_member := FOUND;
  SELECT * INTO o FROM public.cb39_draft_body_origin WHERE draft_id = p_draft;
  v_has_origin := FOUND;
  v_tax := CASE WHEN jsonb_typeof(d.taxonomy) = 'object' THEN d.taxonomy ELSE '{}'::jsonb END;
  v_brief := CASE WHEN v_has_member AND m.brief IS NOT NULL THEN m.brief ELSE v_tax -> 'brain_brief' END;
  v_how := CASE WHEN v_has_member OR v_tax ->> 'source' = 'content-brain' THEN 'brain' ELSE 'normal' END;
  v_sha := CASE WHEN d.post_body IS NULL THEN NULL ELSE encode(sha256(convert_to(d.post_body, 'UTF8')), 'hex') END;
  -- Approved after an edit: the body moved off what the brain released (or what was captured before the first edit).
  v_final := CASE WHEN p_verdict = 'drop' THEN 'drop'
    WHEN (v_has_member AND m.body_sha256 IS NOT NULL AND v_sha IS DISTINCT FROM m.body_sha256)
      OR (v_has_origin AND v_sha IS DISTINCT FROM o.body_sha256)
      OR coalesce(v_tax ->> 'human_edited', '') = 'true' THEN 'edited'
    ELSE 'keep' END;

  -- 1. The verdict, first, with everything the learning needs.
  INSERT INTO public.cb39_draft_verdicts(draft_id, client_id, verdict, reasons, reason_skipped, note, body_sha256, body_snapshot, brief,
    labels, how_made, draft_action, source, invocation_id, decided_by, ms_to_verdict, shown_at, body_before, body_after, edit_chars)
  VALUES (p_draft, v_lane, v_final, v_reasons, v_skip, v_note, v_sha, d.post_body, v_brief,
    jsonb_strip_nulls(jsonb_build_object(
      'type', d.type, 'topic', d.topic, 'title', d.title, 'funnel_stage', d.funnel_stage,
      'status_before', d.status, 'board_visible', d.board_visible, 'created_at', d.created_at, 'scheduled_at', d.scheduled_at,
      'pillar', v_tax -> 'pillar', 'hook_class', v_tax -> 'hook_class', 'source', v_tax -> 'source',
      'source_ref', coalesce(v_tax -> 'source_ref', to_jsonb(d.source_ref)), 'writer', v_tax -> 'writer',
      'writer_lane', v_tax -> 'writer_lane', 'funnel_why', v_tax -> 'funnel_why', 'human_edited', v_tax -> 'human_edited',
      'brain_verdict', v_tax -> 'content_brain' -> 'verdict', 'checks', v_tax -> 'content_brain' -> 'checks',
      'run_id', CASE WHEN v_has_member THEN to_jsonb(m.run_id) END,
      'week_start', CASE WHEN v_has_member THEN to_jsonb(m.week_start) END,
      'member_state', CASE WHEN v_has_member THEN to_jsonb(m.state) END,
      'released_at', CASE WHEN v_has_member THEN to_jsonb(m.released_at) END,
      'released_body_sha256', CASE WHEN v_has_member THEN to_jsonb(m.body_sha256) END,
      'origin_verified', CASE WHEN v_has_origin THEN to_jsonb(o.origin_verified) END,
      'slot', v_brief -> 'slot', 'pattern', v_brief -> 'pattern')),
    v_how, 'pending', 'app', p_invocation, v_uid::text, v_ms,
    CASE WHEN v_ms IS NOT NULL THEN clock_timestamp() - make_interval(secs => v_ms / 1000.0) END,
    CASE WHEN v_final = 'edited' AND v_has_origin THEN o.body END,
    CASE WHEN v_final = 'edited' THEN d.post_body END,
    CASE WHEN v_final = 'edited' AND v_has_origin THEN public.cb39_edit_chars(o.body, d.post_body) END);

  -- 2. The existing path's effect, unchanged, in the same transaction.
  IF p_verdict = 'keep' THEN
    IF d.client_id IS NULL THEN
      UPDATE public.carousel_drafts SET status = 'approved' WHERE id = p_draft AND client_id IS NULL;
      v_action := 'approved';
    ELSE
      v_action := 'none';
    END IF;
  ELSE
    BEGIN
      IF d.client_id IS NULL THEN DELETE FROM public.carousel_drafts WHERE id = p_draft AND client_id IS NULL;
      ELSE DELETE FROM public.carousel_drafts WHERE id = p_draft AND client_id IS NOT NULL; END IF;
      v_action := 'deleted';
    EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN
      UPDATE public.carousel_drafts
         SET status = 'disqualified',
             taxonomy = CASE
               WHEN jsonb_typeof(d.taxonomy) = 'object' THEN d.taxonomy
               WHEN jsonb_typeof(d.taxonomy) = 'string' AND btrim(d.taxonomy #>> '{}') <> '' THEN jsonb_build_object('structure_used', btrim(d.taxonomy #>> '{}'))
               ELSE '{}'::jsonb END
               || jsonb_build_object('deleted_by_operator', true,
                    'deleted_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
       WHERE id = p_draft;
      v_action := 'archived';
    END;
    IF d.client_id IS NULL THEN
      UPDATE public.scheduled_posts SET status = 'cancelled', error_message = 'draft_deleted_by_operator'
       WHERE clickup_task_id = p_draft::text AND status IN ('pending','queued_v2','posting');
    END IF;
  END IF;

  UPDATE public.cb39_draft_verdicts SET draft_action = v_action WHERE draft_id = p_draft RETURNING * INTO v;
  RETURN (to_jsonb(v) - 'body_snapshot' - 'brief' - 'body_before' - 'body_after') || jsonb_build_object('replayed', false);
END $function$;
CREATE OR REPLACE FUNCTION public.cb51_decision_history(p_client text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '10s'
AS $function$
DECLARE v_rulings jsonb; v_links jsonb;
BEGIN
  IF p_client IS NULL OR p_client NOT IN ('ivan','risedtc','arch') THEN RAISE EXCEPTION 'unknown client' USING ERRCODE = '22023'; END IF;
  IF NOT public.cb39_lane_ok(p_client) THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('action', e.action, 'reason', e.reason, 'at', e.created_at,
           'target_kind', e.target_kind, 'target_id', e.target_id) ORDER BY e.created_at DESC), '[]'::jsonb)
    INTO v_rulings
    FROM (SELECT * FROM public.editorial_decisions
           WHERE client_id = p_client AND action IN ('reject','dismiss','defer') AND coalesce(reason, '') <> ''
           ORDER BY created_at DESC LIMIT 20) e;
  SELECT coalesce(jsonb_agg(jsonb_build_object('draft_id', v.draft_id, 'status', d.status, 'published_at', d.published_at,
           'post_url', op.linkedin_url, 'impressions', op.num_impressions, 'likes', op.num_likes, 'comments', op.num_comments)), '[]'::jsonb)
    INTO v_links
    FROM (SELECT draft_id FROM public.cb39_draft_verdicts
           WHERE client_id = p_client AND decided_at > now() - interval '60 days'
           ORDER BY decided_at DESC LIMIT 50) v
    LEFT JOIN public.carousel_drafts d ON d.id = v.draft_id
    LEFT JOIN LATERAL (SELECT o.linkedin_url, o.num_impressions, o.num_likes, o.num_comments FROM public.own_posts o
                        WHERE p_client = 'ivan' AND o.clickup_task_id = v.draft_id::text
                        ORDER BY o.posted_at DESC NULLS LAST LIMIT 1) op ON true;
  RETURN jsonb_build_object('rulings', v_rulings, 'links', v_links);
END $function$;
CREATE OR REPLACE FUNCTION public.cb51_brain_history(p_client text, p_for_check boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '20s'
AS $function$
  WITH cut AS (SELECT now() - interval '75 days' AS t),
  own AS (
    SELECT 1 AS k, o.posted_at AS at, '[published ' || to_char(o.posted_at AT TIME ZONE 'UTC','YYYY-MM-DD') || ', ' || coalesce(o.num_impressions::text,'?') || ' impressions] '
      || replace(regexp_replace(left(coalesce(o.post_text,''),600), E'\n+', ' / ', 'g'), E'\r', '') AS line
    FROM own_posts o, cut WHERE p_client='ivan' AND o.posted_at >= cut.t AND coalesce(o.post_text,'') <> ''),
  rej AS (
    SELECT 2 AS k, e.created_at AS at, '[rejected idea ' || to_char(e.created_at AT TIME ZONE 'UTC','YYYY-MM-DD') || '] reason: ' || coalesce(e.reason,'') AS line
    FROM editorial_decisions e WHERE p_client='ivan' AND e.client_id='ivan' AND e.action='reject'),
  dr AS (
    SELECT 3 AS k, coalesce(d.published_at, d.scheduled_at, d.created_at) AS at,
      CASE WHEN d.status IN ('published','scheduled') THEN '[' || d.status || ' ' || to_char(coalesce(d.published_at, d.scheduled_at, d.created_at) AT TIME ZONE 'UTC','YYYY-MM-DD') || '] ' || regexp_replace(left(d.post_body,600), E'\n+', ' / ', 'g')
           WHEN d.status='review' THEN '[waiting in review ' || to_char(d.created_at AT TIME ZONE 'UTC','YYYY-MM-DD') || '] ' || regexp_replace(left(d.post_body,300), E'\n+', ' / ', 'g')
           ELSE '[rejected draft ' || to_char(d.created_at AT TIME ZONE 'UTC','YYYY-MM-DD') || '] ' || regexp_replace(left(d.post_body,300), E'\n+', ' / ', 'g') END AS line
    FROM carousel_drafts d, cut
    WHERE (CASE WHEN p_client='ivan' THEN d.client_id IS NULL ELSE d.client_id = p_client END)
      AND coalesce(d.post_body,'') <> ''
      AND coalesce(d.published_at, d.scheduled_at, d.created_at) >= cut.t
      AND (d.status IN ('published','scheduled') OR (NOT p_for_check AND d.status IN ('review','rejected')))
      AND NOT (p_client='ivan' AND d.status='published'))
  SELECT coalesce(jsonb_agg(line ORDER BY k, at DESC), '[]'::jsonb) FROM (SELECT * FROM own UNION ALL SELECT * FROM rej UNION ALL SELECT * FROM dr) x
$function$;
CREATE OR REPLACE FUNCTION public.cb52_decision_history(p_client text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '15s'
AS $function$
DECLARE decisions jsonb; wins jsonb; own jsonb; client_own jsonb;
BEGIN
  IF p_client IS NULL OR p_client NOT IN ('ivan','risedtc','arch') THEN RAISE EXCEPTION 'unknown client'; END IF;
  IF NOT public.cb39_lane_ok(p_client) THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
  WITH verdict AS (
    SELECT v.decided_at at,jsonb_build_object('id','verdict:'||v.verdict_id,'origin','content_brain_page',
      'actor',v.decided_by,'source',v.source,'at',v.decided_at,'action',v.verdict,'reasons',v.reasons,'reason',v.note,
      'title',v.labels->>'title','topic',v.labels->>'topic','format',v.labels->>'type',
      'draft_id',v.draft_id,'body',v.body_snapshot,'before',v.body_before,'after',v.body_after,'brief',v.brief) entry
    FROM cb39_draft_verdicts v WHERE v.client_id=p_client
  ), research AS (
    SELECT e.created_at at,jsonb_build_object('id','research:'||e.decision_id,'origin','research',
      'actor',NULL,'actor_provenance','No individual actor stored in editorial_decisions; original request retained',
      'request_id',e.request_id,'at',e.created_at,'action',e.action,'scope',e.scope,'reason',e.reason,'outcome',e.outcome,
      'target_kind',e.target_kind,'target_id',e.target_id,'target_version',e.target_version,
      'target',b.payload,'target_author',b.authored_by_seat) entry
    FROM editorial_decisions e LEFT JOIN editorial_brief_versions b
      ON b.client_id=e.client_id AND b.brief_id=e.target_id AND b.version=e.target_version AND e.target_kind='brief'
    WHERE e.client_id=p_client
  ), rejected AS (
    SELECT d.created_at at,jsonb_build_object('id','rejected_draft:'||d.id,'origin','draft_status',
      'actor',NULL,'at',d.created_at,'action','rejected','reason',NULL,'draft_id',d.id,'title',d.title,
      'topic',d.topic,'body',d.post_body,'source',coalesce(d.taxonomy->>'source',d.source_label)) entry
    FROM carousel_drafts d WHERE (d.client_id=p_client OR (p_client='ivan' AND d.client_id IS NULL)) AND d.status='rejected'
      AND NOT EXISTS(SELECT 1 FROM cb39_draft_verdicts v WHERE v.draft_id=d.id)
  )
  SELECT coalesce(jsonb_agg(entry ORDER BY at DESC),'[]') INTO decisions FROM
    (SELECT * FROM verdict UNION ALL SELECT * FROM research UNION ALL SELECT * FROM rejected) s;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id','win:'||d.id,'origin','chosen_post','action',d.status,
      'actor',NULL,'at',coalesce(d.published_at,d.scheduled_at,d.created_at),'draft_id',d.id,
      'title',d.title,'topic',d.topic,'format',d.type,'source',coalesce(d.taxonomy->>'source',d.source_label,'unrecorded'),
      'body',d.post_body,'internal_test',coalesce(d.taxonomy->'internal_test','false'::jsonb),'performance',op.metrics) ORDER BY coalesce(d.published_at,d.scheduled_at,d.created_at) DESC),'[]') INTO wins
    FROM carousel_drafts d
    LEFT JOIN LATERAL (SELECT jsonb_build_object('impressions',o.num_impressions,'likes',o.num_likes,
      'comments',o.num_comments,'shares',o.num_shares,'url',o.linkedin_url,'measured_at',o.metrics_updated_at) metrics
      FROM own_posts o WHERE p_client='ivan' AND o.clickup_task_id=d.id::text ORDER BY o.posted_at DESC LIMIT 1) op ON true
    WHERE (d.client_id=p_client OR (p_client='ivan' AND d.client_id IS NULL)) AND d.status IN ('published','scheduled');

  SELECT coalesce(jsonb_agg(jsonb_build_object('id','own_post:'||o.id,'origin','own_published_post','action','published',
      'at',o.posted_at,'source',coalesce(o.source,'unrecorded'),'format',o.post_type,'topic',o.topic_category,
      'hook_pattern',o.hook_pattern,'body',o.post_text,'performance',jsonb_build_object('impressions',o.num_impressions,
      'likes',o.num_likes,'comments',o.num_comments,'shares',o.num_shares,'url',o.linkedin_url,
      'measured_at',o.metrics_updated_at)) ORDER BY o.posted_at DESC),'[]') INTO own
    FROM own_posts o WHERE p_client='ivan';
  SELECT coalesce(jsonb_agg(jsonb_build_object('id','client_post:'||m.id,'origin','own_published_post','action','published',
      'at',m.published_at,'title',m.title,'source','client_post_metrics','format',NULL,'topic',m.funnel_class,
      'body',s.post_text,'performance',jsonb_build_object('impressions',m.impressions,'likes',m.reactions,
      'comments',m.comments,'shares',m.shares,'url',m.post_url,'measured_at',m.captured_at)) ORDER BY m.published_at DESC),'[]') INTO client_own
    FROM client_post_metrics m LEFT JOIN client_post_state s ON s.client_id=m.client_id AND s.post_urn=m.social_id
    WHERE p_client<>'ivan' AND m.client_id=p_client;
  RETURN jsonb_build_object('client',p_client,'read_at',now(),'decisions',decisions,'wins',wins||own||client_own,
      'policy','Scheduled and published are choice wins; performance is measured evidence only. Null actor stays unknown.');
END $function$;
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
CREATE OR REPLACE FUNCTION public.cb34_p2_read_guard(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '20s'
AS $function$
DECLARE d public.carousel_drafts%ROWTYPE; m public.cb34_p2_members%ROWTYPE;
BEGIN
 SELECT * INTO d FROM public.carousel_drafts WHERE id=p_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF NOT COALESCE((auth.role()='service_role' OR (auth.uid() IS NOT NULL AND public.operator_gate_ok('clientops') AND public.lane_allowed(coalesce(d.client_id,'ivan')))),false) THEN RETURN NULL; END IF;
 SELECT * INTO m FROM public.cb34_p2_members WHERE draft_id=p_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('member',false,'visible',true); END IF;
 IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.cb34_p2_operator_lane_allowed(m.client_id) THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('member',true,'visible',COALESCE(
   m.state='released' AND m.validation->>'verdict'='PASS'
   AND ((m.client_id='ivan' AND d.client_id IS NULL) OR (m.client_id<>'ivan' AND d.client_id=m.client_id)),false));
END $function$;
CREATE OR REPLACE FUNCTION public.cb39_to_judge(p_client text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '20s'
AS $function$
DECLARE r jsonb;
BEGIN
  IF p_client IS NOT NULL AND NOT public.cb39_lane_ok(p_client) THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object('total', coalesce(sum(n), 0),
           'by_lane', coalesce(jsonb_object_agg(lane, n) FILTER (WHERE lane IS NOT NULL), '{}'::jsonb),
           'newest_release', max(newest))
    INTO r
    FROM (SELECT m.client_id AS lane, count(*) AS n, max(m.released_at) AS newest
            FROM public.cb34_p2_members m
            JOIN public.carousel_drafts d ON d.id = m.draft_id
           WHERE m.state = 'released' AND m.validation ->> 'verdict' = 'PASS'
             AND ((m.client_id = 'ivan' AND d.client_id IS NULL) OR (m.client_id <> 'ivan' AND d.client_id = m.client_id))
             AND d.status IN ('review','error') AND d.published_at IS NULL
             AND NOT coalesce((d.taxonomy ->> 'deleted_by_operator') = 'true', false)
             AND NOT EXISTS (SELECT 1 FROM public.cb39_draft_verdicts v WHERE v.draft_id = m.draft_id)
             AND (p_client IS NULL OR m.client_id = p_client)
             AND public.cb39_lane_ok(m.client_id)
           GROUP BY m.client_id) x;
  RETURN r;
END $function$;
CREATE OR REPLACE FUNCTION public.cb39_monday_card(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '15s'
 SET lock_timeout TO '1s'
AS $function$
DECLARE
  wk timestamptz := date_trunc('week', p_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  key text; n_total int; by_lane text; last_release timestamptz; v_title text; v_body text; existing public.inbox_notifications%ROWTYPE;
  n_keep int; n_edit int; n_drop int; results_line text; part text; c text; brain_line text; plan_lines text; plan_key text; plan_body text;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('cb39-monday-card', 0)) THEN RETURN jsonb_build_object('sent', false, 'reason', 'busy'); END IF;
  IF p_now < wk + interval '16 hours' THEN RETURN jsonb_build_object('sent', false, 'reason', 'before_release_window'); END IF;
  key := 'cb39-judge:' || to_char(wk AT TIME ZONE 'UTC', 'YYYY-MM-DD');

  SELECT coalesce(sum(n), 0)::int, string_agg(lane_label || ' ' || n, ', ' ORDER BY ord), max(newest)
    INTO n_total, by_lane, last_release
    FROM (SELECT CASE m.client_id WHEN 'ivan' THEN 'Ivan' WHEN 'risedtc' THEN 'Rise' ELSE 'Arch' END AS lane_label,
                 CASE m.client_id WHEN 'ivan' THEN 1 WHEN 'risedtc' THEN 2 ELSE 3 END AS ord,
                 count(*) AS n, max(m.released_at) AS newest
            FROM public.cb34_p2_members m
            JOIN public.carousel_drafts d ON d.id = m.draft_id
           WHERE m.state = 'released' AND m.validation ->> 'verdict' = 'PASS'
             AND m.released_at >= wk AND m.released_at <= p_now
             AND ((m.client_id = 'ivan' AND d.client_id IS NULL) OR (m.client_id <> 'ivan' AND d.client_id = m.client_id))
             AND d.status IN ('review','error') AND d.published_at IS NULL
             AND NOT coalesce((d.taxonomy ->> 'deleted_by_operator') = 'true', false)
             AND NOT EXISTS (SELECT 1 FROM public.cb39_draft_verdicts v WHERE v.draft_id = m.draft_id)
           GROUP BY m.client_id) x;

  -- 253 content plan (2026-10-11): one line per account, feed-only. Never blocks the judge card.
  BEGIN plan_lines := public.content_plan_monday_lines(p_now); EXCEPTION WHEN others THEN plan_lines := NULL; END;
  IF n_total = 0 THEN
    IF coalesce(plan_lines, '') = '' THEN RETURN jsonb_build_object('sent', false, 'reason', 'nothing_to_judge', 'week', wk); END IF;
    BEGIN brain_line := public.brain_monday_line(p_now); EXCEPTION WHEN others THEN brain_line := NULL; END;
    plan_body := plan_lines || CASE WHEN brain_line IS NOT NULL THEN E'\n' || brain_line ELSE '' END;
    plan_key := 'cb39-plan:' || to_char(wk AT TIME ZONE 'UTC', 'YYYY-MM-DD');
    SELECT * INTO existing FROM public.inbox_notifications WHERE dedupe_key = plan_key AND source = 'content-plan' ORDER BY created_at LIMIT 1;
    IF FOUND THEN
      IF existing.read_at IS NULL AND existing.dismissed_at IS NULL AND existing.body IS DISTINCT FROM plan_body THEN
        UPDATE public.inbox_notifications SET body = plan_body, last_seen_at = p_now WHERE id = existing.id;
        RETURN jsonb_build_object('sent', false, 'reason', 'plan_refreshed', 'id', existing.id);
      END IF;
      RETURN jsonb_build_object('sent', false, 'reason', 'plan_already_sent', 'id', existing.id);
    END IF;
    INSERT INTO public.inbox_notifications(family, source, dedupe_key, severity, title, body, url, tenant, group_key, push_result)
    VALUES ('content_plan', 'content-plan', plan_key, 'info', 'Content plan for the next 2 weeks', plan_body, '#exp/d/content/plan', NULL, plan_key,
            jsonb_build_object('skipped', 'feed_only'))
    RETURNING * INTO existing;
    RETURN jsonb_build_object('sent', true, 'id', existing.id, 'plan_only', true, 'body', plan_body);
  END IF;
  IF p_now - last_release < interval '45 minutes' AND p_now < wk + interval '30 hours' THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'settling', 'to_judge', n_total, 'last_release', last_release); END IF;

  -- Last week's verdicts (Monday to Monday, UTC).
  SELECT count(*) FILTER (WHERE verdict = 'keep'), count(*) FILTER (WHERE verdict = 'edited'), count(*) FILTER (WHERE verdict = 'drop')
    INTO n_keep, n_edit, n_drop
    FROM public.cb39_draft_verdicts WHERE decided_at >= wk - interval '7 days' AND decided_at < wk;

  -- Run 37's results line, only when there is a mature read: posts that reached 7 days last week, with impressions
  -- at 7 days and a known buyer-engager count. Any failure of the read leaves the line out.
  results_line := NULL;
  BEGIN
    FOREACH c IN ARRAY ARRAY['ivan','risedtc','arch'] LOOP
      SELECT CASE WHEN count(*) > 0 THEN
               CASE c WHEN 'ivan' THEN 'Ivan' WHEN 'risedtc' THEN 'Rise' ELSE 'Arch' END || ' ' || count(*) || ' post' ||
               CASE WHEN count(*) = 1 THEN '' ELSE 's' END || ', ' || sum(r.buyer_engagers) || ' buyer engager' ||
               CASE WHEN sum(r.buyer_engagers) = 1 THEN '' ELSE 's' END END
        INTO part
        FROM public.cb37_results(c, ((wk - interval '14 days') AT TIME ZONE 'UTC')::date) r
       WHERE r.published_at >= wk - interval '14 days' AND r.published_at < wk - interval '7 days'
         AND r.imp_7d IS NOT NULL AND r.buyer_engagers IS NOT NULL;
      IF part IS NOT NULL THEN results_line := coalesce(results_line || '; ', '') || part; END IF;
    END LOOP;
  EXCEPTION WHEN others THEN results_line := NULL;
  END;

  -- Self-updating brain (11 Oct 2026): one feed line, what changed this month with Undo, default "nothing changed".
  BEGIN brain_line := public.brain_monday_line(p_now); EXCEPTION WHEN others THEN brain_line := NULL; END;

  v_title := n_total || ' new brain draft' || CASE WHEN n_total = 1 THEN '' ELSE 's' END || '. Tap to judge.';
  v_body := by_lane || '. Approve or Drop on each card in Review, about 2 minutes.'
    || E'\nLast week: ' || n_keep || ' kept, ' || n_edit || ' edited, ' || n_drop || ' dropped.'
    || CASE WHEN results_line IS NOT NULL THEN E'\nResults at 7 days: ' || results_line || '.' ELSE '' END
    || CASE WHEN brain_line IS NOT NULL THEN E'\n' || brain_line ELSE '' END
    || CASE WHEN coalesce(plan_lines, '') <> '' THEN E'\nPlan:\n' || plan_lines ELSE '' END;

  SELECT * INTO existing FROM public.inbox_notifications WHERE dedupe_key = key AND source = 'cb39-judge' ORDER BY created_at LIMIT 1;
  IF FOUND THEN
    IF existing.read_at IS NULL AND existing.dismissed_at IS NULL AND (existing.title IS DISTINCT FROM v_title OR existing.body IS DISTINCT FROM v_body) THEN
      UPDATE public.inbox_notifications SET title = v_title, body = v_body, last_seen_at = p_now WHERE id = existing.id;
      RETURN jsonb_build_object('sent', false, 'reason', 'refreshed', 'id', existing.id, 'to_judge', n_total);
    END IF;
    RETURN jsonb_build_object('sent', false, 'reason', 'already_sent', 'id', existing.id);
  END IF;

  INSERT INTO public.inbox_notifications(family, source, dedupe_key, severity, title, body, url, tenant, group_key, push_result)
  VALUES ('brain_drafts_pending', 'cb39-judge', key, 'info', v_title, v_body, '#exp/d/content/now', NULL, key,
          jsonb_build_object('skipped', 'feed_only'))
  RETURNING * INTO existing;
  RETURN jsonb_build_object('sent', true, 'id', existing.id, 'to_judge', n_total, 'title', v_title, 'body', v_body);
END $function$;
DROP FUNCTION IF EXISTS public.cb39_implicit_verdict_tg();
DROP FUNCTION IF EXISTS public.cb39_implicit_delete_tg();
DROP FUNCTION IF EXISTS public.cb39_implicit_record(public.carousel_drafts, text, text, text, jsonb, boolean, boolean, timestamptz);
DROP FUNCTION IF EXISTS public.cb39_implicit_actor();
DROP FUNCTION IF EXISTS public.cb35_source_cooldown(text, text, text, integer);
DROP FUNCTION IF EXISTS public.cb35_source_author(text, text, text);
DROP FUNCTION IF EXISTS public.cb34_p2_review_block(jsonb, jsonb);
DELETE FROM public.cb39_draft_verdicts WHERE source = 'implicit';
ALTER TABLE public.cb39_draft_verdicts DROP CONSTRAINT cb39_draft_verdicts_source_check;
ALTER TABLE public.cb39_draft_verdicts ADD CONSTRAINT cb39_draft_verdicts_source_check
  CHECK (source = ANY (ARRAY['app'::text, 'backfill'::text]));
COMMIT;
