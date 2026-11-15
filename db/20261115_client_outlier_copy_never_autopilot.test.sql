-- Test for 20261115_client_outlier_copy_never_autopilot.sql. Put that file's text in place of the placeholder line inside
-- EXECUTE below and run the whole thing as one statement. It always rolls back (it ends in RAISE EXCEPTION); the result is the JSON after ROLLBACK_RESULT.
-- It takes the newest real RISE outlier copy draft, puts it in the state the verifier leaves a good copy in (released, PASS,
-- five passing checks) with a must-carry result on it, and reads the same rows before and after the migration.
DO $t$
DECLARE cp uuid; res jsonb := '{}'::jsonb; wk date := date_trunc('week', now())::date + 7; t0 timestamptz := now();
  v_body text := 'A copied post for the test. Two short lines, no link.'; e0 jsonb; e1 jsonb; c1 jsonb; i0 text; i1 text; a0 text; a1 text; k text;
BEGIN
  SELECT d.id INTO cp FROM public.carousel_drafts d JOIN public.cb34_p2_members m ON m.draft_id = d.id
   WHERE d.client_id = 'risedtc' AND m.client_id = 'risedtc' AND d.qa ->> 'review_kind' = 'outlier_copy' ORDER BY d.created_at DESC LIMIT 1;
  IF cp IS NULL THEN RAISE EXCEPTION 'ROLLBACK_RESULT %', '{"skipped":"no RISE outlier copy draft to test on"}'; END IF;
  UPDATE public.carousel_drafts SET status = 'review', post_body = v_body, scheduled_at = NULL, published_at = NULL,
         qa = jsonb_set(jsonb_set(qa, '{verdict}', '"REVIEW"'), '{outlier_copy,ok}', 'true') WHERE id = cp;
  UPDATE public.cb34_p2_members SET state = 'released', validation = jsonb_build_object('verdict', 'PASS', 'outlier_copy', true,
         'input_body_sha256', encode(sha256(convert_to(v_body, 'UTF8')), 'hex'),
         'checks', jsonb_build_object('qa', '{"pass":true}'::jsonb, 'lint', '{"pass":true}'::jsonb, 'sameness', '{"pass":true}'::jsonb,
                   'invention', '{"pass":true}'::jsonb, 'length', '{"pass":true}'::jsonb, 'must_carry', '{"pass":true}'::jsonb)) WHERE draft_id = cp;
  e0 := public.content_brain_eligibility('risedtc', t0);
  i0 := md5(public.content_brain_eligibility('ivan', t0)::text); a0 := md5(public.content_brain_eligibility('arch', t0)::text);
  EXECUTE $mig$
__MIGRATION__
  $mig$;
  e1 := public.content_brain_eligibility('risedtc', t0); c1 := public.content_autopilot_candidates('risedtc', wk, t0);
  i1 := md5(public.content_brain_eligibility('ivan', t0)::text); a1 := md5(public.content_brain_eligibility('arch', t0)::text);
  res := res || jsonb_build_object(
    's01_copy_eligible_before', (SELECT x -> 'eligible' FROM jsonb_array_elements(e0) x WHERE x ->> 'draft_id' = cp::text),
    's02_copy_eligible_after', (SELECT x -> 'eligible' FROM jsonb_array_elements(e1) x WHERE x ->> 'draft_id' = cp::text),
    's02_copy_fails_after', (SELECT x -> 'fails' FROM jsonb_array_elements(e1) x WHERE x ->> 'draft_id' = cp::text),
    's03_copy_candidate_after', (SELECT x -> 'eligible' FROM jsonb_array_elements(c1) x WHERE x ->> 'draft_id' = cp::text),
    's04_other_rise_rows', (SELECT count(*) FROM jsonb_array_elements(e0) x WHERE x ->> 'draft_id' <> cp::text),
    's04_other_rise_rows_same', (SELECT coalesce(jsonb_agg(x ORDER BY x ->> 'draft_id'), '[]') FROM jsonb_array_elements(e0) x WHERE x ->> 'draft_id' <> cp::text)
                              = (SELECT coalesce(jsonb_agg(x ORDER BY x ->> 'draft_id'), '[]') FROM jsonb_array_elements(e1) x WHERE x ->> 'draft_id' <> cp::text),
    's04_other_rise_eligible_after', (SELECT count(*) FROM jsonb_array_elements(e1) x WHERE x ->> 'draft_id' <> cp::text AND x ->> 'eligible' = 'true'),
    's05_ivan_same', i0 = i1, 's05_arch_same', a0 = a1);
  -- each marker alone is enough: the draft's review kind, the pick's copy intent, the release stamp
  FOREACH k IN ARRAY ARRAY['review_kind', 'intent', 'stamp'] LOOP
    UPDATE public.carousel_drafts SET qa = CASE WHEN k = 'review_kind' THEN qa || '{"review_kind":"outlier_copy"}'::jsonb ELSE qa - 'review_kind' END WHERE id = cp;
    UPDATE public.cb34_p2_members SET
           brief = CASE WHEN k = 'intent' THEN jsonb_set(brief, '{pick_note,outlier_copy}', '"outlier-copy-v1"') ELSE brief #- '{pick_note,outlier_copy}' END,
           validation = CASE WHEN k = 'stamp' THEN validation || '{"outlier_copy":true}'::jsonb ELSE validation - 'outlier_copy' END WHERE draft_id = cp;
    res := res || jsonb_build_object('s06_only_' || k || '_eligible',
      (SELECT x -> 'eligible' FROM jsonb_array_elements(public.content_brain_eligibility('risedtc', t0, ARRAY[cp])) x));
  END LOOP;
  -- no marker at all: an ordinary released draft, a candidate again
  UPDATE public.carousel_drafts SET qa = qa - 'review_kind' WHERE id = cp;
  UPDATE public.cb34_p2_members SET brief = brief #- '{pick_note,outlier_copy}', validation = validation - 'outlier_copy' WHERE draft_id = cp;
  res := res || jsonb_build_object('s07_no_marker_eligible',
      (SELECT x -> 'eligible' FROM jsonb_array_elements(public.content_brain_eligibility('risedtc', t0, ARRAY[cp])) x));
  RAISE EXCEPTION 'ROLLBACK_RESULT %', res::text;
END $t$;
