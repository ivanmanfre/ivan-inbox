-- Hot now: return the checked Slack card line (carousel_drafts.source_detail.card_line, written and checked
-- against the sources by the radar Draft and Hold step) so Ivan sees on the review sheet the exact line Jonathan gets.
BEGIN;
CREATE OR REPLACE FUNCTION public.hot_now_cards()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
      'card_line',nullif(btrim(d.source_detail->'card_line'->>'text'),''),
      'qa_ready',e.market_reviewed_body IS NOT DISTINCT FROM d.post_body) ORDER BY e.post_by)
    FROM public.swishdm_trend_events e
    JOIN public.carousel_drafts d ON d.id=e.draft_id AND d.client_id='swishdm'
    WHERE public.hot_now_market_valid(e.id) AND e.decision='hot' AND e.status='held' AND e.mode='live' AND e.post_by > now()
      AND d.status='review' AND d.board_visible IS NOT TRUE
      AND d.scheduled_at IS NULL AND d.published_at IS NULL
  ),'[]'::jsonb);
END
$function$;
COMMIT;
