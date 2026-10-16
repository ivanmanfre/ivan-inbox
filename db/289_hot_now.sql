-- Hot now (16 Oct 2026, trends-proposal.md): a finished, QA-passed trend draft that is still
-- inside its post-by window is pinned on Home, rings the phone once, and is decided there.
-- Today only the SwishDM trend lane (swishdm_trend_events, n8n vMNwesUjd8Iooqqi) holds such
-- drafts; the Ivan and Rise radars still make angle-only newsjack cards in Ops.
--
--   hot_now_cards()            operator read: live held events with their hidden review draft
--   hot_now_skip(draft, at)    Skip: archive the draft, mark the event killed (kept for dedup)
--   hot_now_push trigger       one push when an event turns held in live mode, never 22-08 Warsaw
--
-- Approve and Edit reuse the existing verbs (swishdm_set_buffer_visibility, the client body save).
BEGIN;

CREATE OR REPLACE FUNCTION public.hot_now_cards()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
SET statement_timeout TO '20s'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.cb34_p2_operator_lane_allowed('ivan') THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'lane','swishdm','event_id',e.id,'draft_id',d.id,'draft_updated_at',d.updated_at,
      'headline',e.headline,'summary',e.summary,'reason',e.reason,'primary_url',e.primary_url,
      'source_published_at',e.source_published_at,'detected_at',e.detected_at,'post_by',e.post_by,
      'post_body',d.post_body,'type',d.type,'image_urls',to_jsonb(d.image_urls),'taxonomy',d.taxonomy,
      'qa_total',coalesce(e.qa->>'total',null)) ORDER BY e.post_by)
    FROM public.swishdm_trend_events e
    JOIN public.carousel_drafts d ON d.id=e.draft_id AND d.client_id='swishdm'
    WHERE e.status='held' AND e.mode='live' AND e.post_by > now()
      AND d.status='review' AND d.board_visible IS NOT TRUE
      AND d.scheduled_at IS NULL AND d.published_at IS NULL
  ),'[]'::jsonb);
END
$function$;

CREATE OR REPLACE FUNCTION public.hot_now_skip(p_draft_id uuid, p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
SET statement_timeout TO '20s'
SET lock_timeout TO '2s'
AS $function$
DECLARE d public.carousel_drafts%ROWTYPE; v_at timestamptz := clock_timestamp();
BEGIN
  IF auth.uid() IS NULL OR NOT public.cb34_p2_operator_lane_allowed('ivan') THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  SELECT * INTO d FROM public.carousel_drafts WHERE id=p_draft_id AND client_id='swishdm' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','draft_not_found'); END IF;
  IF p_expected_updated_at IS NULL OR d.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok',false,'error','stale_draft');
  END IF;
  IF d.status IS DISTINCT FROM 'review' OR d.board_visible IS TRUE OR d.scheduled_at IS NOT NULL OR d.published_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok',false,'error','not_held');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.swishdm_trend_events WHERE draft_id=p_draft_id AND status='held') THEN
    RETURN jsonb_build_object('ok',false,'error','not_hot');
  END IF;
  -- Archive, never delete: the event and its draft stay for dedup and learning.
  UPDATE public.carousel_drafts SET status='archived' WHERE id=p_draft_id;
  UPDATE public.swishdm_trend_events SET status='killed', updated_at=v_at WHERE draft_id=p_draft_id AND status='held';
  RETURN jsonb_build_object('ok',true,'id',p_draft_id);
END
$function$;

REVOKE ALL ON FUNCTION public.hot_now_cards() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hot_now_skip(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hot_now_cards() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hot_now_skip(uuid, timestamptz) TO authenticated;

-- One ring per hot card (feedback-phone-notification-cut-2026-10-07): only on the change to
-- held in live mode, dedupe key per event, feed-only during quiet hours 22:00-08:00 Warsaw.
-- A failed post never blocks the radar's own write.
CREATE OR REPLACE FUNCTION public.hot_now_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_url text; v_secret text; v_hour int; v_push boolean; v_by text;
BEGIN
  BEGIN
    v_hour := extract(hour FROM now() AT TIME ZONE 'Europe/Warsaw')::int;
    v_push := v_hour >= 8 AND v_hour < 22;
    v_by := to_char(NEW.post_by AT TIME ZONE 'Europe/Warsaw', 'HH24:MI');
    SELECT value INTO v_url FROM public.integration_config WHERE key='inbox_notify_url';
    SELECT value INTO v_secret FROM public.integration_config WHERE key='inbox_push_secret';
    IF v_url IS NULL OR v_secret IS NULL THEN RETURN NEW; END IF;
    PERFORM net.http_post(url := v_url,
      headers := jsonb_build_object('Content-Type','application/json','x-inbox-secret',v_secret),
      body := jsonb_build_object('family','newsjack_hot','source','hot-now:swishdm','dedupe_key','hot-now:'||NEW.id::text,
        'severity','info','title','Hot now for Jonathan: '||left(NEW.headline,120),
        'body','Finished post ready. Post by '||v_by||' Warsaw or it dies.','url','./#exp/d/home',
        'media',jsonb_build_object('kind','hot_now','lane','swishdm','event_id',NEW.id),'push',v_push),
      timeout_milliseconds := 30000);
  EXCEPTION WHEN others THEN
    RAISE WARNING 'hot_now_push failed: %', SQLERRM;
  END;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS hot_now_push ON public.swishdm_trend_events;
CREATE TRIGGER hot_now_push AFTER INSERT OR UPDATE OF status ON public.swishdm_trend_events
  FOR EACH ROW WHEN (NEW.status='held' AND NEW.mode='live' AND NEW.post_by > now())
  EXECUTE FUNCTION public.hot_now_push();
COMMIT;
