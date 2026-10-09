-- R3 additive phone reads. Rollback receipts: goal-runs/inbox-phone-oxygen-2026-10-09/R3-ROLLBACK.sql.
-- Each statement is applied separately. Concurrent indexes cannot run inside a transaction.

CREATE INDEX CONCURRENTLY inbox_r3_warm_lane_idx ON public.outreach_prospects ((enrichment_data->>'lane')) WHERE blacklisted=false;

CREATE INDEX CONCURRENTLY inbox_r3_warm_view_idx ON public.outreach_prospects (trigger_type,created_at) WHERE blacklisted=false;

CREATE VIEW public.inbox_phone_replacement_r3 WITH (security_invoker=true) AS  WITH ivan_candidates AS MATERIALIZED (
 SELECT pr.scored_at,pr.icp_score,c.name FROM public.outreach_prospects pr
 JOIN public.outreach_campaigns c ON c.id=pr.campaign_id
 WHERE coalesce(c.client_id,'ivan')='ivan' AND NOT coalesce(pr.blacklisted,false)
 AND pr.scored_at >= now()-interval '30 days'
), rise_candidates AS MATERIALIZED (
 SELECT pr.scored_at,pr.enrichment_data,pr.stage,c.name,coalesce(c.client_id,'ivan') client_id
 FROM public.outreach_prospects pr JOIN public.outreach_campaigns c ON c.id=pr.campaign_id
 WHERE coalesce(c.client_id,'ivan') NOT IN ('ivan','arch') AND NOT coalesce(pr.blacklisted,false)
 AND pr.scored_at >= now()-interval '30 days'
), arch_candidates AS MATERIALIZED (
 SELECT e.promoted_at,e.reviewed_ok,e.reviewed_at,e.lane,pr.skip_state,c.name FROM public.outreach_prospects pr
 JOIN public.outreach_campaigns c ON c.id=pr.campaign_id
 CROSS JOIN LATERAL jsonb_to_record(pr.enrichment_data) AS e(promoted_at text,reviewed_ok text,reviewed_at text,lane text)
 WHERE c.client_id='arch' AND NOT coalesce(pr.blacklisted,false) AND pr.skip_state IS NULL
), qualified AS (
 SELECT 'ivan'::text client_id,public.lane_of(name) lane,scored_at::date AS day
 FROM ivan_candidates WHERE icp_score >= CASE WHEN public.lane_of(name)='cold' THEN 7 ELSE 6 END
 UNION ALL
 SELECT client_id,public.lane_of(name),scored_at::date FROM rise_candidates
 WHERE enrichment_data->>'rise_note_final' IS NOT NULL AND (
 coalesce(enrichment_data->'name_gate'->>'status','') IN ('auto_armed','armed_by_ivan') OR
 coalesce(enrichment_data->'name_gate'->'prior'->>'status','') IN ('auto_armed','armed_by_ivan') OR
 stage IN ('connection_sent','connected','dm_sent','replied'))
 UNION ALL
 SELECT 'arch',public.lane_of(name),(coalesce(promoted_at,CASE WHEN reviewed_ok='true' THEN reviewed_at END))::timestamptz::date
 FROM arch_candidates WHERE lane IS NOT NULL
 AND coalesce(promoted_at,CASE WHEN reviewed_ok='true' THEN reviewed_at END) IS NOT NULL
 AND (coalesce(promoted_at,CASE WHEN reviewed_ok='true' THEN reviewed_at END))::timestamptz >= now()-interval '30 days'
), inflow AS (
 SELECT client_id,lane,day,count(*) qualified_in FROM qualified GROUP BY client_id,lane,day
), outflow AS (
         SELECT COALESCE(c.client_id, 'ivan'::text) AS client_id,
            lane_of(c.name) AS lane,
            (s.sent_at)::date AS day,
            count(*) AS sent_out
           FROM ((( SELECT DISTINCT ON (m.prospect_id, m.message_text, m.sent_at) m.prospect_id,
                    m.sent_at
                   FROM outreach_messages m
                  WHERE ((m.direction = 'outbound'::text) AND (m.message_type = 'connection_note'::text) AND (m.sent_at IS NOT NULL) AND (m.sent_at >= (now() - '30 days'::interval)))
                  ORDER BY m.prospect_id, m.message_text, m.sent_at, m.id) s
             JOIN outreach_prospects pr ON ((pr.id = s.prospect_id)))
             JOIN outreach_campaigns c ON ((c.id = pr.campaign_id)))
          GROUP BY COALESCE(c.client_id, 'ivan'::text), (lane_of(c.name)), ((s.sent_at)::date)
        )
 SELECT COALESCE(i.client_id, o.client_id) AS client_id,
    COALESCE(i.lane, o.lane) AS lane,
    COALESCE(i.day, o.day) AS day,
    COALESCE(i.qualified_in, (0)::bigint) AS qualified_in,
    COALESCE(o.sent_out, (0)::bigint) AS sent_out
   FROM (inflow i
     FULL JOIN outflow o ON (((i.client_id = o.client_id) AND (i.lane = o.lane) AND (i.day = o.day))));

