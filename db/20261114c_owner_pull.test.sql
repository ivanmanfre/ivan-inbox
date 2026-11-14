-- Rolled-back test of 20261114c_owner_pull.sql against the live queue. Needs the owner-keep migration applied. Always ends in an exception.
DO $t$
DECLARE qrow public.scheduled_posts%ROWTYPE; d_race uuid; res jsonb := '{}'::jsonb; before jsonb; after jsonb; r jsonb; x jsonb; msg text; hint text; sqlst text;
  OWNER text := '{"sub":"6fda2a13-441e-4a95-ac41-c392a48ea904","role":"authenticated"}';
  q_hand uuid := 'bb3acbc6-551d-4056-983d-a7f84e0b7b87'; d_hand uuid; s_hand timestamptz;   -- Tue 17 Nov, hand placed
  q_auto uuid := '38af6926-a044-4338-9c48-858495b11af7'; d_auto uuid; s_auto timestamptz;   -- Mon 23 Nov, autopilot
  q_cal uuid := '9019ac7a-972f-4f81-a12b-d4e35da06c14'; d_cal uuid; s_cal timestamptz;   -- Wed 18 Nov, hand placed (for Remove date)
BEGIN
  SELECT jsonb_object_agg(q.id, public.content_autonomy_publish_snapshot_ivan(q.id)) INTO before
    FROM public.scheduled_posts q WHERE q.platform = 'linkedin' AND q.status = 'pending';
  SELECT d.id, q.scheduled_at INTO d_hand, s_hand FROM public.scheduled_posts q JOIN public.carousel_drafts d ON d.id::text = q.clickup_task_id WHERE q.id = q_hand;
  SELECT d.id, q.scheduled_at INTO d_auto, s_auto FROM public.scheduled_posts q JOIN public.carousel_drafts d ON d.id::text = q.clickup_task_id WHERE q.id = q_auto;
  SELECT d.id, q.scheduled_at INTO d_cal, s_cal FROM public.scheduled_posts q JOIN public.carousel_drafts d ON d.id::text = q.clickup_task_id WHERE q.id = q_cal;
  res := res || jsonb_build_object('p00_before_fix_remove_date', (SELECT pg_get_functiondef(p.oid) !~ 'content_owner_pull_ivan' FROM pg_proc p WHERE p.proname = 'operator_set_schedule_date'));

  EXECUTE $mig$
