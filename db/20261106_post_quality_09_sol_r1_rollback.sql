-- Rollback of 20261106_post_quality_09_sol_r1.sql: restores content_plan_place_ivan and drops the helper.
-- Then re-run sections 2-4 of 20261106_post_quality_09.sql for the round-0 bodies, or 20261106_post_quality_09_rollback.sql to remove build 09.
begin;
CREATE OR REPLACE FUNCTION public.content_plan_place_ivan(p_draft uuid, p_at timestamp with time zone, p_expected_body_sha256 text, p_source text DEFAULT 'approved_scheduler'::text, p_explicit_extra boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE d public.carousel_drafts%ROWTYPE; sid uuid; wk date; n int; reserved_n int; v_at timestamptz; e jsonb;
 old_manual text := current_setting('app.schedule_manual',true);
 old_actor text := current_setting('content_plan.actor',true);
 old_kind text := current_setting('content_plan.placement_kind',true);
BEGIN
 IF NOT public.content_plan_service_ok() THEN RAISE EXCEPTION 'service only'; END IF;
 p_explicit_extra:=coalesce(p_explicit_extra,false);
 IF p_source NOT IN ('approved_scheduler','autopilot','explicit','timely_swap') OR p_source IS NULL THEN RETURN jsonb_build_object('ok',false,'error','invalid_source'); END IF;
 IF p_explicit_extra AND p_source <> 'explicit' THEN RETURN jsonb_build_object('ok',false,'error','extra_requires_explicit'); END IF;
 IF p_at IS NULL OR p_at <= now() THEN RETURN jsonb_build_object('ok',false,'error','past_date'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('content-plan:ivan',0));
 PERFORM public.content_plan_reconcile_ivan();
 SELECT * INTO d FROM public.carousel_drafts WHERE id=p_draft FOR UPDATE;
 IF NOT FOUND OR d.client_id IS NOT NULL OR d.published_at IS NOT NULL
    OR coalesce(d.taxonomy->>'deleted_by_operator','')='true'
    OR d.status NOT IN ('review','approved','scheduled') THEN RETURN jsonb_build_object('ok',false,'error','not_schedulable'); END IF;
 IF p_expected_body_sha256 IS NULL OR p_expected_body_sha256<>encode(sha256(convert_to(coalesce(d.post_body,''),'UTF8')),'hex') THEN RETURN jsonb_build_object('ok',false,'error','text_changed'); END IF;
 IF d.status='scheduled' AND d.scheduled_at IS NOT DISTINCT FROM p_at THEN
   SELECT id INTO sid FROM public.content_plan_slots WHERE account='ivan' AND placed_draft_id=d.id AND placed_at=p_at ORDER BY created_at LIMIT 1;
   IF sid IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'scheduled_at',p_at,'slot_id',sid,'idempotent',true); END IF;
 END IF;
 IF d.scheduled_at IS NOT NULL AND d.scheduled_at IS DISTINCT FROM p_at THEN RETURN jsonb_build_object('ok',false,'error','already_dated'); END IF;
 IF p_source IN ('approved_scheduler','explicit','timely_swap') AND d.status<>'approved' THEN RETURN jsonb_build_object('ok',false,'error','approval_required'); END IF;
 IF nullif(btrim(d.post_body),'') IS NULL OR public.cb34_p2_review_block(d.qa,d.taxonomy) IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'error','quality_hold'); END IF;
 IF d.type='video' AND nullif(d.video_url,'') IS NULL OR d.type IN ('carousel','pdf','document') AND nullif(d.pdf_url,'') IS NULL THEN RETURN jsonb_build_object('ok',false,'error','media_not_ready'); END IF;
 IF p_source='autopilot' THEN
   IF p_at < now()+make_interval(hours=>greatest(48,coalesce((SELECT veto_hours FROM public.content_autopilot_config WHERE account='ivan'),48))) THEN RETURN jsonb_build_object('ok',false,'error','veto_window'); END IF;
   IF NOT coalesce((public.content_autonomy_gate_ivan(p_draft)->>'eligible')::boolean,false) THEN RETURN jsonb_build_object('ok',false,'error','autonomy_hold'); END IF;
   IF NOT EXISTS(SELECT 1 FROM public.content_autopilot_config WHERE account='ivan' AND mode='live') THEN RETURN jsonb_build_object('ok',false,'error','autopilot_not_live'); END IF;
   e := (SELECT x FROM jsonb_array_elements(public.content_brain_eligibility('ivan',now(),array[p_draft])) x LIMIT 1);
   IF e IS NULL OR coalesce(jsonb_array_length(e->'fails'),1)>0 THEN RETURN jsonb_build_object('ok',false,'error','quality_hold'); END IF;
 END IF;
 IF p_source<>'explicit' AND extract(isodow FROM p_at AT TIME ZONE 'Europe/Warsaw')>=6 THEN RETURN jsonb_build_object('ok',false,'error','automatic_weekday_only'); END IF;
 -- Include unlinked queue rows; a draft/queue pair is one publication, not two.
 IF EXISTS(SELECT 1 FROM public.carousel_drafts x WHERE x.client_id IS NULL AND x.id<>d.id
   AND x.status IN ('review','approved','scheduled','published') AND coalesce(x.published_at,x.scheduled_at) IS NOT NULL
   AND coalesce(x.taxonomy->>'deleted_by_operator','')<>'true'
   AND (abs(extract(epoch FROM coalesce(x.published_at,x.scheduled_at)-p_at))<86400
       OR (coalesce(x.published_at,x.scheduled_at) AT TIME ZONE 'Europe/Warsaw')::date=(p_at AT TIME ZONE 'Europe/Warsaw')::date))
 OR EXISTS(SELECT 1 FROM public.scheduled_posts q WHERE q.platform='linkedin' AND q.status IN ('pending','posting','posted')
   AND coalesce(q.is_repost,false)=false AND q.clickup_task_id IS DISTINCT FROM d.id::text
   AND NOT EXISTS(SELECT 1 FROM public.carousel_drafts x WHERE x.id::text=q.clickup_task_id)
   AND (abs(extract(epoch FROM coalesce(q.posted_at,q.scheduled_at)-p_at))<86400
       OR (coalesce(q.posted_at,q.scheduled_at) AT TIME ZONE 'Europe/Warsaw')::date=(p_at AT TIME ZONE 'Europe/Warsaw')::date))
 THEN RETURN jsonb_build_object('ok',false,'error','spacing_conflict'); END IF;
 wk:=date_trunc('week',p_at AT TIME ZONE 'Europe/Warsaw')::date;
 SELECT count(*) INTO n FROM (
  SELECT x.id::text FROM public.carousel_drafts x WHERE x.client_id IS NULL AND x.id<>d.id
   AND x.status IN ('review','approved','scheduled','published') AND coalesce(x.taxonomy->>'deleted_by_operator','')<>'true'
   AND (coalesce(x.published_at,x.scheduled_at) AT TIME ZONE 'Europe/Warsaw')::date>=wk
   AND (coalesce(x.published_at,x.scheduled_at) AT TIME ZONE 'Europe/Warsaw')::date<wk+7
  UNION ALL SELECT q.id::text FROM public.scheduled_posts q WHERE q.platform='linkedin' AND q.status IN ('pending','posting','posted')
   AND coalesce(q.is_repost,false)=false AND NOT EXISTS(SELECT 1 FROM public.carousel_drafts x WHERE x.id::text=q.clickup_task_id)
   AND (coalesce(q.posted_at,q.scheduled_at) AT TIME ZONE 'Europe/Warsaw')::date>=wk
   AND (coalesce(q.posted_at,q.scheduled_at) AT TIME ZONE 'Europe/Warsaw')::date<wk+7
 ) dated;
 IF n>=5 AND NOT p_explicit_extra THEN RETURN jsonb_build_object('ok',false,'error','baseline_full'); END IF;
 -- A reserved draft belongs to its plan week; automatic placement cannot silently steal it.
 SELECT s.id INTO sid FROM public.content_plan_slots s WHERE s.account='ivan' AND s.status IN ('planned','requested','proposal')
  AND (s.placed_draft_id=d.id OR s.idea_source='carousel_drafts' AND s.idea_ref=d.id::text
   OR s.idea_source='lm_idea_candidates' AND EXISTS(SELECT 1 FROM public.lm_idea_candidates l WHERE l.id::text=s.idea_ref AND l.promoted_draft_id=d.id))
  ORDER BY (s.week_start=wk) DESC,s.created_at LIMIT 1 FOR UPDATE;
 IF sid IS NOT NULL AND EXISTS(SELECT 1 FROM public.content_plan_slots WHERE id=sid AND week_start<>wk) THEN RETURN jsonb_build_object('ok',false,'error','reserved_other_week'); END IF;
 IF sid IS NULL AND NOT p_explicit_extra THEN
  SELECT count(*) INTO reserved_n FROM public.content_plan_slots s WHERE s.account='ivan' AND s.week_start=wk
   AND s.status IN ('planned','requested','proposal')
   -- Keep pending generation and reviewable reservations. A failed automatic written reservation cannot consume a new placement's capacity.
   AND NOT (s.kind='review_draft' AND s.idea_source='carousel_drafts' AND s.plan_run_id IS NOT NULL
     AND EXISTS(SELECT 1 FROM public.carousel_drafts held WHERE held.id::text=s.idea_ref AND held.client_id IS NULL
       AND held.scheduled_at IS NULL AND held.published_at IS NULL
       AND NOT coalesce((public.content_autonomy_base_ivan(held.id)->>'eligible')::boolean,false)))
   AND NOT EXISTS(SELECT 1 FROM public.carousel_drafts x WHERE x.scheduled_at IS NOT NULL AND (x.id=s.placed_draft_id OR s.idea_source='carousel_drafts' AND x.id::text=s.idea_ref
    OR s.idea_source='lm_idea_candidates' AND EXISTS(SELECT 1 FROM public.lm_idea_candidates l WHERE l.id::text=s.idea_ref AND l.promoted_draft_id=x.id)));
  IF n+reserved_n>=5 THEN RETURN jsonb_build_object('ok',false,'error','reserved_capacity_full'); END IF;
 END IF;
 IF sid IS NULL THEN
  INSERT INTO public.content_plan_slots(account,week_start,kind,idea_source,idea_ref,topic,why_now,format,status)
  VALUES('ivan',wk,'review_draft','carousel_drafts',d.id::text,d.title,'Approved content placed into the shared plan',d.type,'planned') RETURNING id INTO sid;
 END IF;
 PERFORM set_config('content_plan.actor','planner',true);
 PERFORM set_config('content_plan.placement_kind',p_source,true);
 PERFORM set_config('app.schedule_manual',CASE WHEN p_source='explicit' THEN 'on' ELSE '' END,true);
 UPDATE public.carousel_drafts SET status='scheduled',scheduled_at=p_at WHERE id=d.id RETURNING scheduled_at INTO v_at;
 IF v_at IS DISTINCT FROM p_at THEN RAISE EXCEPTION 'placement shifted unexpectedly'; END IF;
 UPDATE public.content_plan_slots SET placed_draft_id=d.id,placed_at=v_at,placement_kind=p_source,updated_at=now() WHERE id=sid;
 UPDATE public.content_plan_slots s SET status='superseded',status_note='same draft placed through the shared plan',updated_at=now()
  WHERE s.account='ivan' AND s.id<>sid AND s.status IN ('planned','requested','proposal')
   AND (s.placed_draft_id=d.id OR s.idea_source='carousel_drafts' AND s.idea_ref=d.id::text
    OR s.idea_source='lm_idea_candidates' AND EXISTS(SELECT 1 FROM public.lm_idea_candidates l WHERE l.id::text=s.idea_ref AND l.promoted_draft_id=d.id));
 PERFORM set_config('content_plan.actor',coalesce(old_actor,''),true);
 PERFORM set_config('content_plan.placement_kind',coalesce(old_kind,''),true);
 PERFORM set_config('app.schedule_manual',coalesce(old_manual,''),true);
 RETURN jsonb_build_object('ok',true,'scheduled_at',v_at,'slot_id',sid);
END $function$;
drop function if exists public.ivan_rerun_blocked(text, uuid, jsonb);
commit;