REVOKE ALL ON public.inbox_phone_replacement_r3 FROM PUBLIC,anon;

GRANT SELECT ON public.inbox_phone_replacement_r3 TO authenticated;

CREATE FUNCTION public.inbox_phone_lanes_pick_r3(p_keys text[] DEFAULT ARRAY['cc'::text, 'gov'::text, 'outcomes'::text, 'health'::text, 'perf'::text, 'pipeline'::text, 'replacement'::text])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$ DECLARE result jsonb:='{}'::jsonb; v jsonb; BEGIN 
IF 'cc'=ANY(p_keys) THEN BEGIN v:=NULL; BEGIN SELECT payload INTO v FROM public.campaign_control_latest_v WHERE kind='operator' LIMIT 1; EXCEPTION WHEN OTHERS THEN v:=NULL; END; IF v IS NULL THEN SELECT payload INTO v FROM public.campaign_control_snapshots WHERE kind='operator' ORDER BY generated_at DESC LIMIT 1; END IF; IF v IS NULL THEN RAISE EXCEPTION 'no snapshot row'; END IF; IF jsonb_typeof(v#>'{ranges,rows}')='array' THEN v:=jsonb_set(v,'{ranges,rows}',(SELECT coalesce(jsonb_agg(r-'rule_changes'),'[]'::jsonb) FROM jsonb_array_elements(v#>'{ranges,rows}')r)); END IF; result:=result||jsonb_build_object('cc',jsonb_build_object('value',v,'error',NULL)); EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_object('cc',jsonb_build_object('value',NULL,'error',SQLERRM)); END; END IF;
IF 'gov'=ANY(p_keys) THEN BEGIN v:=NULL; SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) INTO v FROM public.inbox_governor() g; result:=result||jsonb_build_object('gov',jsonb_build_object('value',v,'error',NULL)); EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_object('gov',jsonb_build_object('value',NULL,'error',SQLERRM)); END; END IF;
IF 'outcomes'=ANY(p_keys) THEN BEGIN v:=NULL; SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) INTO v FROM public.inbox_outcomes_v g; result:=result||jsonb_build_object('outcomes',jsonb_build_object('value',v,'error',NULL)); EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_object('outcomes',jsonb_build_object('value',NULL,'error',SQLERRM)); END; END IF;
IF 'health'=ANY(p_keys) THEN BEGIN v:=NULL; SELECT value::jsonb INTO STRICT v FROM public.integration_config WHERE key='seat_health_summary'; IF v IS NULL THEN RAISE EXCEPTION 'no seat health summary'; END IF; result:=result||jsonb_build_object('health',jsonb_build_object('value',v,'error',NULL)); EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_object('health',jsonb_build_object('value',NULL,'error',SQLERRM)); END; END IF;
IF 'perf'=ANY(p_keys) THEN BEGIN v:=NULL; SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) INTO v FROM public.inbox_campaign_perf_v g; result:=result||jsonb_build_object('perf',jsonb_build_object('value',v,'error',NULL)); EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_object('perf',jsonb_build_object('value',NULL,'error',SQLERRM)); END; END IF;
IF 'pipeline'=ANY(p_keys) THEN BEGIN v:=NULL; SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) INTO v FROM public.inbox_pipeline_v g; result:=result||jsonb_build_object('pipeline',jsonb_build_object('value',v,'error',NULL)); EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_object('pipeline',jsonb_build_object('value',NULL,'error',SQLERRM)); END; END IF;
IF 'replacement'=ANY(p_keys) THEN BEGIN v:=NULL; SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) INTO v FROM public.inbox_phone_replacement_r3 g; result:=result||jsonb_build_object('replacement',jsonb_build_object('value',v,'error',NULL)); EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_object('replacement',jsonb_build_object('value','[]'::jsonb,'error',NULL)); END; END IF;
RETURN result; END; $function$;