__MIGRATION__
  $mig$;

  -- 1. No pull exists: every pending row decides as before, and every undated draft's base check is unchanged in kind.
  SELECT jsonb_object_agg(q.id, public.content_autonomy_publish_snapshot_ivan(q.id)) INTO after
    FROM public.scheduled_posts q WHERE q.platform = 'linkedin' AND q.status = 'pending';
  res := res || jsonb_build_object('p01_no_pull_same_as_before', before = after, 'p01_rows', (SELECT count(*) FROM jsonb_object_keys(before)));

  -- 2. Who may pull.
  BEGIN PERFORM public.content_next_pull(q_hand, s_hand); res := res || jsonb_build_object('p02_anon', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS sqlst = RETURNED_SQLSTATE; res := res || jsonb_build_object('p02_anon', sqlst); END;
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  BEGIN PERFORM public.content_next_pull(q_hand, s_hand); res := res || jsonb_build_object('p03_stranger', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS sqlst = RETURNED_SQLSTATE; res := res || jsonb_build_object('p03_stranger', sqlst); END;
  PERFORM set_config('request.jwt.claims', OWNER, true);
  BEGIN PERFORM public.content_next_pull(q_hand, s_hand + interval '1 hour'); res := res || jsonb_build_object('p04_wrong_slot', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT; res := res || jsonb_build_object('p04_wrong_slot', hint); END;
  BEGIN
    UPDATE public.scheduled_posts SET status = 'posting' WHERE id = q_hand;
    PERFORM public.content_owner_pull_ivan(d_hand, s_hand, 'test');
    RAISE EXCEPTION 'undo' USING DETAIL = 'ALLOWED';
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT, msg = PG_EXCEPTION_DETAIL; res := res || jsonb_build_object('p05_mid_publish', coalesce(nullif(msg, ''), hint)); END;

  -- 3. Pull of a post he placed himself.
  r := public.content_next_pull(q_hand, s_hand);
  PERFORM set_config('request.jwt.claims', '', true);
  res := res || jsonb_build_object('p10_pull_hand_placed', jsonb_build_object('result', r - 'id',
    'queue', (SELECT jsonb_build_object('status', status, 'note', left(error_message, 14)) FROM public.scheduled_posts WHERE id = q_hand),
    'draft', (SELECT jsonb_build_object('status', status, 'at', scheduled_at, 'hand_dated', taxonomy ? 'hand_dated_at') FROM public.carousel_drafts WHERE id = d_hand),
    'still_queued', (SELECT count(*) FROM public.scheduled_posts WHERE clickup_task_id = d_hand::text AND status IN ('pending', 'posting')),
    'base_fails', public.content_autonomy_base_ivan(d_hand) -> 'fails',
    'autopilot_would_take_it', (SELECT e -> 'eligible' FROM jsonb_array_elements(public.content_brain_eligibility('ivan', now(), ARRAY[d_hand])) e LIMIT 1),
    'pull_row', (SELECT jsonb_build_object('was_at', was_at, 'actor', actor ->> 'actor') FROM public.content_owner_pulls WHERE draft_id = d_hand)));
  PERFORM set_config('request.jwt.claims', OWNER, true);
  x := public.content_next_posts();
  res := res || jsonb_build_object('p11_gone_from_next_rows', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(x) e WHERE e ->> 'queue_id' = q_hand::text));
  BEGIN PERFORM public.content_next_pull(q_hand, s_hand); res := res || jsonb_build_object('p12_pull_twice', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT; res := res || jsonb_build_object('p12_pull_twice', hint); END;

  -- 3b. A queue row that comes back to pending after the pull (say, a late sync) is never claimed by the publisher.
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.scheduled_posts SET status = 'pending', scheduled_at = now() - interval '1 minute' WHERE id = q_hand;
  SELECT * INTO qrow FROM public.scheduled_posts WHERE id = q_hand;
  r := public.scheduled_post_claim_if_unchanged(q_hand, to_jsonb(qrow), 'rm-WNhwaS1m7VcZoYLRrJA');
  res := res || jsonb_build_object('p13_restored_row_claim', r - 'post');
  BEGIN
    DELETE FROM public.content_owner_pulls WHERE draft_id = d_hand;
    r := public.scheduled_post_claim_if_unchanged(q_hand, to_jsonb(qrow), 'rm-WNhwaS1m7VcZoYLRrJA');
    RAISE EXCEPTION 'undo' USING DETAIL = (r - 'post')::text;
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, hint = PG_EXCEPTION_DETAIL; res := res || jsonb_build_object('p13b_same_row_no_pull_mark_control', coalesce(nullif(hint, ''), msg)); END;
  BEGIN
    PERFORM set_config('request.jwt.claims', OWNER, true);
    PERFORM set_config('app.schedule_manual', 'on', true);
    UPDATE public.carousel_drafts SET status = 'scheduled', scheduled_at = qrow.scheduled_at WHERE id = d_hand;
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('app.schedule_manual', '', true);
    r := public.scheduled_post_claim_if_unchanged(q_hand, to_jsonb(qrow), 'rm-WNhwaS1m7VcZoYLRrJA');
    RAISE EXCEPTION 'undo' USING DETAIL = (r - 'post')::text;
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, hint = PG_EXCEPTION_DETAIL; res := res || jsonb_build_object('p13c_dated_again_by_him_at_that_time', coalesce(nullif(hint, ''), msg)); END;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('app.schedule_manual', '', true);
  UPDATE public.scheduled_posts SET status = 'cancelled', scheduled_at = s_hand WHERE id = q_hand;
  PERFORM set_config('request.jwt.claims', OWNER, true);

  -- 4. Pull of an autopilot post: its pick is released and it never publishes on the old receipt.
  r := public.content_next_pull(q_auto, s_auto);
  PERFORM set_config('request.jwt.claims', '', true);
  res := res || jsonb_build_object('p20_pull_autopilot', jsonb_build_object('result', r - 'id',
    'queue', (SELECT status FROM public.scheduled_posts WHERE id = q_auto),
    'draft', (SELECT jsonb_build_object('status', status, 'at', scheduled_at) FROM public.carousel_drafts WHERE id = d_auto),
    'pick', (SELECT state FROM public.content_autopilot_picks WHERE draft_id = d_auto),
    'gate', public.content_autonomy_gate_ivan(d_auto) -> 'fails',
    'autopilot_would_take_it', (SELECT e -> 'eligible' FROM jsonb_array_elements(public.content_brain_eligibility('ivan', now(), ARRAY[d_auto])) e LIMIT 1)));

  -- 5. He dates the pulled post again himself: the pull rule no longer applies to it (his own date is his call).
  BEGIN
    PERFORM set_config('request.jwt.claims', OWNER, true);
    PERFORM set_config('app.schedule_manual', 'on', true);
    UPDATE public.carousel_drafts SET status = 'scheduled', scheduled_at = s_hand WHERE id = d_hand;
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE EXCEPTION 'undo' USING DETAIL = jsonb_build_object('status', (SELECT status FROM public.carousel_drafts WHERE id = d_hand),
      'pulled_rule_applies', (public.content_autonomy_base_ivan(d_hand) -> 'fails') ? 'you pulled it from the schedule')::text;
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, hint = PG_EXCEPTION_DETAIL; res := res || jsonb_build_object('p30_dated_again_by_him', coalesce(nullif(hint, ''), msg)); END;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('app.schedule_manual', '', true);

  -- 6. Calendar > Remove date (the operator gate path) on a scheduled post of his. The gate hash is swapped for a
  --    test value inside this transaction only.
  UPDATE public.integration_config SET value = encode(extensions.digest('pull-test-gate', 'sha256'), 'hex') WHERE key = 'operator_panel_gate_hash';
  r := public.operator_set_schedule_date('pull-test-gate', d_cal, NULL);
  res := res || jsonb_build_object('p40_remove_date', jsonb_build_object('result', r - 'id',
    'queue', (SELECT status FROM public.scheduled_posts WHERE id = q_cal),
    'draft', (SELECT jsonb_build_object('status', status, 'at', scheduled_at) FROM public.carousel_drafts WHERE id = d_cal),
    'still_queued', (SELECT count(*) FROM public.scheduled_posts WHERE clickup_task_id = d_cal::text AND status IN ('pending', 'posting'))));
  -- a new date on a scheduled post still just moves it (unchanged behaviour), on the Thu 19 Nov post
  r := public.operator_set_schedule_date('pull-test-gate', (SELECT clickup_task_id::uuid FROM public.scheduled_posts WHERE id = '499704f0-87ff-4efc-86f0-c771c2f2f6ca'), '2026-12-02 10:00:00+00');
  res := res || jsonb_build_object('p41_new_date_still_moves', jsonb_build_object('ok', r -> 'ok', 'queue_retimed', r -> 'queue_retimed', 'pulled', r -> 'pulled',
    'queue', (SELECT jsonb_build_object('status', status, 'at', scheduled_at) FROM public.scheduled_posts WHERE id = '499704f0-87ff-4efc-86f0-c771c2f2f6ca')));
  -- a wrong gate is still refused
  res := res || jsonb_build_object('p42_bad_gate', public.operator_set_schedule_date('nope', d_cal, NULL));
  -- removing the date from an undated review draft is still the plain update (no pull)
  r := public.operator_set_schedule_date('pull-test-gate', (SELECT id FROM public.carousel_drafts WHERE client_id IS NULL AND status = 'review' AND scheduled_at IS NULL ORDER BY created_at DESC LIMIT 1), NULL);
  res := res || jsonb_build_object('p43_review_draft_null_date', jsonb_build_object('ok', r -> 'ok', 'pulled', r -> 'pulled', 'status', r -> 'status'));

  -- 6b. Remove date racing a Schedule: the draft is read as review, then scheduled by another session before the
  --     update. Simulated by a copy of the function that flips the draft right after its read. The fixed function
  --     changes nothing and says try again; the old one cleared the date and left the post scheduled.
  d_race := (SELECT id FROM public.carousel_drafts WHERE client_id IS NULL AND status = 'review' AND scheduled_at IS NULL ORDER BY created_at DESC LIMIT 1);
  EXECUTE $f$CREATE FUNCTION pg_temp.pull_test_flip(p uuid) RETURNS void LANGUAGE plpgsql AS $b$
    BEGIN PERFORM set_config('app.schedule_manual', 'on', true);
      UPDATE public.carousel_drafts SET status = 'scheduled', scheduled_at = '2026-11-24 10:00:00+00' WHERE id = p;
      PERFORM set_config('app.schedule_manual', '', true); END $b$$f$;
  EXECUTE replace(replace(pg_get_functiondef('public.operator_set_schedule_date(text,uuid,timestamptz)'::regprocedure),
    'public.operator_set_schedule_date(', 'pg_temp.op_race_new('), E'  if d.id is null then', E'  perform pg_temp.pull_test_flip(p_draft_id);\n  if d.id is null then');
  EXECUTE replace(replace($old$__OLD_SETDATE__$old$,
    'public.operator_set_schedule_date(', 'pg_temp.op_race_old('), E'  if d.id is null then', E'  perform pg_temp.pull_test_flip(p_draft_id);\n  if d.id is null then');
  BEGIN
    r := pg_temp.op_race_new('pull-test-gate', d_race, NULL);
    RAISE EXCEPTION 'undo' USING DETAIL = jsonb_build_object('result', r - 'id',
      'draft', (SELECT jsonb_build_object('status', status, 'at', scheduled_at) FROM public.carousel_drafts WHERE id = d_race))::text;
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, hint = PG_EXCEPTION_DETAIL; res := res || jsonb_build_object('p44_race_fixed', coalesce(nullif(hint, ''), msg)); END;
  BEGIN
    r := pg_temp.op_race_old('pull-test-gate', d_race, NULL);
    RAISE EXCEPTION 'undo' USING DETAIL = jsonb_build_object('result', r - 'id',
      'draft', (SELECT jsonb_build_object('status', status, 'at', scheduled_at) FROM public.carousel_drafts WHERE id = d_race))::text;
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, hint = PG_EXCEPTION_DETAIL; res := res || jsonb_build_object('p44b_race_before_fix', coalesce(nullif(hint, ''), msg)); END;

  -- 7. Every row that was not pulled or moved still decides as before.
  SELECT jsonb_object_agg(q.id, public.content_autonomy_publish_snapshot_ivan(q.id)) INTO after
    FROM public.scheduled_posts q WHERE q.platform = 'linkedin' AND q.status = 'pending' AND q.id <> '499704f0-87ff-4efc-86f0-c771c2f2f6ca';
  res := res || jsonb_build_object('p50_others_unchanged', (before - q_hand::text - q_auto::text - q_cal::text - '499704f0-87ff-4efc-86f0-c771c2f2f6ca') = after,
    'p50_rows_left', (SELECT count(*) FROM jsonb_object_keys(after)));

  -- 8. Rollback: refused while a pulled post is still off the schedule; once none is, it restores all three functions.
  BEGIN
    EXECUTE $rb$__ROLLBACK_INNER__$rb$;
    RAISE EXCEPTION 'undo' USING DETAIL = 'ROLLED BACK WITH PULLED POSTS OFF THE SCHEDULE';
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, hint = PG_EXCEPTION_DETAIL; res := res || jsonb_build_object('p60_rollback_refused', coalesce(nullif(hint, ''), msg)); END;
  -- Sol r2: a pulled post he dated again while it is still in Review, with its old queue row back to pending, also blocks it.
  BEGIN
    DELETE FROM public.content_owner_pulls WHERE draft_id <> d_hand;
    PERFORM set_config('app.schedule_manual', 'on', true);
    UPDATE public.carousel_drafts SET scheduled_at = '2026-11-26 10:00:00+00' WHERE id = d_hand;
    PERFORM set_config('app.schedule_manual', '', true);
    UPDATE public.scheduled_posts SET status = 'pending', scheduled_at = now() - interval '1 minute' WHERE id = q_hand;
    EXECUTE $rb$__ROLLBACK_INNER__$rb$;
    RAISE EXCEPTION 'undo' USING DETAIL = 'ROLLED BACK WITH A HELD QUEUED COPY OF A PULLED POST';
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, hint = PG_EXCEPTION_DETAIL; res := res || jsonb_build_object('p62_rollback_refused_dated_review_with_queue_row', coalesce(nullif(hint, ''), msg)); END;
  -- Sol r3: a pulled post left 'scheduled' with no date and its old queue row pending also blocks it (NULL-safe check).
  BEGIN
    DELETE FROM public.content_owner_pulls WHERE draft_id <> d_hand;
    PERFORM set_config('app.schedule_manual', 'on', true);
    UPDATE public.carousel_drafts SET status = 'scheduled', scheduled_at = NULL WHERE id = d_hand;
    PERFORM set_config('app.schedule_manual', '', true);
    UPDATE public.scheduled_posts SET status = 'pending', scheduled_at = now() - interval '1 minute' WHERE id = q_hand;
    RAISE NOTICE 'state %', (SELECT jsonb_build_object('status', status, 'at', scheduled_at) FROM public.carousel_drafts WHERE id = d_hand);
    EXECUTE $rb$__ROLLBACK_INNER__$rb$;
    RAISE EXCEPTION 'undo' USING DETAIL = 'ROLLED BACK WITH A SCHEDULED UNDATED PULLED POST QUEUED';
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, hint = PG_EXCEPTION_DETAIL;
    res := res || jsonb_build_object('p63_rollback_refused_scheduled_null_date', coalesce(nullif(hint, ''), msg)); END;
  BEGIN
    DELETE FROM public.content_owner_pulls;
    EXECUTE $rb$__ROLLBACK_INNER__$rb$;
    RAISE EXCEPTION 'undo' USING DETAIL = jsonb_build_object(
      'base', (SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.proname = 'content_autonomy_base_ivan') = '2a46b62634b01cabc17152a931ab8ad2',
      'setdate', (SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.proname = 'operator_set_schedule_date') = '564c7e8085b304b3b591f28b9f28fdf1',
      'claim', (SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.proname = 'scheduled_post_claim_if_unchanged') = '41f376ade312ff6dda04bbc596cd193e',
      'pull_fns_left', (SELECT count(*) FROM pg_proc p WHERE p.proname IN ('content_owner_pull_ivan', 'content_next_pull')),
      'marks_kept_as', (SELECT to_regclass('public.content_owner_pulls_rolled_back_20261114')::text))::text;
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, hint = PG_EXCEPTION_DETAIL; res := res || jsonb_build_object('p61_rollback_restores', coalesce(nullif(hint, ''), msg)); END;

  RAISE EXCEPTION 'ROLLBACK_RESULT %', res::text;
END $t$;
