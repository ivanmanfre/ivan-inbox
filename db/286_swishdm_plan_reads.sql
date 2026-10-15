-- SwishDM onboarding reads only. Cadence is unconfirmed; do not create a plan config or slots.
BEGIN;

CREATE OR REPLACE FUNCTION public.content_plan_week_onboarding(p_account text, p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '10s'
AS $function$
DECLARE
  v_today date := (p_now AT TIME ZONE 'Europe/Warsaw')::date;
  v_monday date;
  v_weeks jsonb := '[]'::jsonb;
  v_held jsonb;
  i integer;
BEGIN
  IF p_account IS DISTINCT FROM 'swishdm' OR NOT public.lane_allowed(p_account) THEN
    RAISE EXCEPTION 'unknown seat' USING ERRCODE = '22023';
  END IF;
  -- The operator's shared Ivan entitlement remains the read gate. No SwishDM writer
  -- entitlement is introduced and cb39_lane_ok's three-seat allowlist stays intact.
  IF NOT public.cb39_lane_ok('ivan') THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  v_monday := v_today - (extract(isodow FROM v_today)::integer - 1);
  FOR i IN 0..2 LOOP
    v_weeks := v_weeks || jsonb_build_array(jsonb_build_object(
      'start', v_monday + 7*i, 'which', (ARRAY['this','next','after'])[i+1],
      'target', 0, 'filled', 0, 'open', 0, 'posts', '[]'::jsonb, 'planned', '[]'::jsonb));
  END LOOP;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'title', coalesce(nullif(d.title,''), left(d.post_body,80)))
          ORDER BY d.created_at DESC, d.id), '[]'::jsonb)
    INTO v_held
    FROM public.carousel_drafts d
    WHERE d.client_id = p_account AND d.status = 'review' AND d.board_visible IS FALSE
      AND d.scheduled_at IS NULL AND d.published_at IS NULL;
  RETURN jsonb_build_object(
    'ok', true, 'account', p_account, 'today', v_today,
    'target', 0, 'target_week', NULL, 'open', 0, 'state', 'awaiting_cadence',
    'proposals_only', true, 'auto_generate', false, 'founder_story_max', 0,
    'cadence_source', 'Awaiting confirmation', 'weeks', v_weeks,
    'done', '[]'::jsonb, 'warnings', '[]'::jsonb, 'last_run', NULL,
    'held_drafts', v_held);
END $function$;

CREATE OR REPLACE FUNCTION public.cb51_decision_history_onboarding(p_client text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '10s'
AS $function$
DECLARE v_rulings jsonb; v_links jsonb;
BEGIN
  IF p_client IS DISTINCT FROM 'swishdm' OR NOT public.lane_allowed(p_client) THEN
    RAISE EXCEPTION 'unknown client' USING ERRCODE = '22023';
  END IF;
  IF NOT public.cb39_lane_ok('ivan') THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('action', e.action, 'reason', e.reason, 'at', e.created_at,
           'target_kind', e.target_kind, 'target_id', e.target_id) ORDER BY e.created_at DESC), '[]'::jsonb)
    INTO v_rulings
    FROM (SELECT * FROM public.editorial_decisions
          WHERE client_id = p_client AND action IN ('reject','dismiss','defer') AND coalesce(reason,'') <> ''
          ORDER BY created_at DESC LIMIT 20) e;
  SELECT coalesce(jsonb_agg(jsonb_build_object('draft_id', v.draft_id, 'status', d.status, 'published_at', d.published_at,
           'post_url', NULL, 'impressions', NULL, 'likes', NULL, 'comments', NULL,
           'verdict', v.verdict, 'reasons', v.reasons, 'note', v.note, 'source', v.source,
           'decided_at', v.decided_at, 'implicit_action', v.labels #>> '{implicit,action}',
           'title', v.labels ->> 'title') ORDER BY v.decided_at DESC), '[]'::jsonb)
    INTO v_links
    FROM (SELECT draft_id, verdict, reasons, note, source, decided_at, labels
          FROM public.cb39_draft_verdicts WHERE client_id = p_client AND decided_at > now() - interval '60 days'
          ORDER BY decided_at DESC LIMIT 50) v
    LEFT JOIN public.carousel_drafts d ON d.id = v.draft_id AND d.client_id = p_client;
  RETURN jsonb_build_object('rulings', v_rulings, 'links', v_links);
END $function$;

REVOKE ALL ON FUNCTION public.content_plan_week_onboarding(text,timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cb51_decision_history_onboarding(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.content_plan_week_onboarding(text,timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cb51_decision_history_onboarding(text) TO authenticated, service_role;
COMMIT;