REVOKE ALL ON FUNCTION public.inbox_phone_lanes_pick_r3(text[]) FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION public.inbox_phone_lanes_pick_r3(text[]) TO authenticated;

CREATE FUNCTION public.inbox_phone_ready_page_r3(p_campaign_ids uuid[],p_now timestamptz,p_offset integer DEFAULT 0,p_limit integer DEFAULT 1000) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $r3$ WITH candidates AS MATERIALIZED (
 SELECT * FROM public.outreach_prospects
 WHERE campaign_id=ANY(p_campaign_ids) AND blacklisted=false AND connected_at IS NULL
 AND ((connection_sent_at IS NULL AND stage IN ('enriched','identified','queued','dm_sent','inmail_ready'))
 OR (skip_reason='invite_withdrawn_stale' AND icp_score>=7 AND reply_count=0
 AND connection_sent_at <= p_now-interval '42 days'
 AND campaign_id IN ('0aaf1db1-4cdc-41f6-a033-87fdde6eb78e'::uuid,'7695d36d-df7e-4344-9ec5-a206b5dbfab0'::uuid,'62f37ffd-7f9d-4a55-ab1e-c14f687c028f'::uuid)))
 ORDER BY id OFFSET greatest(p_offset,0) LIMIT least(greatest(p_limit,1),1000)
), projected AS (
 SELECT p.id,p.campaign_id,p.stage,p.icp_score,p.trigger_type,p.trigger_confidence,p.scorer_version,p.country,p.preferred_channel,p.connection_sent_at,p.connected_at,p.last_dm_sent_at,p.liveness_checked_at,p.created_at,p.skip_state,p.skip_reason,p.reply_count,p.note_variant,p.hypertarget_reserved,p.company_domain,p.next_touch_after,p.call_booked_at,p.needs_manual_reply,p.recycled_at,p.last_reply_at,p.dm_count, e.lane AS ed_lane,e.signal_approved_at AS sig_ok,e.signal_note_final AS sig_note,e.rise_note_final AS rise_note,e.anchor_client AS anchor,e.name_gate->>'status' AS gate,
e.partner_lane AS partner,e.expansion->>'colleague_first' AS colleague,e.invite_refused->>'last_at' AS refused,e.source_kind AS src,e.icp_floor_waived AS waived,e.lang_hold,e.copy_hold FROM candidates p
 CROSS JOIN LATERAL jsonb_to_record(p.enrichment_data) e(lane text,signal_approved_at text,signal_note_final text,rise_note_final text,anchor_client text,name_gate jsonb,partner_lane text,expansion jsonb,invite_refused jsonb,source_kind text,icp_floor_waived text,lang_hold text,copy_hold text)
) SELECT coalesce(jsonb_agg(to_jsonb(projected) ORDER BY id),'[]'::jsonb) FROM projected $r3$;

REVOKE ALL ON FUNCTION public.inbox_phone_ready_page_r3(uuid[],timestamptz,integer,integer) FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION public.inbox_phone_ready_page_r3(uuid[],timestamptz,integer,integer) TO authenticated;

-- Five-minute saved summary. All rows retain their own client_id. Live monitor and governor are never cached.
CREATE TABLE public.inbox_phone_lanes_cache_r3 (slot text PRIMARY KEY CHECK(slot IN ('perf','outcomes','pipeline','replacement')), payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='array'), generated_at timestamptz NOT NULL);

ALTER TABLE public.inbox_phone_lanes_cache_r3 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.inbox_phone_lanes_cache_r3 FROM PUBLIC,anon,authenticated;

GRANT SELECT ON public.inbox_phone_lanes_cache_r3 TO authenticated;

GRANT ALL ON public.inbox_phone_lanes_cache_r3 TO service_role;

CREATE POLICY inbox_phone_lanes_cache_read_r3 ON public.inbox_phone_lanes_cache_r3 FOR SELECT TO authenticated USING (true);

