-- cb39 contract v2 (spec AMENDMENT 2026-10-03), additive: Approve is "keep"; a draft approved after an edit is
-- 'edited' with the before/after bodies and the edit size; Drop reasons gain 'skip' (counted, no reason stored);
-- time to verdict; the Monday card gains last week's kept / edited / dropped and run 37's mature results line.
-- Rollback: 003_cb39_amendment.rollback.sql (restores 001/002 functions; new columns and table are kept empty-safe).
BEGIN;

ALTER TABLE public.cb39_draft_verdicts DROP CONSTRAINT cb39_draft_verdicts_verdict_check;
ALTER TABLE public.cb39_draft_verdicts ADD CONSTRAINT cb39_draft_verdicts_verdict_check CHECK (verdict IN ('keep','edited','drop'));
ALTER TABLE public.cb39_draft_verdicts
  ADD COLUMN IF NOT EXISTS body_before text,
  ADD COLUMN IF NOT EXISTS body_after text,
  ADD COLUMN IF NOT EXISTS edit_chars int,
  ADD COLUMN IF NOT EXISTS ms_to_verdict int CHECK (ms_to_verdict IS NULL OR ms_to_verdict BETWEEN 0 AND 86400000),
  ADD COLUMN IF NOT EXISTS shown_at timestamptz,
  ADD COLUMN IF NOT EXISTS reason_skipped boolean NOT NULL DEFAULT false;
COMMENT ON TABLE public.cb39_draft_verdicts IS 'run 39: Ivan''s verdict per draft: keep (approved as is) / edited (approved after edit) / drop, with the snapshot the learning needs; no FK so it survives the draft. Named consumer: run 38''s brain picker reads it to avoid dropped angles. Not an input to the outlier calibration worker (that counts cb34_outlier_labels). Contract: goal-runs/content-brain-39-one-tap-verdicts-2026-10-03-out/CONTRACT.md';

-- The body as the brain released it, captured before Ivan's first edit save.
CREATE TABLE IF NOT EXISTS public.cb39_draft_body_origin (
  draft_id        uuid PRIMARY KEY,           -- no FK, same as the verdicts
  client_id       text NOT NULL CHECK (client_id IN ('ivan','risedtc','arch')),
  body            text,
  body_sha256     text,
  origin_verified boolean NOT NULL,           -- true when it equals the brain's released body hash
  captured_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  captured_by     text NOT NULL
);
ALTER TABLE public.cb39_draft_body_origin ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cb39_draft_body_origin FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cb39_draft_body_origin TO service_role;

