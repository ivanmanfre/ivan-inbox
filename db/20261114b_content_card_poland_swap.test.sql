-- Rolled-back test of the Poland swap against the live queue. Needs db/20261114_owner_keep.sql applied. Always ends in an exception.
DO $t$
DECLARE res jsonb := '{}'::jsonb; plan jsonb; r jsonb; s jsonb; before jsonb; after jsonb;
  OWNER text := '{"sub":"6fda2a13-441e-4a95-ac41-c392a48ea904","role":"authenticated"}';
  today date := (now() AT TIME ZONE 'Europe/Warsaw')::date;
  pl uuid; pl_sha text; inc uuid; inc_slot timestamptz; inc_q uuid; msg text; hint text; sqlst text;
  now1 timestamptz := '2026-11-16 09:05:00+00';   -- Mon 16 Nov 10:05 Warsaw: only hand-placed business posts are movable that week
  now2 timestamptz := '2026-11-23 06:00:00+00';   -- Mon 23 Nov 07:00 Warsaw: two autopilot posts are movable that week
  to1 timestamptz := '2026-12-01 09:45:00+00';    -- Tue 1 Dec 10:45 Warsaw, the first free weekday after the calendar's tail
BEGIN
  EXECUTE $swap$
-- 2026-11-14: a Poland draft approved from the daily card takes a slot THIS week when the week is short on Poland,
-- and the business post that held the slot moves back to the slot the Poland draft would have got.
--
-- Why. Ivan's calendar is full about two and a half weeks ahead, so the card's Post lands weeks out and the week
-- stays without its Poland posts. He agreed (2026-11-13): the Poland draft takes a slot this week and pushes a
-- business post back; business posts stay on autopilot.

