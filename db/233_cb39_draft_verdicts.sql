-- cb39: Ivan's one-tap Keep / Drop verdicts on content drafts (run 39, 2026-10-03).
-- Contract: O/CONTRACT.md. Rollback: 001_cb39_verdicts.rollback.sql.
BEGIN;

CREATE TABLE IF NOT EXISTS public.cb39_draft_verdicts (
  verdict_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id      uuid NOT NULL UNIQUE,          -- deliberately NO foreign key: the verdict outlives its draft
  client_id     text NOT NULL CHECK (client_id IN ('ivan','risedtc','arch')),
  verdict       text NOT NULL CHECK (verdict IN ('keep','drop')),
  reasons       text[] NOT NULL DEFAULT '{}' CHECK (cardinality(reasons) <= 8),
  note          text CHECK (note IS NULL OR length(note) <= 500),
  body_sha256   text CHECK (body_sha256 IS NULL OR body_sha256 ~ '^[a-f0-9]{64}$'),
  body_snapshot text,
  brief         jsonb,
  labels        jsonb NOT NULL DEFAULT '{}'::jsonb,
  how_made      text NOT NULL CHECK (how_made IN ('brain','normal')),
  draft_action  text NOT NULL CHECK (draft_action IN ('pending','approved','none','deleted','archived','backfill')),
  source        text NOT NULL DEFAULT 'app' CHECK (source IN ('app','backfill')),
  invocation_id uuid,
  decided_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_by    text NOT NULL,
  updated_at    timestamptz
);
CREATE INDEX IF NOT EXISTS cb39_draft_verdicts_client_decided ON public.cb39_draft_verdicts (client_id, decided_at DESC);
ALTER TABLE public.cb39_draft_verdicts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cb39_draft_verdicts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cb39_draft_verdicts TO service_role;
COMMENT ON TABLE public.cb39_draft_verdicts IS 'run 39: one Keep/Drop verdict per draft with the snapshot the learning needs; no FK so it survives the draft. Contract: goal-runs/content-brain-39-one-tap-verdicts-2026-10-03-out/CONTRACT.md';

