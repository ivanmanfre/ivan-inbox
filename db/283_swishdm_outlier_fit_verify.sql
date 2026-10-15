-- Read-only functional checks; run after the bounded SwishDM backfill/recompute.
DO $verify$
DECLARE r jsonb; n integer; test_case jsonb; expected_error boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.client_registry WHERE client_id='swishdm' AND is_active
    AND platform->'measurement'->>'writer_enabled'='false') THEN RAISE EXCEPTION 'SwishDM writer must remain OFF'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cb22_fit_brief_v WHERE client_id='swishdm' AND weekly_policy->>'status'='planning_draft'
    AND brief LIKE 'PLANNING CONTEXT ONLY.%') THEN RAISE EXCEPTION 'planning approval hold changed'; END IF;
  SELECT count(*) INTO n FROM public.outlier_corpus_v WHERE client_id='swishdm';
  IF n=0 OR n<>(SELECT count(*) FROM public.outlier_supply_posts WHERE client_id='swishdm') THEN RAISE EXCEPTION 'scoped source bridge incomplete'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.outlier_current_study_v WHERE client_id='swishdm') THEN RAISE EXCEPTION 'v3 backfill missing'; END IF;
  IF EXISTS (SELECT 1 FROM public.outlier_post_scores s JOIN public.outlier_current_study_v c USING(client_id,study_id)
    WHERE s.client_id='swishdm' AND (s.trailing_n<9 OR s.trailing_n>60 OR s.baseline_last_published_at>=s.published_at)) THEN RAISE EXCEPTION 'baseline regression'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.outlier_studies_v4 WHERE client_id='swishdm' AND state='complete') THEN RAISE EXCEPTION 'v4 backfill missing'; END IF;
  r := public.cb22_inputs('clientops','swishdm');
  IF NOT coalesce((r->>'ok')::boolean,false) THEN RAISE EXCEPTION 'SwishDM Inputs rejected'; END IF;
  FOR test_case IN SELECT * FROM jsonb_array_elements('[
    {"mode":"pool","payload":{"clients":["invalid"]}},
    {"mode":"pool","payload":{"clients":["swishdm","invalid"]}},
    {"mode":"pool","payload":{"clients":[]}},
    {"mode":"pool","payload":{"clients":null}},
    {"mode":"judgments","payload":{"clients":["swishdm"],"judgments":[{"client":"ivan"}]}},
    {"mode":"checks","payload":{"clients":["swishdm"],"checks":[{"client":"ivan"}]}},
    {"mode":"judgments","payload":{"judgments":[{"client":"invalid"}]}},
    {"mode":"checks","payload":{"checks":[{"client":"invalid"}]}}
  ]'::jsonb) LOOP
    expected_error := false;
    BEGIN
      PERFORM public.cb22_promote('clientops',test_case->>'mode','283-negative-scope',test_case->'payload');
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM IN ('invalid client scope','row outside client scope') THEN expected_error := true; ELSE RAISE; END IF;
    END;
    IF NOT expected_error THEN RAISE EXCEPTION 'scope negative case accepted: %', test_case; END IF;
  END LOOP;
  -- Recognizes the new seat but refuses unaccepted sources before inserting any idea.
  expected_error := false;
  BEGIN
    PERFORM public.operator_outlier_use('clientops','swishdm','linkedin','0');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='not a current accepted idea of this client' THEN expected_error := true; ELSE RAISE; END IF;
  END;
  IF NOT expected_error THEN RAISE EXCEPTION 'Use accepted an unscreened source'; END IF;
  BEGIN
    PERFORM public.cb22_inputs('clientops','invalid');
    RAISE EXCEPTION 'invalid seat was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'unknown seat' THEN RAISE; END IF;
  END;
END
$verify$;
SELECT '283 scoped outlier/fit and writer-OFF assertions passed' AS result;
