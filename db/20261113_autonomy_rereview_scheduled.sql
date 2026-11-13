-- 2026-11-13  Ivan autopilot: a scheduled post whose automatic review went stale is re-reviewed in place.
--
-- Bug: content_autonomy_gate_ivan binds the review to a hash of the whole draft manifest, which includes
-- advisory metadata that background jobs write after the review (qa.line_flags, qa.lint_advisory,
-- taxonomy.no_photo*, taxonomy.iso_loop). content_autonomy_review_due_ivan only returned undated drafts, so a
-- scheduled autopilot post that went stale was never reviewed again and the publisher refused it at its slot
-- (autonomy_review_stale) with no alert. 13 Nov post missed; 20, 23 and 25 Nov were blocked the same way.
--
-- Fix, database only (the reviewer in workflow 9NfRVTzpY2Qeo5qy is driven by these functions):
--  1. New reviews are bound to a "core" manifest: the same manifest minus those advisory keys. Everything that
--     is published or that the review judged (body, type, assets, slides, sources, the rest of taxonomy and qa,
--     brain provenance, policy) stays bound. Receipts written before this change keep the full-manifest binding.
--  2. review_due also returns scheduled autopilot posts (armed pick, same slot, same text, slot more than
--     20 minutes ahead) whose gate fails, soonest slot first. review_save accepts them. Nothing else about a
--     scheduled post is touched: only qa.autonomous_review is written, as before.
-- A post whose slot has already passed is not re-reviewed, so nothing publishes late because of this change.
--  3. A GIF attachment never passes the automatic gate: the sighted reviewer sees one frame of it.

