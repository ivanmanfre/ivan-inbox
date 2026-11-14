DO $t$
DECLARE res jsonb := '{}'::jsonb; r jsonb; idea uuid; n0 int; n1 int; sqlst text;
  OWNER text := '{"sub":"6fda2a13-441e-4a95-ac41-c392a48ea904","role":"authenticated"}';
BEGIN
  SELECT count(*) INTO n0 FROM public.lm_idea_candidates WHERE public.content_idea_waits(needs_ivan_data, needs_ivan_answer);
  SELECT id INTO idea FROM public.lm_idea_candidates WHERE needs_ivan_data AND status IN ('pending','scored','reviewing') ORDER BY created_at DESC LIMIT 1;
  EXECUTE $mig$
__MIGRATION__
  $mig$;
  SELECT count(*) INTO n1 FROM public.lm_idea_candidates WHERE public.content_idea_waits(needs_ivan_data, needs_ivan_answer);
  res := res || jsonb_build_object('w01_waiting_before_after', jsonb_build_array(n0, n1));
  res := res || jsonb_build_object('w02_rule', jsonb_build_object(
    'text', public.content_idea_waits(true, 'yes, 3 of 5 took it'), 'newline_tab', public.content_idea_waits(true, E'\n\t  \r'),
    'null', public.content_idea_waits(true, null), 'not_flagged', public.content_idea_waits(false, null),
    'nbsp_only', public.content_idea_waits(true, chr(160))));
  BEGIN SET LOCAL ROLE anon; PERFORM public.content_idea_answer_ivan(idea, 'x'); RESET ROLE; res := res || jsonb_build_object('w03_anon', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS sqlst = RETURNED_SQLSTATE; res := res || jsonb_build_object('w03_anon', sqlst); END;
  RESET ROLE;
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
    SET LOCAL ROLE authenticated; PERFORM public.content_idea_answer_ivan(idea, 'x'); RESET ROLE; res := res || jsonb_build_object('w03b_stranger', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS sqlst = RETURNED_SQLSTATE; res := res || jsonb_build_object('w03b_stranger', sqlst); END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claims', OWNER, true);
  SET LOCAL ROLE authenticated;
  res := res || jsonb_build_object('w04_blank_answer', public.content_idea_answer_ivan(idea, E'\n\t '));
  RESET ROLE; UPDATE public.lm_idea_candidates SET needs_ivan_answer = E'\n' WHERE id = idea; SET LOCAL ROLE authenticated;
  r := public.content_idea_answer_ivan(idea, E'  Yes: 2 of the 4 who saw it booked.\n');
  res := res || jsonb_build_object('w05_real_answer_after_stored_blank', r,
    'w05_stored', (SELECT jsonb_build_object('answer', needs_ivan_answer, 'waits', public.content_idea_waits(needs_ivan_data, needs_ivan_answer),
       'evidence_last', evidence -> -1 ->> 'source') FROM public.lm_idea_candidates WHERE id = idea));
  res := res || jsonb_build_object('w06_second_answer', public.content_idea_answer_ivan(idea, 'again'));
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE EXCEPTION 'ROLLBACK_RESULT %', res::text;
END $t$;
