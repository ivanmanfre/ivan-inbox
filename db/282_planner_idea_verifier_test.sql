-- Run against live DB; every fixture and queued side effect rolls back. No dates or publish writes.
-- Uses a real ordinary ivan-writer PASS artifact and its genuine source/QA, never fabricates a verifier PASS.
BEGIN;
DO $test$
DECLARE c public.lm_idea_candidates%rowtype; d public.carousel_drafts%rowtype;
  ci uuid; di uuid; si uuid; r jsonb; p jsonb; st jsonb; n int; flag text;
  wk date := date_trunc('week',now() AT TIME ZONE 'Europe/Warsaw')::date+7;
BEGIN
  SELECT * INTO STRICT c FROM public.lm_idea_candidates WHERE id='3cb2acd9-e582-4a97-8abf-3def441a01af';
  SELECT * INTO STRICT d FROM public.carousel_drafts WHERE id='fa1cd21a-a8ef-42e6-9624-78245b076f90';
  ci:=gen_random_uuid(); di:=gen_random_uuid(); si:=gen_random_uuid();
  INSERT INTO public.lm_idea_candidates(id,source,source_ref,raw_topic,post_angle,raw_context,evidence,content_type,status,workspace_type)
  VALUES(ci,c.source,c.source_ref,c.raw_topic,c.post_angle,c.raw_context,c.evidence,'post','reviewing','own');
  INSERT INTO public.content_plan_slots(id,account,week_start,kind,idea_source,idea_ref,topic,why_now,status)
  VALUES(si,'ivan',wk,'idea','lm_idea_candidates',ci::text,c.raw_topic,'transactional verifier integration test','requested');
  -- The draft INSERT is exactly the ordinary promoter's registration path.
  INSERT INTO public.carousel_drafts(id,title,topic,type,status,post_body,qa,description,taxonomy)
  VALUES(di,d.title,d.topic,d.type,'review',d.post_body,d.qa,d.description,
    jsonb_build_object('source_candidate_id',ci,'source',c.source));
  IF NOT EXISTS(SELECT 1 FROM public.cb34_p2_members WHERE draft_id=di AND candidate_id=ci AND client_id='ivan' AND state='held' AND validation IS NULL) THEN
    RAISE EXCEPTION 'ordinary promoter INSERT did not create an unvalidated held member'; END IF;
  UPDATE public.lm_idea_candidates SET promoted_draft_id=di,promoted_draft_table='carousel_drafts',status='promoted' WHERE id=ci;
  r:=public.content_plan_register_ivan_idea(ci,di);
  IF r->>'reason' IS DISTINCT FROM 'already_registered' THEN RAISE EXCEPTION 'registration is not idempotent: %',r; END IF;
  SELECT x INTO p FROM jsonb_array_elements(public.cb35_brain_pending_v4()) x WHERE x->>'draft_id'=di::text;
  IF p IS NULL OR p#>>'{brief,payload,draft_id}' IS DISTINCT FROM di::text OR p#>>'{brief,source_kind}' IS DISTINCT FROM 'planner_original_idea' THEN
    RAISE EXCEPTION 'not pending in the normal verifier with a retry payload'; END IF;
  SELECT x INTO r FROM jsonb_array_elements(public.content_autopilot_candidates('ivan',wk)) x WHERE x->>'draft_id'=di::text;
  IF r->>'eligible' IS DISTINCT FROM 'false' OR r->>'plan_slot_id' IS DISTINCT FROM si::text OR (r->>'planned_week')::date IS DISTINCT FROM wk THEN
    RAISE EXCEPTION 'unchecked draft eligible or original idea slot not resolved: %',r; END IF;
  SELECT x INTO r FROM jsonb_array_elements(public.content_autopilot_candidates('ivan',wk+7)) x WHERE x->>'draft_id'=di::text;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(r->'fails') f WHERE f LIKE 'planned for the week%') THEN RAISE EXCEPTION 'another week can steal the idea draft'; END IF;
  st:=public.content_plan_week('ivan');
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(st->'weeks') w,jsonb_array_elements(w->'planned') s WHERE s->>'slot_id'=si::text AND s->>'status'='drafting') THEN
    RAISE EXCEPTION 'in-flight verification did not retain the planner slot'; END IF;
  -- A real failed QA outcome is never promoted. Final-held drafts must give the slot back.
  UPDATE public.cb34_p2_members SET hold_reason='final: transactional hold gate proof' WHERE draft_id=di;
  st:=public.content_plan_week('ivan');
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(st->'weeks') w,jsonb_array_elements(w->'cannot_go_out') s WHERE s->>'slot_id'=si::text) THEN
    RAISE EXCEPTION 'final-held idea draft still fills the plan'; END IF;
  -- Scope and human edit protections: independent candidates keep every other guard valid.
  FOREACH flag IN ARRAY ARRAY['human_edited','deleted_by_operator','internal_test','client_lane','no_slot','authenticated','borrowed','video'] LOOP
    ci:=gen_random_uuid(); di:=gen_random_uuid();
    INSERT INTO public.lm_idea_candidates(id,source,raw_topic,post_angle,raw_context,evidence,content_type,status,workspace_type)
    VALUES(ci,CASE WHEN flag='borrowed' THEN 'competitor' ELSE c.source END,c.raw_topic,c.post_angle,c.raw_context,c.evidence,'post','reviewing','own');
    IF flag<>'no_slot' THEN
      INSERT INTO public.content_plan_slots(account,week_start,kind,idea_source,idea_ref,topic,why_now,status)
      VALUES('ivan',wk,'idea','lm_idea_candidates',ci::text,c.raw_topic,'scope test','requested');
    END IF;
    IF flag='authenticated' THEN PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true); END IF;
    INSERT INTO public.carousel_drafts(id,client_id,title,topic,type,status,post_body,qa,taxonomy)
    VALUES(di,CASE WHEN flag='client_lane' THEN 'arch' END,d.title,d.topic,CASE WHEN flag='video' THEN 'video' ELSE 'text' END,'review',d.post_body,d.qa,
      jsonb_build_object('source_candidate_id',ci)||CASE WHEN flag IN ('human_edited','deleted_by_operator','internal_test') THEN jsonb_build_object(flag,true) ELSE '{}'::jsonb END);
    IF flag='authenticated' THEN
      UPDATE public.lm_idea_candidates SET promoted_draft_id=di,promoted_draft_table='carousel_drafts' WHERE id=ci;
      PERFORM set_config('request.jwt.claims','',true);
    END IF;
    IF flag='borrowed' THEN
      IF NOT EXISTS(SELECT 1 FROM public.cb34_p2_members WHERE draft_id=di AND state='held' AND hold_reason LIKE 'final:%borrowed-winner%') THEN RAISE EXCEPTION 'borrowed-winner material was treated as an original idea'; END IF;
    ELSIF flag='video' THEN
      IF NOT EXISTS(SELECT 1 FROM public.cb34_p2_members WHERE draft_id=di AND state='held' AND hold_reason LIKE 'final:%asset verifier%') THEN RAISE EXCEPTION 'video entered a copy-only verification/retry path'; END IF;
    ELSIF EXISTS(SELECT 1 FROM public.cb34_p2_members WHERE draft_id=di) THEN RAISE EXCEPTION 'scope protection failed: %',flag; END IF;
  END LOOP;
  -- Existing dated rows are only READ; no fixture is scheduled or published.
  SELECT id INTO di FROM public.carousel_drafts WHERE client_id IS NULL AND (scheduled_at IS NOT NULL OR published_at IS NOT NULL) LIMIT 1;
  IF di IS NOT NULL THEN
    r:=public.content_plan_register_ivan_idea(ci,di);
    IF coalesce((r->>'registered')::boolean,false) THEN RAISE EXCEPTION 'dated row registered'; END IF;
  END IF;
  RAISE NOTICE 'db/282 integration assertions passed';
END $test$;
SELECT 'PASS: held registration, normal pending/retry payload, exact slot/week mapping, fail-closed eligibility, in-flight slot retention, final hold removal, idempotency, authenticated writes, human edit/deleted/test/client/no-slot/borrowed/dated exclusions' AS result;
ROLLBACK;