-- Who may read/write a lane: SQL owner / service role always; an operator through Ivan's entitlement.
CREATE OR REPLACE FUNCTION public.cb39_lane_ok(p_client text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $$
  SELECT p_client IN ('ivan','risedtc','arch') AND (
    coalesce(auth.role(),'') = 'service_role'
    -- a direct database session (SQL owner, n8n Postgres node) carries no request JWT at all
    OR coalesce(current_setting('request.jwt.claims', true), '') = ''
    OR public.cb34_p2_operator_lane_allowed(p_client));
$$;
REVOKE ALL ON FUNCTION public.cb39_lane_ok(text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.cb39_verdict_set(
  p_draft uuid, p_verdict text, p_reasons text[] DEFAULT '{}', p_note text DEFAULT NULL, p_invocation uuid DEFAULT NULL)
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
  v_has_member boolean := false;
  v_lane text; v_tax jsonb; v_brief jsonb; v_how text; v_action text;
  v_reasons text[] := coalesce(p_reasons, '{}');
  v_note text := nullif(btrim(coalesce(p_note,'')), '');
  v_allowed text[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  IF p_draft IS NULL OR p_verdict IS NULL OR p_verdict NOT IN ('keep','drop') THEN
    RAISE EXCEPTION 'verdict must be keep or drop' USING ERRCODE = '22023'; END IF;
  v_allowed := CASE p_verdict
    WHEN 'drop' THEN ARRAY['invented_fact','not_my_voice','generic','wrong_topic','too_long','already_said','other']
    ELSE ARRAY['my_voice','strong_hook','true_story','useful','other'] END;
  IF NOT (v_reasons <@ v_allowed) OR cardinality(v_reasons) > 8 THEN
    RAISE EXCEPTION 'unknown reason for %', p_verdict USING ERRCODE = '22023'; END IF;
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN RAISE EXCEPTION 'note too long' USING ERRCODE = '22023'; END IF;

  -- One writer per draft at a time: a double tap waits, then replays.
  PERFORM pg_advisory_xact_lock(hashtextextended('cb39-verdict:' || p_draft::text, 0));

  SELECT * INTO v FROM public.cb39_draft_verdicts WHERE draft_id = p_draft FOR UPDATE;
  IF FOUND THEN
    IF NOT public.cb39_lane_ok(v.client_id) THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
    IF v.verdict <> p_verdict THEN
      RAISE EXCEPTION 'already judged %', v.verdict USING ERRCODE = 'P0001', HINT = 'cb39_already_judged'; END IF;
    UPDATE public.cb39_draft_verdicts
       SET reasons = CASE WHEN cardinality(v_reasons) > 0 THEN v_reasons ELSE reasons END,
           note = coalesce(v_note, note),
           updated_at = CASE WHEN cardinality(v_reasons) > 0 OR v_note IS NOT NULL THEN clock_timestamp() ELSE updated_at END
     WHERE draft_id = p_draft RETURNING * INTO v;
    RETURN (to_jsonb(v) - 'body_snapshot' - 'brief') || jsonb_build_object('replayed', true);
  END IF;

  SELECT * INTO d FROM public.carousel_drafts WHERE id = p_draft FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'draft not found' USING ERRCODE = 'P0002'; END IF;
  -- client_id='ivan' rows are editorial-native and run their own statuses; the app's writes refuse them too.
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
  v_tax := CASE WHEN jsonb_typeof(d.taxonomy) = 'object' THEN d.taxonomy ELSE '{}'::jsonb END;
  v_brief := CASE WHEN v_has_member AND m.brief IS NOT NULL THEN m.brief ELSE v_tax -> 'brain_brief' END;
  v_how := CASE WHEN v_has_member OR v_tax ->> 'source' = 'content-brain' THEN 'brain' ELSE 'normal' END;

  -- 1. The verdict, first, with everything the learning needs.
  INSERT INTO public.cb39_draft_verdicts(draft_id, client_id, verdict, reasons, note, body_sha256, body_snapshot, brief,
    labels, how_made, draft_action, source, invocation_id, decided_by)
  VALUES (p_draft, v_lane, p_verdict, v_reasons, v_note,
    CASE WHEN d.post_body IS NULL THEN NULL ELSE encode(sha256(convert_to(d.post_body, 'UTF8')), 'hex') END,
    d.post_body, v_brief,
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
      'slot', v_brief -> 'slot', 'pattern', v_brief -> 'pattern')),
    v_how, 'pending', 'app', p_invocation, v_uid::text);

  -- 2. The existing path's effect, unchanged, in the same transaction.
  IF p_verdict = 'keep' THEN
    IF d.client_id IS NULL THEN
      -- approveDraft (src/lib/content.ts): status='approved', Ivan lane only. Never publishes.
      UPDATE public.carousel_drafts SET status = 'approved' WHERE id = p_draft AND client_id IS NULL;
      v_action := 'approved';
    ELSE
      -- No client-lane approve exists: approving a client row would lock it off the board (content.ts reviewActionable).
      v_action := 'none';
    END IF;
  ELSE
    -- deleteDraft / deleteClientDraft: hard delete; when the database refuses it, the same
    -- archive fallback (status='disqualified' + taxonomy.deleted_by_operator) so it leaves every list.
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
      -- deleteDraft's cancelQueueRowsFor: a deleted Ivan draft must not publish from a stale queue row.
      UPDATE public.scheduled_posts SET status = 'cancelled', error_message = 'draft_deleted_by_operator'
       WHERE clickup_task_id = p_draft::text AND status IN ('pending','queued_v2','posting');
    END IF;
  END IF;

  UPDATE public.cb39_draft_verdicts SET draft_action = v_action WHERE draft_id = p_draft RETURNING * INTO v;
  RETURN (to_jsonb(v) - 'body_snapshot' - 'brief') || jsonb_build_object('replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.cb39_verdict_set(uuid, text, text[], text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cb39_verdict_set(uuid, text, text[], text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cb39_verdicts(p_client text DEFAULT NULL, p_since timestamptz DEFAULT NULL)
RETURNS SETOF public.cb39_draft_verdicts LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' SET statement_timeout TO '20s' AS $$
BEGIN
  IF p_client IS NOT NULL AND p_client NOT IN ('ivan','risedtc','arch') THEN RAISE EXCEPTION 'unknown client' USING ERRCODE = '22023'; END IF;
  IF p_client IS NOT NULL AND NOT public.cb39_lane_ok(p_client) THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  IF p_client IS NULL AND NOT (public.cb39_lane_ok('ivan') OR public.cb39_lane_ok('risedtc') OR public.cb39_lane_ok('arch')) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT v.* FROM public.cb39_draft_verdicts v
   WHERE (p_client IS NULL OR v.client_id = p_client) AND public.cb39_lane_ok(v.client_id)
     AND (p_since IS NULL OR v.decided_at >= p_since)
   ORDER BY v.decided_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.cb39_verdicts(text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cb39_verdicts(text, timestamptz) TO authenticated, service_role;

-- Released, visible brain drafts still waiting for a verdict.
CREATE OR REPLACE FUNCTION public.cb39_to_judge(p_client text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' SET statement_timeout TO '20s' AS $$
DECLARE r jsonb;
BEGIN
  IF p_client IS NOT NULL AND NOT public.cb39_lane_ok(p_client) THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object('total', coalesce(sum(n), 0),
           'by_lane', coalesce(jsonb_object_agg(lane, n) FILTER (WHERE lane IS NOT NULL), '{}'::jsonb),
           'newest_release', max(newest))
    INTO r
    FROM (SELECT m.client_id AS lane, count(*) AS n, max(m.released_at) AS newest
            FROM public.cb34_p2_members m
            JOIN public.carousel_drafts d ON d.id = m.draft_id
           WHERE m.state = 'released' AND m.validation ->> 'verdict' = 'PASS'
             AND ((m.client_id = 'ivan' AND d.client_id IS NULL) OR (m.client_id <> 'ivan' AND d.client_id = m.client_id))
             AND d.status IN ('review','error') AND d.published_at IS NULL
             AND NOT coalesce((d.taxonomy ->> 'deleted_by_operator') = 'true', false)
             AND NOT EXISTS (SELECT 1 FROM public.cb39_draft_verdicts v WHERE v.draft_id = m.draft_id)
             AND (p_client IS NULL OR m.client_id = p_client)
             AND public.cb39_lane_ok(m.client_id)
           GROUP BY m.client_id) x;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.cb39_to_judge(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cb39_to_judge(text) TO authenticated, service_role;

COMMIT;
