-- Market evidence is service-written; operator reads and approval fail closed.
BEGIN;
ALTER TABLE public.swishdm_trend_events ADD COLUMN IF NOT EXISTS market_validation jsonb;
ALTER TABLE public.swishdm_trend_events ADD COLUMN IF NOT EXISTS market_evidence_id uuid;
ALTER TABLE public.swishdm_trend_events ADD COLUMN IF NOT EXISTS market_reviewed_body text;
ALTER TABLE public.swishdm_trend_events ADD COLUMN IF NOT EXISTS hot_notified_at timestamptz;
CREATE TABLE IF NOT EXISTS public.swishdm_trend_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES public.swishdm_trend_events(id),
 client_id text NOT NULL DEFAULT 'swishdm' CHECK(client_id='swishdm'),
 run_id text NOT NULL, checked_at timestamptz NOT NULL DEFAULT now(),
 pack jsonb NOT NULL, validation jsonb NOT NULL,
 UNIQUE(event_id,run_id)
);
CREATE INDEX IF NOT EXISTS swishdm_trend_evidence_event_time ON public.swishdm_trend_evidence(event_id,checked_at DESC);
ALTER TABLE public.swishdm_trend_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.swishdm_trend_evidence FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.swishdm_trend_evidence TO service_role;
CREATE OR REPLACE FUNCTION public.hot_now_market_valid(p_event uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $f$
DECLARE e public.swishdm_trend_events%ROWTYPE; v jsonb; checked timestamptz;
BEGIN
 SELECT * INTO e FROM public.swishdm_trend_events WHERE id=p_event;
 SELECT validation INTO v FROM public.swishdm_trend_evidence WHERE id=e.market_evidence_id AND event_id=e.id AND client_id='swishdm';
 IF v IS NULL OR v IS DISTINCT FROM e.market_validation THEN RETURN false; END IF;
 checked:=(v->>'validated_at')::timestamptz;
 RETURN coalesce(v->>'status'='validated' AND v->>'policy_version'='market-v1'
   AND checked <= now() AND checked >= now()-interval '60 minutes'
   AND (v->>'independent_people')::int>=3 AND (v->>'qualified_people')::int>=2
   AND (v->>'original_threads')::int>=2
   AND v->>'traction_route' IN ('growing_people','substantive_replies','above_baseline')
   AND v->'failure_reasons'='[]'::jsonb AND e.post_by>now(),false);
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN RETURN false;
END $f$;
REVOKE ALL ON FUNCTION public.hot_now_market_valid(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.hot_now_evidence(p_event uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $f$
BEGIN
 IF auth.uid() IS NULL OR NOT public.cb34_p2_operator_lane_allowed('ivan') THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
 RETURN (SELECT jsonb_build_object('validation',v.validation,'pack',v.pack,'checked_at',v.checked_at)
 FROM public.swishdm_trend_events e JOIN public.swishdm_trend_evidence v ON v.id=e.market_evidence_id AND v.event_id=e.id AND v.client_id='swishdm'
 WHERE e.id=p_event AND public.hot_now_market_valid(e.id));
END $f$;
REVOKE ALL ON FUNCTION public.hot_now_evidence(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hot_now_evidence(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.hot_now_approval_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $f$
DECLARE e public.swishdm_trend_events%ROWTYPE;
BEGIN
 IF NEW.client_id='swishdm' AND NEW.board_visible IS TRUE AND OLD.board_visible IS NOT TRUE THEN
  SELECT * INTO e FROM public.swishdm_trend_events WHERE draft_id=NEW.id AND decision='hot' AND status='held' LIMIT 1;
  IF FOUND THEN
   IF NOT public.hot_now_market_valid(e.id) THEN RAISE EXCEPTION 'Refresh market evidence before sending this trend for review'; END IF;
   IF e.market_reviewed_body IS DISTINCT FROM NEW.post_body THEN RAISE EXCEPTION 'The edited post needs a fresh quality review'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.hot_now_approval_guard() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS hot_now_approval_guard ON public.carousel_drafts;
CREATE TRIGGER hot_now_approval_guard BEFORE UPDATE OF board_visible ON public.carousel_drafts
 FOR EACH ROW EXECUTE FUNCTION public.hot_now_approval_guard();
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
      'qa_total',coalesce(e.qa->>'total',null),'validation',e.market_validation,
      'qa_ready',e.market_reviewed_body IS NOT DISTINCT FROM d.post_body) ORDER BY e.post_by)
    FROM public.swishdm_trend_events e
    JOIN public.carousel_drafts d ON d.id=e.draft_id AND d.client_id='swishdm'
    WHERE public.hot_now_market_valid(e.id) AND e.decision='hot' AND e.status='held' AND e.mode='live' AND e.post_by > now()
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
    IF NOT public.hot_now_market_valid(NEW.id) THEN RETURN NEW; END IF;
    UPDATE public.swishdm_trend_events SET hot_notified_at=now() WHERE id=NEW.id AND hot_notified_at IS NULL;
    IF NOT FOUND THEN RETURN NEW; END IF;
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

COMMIT;
