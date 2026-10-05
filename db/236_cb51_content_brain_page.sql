-- run 51 (Content Brain page, 2026-10-05). App-side only; no table, no data, no pipeline change.
-- 1. cb39_verdict_set: the Drop reason allowlist gains 'needs_proof' and 'weak_hook' (the Content Brain
--    page's required reason chips). Body otherwise byte-identical to the live definition read 2026-10-05
--    (snapshot: 236_cb51_content_brain_page_rollback.sql). Readers of reasons (CB35 weekly job) treat them as text.
-- 2. cb51_draft_sources(ids): the source behind each waiting draft, read by primary key: the brain member's
--    stored source passage, the draft's own source record (call quote, tracked post), the editorial brief's
--    first evidence passage, and the outlier's measured result vs the author's usual. Visible drafts only.
-- 3. cb51_decision_history(client): recorded brief decisions (editorial_decisions, actor kept as recorded) and,
--    for drafts that got a verdict, where they went (status, published, own-post metrics when linked).

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
  IF NOT (v_reasons <@ ARRAY['invented_fact','not_my_voice','generic','wrong_topic','too_long','already_said','other','needs_proof','weak_hook']) OR cardinality(v_reasons) > 8 THEN
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

CREATE OR REPLACE FUNCTION public.cb51_draft_sources(p_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' SET statement_timeout TO '10s' AS $$
DECLARE r jsonb;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN RETURN '[]'::jsonb; END IF;
  IF cardinality(p_ids) > 60 THEN RAISE EXCEPTION 'too many drafts' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(jsonb_agg(x.j), '[]'::jsonb) INTO r FROM (
    SELECT jsonb_build_object(
      'draft_id', d.id,
      'member_state', m.state,
      'slot', coalesce(m.brief ->> 'slot', d.taxonomy -> 'brain_brief' ->> 'slot'),
      'source_ref', s.ref,
      'source_text', m.source_text,
      'detail', CASE WHEN jsonb_typeof(d.source_detail) = 'object' THEN d.source_detail - 'voice_writer' - 'references' ELSE NULL END,
      'x', xp.j,
      'linkedin', lp.j,
      'brief', bp.j) AS j
    FROM unnest(p_ids) AS i(id)
    JOIN public.carousel_drafts d ON d.id = i.id
    LEFT JOIN public.cb34_p2_members m ON m.draft_id = d.id
    CROSS JOIN LATERAL (SELECT coalesce(d.client_id, 'ivan') AS lane,
      coalesce(m.source_ref, d.taxonomy -> 'brain_brief' ->> 'source_ref') AS ref) s
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object('author', nullif(btrim(p.author_name), ''), 'handle', p.author_handle, 'text', p.text, 'url', p.url,
               'published_at', p.created_at, 'likes', p.likes, 'views', p.views,
               'ratio', sc.ratio, 'baseline', sc.trailing_median, 'baseline_n', sc.trailing_n) AS j
        FROM public.x_competitor_posts p
        LEFT JOIN LATERAL (SELECT o.ratio, o.trailing_median, o.trailing_n FROM public.x_outlier_scores o
                            WHERE o.client_id = s.lane AND o.post_id = p.post_id ORDER BY o.created_at DESC LIMIT 1) sc ON true
       WHERE s.ref LIKE 'outlier:x:%' AND p.client_id = s.lane AND p.post_id = split_part(s.ref, ':', 3)
       LIMIT 1) xp ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object('published_at', o.published_at, 'likes', o.likes, 'comments', o.comments,
               'ratio', o.ratio, 'baseline', o.trailing_median, 'baseline_n', o.trailing_n) AS j
        FROM public.outlier_post_scores o
       WHERE s.ref LIKE 'outlier:linkedin:%' AND o.client_id = s.lane AND o.post_ref = split_part(s.ref, ':', 3)
       ORDER BY o.created_at DESC LIMIT 1) lp ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object('evidence', b.payload -> 'evidence' -> 0, 'objective', b.payload -> 'purpose' ->> 'objective',
               'structure', b.payload -> 'production' ->> 'structure') AS j
        FROM public.editorial_brief_versions b
       WHERE jsonb_typeof(d.source_detail) = 'object' AND d.source_detail ->> 'brief_version' ~ '^[0-9]{1,6}$'
         AND b.client_id = s.lane AND b.brief_id = d.source_detail ->> 'brief_id'
         AND b.version = (d.source_detail ->> 'brief_version')::int) bp ON true
    WHERE public.cb39_lane_ok(s.lane)
      AND coalesce((public.cb34_p2_read_guard(d.id) ->> 'visible')::boolean, false)
  ) x;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.cb51_draft_sources(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cb51_draft_sources(uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cb51_decision_history(p_client text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' SET statement_timeout TO '10s' AS $$
DECLARE v_rulings jsonb; v_links jsonb;
BEGIN
  IF p_client IS NULL OR p_client NOT IN ('ivan','risedtc','arch') THEN RAISE EXCEPTION 'unknown client' USING ERRCODE = '22023'; END IF;
  IF NOT public.cb39_lane_ok(p_client) THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('action', e.action, 'reason', e.reason, 'at', e.created_at,
           'target_kind', e.target_kind, 'target_id', e.target_id) ORDER BY e.created_at DESC), '[]'::jsonb)
    INTO v_rulings
    FROM (SELECT * FROM public.editorial_decisions
           WHERE client_id = p_client AND action IN ('reject','dismiss','defer') AND coalesce(reason, '') <> ''
           ORDER BY created_at DESC LIMIT 20) e;
  SELECT coalesce(jsonb_agg(jsonb_build_object('draft_id', v.draft_id, 'status', d.status, 'published_at', d.published_at,
           'post_url', op.linkedin_url, 'impressions', op.num_impressions, 'likes', op.num_likes, 'comments', op.num_comments)), '[]'::jsonb)
    INTO v_links
    FROM (SELECT draft_id FROM public.cb39_draft_verdicts
           WHERE client_id = p_client AND decided_at > now() - interval '60 days'
           ORDER BY decided_at DESC LIMIT 50) v
    LEFT JOIN public.carousel_drafts d ON d.id = v.draft_id
    LEFT JOIN LATERAL (SELECT o.linkedin_url, o.num_impressions, o.num_likes, o.num_comments FROM public.own_posts o
                        WHERE p_client = 'ivan' AND o.clickup_task_id = v.draft_id::text
                        ORDER BY o.posted_at DESC NULLS LAST LIMIT 1) op ON true;
  RETURN jsonb_build_object('rulings', v_rulings, 'links', v_links);
END $$;
REVOKE ALL ON FUNCTION public.cb51_decision_history(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cb51_decision_history(text) TO authenticated, service_role;
