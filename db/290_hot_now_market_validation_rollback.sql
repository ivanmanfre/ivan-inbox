BEGIN;
DROP TRIGGER IF EXISTS hot_now_approval_guard ON public.carousel_drafts;
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

-- Keep additive evidence storage for history and dedup.
COMMIT;