-- Is this draft a Poland-lane draft (the card's own definition, content_card_candidates.poland_lane)?
CREATE OR REPLACE FUNCTION public.content_card_poland_lane(p_draft uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT coalesce(public.content_card_poland(d.id), false)
      OR (jsonb_typeof(d.source_detail) = 'object' AND public.content_card_jstrim(coalesce(d.source_detail ->> 'kind', '')) = 'x_tracked_outlier')
      OR public.content_card_jstrim(coalesce(public.content_card_tax(d.taxonomy) ->> 'source', '')) = 'x_tracked_outlier'
    FROM public.carousel_drafts d WHERE d.id = p_draft
$function$;

-- The scheduled business posts of this Warsaw week that can give up their slot. Never a Poland post, a lead magnet,
-- a boosted post, a post within 3 hours, a post that is not going out as it stands, or one Ivan kept by hand.
CREATE OR REPLACE FUNCTION public.content_card_swap_incumbents(p_now timestamptz DEFAULT now())
 RETURNS TABLE(draft_id uuid, slot_at timestamptz, queue_id uuid, autopilot boolean, title text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH w AS (
    SELECT ((p_now AT TIME ZONE 'Europe/Warsaw')::date - (extract(isodow FROM (p_now AT TIME ZONE 'Europe/Warsaw')::date)::int - 1)) AS d0
  )
  SELECT d.id, d.scheduled_at, q.id,
         EXISTS (SELECT 1 FROM public.content_autopilot_picks ap WHERE ap.draft_id = d.id AND ap.account = 'ivan' AND ap.state = 'armed' AND ap.slot_at = d.scheduled_at),
         coalesce(nullif(btrim(d.title), ''), left(btrim(d.post_body), 70))
    FROM public.carousel_drafts d
    CROSS JOIN w
    JOIN public.scheduled_posts q ON q.clickup_task_id = d.id::text AND q.platform = 'linkedin' AND q.status = 'pending'
         AND coalesce(q.is_repost, false) = false AND q.scheduled_at = d.scheduled_at
   WHERE d.client_id IS NULL AND d.status = 'scheduled' AND d.published_at IS NULL
     AND d.scheduled_at >= p_now + interval '3 hours'
     AND d.scheduled_at < ((w.d0 + 7)::timestamp AT TIME ZONE 'Europe/Warsaw')
     AND d.type IN ('text', 'single_image', 'image')
     AND coalesce(d.taxonomy ->> 'lead_magnet', '') = '' AND coalesce(d.taxonomy ->> 'paid_boost', '') <> 'true'
     AND coalesce(d.taxonomy ->> 'deleted_by_operator', '') <> 'true'
     AND NOT coalesce(public.content_card_poland_lane(d.id), false)
     AND (SELECT count(*) FROM public.scheduled_posts x WHERE x.clickup_task_id = d.id::text AND x.status IS DISTINCT FROM 'cancelled') = 1
     AND NOT EXISTS (SELECT 1 FROM public.content_owner_keeps k WHERE k.draft_id = d.id AND k.revoked_at IS NULL)
     AND coalesce((public.content_autonomy_publish_state_ivan(q.id) ->> 'eligible')::boolean, false)
$function$;

-- What Post on today's card would do: null = the usual next free slot; else the slot it takes and the post it moves.
CREATE OR REPLACE FUNCTION public.content_card_swap_plan_at(p_now timestamptz) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE c public.content_daily_cards%ROWTYPE; d public.carousel_drafts%ROWTYPE; r record;
BEGIN
  SELECT * INTO c FROM public.content_daily_cards WHERE day = (now() AT TIME ZONE 'Europe/Warsaw')::date;
  IF NOT FOUND OR c.state <> 'shown' THEN RETURN NULL; END IF;
  SELECT * INTO d FROM public.carousel_drafts WHERE id = c.draft_id AND client_id IS NULL;
  IF NOT FOUND OR d.status <> 'review' OR d.scheduled_at IS NOT NULL OR d.published_at IS NOT NULL THEN RETURN NULL; END IF;
  IF NOT coalesce(public.content_card_poland_lane(d.id), false) OR public.content_card_week_poland(p_now) >= 2 THEN RETURN NULL; END IF;
  -- An autopilot post moves before one Ivan dated by hand; among equals the latest of the week moves.
  SELECT * INTO r FROM public.content_card_swap_incumbents(p_now) x ORDER BY x.autopilot DESC, x.slot_at DESC, x.draft_id LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('day', c.day, 'draft_id', c.draft_id, 'incumbent', r.draft_id, 'slot_at', r.slot_at,
    'autopilot', r.autopilot, 'title', r.title);
END $function$;

CREATE OR REPLACE FUNCTION public.content_card_swap_plan() RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.content_owner_ok_ivan() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  RETURN public.content_card_swap_plan_at(now());
END $function$;

-- Post with the swap, one transaction: the business post moves to p_incumbent_to (queue row and autopilot pick with
-- it), then the existing content_card_post approves the Poland draft and dates it on the vacated slot. Any refusal
-- anywhere undoes all of it.
CREATE OR REPLACE FUNCTION public.content_card_post_swap_at(p_now timestamptz, p_day date, p_draft uuid, p_body_sha text,
    p_incumbent uuid, p_incumbent_slot timestamptz, p_incumbent_to timestamptz, p_ms_to_verdict integer)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '3s' SET statement_timeout TO '25s'
AS $function$
DECLARE plan jsonb; inc record; v_queue uuid; v_kind text; v_to timestamptz; v_status text; v_n int; r jsonb;
  old_kind text := current_setting('content_plan.placement_kind', true);
BEGIN
  IF NOT public.content_owner_ok_ivan() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  IF p_day IS NULL OR p_draft IS NULL OR p_body_sha IS NULL OR p_incumbent IS NULL OR p_incumbent_slot IS NULL OR p_incumbent_to IS NULL THEN
    RAISE EXCEPTION 'bad request' USING ERRCODE = '22023'; END IF;
  IF p_incumbent_to <= p_incumbent_slot THEN
    RAISE EXCEPTION 'Not posted: the post that moves must move later.' USING ERRCODE = 'P0001', HINT = 'card_changed'; END IF;
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('content-plan:ivan', 0));
    plan := public.content_card_swap_plan_at(p_now);
    IF plan IS NULL OR plan ->> 'draft_id' IS DISTINCT FROM p_draft::text OR plan ->> 'day' IS DISTINCT FROM p_day::text THEN
      RAISE EXCEPTION 'Not posted: this week no longer needs the swap. Tap Post again.' USING ERRCODE = 'P0001', HINT = 'card_changed'; END IF;
    -- The post he was shown is the one the plan names now (an autopilot post that became movable since would move first).
    IF plan ->> 'incumbent' IS DISTINCT FROM p_incumbent::text OR (plan ->> 'slot_at')::timestamptz IS DISTINCT FROM p_incumbent_slot THEN
      RAISE EXCEPTION 'Not posted: the post that would move has changed. Tap Post again.' USING ERRCODE = 'P0001', HINT = 'card_changed'; END IF;
    SELECT * INTO inc FROM public.content_card_swap_incumbents(p_now) x WHERE x.draft_id = p_incumbent AND x.slot_at = p_incumbent_slot;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Not posted: the post that would move has changed. Tap Post again.' USING ERRCODE = 'P0001', HINT = 'card_changed'; END IF;
    v_queue := inc.queue_id;
    PERFORM 1 FROM public.scheduled_posts WHERE id = v_queue FOR UPDATE;
    PERFORM 1 FROM public.carousel_drafts WHERE id = p_incumbent FOR UPDATE NOWAIT;
    -- Checked again now that both rows are locked: an edit or a re-date that landed between the read and the locks
    -- (the app writes drafts directly) must not be carried into the move.
    SELECT * INTO inc FROM public.content_card_swap_incumbents(p_now) x
     WHERE x.draft_id = p_incumbent AND x.slot_at = p_incumbent_slot AND x.queue_id = v_queue;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Not posted: the post that would move has changed. Tap Post again.' USING ERRCODE = 'P0001', HINT = 'card_changed'; END IF;
    -- The plan slot keeps its kind (an autopilot placement stays an autopilot placement after the move).
    SELECT s.placement_kind INTO v_kind FROM public.content_plan_slots s
     WHERE s.account = 'ivan' AND s.placed_draft_id = p_incumbent AND s.placed_at = p_incumbent_slot ORDER BY s.created_at LIMIT 1;
    PERFORM set_config('content_plan.placement_kind', coalesce(v_kind, ''), true);
    UPDATE public.carousel_drafts SET scheduled_at = p_incumbent_to
     WHERE id = p_incumbent AND client_id IS NULL AND status = 'scheduled' AND scheduled_at = p_incumbent_slot AND published_at IS NULL
    RETURNING scheduled_at, status INTO v_to, v_status;
    PERFORM set_config('content_plan.placement_kind', coalesce(old_kind, ''), true);
    -- The weekday and re-run guards may move or pull the date in that same write: then nothing is swapped.
    IF v_to IS NULL OR v_status IS DISTINCT FROM 'scheduled' OR v_to IS DISTINCT FROM p_incumbent_to THEN
      RAISE EXCEPTION 'Not posted: the post that moves could not take its new time.' USING ERRCODE = 'P0001', HINT = 'card_changed'; END IF;
    UPDATE public.scheduled_posts SET scheduled_at = v_to WHERE id = v_queue AND status = 'pending' AND scheduled_at = p_incumbent_slot;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'Not posted: the post that moves is being published right now.' USING ERRCODE = 'P0001', HINT = 'card_busy'; END IF;
    UPDATE public.content_autopilot_picks SET slot_at = v_to
     WHERE draft_id = p_incumbent AND account = 'ivan' AND state = 'armed' AND slot_at = p_incumbent_slot;
    -- It was going out before the move; it must still be going out after it (a frozen-slot exemption, for one, does
    -- not travel with the date). Otherwise nothing is swapped.
    IF NOT coalesce((public.content_autonomy_publish_state_ivan(v_queue) ->> 'eligible')::boolean, false) THEN
      RAISE EXCEPTION 'Not posted: the post that moves would not go out at its new time.' USING ERRCODE = 'P0001', HINT = 'card_changed'; END IF;
  EXCEPTION
    WHEN lock_not_available OR deadlock_detected OR serialization_failure THEN
      RAISE EXCEPTION 'Not posted: it is being changed right now. Try again.' USING ERRCODE = 'P0001', HINT = 'card_busy';
    WHEN check_violation THEN
      -- the calendar's own spacing rule refused the new time (another post took that day)
      RAISE EXCEPTION 'Not posted: the new time for the post that moves is taken. Tap Post again.' USING ERRCODE = 'P0001', HINT = 'card_changed';
  END;
  r := public.content_card_post(p_day, p_draft, p_body_sha, p_incumbent_slot, p_ms_to_verdict);
  IF (r ->> 'scheduled_at')::timestamptz IS DISTINCT FROM p_incumbent_slot THEN
    RAISE EXCEPTION 'Not posted: the slot could not be taken.' USING ERRCODE = 'P0001', HINT = 'card_changed'; END IF;
  RETURN r || jsonb_build_object('moved', p_incumbent, 'moved_from', p_incumbent_slot, 'moved_to', v_to);
END $function$;

CREATE OR REPLACE FUNCTION public.content_card_post_swap(p_day date, p_draft uuid, p_body_sha text,
    p_incumbent uuid, p_incumbent_slot timestamptz, p_incumbent_to timestamptz, p_ms_to_verdict integer DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.content_card_post_swap_at(now(), p_day, p_draft, p_body_sha, p_incumbent, p_incumbent_slot, p_incumbent_to, p_ms_to_verdict)
$function$;

REVOKE ALL ON FUNCTION public.content_card_poland_lane(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.content_card_swap_incumbents(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.content_card_swap_plan_at(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.content_card_post_swap_at(timestamptz, date, uuid, text, uuid, timestamptz, timestamptz, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.content_card_swap_plan() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.content_card_post_swap(date, uuid, text, uuid, timestamptz, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.content_card_poland_lane(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.content_card_swap_incumbents(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.content_card_swap_plan_at(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.content_card_post_swap_at(timestamptz, date, uuid, text, uuid, timestamptz, timestamptz, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.content_card_swap_plan() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.content_card_post_swap(date, uuid, text, uuid, timestamptz, timestamptz, integer) TO authenticated, service_role;

  $swap$;

  SELECT jsonb_object_agg(q.id, public.content_autonomy_publish_snapshot_ivan(q.id)) INTO before
    FROM public.scheduled_posts q WHERE q.platform = 'linkedin' AND q.status = 'pending';

  -- A Poland-lane draft waiting in Review becomes today's card (as the 11:00 pick would make it).
  SELECT x.draft_id INTO pl FROM public.content_card_candidates(now()) x JOIN public.carousel_drafts cd ON cd.id = x.draft_id
   WHERE x.poland_lane AND jsonb_array_length(coalesce(cd.qa -> 'line_flags' -> 'lines', '[]'::jsonb)) = 0 AND coalesce(cd.qa -> 'line_flags' ->> 'lines_rejected', '0') = '0'
     AND NOT EXISTS (SELECT 1 FROM public.cb34_p2_members m WHERE m.draft_id = cd.id) ORDER BY x.created_at DESC LIMIT 1;
  SELECT public.content_card_sha(post_body) INTO pl_sha FROM public.carousel_drafts WHERE id = pl;
  DELETE FROM public.content_daily_cards WHERE day = today;
  INSERT INTO public.content_daily_cards (day, draft_id, body_sha256, why, picked_at, state) VALUES (today, pl, pl_sha, 'poland', now(), 'shown');
  res := res || jsonb_build_object('s00_poland_draft', left(pl::text, 8),
    's00_week_poland_now1', public.content_card_week_poland(now1), 's00_week_poland_now2', public.content_card_week_poland(now2),
    's00_incumbents_now1', (SELECT jsonb_agg(jsonb_build_object('d', left(x.draft_id::text, 8), 'at', x.slot_at, 'auto', x.autopilot) ORDER BY x.slot_at) FROM public.content_card_swap_incumbents(now1) x),
    's00_incumbents_now2', (SELECT jsonb_agg(jsonb_build_object('d', left(x.draft_id::text, 8), 'at', x.slot_at, 'auto', x.autopilot) ORDER BY x.slot_at) FROM public.content_card_swap_incumbents(now2) x));

  -- Not signed in / plan read.
  BEGIN PERFORM public.content_card_swap_plan(); res := res || jsonb_build_object('s01_anon_plan', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS sqlst = RETURNED_SQLSTATE; res := res || jsonb_build_object('s01_anon_plan', sqlst); END;
  BEGIN PERFORM public.content_card_post_swap(today, pl, pl_sha, pl, now(), now() + interval '1 day');
    res := res || jsonb_build_object('s02_anon_post', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS sqlst = RETURNED_SQLSTATE; res := res || jsonb_build_object('s02_anon_post', sqlst); END;

  PERFORM set_config('request.jwt.claims', OWNER, true);
  res := res || jsonb_build_object('s03_plan_right_now', public.content_card_swap_plan());

  -- WEEK 1: a hand-placed post moves.
  plan := public.content_card_swap_plan_at(now1);
  res := res || jsonb_build_object('s10_plan', plan);
  inc := (plan ->> 'incumbent')::uuid; inc_slot := (plan ->> 'slot_at')::timestamptz;
  SELECT q.id INTO inc_q FROM public.scheduled_posts q WHERE q.clickup_task_id = inc::text AND q.status = 'pending';
  BEGIN r := public.content_card_post_swap_at(now1, today, pl, pl_sha, inc, inc_slot + interval '1 minute', to1, NULL);
    res := res || jsonb_build_object('s11_wrong_slot', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT; res := res || jsonb_build_object('s11_wrong_slot', hint); END;
  BEGIN r := public.content_card_post_swap_at(now1, today, pl, repeat('0', 64), inc, inc_slot, to1, NULL);
    res := res || jsonb_build_object('s12_wrong_text', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT, msg = MESSAGE_TEXT; res := res || jsonb_build_object('s12_wrong_text', coalesce(nullif(hint, ''), msg)); END;
  BEGIN
    -- an eligible post that is not the one the plan names (here: the week's earliest movable post)
    r := public.content_card_post_swap_at(now1, today, pl, pl_sha,
      (SELECT x.draft_id FROM public.content_card_swap_incumbents(now1) x ORDER BY x.slot_at LIMIT 1),
      (SELECT x.slot_at FROM public.content_card_swap_incumbents(now1) x ORDER BY x.slot_at LIMIT 1), to1, NULL);
    res := res || jsonb_build_object('s12b_other_incumbent', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT, msg = MESSAGE_TEXT; res := res || jsonb_build_object('s12b_other_incumbent', coalesce(nullif(hint, ''), msg)); END;
  res := res || jsonb_build_object('s13_after_refusals_nothing_moved',
    (SELECT scheduled_at = inc_slot FROM public.carousel_drafts WHERE id = inc) AND (SELECT scheduled_at IS NULL AND status = 'review' FROM public.carousel_drafts WHERE id = pl));
  BEGIN
    -- a taken day as the new time: the spacing guard refuses, nothing is swapped
    r := public.content_card_post_swap_at(now1, today, pl, pl_sha, inc, inc_slot, '2026-11-24 12:30:00+00', NULL);
    res := res || jsonb_build_object('s14_taken_target', 'ALLOWED');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT; res := res || jsonb_build_object('s14_taken_target', msg); END;
  BEGIN
    r := public.content_card_post_swap_at(now1, today, pl, pl_sha, inc, inc_slot, to1, NULL);
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE EXCEPTION 'undo' USING DETAIL = jsonb_build_object('result', r,
      'poland', (SELECT jsonb_build_object('status', status, 'at', scheduled_at) FROM public.carousel_drafts WHERE id = pl),
      'moved_draft', (SELECT jsonb_build_object('status', status, 'at', scheduled_at) FROM public.carousel_drafts WHERE id = inc),
      'moved_queue', (SELECT jsonb_build_object('status', status, 'at', scheduled_at) FROM public.scheduled_posts WHERE id = inc_q),
      'moved_publish', public.content_autonomy_publish_snapshot_ivan(inc_q) - 'expected' - 'files',
      'card', (SELECT state FROM public.content_daily_cards WHERE day = today),
      'slot_kind', (SELECT jsonb_agg(placement_kind) FROM public.content_plan_slots WHERE account = 'ivan' AND placed_draft_id = inc),
      'week_poland', public.content_card_week_poland(now1))::text;
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, hint = PG_EXCEPTION_DETAIL; res := res || jsonb_build_object('s15_swap_hand_placed', coalesce(nullif(hint, ''), msg)); END;
  PERFORM set_config('request.jwt.claims', OWNER, true);

  -- WEEK 2: an autopilot post moves and stays publishable on its automatic review.
  plan := public.content_card_swap_plan_at(now2);
  res := res || jsonb_build_object('s20_plan', plan);
  inc := (plan ->> 'incumbent')::uuid; inc_slot := (plan ->> 'slot_at')::timestamptz;
  SELECT q.id INTO inc_q FROM public.scheduled_posts q WHERE q.clickup_task_id = inc::text AND q.status = 'pending';
  BEGIN
    r := public.content_card_post_swap_at(now2, today, pl, pl_sha, inc, inc_slot, to1, NULL);
    PERFORM set_config('request.jwt.claims', '', true);
    SELECT jsonb_object_agg(q.id, public.content_autonomy_publish_snapshot_ivan(q.id)) INTO after
      FROM public.scheduled_posts q WHERE q.platform = 'linkedin' AND q.status = 'pending' AND q.id <> inc_q;
    RAISE EXCEPTION 'undo' USING DETAIL = jsonb_build_object('result', r,
      'poland', (SELECT jsonb_build_object('status', status, 'at', scheduled_at) FROM public.carousel_drafts WHERE id = pl),
      'moved_draft', (SELECT jsonb_build_object('status', status, 'at', scheduled_at) FROM public.carousel_drafts WHERE id = inc),
      'moved_queue', (SELECT jsonb_build_object('status', status, 'at', scheduled_at) FROM public.scheduled_posts WHERE id = inc_q),
      'moved_pick', (SELECT jsonb_build_object('state', state, 'slot', slot_at) FROM public.content_autopilot_picks WHERE draft_id = inc),
      'moved_publish', public.content_autonomy_publish_snapshot_ivan(inc_q) - 'expected' - 'files' - 'manifest_sha256',
      'slot_kind', (SELECT jsonb_agg(placement_kind) FROM public.content_plan_slots WHERE account = 'ivan' AND placed_draft_id = inc),
      'others_unchanged', (before - inc_q::text) = after)::text;
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, hint = PG_EXCEPTION_DETAIL; res := res || jsonb_build_object('s21_swap_autopilot', coalesce(nullif(hint, ''), msg)); END;
  PERFORM set_config('request.jwt.claims', OWNER, true);

  -- The week already has its two Poland posts: no plan.
  res := res || jsonb_build_object('s30_week_30nov_poland', public.content_card_week_poland('2026-11-30 06:00:00+00'),
    's30_plan_30nov', public.content_card_swap_plan_at('2026-11-30 06:00:00+00'));
  -- A business card: no plan.
  UPDATE public.content_daily_cards SET draft_id = (SELECT x.draft_id FROM public.content_card_candidates(now()) x WHERE NOT x.poland_lane LIMIT 1) WHERE day = today;
  res := res || jsonb_build_object('s31_business_card_plan', public.content_card_swap_plan_at(now1));

  RAISE EXCEPTION 'ROLLBACK_RESULT %', res::text;
END $t$;
