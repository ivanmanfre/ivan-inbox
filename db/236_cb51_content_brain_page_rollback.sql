-- Rollback of 236: the live cb39_verdict_set as read 2026-10-05 before run 51, and the two run-51 readers dropped.
-- A verdict row already saved with 'needs_proof' / 'weak_hook' stays as written (rows are never rewritten).
CREATE OR REPLACE FUNCTION public.cb39_verdict_set(p_draft uuid, p_verdict text, p_reasons text[] DEFAULT '{}'::text[], p_note text DEFAULT NULL::text, p_invocation uuid DEFAULT NULL::uuid, p_ms_to_verdict integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '20s'
 SET lock_timeout TO '2s'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v public.cb39_draft_verdicts%ROWTYPE;
  d public.carousel_drafts%ROWTYPE;
  m public.cb34_p2_members%ROWTYPE;
  o public.cb39_draft_body_origin%ROWTYPE;
  v_has_member boolean := false; v_has_origin boolean := false;
  v_lane text; v_tax jsonb; v_brief jsonb; v_how text; v_action text; v_sha text; v_final text;
  v_skip boolean := false;
  v_reasons text[] := coalesce(p_reasons, '{}');
  v_note text := nullif(btrim(coalesce(p_note,'')), '');
  v_ms int := CASE WHEN p_ms_to_verdict BETWEEN 0 AND 86400000 THEN p_ms_to_verdict END;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  IF p_draft IS NULL OR p_verdict IS NULL OR p_verdict NOT IN ('keep','drop') THEN
    RAISE EXCEPTION 'verdict must be keep or drop' USING ERRCODE = '22023'; END IF;
  IF p_verdict = 'keep' AND cardinality(v_reasons) > 0 THEN RAISE EXCEPTION 'approve takes no reason' USING ERRCODE = '22023'; END IF;
  IF 'skip' = ANY (v_reasons) THEN
    IF cardinality(v_reasons) > 1 THEN RAISE EXCEPTION 'skip stands alone' USING ERRCODE = '22023'; END IF;
    v_skip := true; v_reasons := '{}';
  END IF;
  IF NOT (v_reasons <@ ARRAY['invented_fact','not_my_voice','generic','wrong_topic','too_long','already_said','other']) OR cardinality(v_reasons) > 8 THEN
    RAISE EXCEPTION 'unknown reason for %', p_verdict USING ERRCODE = '22023'; END IF;
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN RAISE EXCEPTION 'note too long' USING ERRCODE = '22023'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('cb39-verdict:' || p_draft::text, 0));

  SELECT * INTO v FROM public.cb39_draft_verdicts WHERE draft_id = p_draft FOR UPDATE;
  IF FOUND THEN
    IF NOT public.cb39_lane_ok(v.client_id) THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
    IF (v.verdict = 'drop') <> (p_verdict = 'drop') THEN
      RAISE EXCEPTION 'already judged %', CASE WHEN v.verdict = 'drop' THEN 'drop' ELSE 'keep' END USING ERRCODE = 'P0001', HINT = 'cb39_already_judged'; END IF;
    UPDATE public.cb39_draft_verdicts
       SET reasons = CASE WHEN cardinality(v_reasons) > 0 THEN v_reasons WHEN v_skip THEN '{}' ELSE reasons END,
           reason_skipped = CASE WHEN v_skip THEN true WHEN cardinality(v_reasons) > 0 THEN false ELSE reason_skipped END,
           note = coalesce(v_note, note),
           updated_at = CASE WHEN cardinality(v_reasons) > 0 OR v_note IS NOT NULL OR v_skip THEN clock_timestamp() ELSE updated_at END
     WHERE draft_id = p_draft RETURNING * INTO v;
    RETURN (to_jsonb(v) - 'body_snapshot' - 'brief' - 'body_before' - 'body_after') || jsonb_build_object('replayed', true);
  END IF;

  SELECT * INTO d FROM public.carousel_drafts WHERE id = p_draft FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'draft not found' USING ERRCODE = 'P0002'; END IF;
  IF d.client_id = 'ivan' THEN RAISE EXCEPTION 'This post could not be updated from here.' USING ERRCODE = '42501'; END IF;
  v_lane := coalesce(d.client_id, 'ivan');
  IF NOT public.cb39_lane_ok(v_lane) OR NOT public.cb34_p2_operator_lane_allowed(v_lane) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  IF d.published_at IS NOT NULL OR d.status NOT IN ('review','error') THEN
    RAISE EXCEPTION 'Not in review any more (it is %).', d.status USING ERRCODE = 'P0001', HINT = 'cb39_not_in_review'; END IF;
  IF p_verdict = 'drop' AND d.client_id IS NOT NULL AND d.board_visible IS TRUE THEN
    RAISE EXCEPTION 'This draft is on the client''s board. Take it off the board first.' USING ERRCODE = 'P0001', HINT = 'cb39_on_board'; END IF;

  SELECT * INTO m FROM public.cb34_p2_members WHERE draft_id = p_draft;
  v_has_member := FOUND;
  SELECT * INTO o FROM public.cb39_draft_body_origin WHERE draft_id = p_draft;
  v_has_origin := FOUND;
  v_tax := CASE WHEN jsonb_typeof(d.taxonomy) = 'object' THEN d.taxonomy ELSE '{}'::jsonb END;
  v_brief := CASE WHEN v_has_member AND m.brief IS NOT NULL THEN m.brief ELSE v_tax -> 'brain_brief' END;
  v_how := CASE WHEN v_has_member OR v_tax ->> 'source' = 'content-brain' THEN 'brain' ELSE 'normal' END;
  v_sha := CASE WHEN d.post_body IS NULL THEN NULL ELSE encode(sha256(convert_to(d.post_body, 'UTF8')), 'hex') END;
  -- Approved after an edit: the body moved off what the brain released (or what was captured before the first edit).
  v_final := CASE WHEN p_verdict = 'drop' THEN 'drop'
    WHEN (v_has_member AND m.body_sha256 IS NOT NULL AND v_sha IS DISTINCT FROM m.body_sha256)
      OR (v_has_origin AND v_sha IS DISTINCT FROM o.body_sha256)
      OR coalesce(v_tax ->> 'human_edited', '') = 'true' THEN 'edited'
    ELSE 'keep' END;

  -- 1. The verdict, first, with everything the learning needs.
  INSERT INTO public.cb39_draft_verdicts(draft_id, client_id, verdict, reasons, reason_skipped, note, body_sha256, body_snapshot, brief,
    labels, how_made, draft_action, source, invocation_id, decided_by, ms_to_verdict, shown_at, body_before, body_after, edit_chars)
  VALUES (p_draft, v_lane, v_final, v_reasons, v_skip, v_note, v_sha, d.post_body, v_brief,
    jsonb_strip_nulls(jsonb_build_object(
      'type', d.type, 'topic', d.topic, 'title', d.title, 'funnel_stage', d.funnel_stage,
      'status_before', d.status, 'board_visible', d.board_visible, 'created_at', d.created_at, 'scheduled_at', d.scheduled_at,
      'pillar', v_tax -> 'pillar', 'hook_class', v_tax -> 'hook_class', 'source', v_tax -> 'source',
      'source_ref', coalesce(v_tax -> 'source_ref', to_jsonb(d.source_ref)), 'writer', v_tax -> 'writer',
      'writer_lane', v_tax -> 'writer_lane', 'funnel_why', v_tax -> 'funnel_why', 'human_edited', v_tax -> 'human_edited',
      'brain_verdict', v_tax -> 'content_brain' -> 'verdict', 'checks', v_tax -> 'content_brain' -> 'checks',
      'run_id', CASE WHEN v_has_member THEN to_jsonb(m.run_id) END,
      'week_start', CASE WHEN v_has_member THEN to_jsonb(m.week_start) END,
      'member_state', CASE WHEN v_has_member THEN to_jsonb(m.state) END,
      'released_at', CASE WHEN v_has_member THEN to_jsonb(m.released_at) END,
      'released_body_sha256', CASE WHEN v_has_member THEN to_jsonb(m.body_sha256) END,
      'origin_verified', CASE WHEN v_has_origin THEN to_jsonb(o.origin_verified) END,
      'slot', v_brief -> 'slot', 'pattern', v_brief -> 'pattern')),
    v_how, 'pending', 'app', p_invocation, v_uid::text, v_ms,
    CASE WHEN v_ms IS NOT NULL THEN clock_timestamp() - make_interval(secs => v_ms / 1000.0) END,
    CASE WHEN v_final = 'edited' AND v_has_origin THEN o.body END,
    CASE WHEN v_final = 'edited' THEN d.post_body END,
    CASE WHEN v_final = 'edited' AND v_has_origin THEN public.cb39_edit_chars(o.body, d.post_body) END);

  -- 2. The existing path's effect, unchanged, in the same transaction.
  IF p_verdict = 'keep' THEN
    IF d.client_id IS NULL THEN
      UPDATE public.carousel_drafts SET status = 'approved' WHERE id = p_draft AND client_id IS NULL;
      v_action := 'approved';
    ELSE
      v_action := 'none';
    END IF;
  ELSE
    BEGIN
      IF d.client_id IS NULL THEN DELETE FROM public.carousel_drafts WHERE id = p_draft AND client_id IS NULL;
      ELSE DELETE FROM public.carousel_drafts WHERE id = p_draft AND client_id IS NOT NULL; END IF;
      v_action := 'deleted';
    EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN
      UPDATE public.carousel_drafts
         SET status = 'disqualified',
             taxonomy = CASE
               WHEN jsonb_typeof(d.taxonomy) = 'object' THEN d.taxonomy
               WHEN jsonb_typeof(d.taxonomy) = 'string' AND btrim(d.taxonomy #>> '{}') <> '' THEN jsonb_build_object('structure_used', btrim(d.taxonomy #>> '{}'))
               ELSE '{}'::jsonb END
               || jsonb_build_object('deleted_by_operator', true,
                    'deleted_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
       WHERE id = p_draft;
      v_action := 'archived';
    END;
    IF d.client_id IS NULL THEN
      UPDATE public.scheduled_posts SET status = 'cancelled', error_message = 'draft_deleted_by_operator'
       WHERE clickup_task_id = p_draft::text AND status IN ('pending','queued_v2','posting');
    END IF;
  END IF;

  UPDATE public.cb39_draft_verdicts SET draft_action = v_action WHERE draft_id = p_draft RETURNING * INTO v;
  RETURN (to_jsonb(v) - 'body_snapshot' - 'brief' - 'body_before' - 'body_after') || jsonb_build_object('replayed', false);
END $function$;
DROP FUNCTION IF EXISTS public.cb51_draft_sources(uuid[]);
DROP FUNCTION IF EXISTS public.cb51_decision_history(text);
