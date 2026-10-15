-- Provider exception test uses synthetic answers only inside a rolled-back transaction.
BEGIN;
DO $verify$
DECLARE p jsonb; r jsonb; item jsonb; payload jsonb; lane text;
BEGIN
  p:=public.cb22_promote('clientops','pool',null,'{"clients":["swishdm"]}'::jsonb);
  item:=p->'pool'->'swishdm'->0;
  IF item IS NULL THEN
    -- A completed real backfill can leave no unjudged fit requests; the original source remains a valid candidate.
    SELECT jsonb_build_object('platform','linkedin','post_id',s.post_ref) INTO item
    FROM public.outlier_post_scores s JOIN public.outlier_current_study_v c USING(client_id,study_id)
    WHERE s.client_id='swishdm' AND s.is_outlier_3x AND s.published_at>=now()-interval '21 days'
    ORDER BY s.ratio DESC LIMIT 1;
  END IF;
  IF item IS NULL THEN RAISE EXCEPTION 'No real scoped candidate for provider test'; END IF;
  -- Reset only this one fixture cache row inside the transaction; ROLLBACK restores any genuine cached result.
  DELETE FROM public.cb30_post_checks WHERE client_id='swishdm' AND platform=item->>'platform' AND post_id=item->>'post_id';
  payload:=jsonb_build_object('clients',jsonb_build_array('swishdm'),'checks',jsonb_build_array(jsonb_build_object(
    'client','swishdm','platform',item->>'platform','post_id',item->>'post_id','engagement','idea','topic','direct','audience','reader',
    'reason','Rolled-back provider guard fixture; never retained as a real judgment.','served_model','gpt-6.1-sol-fake','prompt_sha256',repeat('0',64))));
  r:=public.cb22_promote('clientops','checks','285-provider-guard-fixture',payload);
  IF r->>'refused'<>'1' OR r->>'inserted'<>'0' THEN RAISE EXCEPTION 'Unsupported model was accepted'; END IF;
  payload:=jsonb_set(payload,'{checks,0,served_model}','null'::jsonb);
  r:=public.cb22_promote('clientops','checks','285-provider-guard-fixture',payload);
  IF r->>'refused'<>'1' OR r->>'inserted'<>'0' THEN RAISE EXCEPTION 'Missing model was accepted'; END IF;
  payload:=jsonb_set(payload,'{checks,0,served_model}','"gpt-6.1-sol"'::jsonb);
  r:=public.cb22_promote('clientops','checks','285-provider-guard-fixture',payload);
  IF r->>'refused'<>'0' OR r->>'inserted'<>'1' THEN RAISE EXCEPTION 'Explicit authorized model rejected'; END IF;
  FOREACH lane IN ARRAY ARRAY['ivan','risedtc','arch'] LOOP
    SELECT x INTO item FROM jsonb_array_elements(public.operator_outliers('clientops',lane,'all',null)->'rows') x
      WHERE (x->>'published_at')::timestamptz>=now()-interval '21 days' LIMIT 1;
    IF item IS NULL THEN RAISE EXCEPTION 'No current candidate for other-lane provider test: %', lane; END IF;
    payload:=jsonb_build_object('clients',jsonb_build_array(lane),'checks',jsonb_build_array(jsonb_build_object(
      'client',lane,'platform',item->>'platform','post_id',item->>'post_id','engagement','idea','topic','direct','audience','reader',
      'reason','Rolled-back forbidden-provider fixture.','served_model','gpt-6.1-sol','prompt_sha256',repeat('0',64))));
    r:=public.cb22_promote('clientops','checks','285-provider-guard-fixture',payload);
    IF r->>'refused'<>'1' OR r->>'inserted'<>'0' THEN RAISE EXCEPTION 'Other lane accepted SwishDM provider exception: %', lane; END IF;
  END LOOP;
  IF position($expected$or coalesce(v_j ->> 'served_model', '') not like '%opus%'$expected$ in pg_get_functiondef('public.cb22_promote(text,text,text,jsonb)'::regprocedure))=0 THEN RAISE EXCEPTION 'Seller provider guard changed'; END IF;
END
$verify$;
ROLLBACK;
SELECT '285 exact GPT model accepted for SwishDM only; unsupported alias refused; seller guard retained; synthetic answers rolled back' result;
