-- db/275: the SwishDM seat in Content > Review asks for early reads like every other seat, and
-- cb33_draft_reads answered 400 'unknown seat' (a console error on every Review paint, and the
-- draft's chip read "Early read unavailable"). There is no early-read pipeline for SwishDM: the
-- labeller (cb33_label_* via cb33_assert_client) stays ivan/risedtc/arch only, and this file
-- does not touch cb33_assert_client, so nothing new is labelled, queued or sent.
--
-- The read now answers for 'swishdm' with the same gate and lane checks, one plain no_read_yet
-- row per SwishDM draft and the reason in words. ivan/risedtc/arch run the unchanged query.
-- Rollback: db/275_swishdm_early_reads_seat_rollback.sql (the exact live definition before this).
CREATE OR REPLACE FUNCTION public.cb33_draft_reads(p_gate text, p_client text, p_draft_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '20s'
AS $function$
DECLARE rows_j jsonb;
BEGIN
 IF p_client = 'swishdm' THEN
  IF NOT public.operator_gate_ok(p_gate) OR NOT public.lane_allowed(p_client) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF coalesce(cardinality(p_draft_ids),0)>250 THEN RAISE EXCEPTION 'too many draft IDs'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('draft_id',d.id,'client_id',p_client,'body_hash',public.cb33_body_hash(d.post_body),'state','no_read_yet',
   'reason','Early reads are not running for SwishDM yet.','labels',NULL,'pattern',NULL,'sentence',NULL,'small_sample',false,'holdout',NULL,
   'recipe_fit',NULL,'labelled_at',NULL,'computed_at',NULL) ORDER BY d.id),'[]'::jsonb)
  INTO rows_j FROM public.carousel_drafts d
  WHERE d.id=ANY(coalesce(p_draft_ids,'{}'::uuid[])) AND d.client_id='swishdm';
  RETURN jsonb_build_object('ok',true,'client',p_client,'reads',rows_j);
 END IF;
 PERFORM public.cb33_assert_client(p_client);
 IF NOT public.operator_gate_ok(p_gate) OR NOT public.lane_allowed(p_client) THEN RAISE EXCEPTION 'unauthorized'; END IF;
 IF coalesce(cardinality(p_draft_ids),0)>250 THEN RAISE EXCEPTION 'too many draft IDs'; END IF;
 SELECT coalesce(jsonb_agg(CASE WHEN e.labels IS NOT NULL THEN
 public.cb33_render_read(p_client,d.id,public.cb33_body_hash(d.post_body),e.labels,d.post_body,d.type,
 coalesce(cardinality(d.image_urls),0),'draft',e.labelled_at)
 ELSE jsonb_build_object('draft_id',d.id,'client_id',p_client,'body_hash',public.cb33_body_hash(d.post_body),'state','no_read_yet',
 'reason',CASE WHEN nullif(btrim(coalesce(d.post_body,'')),'') IS NULL THEN 'empty_body' ELSE coalesce(e.reason,CASE WHEN EXISTS(SELECT 1 FROM public.cb33_label_queue q WHERE q.client_id=p_client AND q.draft_id=d.id AND q.body_hash=public.cb33_body_hash(d.post_body) AND q.status IN ('queued','claimed')) THEN 'pending_label' WHEN EXISTS(SELECT 1 FROM public.cb33_label_queue q WHERE q.client_id=p_client AND q.draft_id=d.id AND q.body_hash=public.cb33_body_hash(d.post_body) AND q.status='failed') THEN 'label_failed' WHEN d.created_at<now()-interval '14 days' AND d.scheduled_at IS NULL THEN 'older_than_14_days_not_scheduled' ELSE 'waiting_for_discovery' END) END,
 'labels',NULL,'pattern',NULL,'sentence',NULL,'small_sample',p_client='arch','holdout',(SELECT payload FROM public.cb33_holdout_checks WHERE client_id=p_client),'recipe_fit',NULL,'labelled_at',NULL,'computed_at',e.computed_at) END ORDER BY d.id),'[]'::jsonb)
 INTO rows_j FROM public.carousel_drafts d LEFT JOIN public.cb33_early_reads e ON e.client_id=p_client AND e.draft_id=d.id AND e.body_hash=public.cb33_body_hash(d.post_body)
 WHERE d.id=ANY(coalesce(p_draft_ids,'{}'::uuid[])) AND coalesce(d.client_id,'ivan')=p_client AND(d.client_id IS NULL OR d.client_id IN ('ivan','risedtc','arch'));
 RETURN jsonb_build_object('ok',true,'client',p_client,'reads',rows_j);
END $function$
;
