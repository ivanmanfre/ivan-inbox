-- Rolled-back test of 20261116a_missed_autopilot_post_park.sql against the live queue. Always ends in an exception, so
-- nothing it does is kept: no row change, no cron job, and no alert (pg_net only sends queued requests that commit).
DO $t$
DECLARE res jsonb := '{}'::jsonb; before jsonb; after jsonb; r jsonb; msg text; hint text;
  q_stuck uuid := '64803ecd-3401-4587-942f-1f11298a681e'; d_stuck uuid := 'f92d9e05-52a4-475d-bddd-8057091966dd';
  q_gif20 uuid := 'ab3e40e3-7071-488a-9946-21277fde3532'; q_gif25 uuid := 'fd288cbc-8a5f-42a8-87fb-edd1ebccf50c';
  row_before jsonb; content_before text; content_after text; req0 bigint; req1 bigint;
BEGIN
  SELECT jsonb_object_agg(q.id, public.content_autonomy_publish_snapshot_ivan(q.id) - 'expected') INTO before
    FROM public.scheduled_posts q WHERE q.platform = 'linkedin' AND q.status = 'pending';
  SELECT to_jsonb(q) INTO row_before FROM public.scheduled_posts q WHERE id = q_stuck;
  SELECT md5(coalesce(post_body,'') || coalesce(qa::text,'') || coalesce(image_urls::text,'') || coalesce(pdf_url,'') || coalesce(video_url,'') || coalesce(type,''))
    INTO content_before FROM public.carousel_drafts WHERE id = d_stuck;
  SELECT coalesce(max(id), 0) INTO req0 FROM net.http_request_queue;
  res := res || jsonb_build_object('p00_stuck_before', jsonb_build_object('status', row_before->>'status', 'slot', row_before->>'scheduled_at',
    'state', before->(q_stuck::text)));

  EXECUTE $mig$
