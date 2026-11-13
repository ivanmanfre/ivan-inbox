-- Rollback of 20261113 autonomy re-review.
-- Reverts the two producer functions: scheduled posts are no longer re-reviewed and new receipts are stamped
-- with the full-manifest hash again. review_due is the captured definition with one line kept from the new
-- one: the "valid HOLD is not retried" compare reads the receipt's own format, so a core-v2 HOLD on an
-- unchanged undated draft is not reviewed again.
-- The gate keeps reading both receipt formats and the two helpers stay, so receipts already stamped
-- manifest_kind='core-v2' on scheduled posts remain valid and those posts still publish.
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
  WHERE d.client_id IS NULL AND d.status IN ('review','approved') AND d.scheduled_at IS NULL AND d.published_at IS NULL
   AND (public.content_autonomy_base_ivan(d.id)->>'eligible')::boolean
   AND NOT (public.content_autonomy_gate_ivan(d.id)->>'eligible')::boolean
   -- A valid HOLD is an exception, not an invitation to retry every sweep.
   AND (d.qa->'autonomous_review'->>'manifest_sha256' IS DISTINCT FROM public.content_autonomy_bound_sha_ivan(d.id,d.qa->'autonomous_review'->>'manifest_kind')
    OR (d.qa->'autonomous_review'->>'retryable'='true' AND (d.qa->'autonomous_review'->>'reviewed_at')::timestamptz<now()-interval '6 hours'))
  ORDER BY d.created_at DESC,d.id LIMIT greatest(0,least(coalesce(p_limit,1),5))
 ) a;
 RETURN out;
END $function$
;
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
 IF current_manifest IS NULL OR current_manifest IS DISTINCT FROM p_expected THEN RETURN jsonb_build_object('ok',false,'error','snapshot_changed'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.carousel_drafts WHERE id=p_draft AND status IN ('review','approved') AND scheduled_at IS NULL AND published_at IS NULL) OR NOT (public.content_autonomy_base_ivan(p_draft)->>'eligible')::boolean THEN RETURN jsonb_build_object('ok',false,'error','not_reviewable'); END IF;
 IF jsonb_typeof(p_review) IS DISTINCT FROM 'object' OR octet_length(p_review::text)>100000 THEN RETURN jsonb_build_object('ok',false,'error','invalid_review'); END IF;
 r:=p_review||jsonb_build_object('manifest_sha256',encode(sha256(convert_to(current_manifest::text,'UTF8')),'hex'),
  'policy_sha256',current_manifest->>'policy_sha256','policy_version','ivan-autonomy-v1-cold-start',
  'reviewed_at',now(),'human_calibration','cold_start_one_recorded_rejection_zero_recorded_acceptances');
 UPDATE public.carousel_drafts SET qa=jsonb_set(coalesce(qa,'{}'::jsonb),'{autonomous_review}',r,true) WHERE id=p_draft;
 gate:=public.content_autonomy_gate_ivan(p_draft);
 RETURN jsonb_build_object('ok',true,'eligible',gate->'eligible','fails',gate->'fails','manifest_sha256',r->>'manifest_sha256');
END $function$
;