CREATE OR REPLACE FUNCTION public.content_autonomy_manifest_core(p_manifest jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT CASE WHEN jsonb_typeof(p_manifest) IS DISTINCT FROM 'object' THEN p_manifest ELSE
  p_manifest
  || jsonb_build_object('taxonomy', CASE WHEN jsonb_typeof(p_manifest->'taxonomy')='object'
       THEN (p_manifest->'taxonomy') - ARRAY['no_photo','no_photo_at','no_photo_reason','iso_loop'] ELSE p_manifest->'taxonomy' END)
  || jsonb_build_object('qa_without_autonomous_review', CASE WHEN jsonb_typeof(p_manifest->'qa_without_autonomous_review')='object'
       THEN (p_manifest->'qa_without_autonomous_review') - ARRAY['line_flags','lint_advisory'] ELSE p_manifest->'qa_without_autonomous_review' END)
  || jsonb_build_object('manifest_kind','core-v2') END;
$function$;
REVOKE ALL ON FUNCTION public.content_autonomy_manifest_core(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_autonomy_manifest_core(jsonb) TO service_role;

-- The hash a receipt must match now: core for receipts stamped core-v2, the full manifest for older ones.
CREATE OR REPLACE FUNCTION public.content_autonomy_bound_sha_ivan(p_draft uuid, p_kind text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT encode(sha256(convert_to((CASE WHEN p_kind='core-v2' THEN public.content_autonomy_manifest_core(m) ELSE m END)::text,'UTF8')),'hex')
 FROM (SELECT public.content_autonomy_manifest_ivan(p_draft) m) x;
$function$;
REVOKE ALL ON FUNCTION public.content_autonomy_bound_sha_ivan(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_autonomy_bound_sha_ivan(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.content_autonomy_gate_ivan(p_draft uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE d public.carousel_drafts%ROWTYPE; base jsonb; f jsonb; r jsonb; mf jsonb; sha text; k text; urls jsonb; expected_urls jsonb;
BEGIN
 base:=public.content_autonomy_base_ivan(p_draft); f:=base->'fails';
 SELECT * INTO d FROM public.carousel_drafts WHERE id=p_draft AND client_id IS NULL;
 IF NOT FOUND THEN RETURN base; END IF;
 mf:=public.content_autonomy_manifest_ivan(p_draft);
 r:=d.qa->'autonomous_review';
 -- 2026-11-13: receipts stamped core-v2 are bound to the manifest without advisory metadata; older receipts to the full one.
 sha:=encode(sha256(convert_to((CASE WHEN r->>'manifest_kind'='core-v2' THEN public.content_autonomy_manifest_core(mf) ELSE mf END)::text,'UTF8')),'hex');
 IF r->>'manifest_sha256' IS DISTINCT FROM sha OR r->>'policy_sha256' IS DISTINCT FROM mf->>'policy_sha256'
  OR r->>'policy_version' IS DISTINCT FROM 'ivan-autonomy-v1-cold-start' THEN f:=f||jsonb_build_array('automatic review is missing or stale'); END IF;
 FOREACH k IN ARRAY ARRAY['facts','editorial'] LOOP
  IF coalesce(r->k->>'verdict','')<>'PASS' OR nullif(btrim(r->k->>'response_id'),'') IS NULL OR nullif(btrim(r->k->>'model'),'') IS NULL
   OR jsonb_typeof(r->k->'blocks') IS DISTINCT FROM 'array' OR (CASE WHEN jsonb_typeof(r->k->'blocks')='array' THEN jsonb_array_length(r->k->'blocks') ELSE 1 END)<>0 THEN
   f:=f||jsonb_build_array('independent '||k||' review has not passed');
  END IF;
 END LOOP;
 IF r->'facts'->>'response_id'=r->'editorial'->>'response_id' THEN f:=f||jsonb_build_array('reviews must be separate provider responses'); END IF;
 SELECT coalesce(jsonb_agg(x ORDER BY x),'[]'::jsonb) INTO expected_urls FROM (
  SELECT DISTINCT u AS x FROM unnest(coalesce(d.image_urls,'{}'::text[])||ARRAY[d.pdf_url,d.video_url]) u WHERE nullif(u,'') IS NOT NULL) a;
 IF expected_urls='[]'::jsonb THEN
  IF coalesce(r->'assets'->>'verdict','')<>'NOT_REQUIRED' THEN f:=f||jsonb_build_array('text-only asset decision is missing'); END IF;
 ELSE
  IF coalesce(r->'assets'->>'verdict','')<>'PASS' OR coalesce(r->'assets'->>'coverage','')<>'all_final_assets'
   OR nullif(btrim(r->'assets'->>'response_id'),'') IS NULL OR nullif(btrim(r->'assets'->>'model'),'') IS NULL
   OR jsonb_typeof(r->'assets'->'blocks') IS DISTINCT FROM 'array' OR (CASE WHEN jsonb_typeof(r->'assets'->'blocks')='array' THEN jsonb_array_length(r->'assets'->'blocks') ELSE 1 END)<>0
   OR jsonb_typeof(r->'assets'->'files') IS DISTINCT FROM 'array' THEN f:=f||jsonb_build_array('all final assets need a sighted review');
  ELSE
   SELECT coalesce(jsonb_agg(x ORDER BY x),'[]'::jsonb) INTO urls FROM (
    SELECT DISTINCT z->>'url' x FROM jsonb_array_elements(r->'assets'->'files') z
    WHERE z->>'sha256' ~ '^[0-9a-f]{64}$' AND coalesce((z->>'bytes')~'^[1-9][0-9]*$',false)) a;
   IF urls IS DISTINCT FROM expected_urls THEN f:=f||jsonb_build_array('reviewed asset byte hashes do not cover final URLs'); END IF;
   -- 2026-11-13: the sighted reviewer sees only the first frame of a GIF, so a GIF is never covered by its PASS.
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(r->'assets'->'files') z WHERE z->>'mime_type'='image/gif' OR z->>'url' ~* '\.gif(\?|$)')
    THEN f:=f||jsonb_build_array('animated GIF needs a full-frame review'); END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object('eligible',jsonb_array_length(f)=0,'fails',f,'manifest_sha256',sha,'policy_sha256',mf->>'policy_sha256','reviewed_at',r->'reviewed_at');
END $function$;

CREATE OR REPLACE FUNCTION public.content_autonomy_review_due_ivan(p_limit integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE out jsonb;
BEGIN
 IF NOT public.content_plan_service_ok() THEN RAISE EXCEPTION 'service only'; END IF;
 SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO out FROM (
  SELECT jsonb_build_object('draft_id',d.id,'expected',public.content_autonomy_manifest_ivan(d.id),
   'manifest_sha256',encode(sha256(convert_to(public.content_autonomy_manifest_ivan(d.id)::text,'UTF8')),'hex'),
   'source_pack',d.qa->'writer_source_pack','constraints',public.content_autonomy_policy_ivan(),
   'prewrite_evidence',coalesce(d.qa->'prewrite_evidence',jsonb_build_object('status','unavailable')),
   'brain_brief',m.brief) x
  FROM public.carousel_drafts d LEFT JOIN public.cb34_p2_members m ON m.draft_id=d.id
  WHERE d.client_id IS NULL AND d.published_at IS NULL
   AND ((d.status IN ('review','approved') AND d.scheduled_at IS NULL)
    -- 2026-11-13: a scheduled autopilot post is reviewed again in place when its review no longer holds.
    -- Only a live automatic slot that is still ahead: armed pick, same slot, same checked text.
    -- Admission closes 20 minutes before the slot; review_save refuses inside the last 10.
    OR (d.status='scheduled' AND d.scheduled_at>now()+interval '20 minutes'
     AND EXISTS(SELECT 1 FROM public.content_autopilot_picks ap WHERE ap.account='ivan' AND ap.draft_id=d.id AND ap.state='armed'
      AND ap.slot_at=d.scheduled_at AND ap.body_sha256=encode(sha256(convert_to(d.post_body,'UTF8')),'hex'))))
   AND (public.content_autonomy_base_ivan(d.id)->>'eligible')::boolean
   AND NOT (public.content_autonomy_gate_ivan(d.id)->>'eligible')::boolean
   -- A valid HOLD is an exception, not an invitation to retry every sweep.
   AND (d.qa->'autonomous_review'->>'manifest_sha256' IS DISTINCT FROM public.content_autonomy_bound_sha_ivan(d.id,d.qa->'autonomous_review'->>'manifest_kind')
    -- A provider failure on a scheduled post is retried on the next sweep: its slot will not wait six hours.
    -- The receipt is stamped when the review is saved, minutes into a sweep, so the wait is only long enough
    -- to keep one sweep from taking the same row twice. Sweeps are 10 minutes apart and take one row each.
    OR (d.qa->'autonomous_review'->>'retryable'='true' AND (d.qa->'autonomous_review'->>'reviewed_at')::timestamptz<now()-CASE WHEN d.scheduled_at IS NULL THEN interval '6 hours' ELSE interval '1 minute' END))
  -- Fresh work (no receipt for the draft as it is now) goes before retries of a failed provider call, so a
  -- provider that keeps failing on some posts cannot starve the rest. Inside each group: soonest slot, then undated.
  ORDER BY (d.qa->'autonomous_review'->>'manifest_sha256' IS NOT DISTINCT FROM public.content_autonomy_bound_sha_ivan(d.id,d.qa->'autonomous_review'->>'manifest_kind')),
   (d.scheduled_at IS NULL),d.scheduled_at,d.created_at DESC,d.id LIMIT greatest(0,least(coalesce(p_limit,1),5))
 ) a;
 RETURN out;
END $function$;

CREATE OR REPLACE FUNCTION public.content_autonomy_review_save_ivan(p_draft uuid, p_expected jsonb, p_review jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE current_manifest jsonb; r jsonb; gate jsonb;
BEGIN
 IF NOT public.content_plan_service_ok() THEN RAISE EXCEPTION 'service only'; END IF;
 PERFORM 1 FROM public.carousel_drafts WHERE id=p_draft AND client_id IS NULL FOR UPDATE;
 current_manifest:=public.content_autonomy_manifest_ivan(p_draft);
 -- 2026-11-13: the snapshot the reviewer read must equal the draft now, advisory metadata aside.
 IF current_manifest IS NULL OR public.content_autonomy_manifest_core(current_manifest) IS DISTINCT FROM public.content_autonomy_manifest_core(p_expected) THEN RETURN jsonb_build_object('ok',false,'error','snapshot_changed'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.carousel_drafts d WHERE d.id=p_draft AND d.published_at IS NULL
   AND ((d.status IN ('review','approved') AND d.scheduled_at IS NULL)
    OR (d.status='scheduled' AND d.scheduled_at>now()+interval '10 minutes'
     AND EXISTS(SELECT 1 FROM public.content_autopilot_picks ap WHERE ap.account='ivan' AND ap.draft_id=d.id AND ap.state='armed'
      AND ap.slot_at=d.scheduled_at AND ap.body_sha256=encode(sha256(convert_to(d.post_body,'UTF8')),'hex')))))
  OR NOT (public.content_autonomy_base_ivan(p_draft)->>'eligible')::boolean THEN RETURN jsonb_build_object('ok',false,'error','not_reviewable'); END IF;
 IF jsonb_typeof(p_review) IS DISTINCT FROM 'object' OR octet_length(p_review::text)>100000 THEN RETURN jsonb_build_object('ok',false,'error','invalid_review'); END IF;
 r:=p_review||jsonb_build_object('manifest_sha256',encode(sha256(convert_to(public.content_autonomy_manifest_core(current_manifest)::text,'UTF8')),'hex'),
  'manifest_kind','core-v2',
  'policy_sha256',current_manifest->>'policy_sha256','policy_version','ivan-autonomy-v1-cold-start',
  'reviewed_at',now(),'human_calibration','cold_start_one_recorded_rejection_zero_recorded_acceptances');
 UPDATE public.carousel_drafts SET qa=jsonb_set(coalesce(qa,'{}'::jsonb),'{autonomous_review}',r,true) WHERE id=p_draft;
 gate:=public.content_autonomy_gate_ivan(p_draft);
 RETURN jsonb_build_object('ok',true,'eligible',gate->'eligible','fails',gate->'fails','manifest_sha256',r->>'manifest_sha256');
END $function$;