CREATE FUNCTION public.inbox_phone_refresh_lanes_r3() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET statement_timeout='10s' AS $r3$
DECLARE result jsonb; k text; stamp timestamptz:=statement_timestamp();
BEGIN
 result:=public.inbox_phone_lanes_pick_r3(ARRAY['perf','outcomes','pipeline','replacement']);
 FOREACH k IN ARRAY ARRAY['perf','outcomes','pipeline','replacement'] LOOP
  IF result->k->>'error' IS NOT NULL OR jsonb_typeof(result->k->'value') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'summary refresh failed: %',k; END IF;
  INSERT INTO public.inbox_phone_lanes_cache_r3 VALUES(k,result->k->'value',stamp)
   ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload,generated_at=excluded.generated_at;
 END LOOP;
 RETURN jsonb_build_object('generated_at',stamp,'slots',result);
END;$r3$;

REVOKE ALL ON FUNCTION public.inbox_phone_refresh_lanes_r3() FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.inbox_phone_refresh_lanes_r3() TO service_role;

CREATE FUNCTION public.inbox_phone_lanes_cached_r3(p_keys text[],p_fresh boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $r3$
DECLARE result jsonb:='{}'; k text; hit public.inbox_phone_lanes_cache_r3; direct_keys text[]:=ARRAY[]::text[];
BEGIN
 FOREACH k IN ARRAY p_keys LOOP
  hit:=NULL;
  IF NOT p_fresh AND k=ANY(ARRAY['perf','outcomes','pipeline','replacement']) THEN
   SELECT * INTO hit FROM public.inbox_phone_lanes_cache_r3 WHERE slot=k AND generated_at>=now()-interval '15 minutes';
  END IF;
  IF hit.generated_at IS NULL THEN direct_keys:=array_append(direct_keys,k);
  ELSE result:=result||jsonb_build_object(k,jsonb_build_object('value',hit.payload,'error',NULL,'generated_at',hit.generated_at,'from_cache',true)); END IF;
 END LOOP;
 IF cardinality(direct_keys)>0 THEN result:=result||public.inbox_phone_lanes_pick_r3(direct_keys); END IF;
 RETURN result;
END;$r3$;

REVOKE ALL ON FUNCTION public.inbox_phone_lanes_cached_r3(text[],boolean) FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION public.inbox_phone_lanes_cached_r3(text[],boolean) TO authenticated;

SELECT public.inbox_phone_refresh_lanes_r3();

SELECT cron.schedule('inbox-phone-lanes-r3','*/5 * * * *',$$SELECT public.inbox_phone_refresh_lanes_r3();$$);

-- Audit fix: use a checked source read for the scheduled refresh. The previous R3 job is retired.
CREATE FUNCTION public.inbox_phone_refresh_lanes_checked_r3() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET statement_timeout='10s' AS $r3$
DECLARE result jsonb; k text; v jsonb; stamp timestamptz:=statement_timestamp();
BEGIN
 result:=public.inbox_phone_lanes_pick_r3(ARRAY['perf','outcomes','pipeline']);
 -- Read the source directly so a query failure aborts this refresh and retains the old rows.
 SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO v FROM public.inbox_phone_replacement_r3 r;
 result:=result||jsonb_build_object('replacement',jsonb_build_object('value',v,'error',NULL));
 FOREACH k IN ARRAY ARRAY['perf','outcomes','pipeline','replacement'] LOOP
  IF result->k->>'error' IS NOT NULL OR jsonb_typeof(result->k->'value') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'summary refresh failed: %',k; END IF;
  INSERT INTO public.inbox_phone_lanes_cache_r3 VALUES(k,result->k->'value',stamp)
   ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload,generated_at=excluded.generated_at;
 END LOOP;
 RETURN jsonb_build_object('generated_at',stamp,'slots',result);
END;$r3$;

REVOKE ALL ON FUNCTION public.inbox_phone_refresh_lanes_checked_r3() FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.inbox_phone_refresh_lanes_checked_r3() TO service_role;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='inbox-phone-lanes-r3';

SELECT cron.schedule('inbox-phone-lanes-checked-r3','*/5 * * * *',$$SELECT public.inbox_phone_refresh_lanes_checked_r3();$$);