CREATE OR REPLACE FUNCTION public.cb39_capture_origin(p_draft uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' SET statement_timeout TO '10s' SET lock_timeout TO '2s' AS $$
DECLARE d public.carousel_drafts%ROWTYPE; m public.cb34_p2_members%ROWTYPE; v_lane text; v_sha text; o public.cb39_draft_body_origin%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO o FROM public.cb39_draft_body_origin WHERE draft_id = p_draft;
  IF FOUND THEN RETURN jsonb_build_object('captured', false, 'reason', 'already', 'origin_verified', o.origin_verified); END IF;
  SELECT * INTO d FROM public.carousel_drafts WHERE id = p_draft;
  IF NOT FOUND OR d.client_id = 'ivan' THEN RAISE EXCEPTION 'draft not found' USING ERRCODE = 'P0002'; END IF;
  v_lane := coalesce(d.client_id, 'ivan');
  IF NOT public.cb34_p2_operator_lane_allowed(v_lane) THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO m FROM public.cb34_p2_members WHERE draft_id = p_draft;
  v_sha := CASE WHEN d.post_body IS NULL THEN NULL ELSE encode(sha256(convert_to(d.post_body, 'UTF8')), 'hex') END;
  INSERT INTO public.cb39_draft_body_origin(draft_id, client_id, body, body_sha256, origin_verified, captured_by)
  VALUES (p_draft, v_lane, d.post_body, v_sha, FOUND AND m.body_sha256 IS NOT NULL AND m.body_sha256 = v_sha, auth.uid()::text)
  ON CONFLICT (draft_id) DO NOTHING;
  SELECT * INTO o FROM public.cb39_draft_body_origin WHERE draft_id = p_draft;
  RETURN jsonb_build_object('captured', true, 'origin_verified', o.origin_verified);
END $$;
REVOKE ALL ON FUNCTION public.cb39_capture_origin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cb39_capture_origin(uuid) TO authenticated;

-- Size of the changed region: chars removed + chars inserted between the common prefix and the common suffix.
CREATE OR REPLACE FUNCTION public.cb39_edit_chars(a text, b text)
RETURNS int LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE la int := coalesce(length(a), 0); lb int := coalesce(length(b), 0); p int := 0; s int := 0;
BEGIN
  IF a IS NULL OR b IS NULL THEN RETURN NULL; END IF;
  WHILE p < la AND p < lb AND substr(a, p + 1, 1) = substr(b, p + 1, 1) LOOP p := p + 1; END LOOP;
  WHILE s < la - p AND s < lb - p AND substr(a, la - s, 1) = substr(b, lb - s, 1) LOOP s := s + 1; END LOOP;
  RETURN (la - p - s) + (lb - p - s);
END $$;

DROP FUNCTION IF EXISTS public.cb39_verdict_set(uuid, text, text[], text, uuid);
CREATE OR REPLACE FUNCTION public.cb39_verdict_set(
  p_draft uuid, p_verdict text, p_reasons text[] DEFAULT '{}', p_note text DEFAULT NULL, p_invocation uuid DEFAULT NULL,
  p_ms_to_verdict int DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
SET statement_timeout TO '20s'
SET lock_timeout TO '2s'
AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.cb39_verdict_set(uuid, text, text[], text, uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cb39_verdict_set(uuid, text, text[], text, uuid, int) TO authenticated;

-- The one weekly card: drafts to judge + last week's kept / edited / dropped + run 37's results line when mature.
CREATE OR REPLACE FUNCTION public.cb39_monday_card(p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' SET statement_timeout TO '15s' SET lock_timeout TO '1s' AS $$
DECLARE
  wk timestamptz := date_trunc('week', p_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  key text; n_total int; by_lane text; last_release timestamptz; v_title text; v_body text; existing public.inbox_notifications%ROWTYPE;
  n_keep int; n_edit int; n_drop int; results_line text; part text; c text;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('cb39-monday-card', 0)) THEN RETURN jsonb_build_object('sent', false, 'reason', 'busy'); END IF;
  IF p_now < wk + interval '16 hours' THEN RETURN jsonb_build_object('sent', false, 'reason', 'before_release_window'); END IF;
  key := 'cb39-judge:' || to_char(wk AT TIME ZONE 'UTC', 'YYYY-MM-DD');

  SELECT coalesce(sum(n), 0)::int, string_agg(lane_label || ' ' || n, ', ' ORDER BY ord), max(newest)
    INTO n_total, by_lane, last_release
    FROM (SELECT CASE m.client_id WHEN 'ivan' THEN 'Ivan' WHEN 'risedtc' THEN 'Rise' ELSE 'Arch' END AS lane_label,
                 CASE m.client_id WHEN 'ivan' THEN 1 WHEN 'risedtc' THEN 2 ELSE 3 END AS ord,
                 count(*) AS n, max(m.released_at) AS newest
            FROM public.cb34_p2_members m
            JOIN public.carousel_drafts d ON d.id = m.draft_id
           WHERE m.state = 'released' AND m.validation ->> 'verdict' = 'PASS'
             AND m.released_at >= wk AND m.released_at <= p_now
             AND ((m.client_id = 'ivan' AND d.client_id IS NULL) OR (m.client_id <> 'ivan' AND d.client_id = m.client_id))
             AND d.status IN ('review','error') AND d.published_at IS NULL
             AND NOT coalesce((d.taxonomy ->> 'deleted_by_operator') = 'true', false)
             AND NOT EXISTS (SELECT 1 FROM public.cb39_draft_verdicts v WHERE v.draft_id = m.draft_id)
           GROUP BY m.client_id) x;

  IF n_total = 0 THEN RETURN jsonb_build_object('sent', false, 'reason', 'nothing_to_judge', 'week', wk); END IF;
  IF p_now - last_release < interval '45 minutes' AND p_now < wk + interval '30 hours' THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'settling', 'to_judge', n_total, 'last_release', last_release); END IF;

  -- Last week's verdicts (Monday to Monday, UTC).
  SELECT count(*) FILTER (WHERE verdict = 'keep'), count(*) FILTER (WHERE verdict = 'edited'), count(*) FILTER (WHERE verdict = 'drop')
    INTO n_keep, n_edit, n_drop
    FROM public.cb39_draft_verdicts WHERE decided_at >= wk - interval '7 days' AND decided_at < wk;

  -- Run 37's results line, only when there is a mature read: posts that reached 7 days last week, with impressions
  -- at 7 days and a known buyer-engager count. Any failure of the read leaves the line out.
  results_line := NULL;
  BEGIN
    FOREACH c IN ARRAY ARRAY['ivan','risedtc','arch'] LOOP
      SELECT CASE WHEN count(*) > 0 THEN
               CASE c WHEN 'ivan' THEN 'Ivan' WHEN 'risedtc' THEN 'Rise' ELSE 'Arch' END || ' ' || count(*) || ' post' ||
               CASE WHEN count(*) = 1 THEN '' ELSE 's' END || ', ' || sum(r.buyer_engagers) || ' buyer engager' ||
               CASE WHEN sum(r.buyer_engagers) = 1 THEN '' ELSE 's' END END
        INTO part
        FROM public.cb37_results(c, ((wk - interval '14 days') AT TIME ZONE 'UTC')::date) r
       WHERE r.published_at >= wk - interval '14 days' AND r.published_at < wk - interval '7 days'
         AND r.imp_7d IS NOT NULL AND r.buyer_engagers IS NOT NULL;
      IF part IS NOT NULL THEN results_line := coalesce(results_line || '; ', '') || part; END IF;
    END LOOP;
  EXCEPTION WHEN others THEN results_line := NULL;
  END;

  v_title := n_total || ' new brain draft' || CASE WHEN n_total = 1 THEN '' ELSE 's' END || '. Tap to judge.';
  v_body := by_lane || '. Approve or Drop on each card in Review, about 2 minutes.'
    || E'\nLast week: ' || n_keep || ' kept, ' || n_edit || ' edited, ' || n_drop || ' dropped.'
    || CASE WHEN results_line IS NOT NULL THEN E'\nResults at 7 days: ' || results_line || '.' ELSE '' END;

  SELECT * INTO existing FROM public.inbox_notifications WHERE dedupe_key = key AND source = 'cb39-judge' ORDER BY created_at LIMIT 1;
  IF FOUND THEN
    IF existing.read_at IS NULL AND existing.dismissed_at IS NULL AND (existing.title IS DISTINCT FROM v_title OR existing.body IS DISTINCT FROM v_body) THEN
      UPDATE public.inbox_notifications SET title = v_title, body = v_body, last_seen_at = p_now WHERE id = existing.id;
      RETURN jsonb_build_object('sent', false, 'reason', 'refreshed', 'id', existing.id, 'to_judge', n_total);
    END IF;
    RETURN jsonb_build_object('sent', false, 'reason', 'already_sent', 'id', existing.id);
  END IF;

  INSERT INTO public.inbox_notifications(family, source, dedupe_key, severity, title, body, url, tenant, group_key, push_result)
  VALUES ('brain_drafts_pending', 'cb39-judge', key, 'info', v_title, v_body, '#exp/d/content/now', NULL, key,
          jsonb_build_object('skipped', 'feed_only'))
  RETURNING * INTO existing;
  RETURN jsonb_build_object('sent', true, 'id', existing.id, 'to_judge', n_total, 'title', v_title, 'body', v_body);
END $$;
REVOKE ALL ON FUNCTION public.cb39_monday_card(timestamptz) FROM PUBLIC, anon, authenticated;

COMMIT;
