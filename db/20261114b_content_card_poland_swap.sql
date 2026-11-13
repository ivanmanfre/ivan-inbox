BEGIN;
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

COMMIT;
