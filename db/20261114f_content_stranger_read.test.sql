DO $t$
DECLARE brain_c uuid; nb int; elig0 int; elig_brain int; elig1 int; ap jsonb; res jsonb := '{}'::jsonb; c0 jsonb; c1 jsonb; a0 jsonb; a1 jsonb; geo uuid; geo_sha text; s text; n int; brain_in_card int;
BEGIN
  SELECT jsonb_agg(to_jsonb(x) ORDER BY x.draft_id) INTO c0 FROM public.content_card_candidates(now()) x;
  a0 := (SELECT jsonb_agg(jsonb_build_object('d', e->'draft_id', 'f', e->'fails') ORDER BY e->>'draft_id') FROM jsonb_array_elements(public.content_autopilot_candidates('ivan', date_trunc('week', now())::date + 7, now())) e);
  EXECUTE $mig$
__MIGRATION__
  $mig$;
  -- 1. Nothing read yet and no heartbeat: both readers answer exactly as before.
  SELECT jsonb_agg(to_jsonb(x) ORDER BY x.draft_id) INTO c1 FROM public.content_card_candidates(now()) x;
  a1 := (SELECT jsonb_agg(jsonb_build_object('d', e->'draft_id', 'f', e->'fails') ORDER BY e->>'draft_id') FROM jsonb_array_elements(public.content_autopilot_candidates('ivan', date_trunc('week', now())::date + 7, now())) e);
  res := res || jsonb_build_object('s01_card_same', c0 IS NOT DISTINCT FROM c1, 's01_card_rows', jsonb_array_length(coalesce(c0, '[]')),
                                   's01_autopilot_same', a0 IS NOT DISTINCT FROM a1, 's01_autopilot_rows', jsonb_array_length(coalesce(a0, '[]')));
  SELECT count(*) INTO n FROM public.content_stranger_due(100);
  res := res || jsonb_build_object('s02_due_now', n,
    's02_due_all_brain', NOT EXISTS (SELECT 1 FROM public.content_stranger_due(100) x WHERE NOT EXISTS (SELECT 1 FROM public.cb34_p2_members m WHERE m.draft_id = x.draft_id AND m.client_id = 'ivan')),
    's02_prompt_row', (SELECT jsonb_build_object('v', version, 'active', is_active, 'has_body', position('{{BODY}}' in body) > 0) FROM public.content_prompts WHERE slug = 'ivan-stranger-read'),
    's02_cron', (SELECT schedule FROM cron.job WHERE jobname = 'content-stranger-read'));
  SELECT id, public.content_card_sha(post_body) INTO geo, geo_sha FROM public.carousel_drafts WHERE id::text LIKE '848607fe%';
  res := res || jsonb_build_object('s03_geo_in_scope', public.content_stranger_scope(geo),
    's03_poland_out', NOT EXISTS (SELECT 1 FROM public.carousel_drafts d WHERE d.client_id IS NULL AND public.content_card_poland(d.id) AND public.content_stranger_scope(d.id)),
    's03_hand_lm_out', (SELECT public.content_stranger_scope(id) FROM public.carousel_drafts WHERE id::text LIKE 'e3fe15e6%'));
  -- 1b. The tick does not count "nothing due" as health while a text waits out a failed try.
  INSERT INTO public.content_stranger_reads (draft_id, body_sha256, attempts, last_error, attempted_at)
    SELECT x.draft_id, x.body_sha256, 1, 'timeout', now() FROM public.content_stranger_due(100) x;
  res := res || jsonb_build_object('s05_due_in_backoff', (SELECT count(*) FROM public.content_stranger_due(100)));
  res := res || jsonb_build_object('s05_tick', public.content_stranger_tick());
  res := res || jsonb_build_object('s05_beat_after', (SELECT beat_at FROM public.content_stranger_state));
  DELETE FROM public.content_stranger_reads;
  -- 2. The judge is alive: an unread brain draft is held, with the plain reason.
  INSERT INTO public.content_stranger_state (id, beat_at) VALUES (true, now()) ON CONFLICT (id) DO UPDATE SET beat_at = now();
  res := res || jsonb_build_object('s10_unread_alive', public.content_stranger_block(geo));
  -- 3. Saving: a wrong hash, a try without a verdict, a fail, a later pass never replaces a stored verdict.
  res := res || jsonb_build_object('s20_wrong_sha', public.content_stranger_save(geo, 'x', 'fail', 'r', null, 'm', 1, null));
  res := res || jsonb_build_object('s21_retry', public.content_stranger_save(geo, geo_sha, null, null, null, 'm', 1, 'timeout'));
  res := res || jsonb_build_object('s21_attempts', (SELECT attempts FROM public.content_stranger_reads WHERE draft_id = geo AND body_sha256 = geo_sha),
    's21_block', public.content_stranger_block(geo));
  res := res || jsonb_build_object('s22_fail', public.content_stranger_save(geo, geo_sha, 'fail', 'The stranger never sees the DM.', '{"reads":[]}', 'm', 1, null));
  res := res || jsonb_build_object('s22_block', public.content_stranger_block(geo));
  res := res || jsonb_build_object('s23_pass_after_fail', public.content_stranger_save(geo, geo_sha, 'pass', 'x', null, 'm', 1, null));
  res := res || jsonb_build_object('s23_still', (SELECT verdict FROM public.content_stranger_reads WHERE draft_id = geo AND body_sha256 = geo_sha));
  -- 4. The readers: the failed draft leaves the pick and gains a fail on the autopilot side.
  res := res || jsonb_build_object('s30_card_has_geo', EXISTS (SELECT 1 FROM public.content_card_candidates(now()) x WHERE x.draft_id = geo),
    's30_card_had_geo_before', c0 @> jsonb_build_array(jsonb_build_object('draft_id', geo)),
    's31_autopilot_geo_fails', (SELECT e->'fails' FROM jsonb_array_elements(public.content_autopilot_candidates('ivan', date_trunc('week', now())::date + 7, now())) e WHERE e->>'draft_id' = geo::text));
  -- 4b. A brain draft that IS in today's pick list leaves it while the judge is alive and it is unread, and comes back
  --     when every other candidate is gone (the cold read never empties the pick).
  SELECT x->>'draft_id' INTO brain_c FROM jsonb_array_elements(c0) x
   WHERE x->>'draft_id' <> geo::text AND EXISTS (SELECT 1 FROM public.cb34_p2_members m WHERE m.draft_id::text = x->>'draft_id' AND m.client_id = 'ivan') LIMIT 1;
  res := res || jsonb_build_object('s32_brain_in_pick_before', brain_c IS NOT NULL,
    's32_brain_in_pick_now', EXISTS (SELECT 1 FROM public.content_card_candidates(now()) x WHERE x.draft_id = brain_c));
  BEGIN
    UPDATE public.carousel_drafts d SET status = 'approved'
     WHERE d.id IN (SELECT x.draft_id FROM public.content_card_candidates(now()) x)
       AND NOT EXISTS (SELECT 1 FROM public.cb34_p2_members m WHERE m.draft_id = d.id AND m.client_id = 'ivan');
    SELECT count(*) INTO nb FROM public.content_card_candidates(now());
    RAISE EXCEPTION 'undo' USING DETAIL = jsonb_build_object('rows_when_only_held_brain_left', nb,
      'brain_back', EXISTS (SELECT 1 FROM public.content_card_candidates(now()) x WHERE x.draft_id = brain_c))::text;
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS s = PG_EXCEPTION_DETAIL; res := res || jsonb_build_object('s33_pick_fallback', s); END;
  -- 4c. Autopilot: the same, on the drafts that could go out.
  ap := public.content_autopilot_candidates('ivan', date_trunc('week', now())::date, now());
  SELECT count(*) FILTER (WHERE (e->>'eligible')::boolean),
         count(*) FILTER (WHERE (e->>'eligible')::boolean AND EXISTS (SELECT 1 FROM public.cb34_p2_members m WHERE m.draft_id::text = e->>'draft_id' AND m.client_id = 'ivan'))
    INTO elig1, elig_brain FROM jsonb_array_elements(ap) e;
  elig0 := (SELECT count(*) FROM jsonb_array_elements(public.content_autopilot_candidates('ivan', date_trunc('week', now())::date, now() - interval '0 s')) e WHERE (e->>'eligible')::boolean AND e->'fails' = '[]'::jsonb);
  res := res || jsonb_build_object('s34_autopilot_eligible_before', elig0, 's34_eligible_now', elig1, 's34_eligible_brain_now', elig_brain,
    's34_eligible_ids', (SELECT jsonb_agg(jsonb_build_object('d', left(e->>'draft_id', 8), 'brain', EXISTS (SELECT 1 FROM public.cb34_p2_members m WHERE m.draft_id::text = e->>'draft_id' AND m.client_id = 'ivan'), 'warn', e->'warnings'->-1)) FROM jsonb_array_elements(ap) e WHERE (e->>'eligible')::boolean),
    's34_held_reason', (SELECT e->'fails'->-1 FROM jsonb_array_elements(ap) e WHERE e->'fails' @> to_jsonb('the cold read has not run on this text yet'::text) LIMIT 1));
  BEGIN
    UPDATE public.carousel_drafts d SET status = 'rejected'
     WHERE d.id::text IN (SELECT e->>'draft_id' FROM jsonb_array_elements(ap) e WHERE (e->>'eligible')::boolean)
       AND NOT EXISTS (SELECT 1 FROM public.cb34_p2_members m WHERE m.draft_id = d.id AND m.client_id = 'ivan');
    ap := public.content_autopilot_candidates('ivan', date_trunc('week', now())::date, now());
    RAISE EXCEPTION 'undo' USING DETAIL = jsonb_build_object(
      'eligible_when_only_held_brain_left', (SELECT count(*) FROM jsonb_array_elements(ap) e WHERE (e->>'eligible')::boolean),
      'warning', (SELECT e->'warnings'->-1 FROM jsonb_array_elements(ap) e WHERE (e->>'eligible')::boolean LIMIT 1))::text;
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS s = PG_EXCEPTION_DETAIL; res := res || jsonb_build_object('s35_autopilot_fallback', s); END;
  -- 5. Kill switch, and a dead judge.
  INSERT INTO public.integration_config (key, value) VALUES ('content_stranger_gate', 'off') ON CONFLICT (key) DO UPDATE SET value = 'off';
  res := res || jsonb_build_object('s40_gate_off', public.content_stranger_block(geo));
  res := res || jsonb_build_object('s40_tick_off', public.content_stranger_tick());
  UPDATE public.integration_config SET value = 'on' WHERE key = 'content_stranger_gate';
  UPDATE public.content_stranger_reads SET verdict = NULL, reason = NULL, judged_at = NULL WHERE draft_id = geo;
  UPDATE public.content_stranger_state SET beat_at = now() - interval '4 hours';
  res := res || jsonb_build_object('s41_dead_judge_unread', public.content_stranger_block(geo));
  -- 6. Privileges.
  BEGIN SET LOCAL ROLE authenticated; PERFORM public.content_stranger_block(geo); RESET ROLE; res := res || jsonb_build_object('s50_auth_block', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS s = RETURNED_SQLSTATE; res := res || jsonb_build_object('s50_auth_block', s); END;
  RESET ROLE;
  BEGIN SET LOCAL ROLE anon; PERFORM 1 FROM public.content_stranger_reads; RESET ROLE; res := res || jsonb_build_object('s51_anon_table', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS s = RETURNED_SQLSTATE; res := res || jsonb_build_object('s51_anon_table', s); END;
  RESET ROLE;
  RAISE EXCEPTION 'ROLLBACK_RESULT %', res::text;
END $t$;