__MIGRATION__
  $mig$;

  -- 1. Grants and the public-key surface check (expected 92/0/0/2/0 unchanged).
  res := res || jsonb_build_object('p01_exec_privilege', (SELECT jsonb_object_agg(rl, has_function_privilege(rl, 'public.content_autonomy_park_missed_ivan(timestamptz)', 'EXECUTE'))
      FROM unnest(ARRAY['anon','authenticated','service_role']) rl),
    'p01_table_select', (SELECT jsonb_object_agg(rl, has_table_privilege(rl, 'public.content_missed_posts', 'SELECT')) FROM unnest(ARRAY['anon','authenticated','service_role']) rl),
    'p01_surface', (SELECT jsonb_agg(c.actual::text || '/' || c.expected::text || CASE WHEN c.ok THEN ' ok' ELSE ' OFF' END) FROM public.public_key_surface_check() c),
    'p01_cron', (SELECT jsonb_agg(schedule || ' ' || command) FROM cron.job WHERE jobname = 'content-missed-post-park'));

  -- 2. A sibling copy of the same draft being published right now: the stuck row is left alone this tick.
  BEGIN
    INSERT INTO public.scheduled_posts (clickup_task_id, post_text, scheduled_at, status, platform)
    VALUES (d_stuck::text, 'rolled-back test sibling', '2026-11-13 11:00+00', 'posting', 'linkedin');
    r := public.content_autonomy_park_missed_ivan();
    RAISE EXCEPTION 'undo' USING DETAIL = r::text;
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS msg = PG_EXCEPTION_DETAIL, hint = MESSAGE_TEXT;
    res := res || jsonb_build_object('p02_sibling_posting', coalesce(nullif(msg, ''), hint));
  END;

  -- 3. The real sweep, now.
  r := public.content_autonomy_park_missed_ivan();
  res := res || jsonb_build_object('p03_run_now', r);
  SELECT md5(coalesce(post_body,'') || coalesce(qa::text,'') || coalesce(image_urls::text,'') || coalesce(pdf_url,'') || coalesce(video_url,'') || coalesce(type,''))
    INTO content_after FROM public.carousel_drafts WHERE id = d_stuck;
  res := res || jsonb_build_object('p04_after',
    (SELECT jsonb_build_object('queue_status', q.status, 'queue_error', q.error_message, 'draft_status', d.status, 'draft_date', d.scheduled_at,
       'content_unchanged', content_before = content_after,
       'pick', (SELECT state FROM public.content_autopilot_picks WHERE draft_id = d.id),
       'owner_pull_mark', EXISTS (SELECT 1 FROM public.content_owner_pulls WHERE draft_id = d.id),
       'receipt', (SELECT to_jsonb(m) - 'notify' FROM public.content_missed_posts m WHERE m.queue_id = q.id))
     FROM public.scheduled_posts q JOIN public.carousel_drafts d ON d.id::text = q.clickup_task_id WHERE q.id = q_stuck));
  SELECT coalesce(max(id), 0) INTO req1 FROM net.http_request_queue;
  res := res || jsonb_build_object('p05_alerts_queued', (SELECT count(*) FROM net.http_request_queue WHERE id > req0),
    'p05_alert_payload', (SELECT jsonb_agg(convert_from(body, 'UTF8')::jsonb) FROM net.http_request_queue WHERE id > req0),
    'p05_alert_url_is_inbox_notify', (SELECT bool_and(url = (SELECT value FROM public.integration_config WHERE key = 'inbox_notify_url')) FROM net.http_request_queue WHERE id > req0));

  -- 4. What the publisher sees now: Get Due Posts' exact filter, and the claim on the old snapshot.
  res := res || jsonb_build_object('p06_get_due_posts', (SELECT coalesce(jsonb_agg(id), '[]'::jsonb) FROM (SELECT id FROM public.scheduled_posts
       WHERE status = 'pending' AND scheduled_at <= now() ORDER BY scheduled_at LIMIT 5) x),
    'p06_claim_old_snapshot', public.scheduled_post_claim_if_unchanged(q_stuck, row_before, 'rm-WNhwaS1m7VcZoYLRrJA'));

  -- 5. The fresh review path: the automatic reviewer's queue now admits the draft (status review, no date).
  res := res || jsonb_build_object('p07_review_due_has_it', (SELECT bool_or((x->>'draft_id')::uuid = d_stuck) FROM jsonb_array_elements(public.content_autonomy_review_due_ivan(5)) x),
    'p07_base', public.content_autonomy_base_ivan(d_stuck));

  -- 6. A second tick: nothing more, no second alert.
  r := public.content_autonomy_park_missed_ivan();
  res := res || jsonb_build_object('p08_second_tick', r, 'p08_new_alerts', (SELECT count(*) FROM net.http_request_queue WHERE id > req1));

  -- 7. Every other pending row is decided exactly as before.
  SELECT jsonb_object_agg(q.id, public.content_autonomy_publish_snapshot_ivan(q.id) - 'expected') INTO after
    FROM public.scheduled_posts q WHERE q.platform = 'linkedin' AND q.status = 'pending';
  res := res || jsonb_build_object('p09_others_unchanged', (before - q_stuck::text) = after, 'p09_pending_left', (SELECT count(*) FROM jsonb_object_keys(after)));

  -- 8. Time passes to 1 Dec: only the two loop-GIF posts (not eligible) are parked. The eligible autopilot posts (23, 24 Nov)
  --    and the five posts Ivan placed himself are never touched, even late.
  BEGIN
    SELECT coalesce(max(id), 0) INTO req1 FROM net.http_request_queue;
    r := public.content_autonomy_park_missed_ivan('2026-12-01 00:00+00');
    RAISE EXCEPTION 'undo' USING DETAIL = jsonb_build_object('run', r,
      'parked_ids', (SELECT jsonb_agg(x->>'queue_id') FROM jsonb_array_elements(r->'parked') x),
      'expected_ids', jsonb_build_array(q_gif20, q_gif25),
      'still_pending', (SELECT count(*) FROM public.scheduled_posts WHERE platform = 'linkedin' AND status = 'pending'),
      'gif_alert_bodies', (SELECT jsonb_agg(convert_from(body, 'UTF8')::jsonb->>'body') FROM net.http_request_queue WHERE id > req1))::text;
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS msg = PG_EXCEPTION_DETAIL, hint = MESSAGE_TEXT;
    res := res || jsonb_build_object('p10_future_1dec', coalesce(nullif(msg, ''), hint));
  END;

  -- 9. Rollback: job and function gone, receipts kept under a new name, the parked row stays parked.
  BEGIN
    EXECUTE $rbx$
__ROLLBACK__
    $rbx$;
    RAISE EXCEPTION 'undo' USING DETAIL = jsonb_build_object(
      'cron_left', (SELECT count(*) FROM cron.job WHERE jobname = 'content-missed-post-park'),
      'fn_left', (SELECT count(*) FROM pg_proc WHERE proname = 'content_autonomy_park_missed_ivan'),
      'receipts_kept_as', to_regclass('public.content_missed_posts_rolled_back_20261116')::text,
      'stuck_row_status', (SELECT status FROM public.scheduled_posts WHERE id = q_stuck))::text;
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS msg = PG_EXCEPTION_DETAIL, hint = MESSAGE_TEXT;
    res := res || jsonb_build_object('p11_rollback', coalesce(nullif(msg, ''), hint));
  END;

  RAISE EXCEPTION 'ROLLBACK_RESULT %', res::text;
END $t$;
