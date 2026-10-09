-- R2 additive phone reads and service-only caches. Applied 2026-10-09 via Management API.
-- Original objects remain untouched. Authenticated readers retain source access/gate checks.

CREATE FUNCTION public.inbox_phone_copy_routes_r2(p_ids uuid[]) RETURNS TABLE(prospect_id uuid, copy_route text) LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $r2$ WITH ids AS (
         SELECT DISTINCT mm.prospect_id AS id
           FROM outreach_messages mm
             JOIN outreach_prospects pr ON pr.id = mm.prospect_id
             JOIN outreach_campaigns c ON c.id = pr.campaign_id
          WHERE c.client_id = 'arch'::text AND mm.prospect_id = ANY(p_ids)
        ), ap AS MATERIALIZED (
         SELECT pr.id,
            pr.stage,
            pr.company,
            pr.company_domain,
            pr.company_linkedin_url,
            pr.blacklisted,
            pr.skip_state,
            pr.last_reply_at,
            COALESCE(pr.reply_count, 0) AS reply_count,
            COALESCE(( SELECT jsonb_object_agg(e.key, e.value) AS jsonb_object_agg
                   FROM jsonb_each(pr.enrichment_data) e(key, value)
                  WHERE e.key = ANY (ARRAY['copy_vertical'::text, 'vertical'::text, 'gate'::text, 'company_vertical'::text, 'lane'::text, 'copy_hold'::text, 'lang_hold'::text, 'person_hold'::text, 'audit_url'::text, 'audit_sha'::text, 'audit_read_at'::text, 'audit_status'::text, 'game'::text, 'audit_company'::text, 'approach_evidence'::text, 'eu_logic'::text, 'channel'::text, 'arch_note_final'::text])), '{}'::jsonb) AS ed
           FROM outreach_prospects pr
             JOIN ids ON ids.id = pr.id
        ), mk AS MATERIALIZED (
         SELECT mm.prospect_id,
            mm.direction,
            mm.message_type,
            mm.ai_model,
            mm.message_text,
            COALESCE(mm.sent_at, mm.created_at) AS at,
            mm.sent_at IS NOT NULL AND mm.send_blocked_at IS NULL AS sent,
            mm.sent_at IS NULL AND mm.send_blocked_at IS NULL AS pending,
            _inbox_template_key(mm.ai_model, mm.draft_evidence) AS k
           FROM outreach_messages mm
             JOIN ids ON ids.id = mm.prospect_id
        ), mr AS MATERIALIZED (
         SELECT mk.prospect_id,
            mk.direction,
            mk.message_type,
            mk.ai_model,
            mk.at,
            mk.sent,
            mk.pending,
                CASE
                    WHEN mk.direction = 'outbound'::text THEN _inbox_message_route(mk.k, mk.ai_model, mk.message_type, mk.message_text)
                    ELSE NULL::text
                END AS route
           FROM mk
        ), agg AS (
         SELECT mr.prospect_id,
                CASE
                    WHEN bool_or(mr.sent AND mr.route = 'eu_expansion'::text) THEN 'eu_expansion'::text
                    WHEN bool_or(mr.sent AND mr.route = 'audit_offer'::text) THEN 'audit_offer'::text
                    WHEN bool_or(mr.sent AND mr.route = 'sponsor_door'::text) THEN 'sponsor_door'::text
                    WHEN bool_or(mr.sent AND (mr.route = ANY (ARRAY['apps'::text, 'games'::text, 'pc'::text, 'd2c'::text]))) THEN (array_agg(mr.route ORDER BY mr.at) FILTER (WHERE mr.sent AND (mr.route = ANY (ARRAY['apps'::text, 'games'::text, 'pc'::text, 'd2c'::text]))))[1]
                    WHEN bool_or(mr.sent AND mr.route = 'generic'::text) THEN 'generic'::text
                    WHEN bool_or(mr.sent AND mr.route = 'ladder'::text) THEN 'ladder'::text
                    WHEN bool_or(mr.sent AND mr.route = 'custom'::text) THEN 'custom'::text
                    ELSE NULL::text
                END AS sent_route,
                CASE
                    WHEN bool_or(mr.pending AND mr.route = 'eu_expansion'::text) THEN 'eu_expansion'::text
                    WHEN bool_or(mr.pending AND mr.route = 'audit_offer'::text) THEN 'audit_offer'::text
                    WHEN bool_or(mr.pending AND mr.route = 'sponsor_door'::text) THEN 'sponsor_door'::text
                    WHEN bool_or(mr.pending AND (mr.route = ANY (ARRAY['apps'::text, 'games'::text, 'pc'::text, 'd2c'::text]))) THEN (array_agg(mr.route ORDER BY mr.at) FILTER (WHERE mr.pending AND (mr.route = ANY (ARRAY['apps'::text, 'games'::text, 'pc'::text, 'd2c'::text]))))[1]
                    WHEN bool_or(mr.pending AND mr.route = 'generic'::text) THEN 'generic'::text
                    WHEN bool_or(mr.pending AND mr.route = 'ladder'::text) THEN 'ladder'::text
                    WHEN bool_or(mr.pending AND mr.route = 'custom'::text) THEN 'custom'::text
                    ELSE NULL::text
                END AS draft_route,
            (array_agg(_inbox_note_arm(mr.ai_model) ORDER BY mr.at) FILTER (WHERE mr.sent AND mr.direction = 'outbound'::text AND mr.message_type = 'connection_note'::text))[1] AS note,
            bool_or(mr.sent AND mr.direction = 'outbound'::text AND mr.message_type = 'connection_note'::text) AS note_sent,
            bool_or(mr.direction = 'inbound'::text) AS has_inbound
           FROM mr
          GROUP BY mr.prospect_id
        ), f AS MATERIALIZED (
         SELECT ap.id,
            ap.stage,
            ap.company,
            ap.company_domain,
            ap.company_linkedin_url,
            ap.blacklisted,
            ap.skip_state,
            ap.last_reply_at,
            ap.reply_count,
            ap.ed,
            agg.sent_route,
            agg.draft_route,
            agg.note,
            COALESCE(agg.note_sent, false) AS note_sent,
            COALESCE(agg.has_inbound, false) OR ap.reply_count > 0 OR ap.last_reply_at IS NOT NULL AS replied,
            _inbox_copy_vertical(ap.ed) AS cv
           FROM ap
             JOIN agg ON agg.prospect_id = ap.id
        ), g AS (
         SELECT f.id,
            f.stage,
            f.company,
            f.company_domain,
            f.company_linkedin_url,
            f.blacklisted,
            f.skip_state,
            f.last_reply_at,
            f.reply_count,
            f.ed,
            f.sent_route,
            f.draft_route,
            f.note,
            f.note_sent,
            f.replied,
            f.cv,
            NOT COALESCE(f.blacklisted, false) AND f.skip_state IS NULL AND (COALESCE(f.ed ->> 'copy_hold'::text, ''::text) = ANY (ARRAY[''::text, 'false'::text, '0'::text])) AND (COALESCE(f.ed ->> 'lang_hold'::text, ''::text) = ANY (ARRAY[''::text, 'false'::text, '0'::text])) AND (COALESCE(f.ed ->> 'person_hold'::text, ''::text) = ANY (ARRAY[''::text, 'false'::text, '0'::text])) AND (COALESCE(f.stage, ''::text) <> ALL (ARRAY['replied'::text, 'archived'::text, 'ballot_hold'::text, 'disqualified'::text, 'skipped'::text])) AND (f.cv = ANY (ARRAY['apps'::text, 'games'::text, 'pc'::text])) AND COALESCE(f.ed ->> 'audit_url'::text, ''::text) ~ '^https://madebyarch\.com/[a-z0-9-]+-audit/$'::text AND COALESCE(f.ed ->> 'audit_sha'::text, ''::text) ~* '^[a-f0-9]{64}$'::text AND _inbox_try_ts(f.ed ->> 'audit_read_at'::text) <= now() AND _inbox_try_ts(f.ed ->> 'audit_read_at'::text) >= (now() - '30 days'::interval) AND (COALESCE(f.ed ->> 'audit_status'::text, ''::text) <> ALL (ARRAY['insufficient_material'::text, 'research_failed'::text, 'build_failed'::text, 'build_pending'::text, 'config_needed'::text])) AND ("substring"(f.ed ->> 'audit_url'::text, '^https://madebyarch\.com/([a-z0-9-]+)-audit/$'::text) = _inbox_audit_slug(f.company) OR "substring"(f.ed ->> 'audit_url'::text, '^https://madebyarch\.com/([a-z0-9-]+)-audit/$'::text) = _inbox_audit_slug(f.ed ->> 'game'::text) OR "substring"(f.ed ->> 'audit_url'::text, '^https://madebyarch\.com/([a-z0-9-]+)-audit/$'::text) = _inbox_audit_slug(f.ed ->> 'audit_company'::text) OR "substring"(f.ed ->> 'audit_url'::text, '^https://madebyarch\.com/([a-z0-9-]+)-audit/$'::text) = _inbox_audit_slug(f.company_domain)) AND (EXISTS ( SELECT 1
                   FROM outreach_templates t
                  WHERE t.client_id = 'arch'::text AND t.in_rotation AND t.key = 'dm1_a'::text)) AS audit_ok,
            (f.cv = ANY (ARRAY['games'::text, 'pc'::text, 'apps'::text, 'd2c'::text])) AND (lower("substring"(COALESCE(f.company_linkedin_url, ''::text), '(?i)linkedin\.com/company/([^/?#]+)'::text)) = ANY (ARRAY['metacoregames'::text, 'whatnot-inc'::text])) AND (EXISTS ( SELECT 1
                   FROM outreach_templates t
                  WHERE t.client_id = 'arch'::text AND t.in_rotation AND t.key = 'dm1_eu_expansion'::text)) AND (( SELECT count(DISTINCT r.value ->> 'kind'::text) AS count
                   FROM jsonb_array_elements(
                        CASE
                            WHEN jsonb_typeof(f.ed -> 'approach_evidence'::text) = 'array'::text THEN f.ed -> 'approach_evidence'::text
                            ELSE '[]'::jsonb
                        END) r(value)
                  WHERE ((r.value ->> 'kind'::text) = ANY (ARRAY['us_creator_activity'::text, 'eu_product_availability'::text])) AND (r.value ->> 'company_key'::text) = lower("substring"(f.company_linkedin_url, '(?i)linkedin\.com/company/([^/?#]+)'::text)) AND (r.value ->> 'verified_by'::text) = 'operator_review'::text AND COALESCE(r.value ->> 'id'::text, ''::text) <> ''::text AND COALESCE(r.value ->> 'source_url'::text, ''::text) <> ''::text AND btrim(COALESCE(r.value ->> 'source_quote'::text, ''::text)) <> ''::text AND _inbox_try_ts(r.value ->> 'observed_at'::text) >= (now() - '90 days'::interval) AND _inbox_try_ts(r.value ->> 'observed_at'::text) <= now() AND _inbox_try_ts(r.value ->> 'checked_at'::text) >= (now() - '30 days'::interval) AND _inbox_try_ts(r.value ->> 'checked_at'::text) <= now())) = 2 AS eu_ok,
            NOT f.note_sent AND ((f.ed ->> 'lane'::text) = ANY (ARRAY['sponsor_team'::text, 'sponsor_mined'::text])) AND jsonb_typeof(f.ed -> 'eu_logic'::text) = 'boolean'::text AND NULLIF(btrim(COALESCE(f.ed ->> 'channel'::text, ''::text)), ''::text) IS NOT NULL AND COALESCE(NULLIF(btrim(f.ed ->> 'arch_note_final'::text), ''::text), ''::text) = ''::text AND ((POSITION((lower(substr(regexp_replace(f.id::text, '[^0-9a-fA-F]'::text, ''::text, 'g'::text), 30, 1))) IN ('0123456789abcdef'::text)) - 1) % 2) = 0 AS sponsor_ok
           FROM f
        )
 SELECT id AS prospect_id,
    min(
        CASE
            WHEN sent_route IS NOT NULL AND sent_route <> 'ladder'::text THEN 'sent:'::text || sent_route
            WHEN sent_route = 'ladder'::text THEN 'sent:'::text ||
            CASE
                WHEN cv = 'unknown'::text THEN 'custom'::text
                ELSE cv
            END
            WHEN draft_route IS NOT NULL AND draft_route <> 'ladder'::text THEN 'next:'::text || draft_route
            WHEN replied THEN 'next:custom'::text
            WHEN sponsor_ok THEN 'next:sponsor_door'::text
            WHEN cv = 'unknown'::text OR (COALESCE(ed ->> 'copy_hold'::text, ''::text) <> ALL (ARRAY[''::text, 'false'::text, '0'::text])) THEN 'next:hold'::text
            WHEN audit_ok THEN 'next:audit_offer'::text
            WHEN eu_ok THEN 'next:eu_expansion'::text
            ELSE 'next:'::text || cv
        END || COALESCE(':'::text || note, ''::text)) AS copy_route
   FROM g
  GROUP BY id $r2$;

REVOKE ALL ON FUNCTION public.inbox_phone_copy_routes_r2(uuid[]) FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION public.inbox_phone_copy_routes_r2(uuid[]) TO authenticated;

CREATE FUNCTION public.inbox_phone_rows_r2(p_ids uuid[]) RETURNS SETOF public.inbox_messages_v LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $r2$ SELECT m.id,
    m.prospect_id,
    m.direction,
    m.message_text,
    m.message_type,
    COALESCE(m.channel, 'linkedin'::text) AS channel,
    m.sent_at,
    m.approved_at,
    m.read_at,
    m.created_at,
    m.send_blocked_at,
    m.send_blocked_reason,
    m.unipile_chat_id,
    m.ai_model,
    p.name AS prospect_name,
    p.company AS prospect_company,
    p.headline AS prospect_headline,
    p.stage AS prospect_stage,
    p.email AS prospect_email,
    p.profile_photo_url,
    c.name AS campaign_name,
    COALESCE(c.client_id, 'ivan'::text) AS client_id,
    m.snoozed_until,
    m.snoozed_at,
    p.linkedin_url AS prospect_linkedin_url,
    COALESCE(uc.provider_id, ua.provider_id) AS chat_provider_id,
    p.skip_reason AS prospect_skip_reason,
    m.reply_intent,
    p.blacklisted AS prospect_blacklisted,
    (p.enrichment_data ->> 'lane'::text) AS lane,
    acr.copy_route,
    lane_of(c.name) AS campaign_lane,
    m.discard_mode
   FROM (((((outreach_messages m
     JOIN outreach_prospects p ON ((p.id = m.prospect_id)))
     JOIN outreach_campaigns c ON ((c.id = p.campaign_id)))
     LEFT JOIN unipile_chats uc ON ((uc.chat_id = m.unipile_chat_id)))
     LEFT JOIN LATERAL ( SELECT x.provider_id
           FROM unipile_chats x
          WHERE ((x.attendee_provider_id IS NOT NULL) AND (x.attendee_provider_id = p.linkedin_profile_id))
         LIMIT 1) ua ON (true))
     LEFT JOIN public.inbox_phone_copy_routes_r2(p_ids) acr ON ((acr.prospect_id = m.prospect_id)))
 WHERE m.prospect_id = ANY(p_ids) $r2$;

REVOKE ALL ON FUNCTION public.inbox_phone_rows_r2(uuid[]) FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION public.inbox_phone_rows_r2(uuid[]) TO authenticated;

CREATE FUNCTION public.inbox_phone_priority_r2() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $r2$
WITH ids AS MATERIALIZED (
 SELECT DISTINCT prospect_id FROM public.outreach_messages
 WHERE (created_at >= now()-interval '15 days' AND (direction='inbound' OR (direction='outbound' AND sent_at IS NULL AND approved_at IS NULL)))
 OR (direction='outbound' AND sent_at IS NULL AND approved_at IS NULL AND send_blocked_reason IN ('owner_confirmation','reply_retry_pending'))
 OR snoozed_until IS NOT NULL
 UNION SELECT id FROM public.outreach_prospects WHERE next_touch_after <= now()+interval '72 hours'
 UNION SELECT prospect_id FROM public.outreach_messages WHERE direction='outbound' AND sent_at >= now()-interval '15 days'
), rows AS (SELECT r.* FROM public.inbox_phone_rows_r2(ARRAY(SELECT prospect_id FROM ids)) r)
SELECT coalesce(jsonb_agg(to_jsonb(rows) ORDER BY created_at,id),'[]'::jsonb) FROM rows;
$r2$;

REVOKE ALL ON FUNCTION public.inbox_phone_priority_r2() FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION public.inbox_phone_priority_r2() TO authenticated;

CREATE FUNCTION public.inbox_phone_messages_page_r2(p_offset integer DEFAULT 0, p_limit integer DEFAULT 1000) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $r2$
WITH chosen AS MATERIALIZED (
 SELECT m.id,m.prospect_id,m.created_at FROM public.outreach_messages m
 JOIN public.outreach_prospects p ON p.id=m.prospect_id JOIN public.outreach_campaigns c ON c.id=p.campaign_id
 ORDER BY m.created_at DESC,m.id DESC LIMIT least(greatest(p_limit,0),1000) OFFSET greatest(p_offset,0)
), rows AS (SELECT r.* FROM public.inbox_phone_rows_r2(ARRAY(SELECT DISTINCT prospect_id FROM chosen)) r JOIN chosen c USING(id))
SELECT coalesce(jsonb_agg(to_jsonb(rows) ORDER BY created_at DESC,id DESC),'[]'::jsonb) FROM rows;
$r2$;

REVOKE ALL ON FUNCTION public.inbox_phone_messages_page_r2(integer,integer) FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION public.inbox_phone_messages_page_r2(integer,integer) TO authenticated;

CREATE FUNCTION public.inbox_phone_lanes_summary_r2() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $r2$ DECLARE result jsonb:='{}'::jsonb; v jsonb; BEGIN BEGIN v:=NULL; BEGIN SELECT payload INTO v FROM public.campaign_control_latest_v WHERE kind='operator' LIMIT 1; EXCEPTION WHEN OTHERS THEN v:=NULL; END; IF v IS NULL THEN SELECT payload INTO v FROM public.campaign_control_snapshots WHERE kind='operator' ORDER BY generated_at DESC LIMIT 1; END IF; IF v IS NULL THEN RAISE EXCEPTION 'no snapshot row'; END IF; result:=result||jsonb_build_object('cc',jsonb_build_object('value',v,'error',NULL)); EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_object('cc',jsonb_build_object('value',NULL,'error',SQLERRM)); END;
BEGIN v:=NULL; SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) INTO v FROM public.inbox_governor() g; result:=result||jsonb_build_object('gov',jsonb_build_object('value',v,'error',NULL)); EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_object('gov',jsonb_build_object('value',NULL,'error',SQLERRM)); END;
BEGIN v:=NULL; SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) INTO v FROM public.inbox_outcomes_v g; result:=result||jsonb_build_object('outcomes',jsonb_build_object('value',v,'error',NULL)); EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_object('outcomes',jsonb_build_object('value',NULL,'error',SQLERRM)); END;
BEGIN v:=NULL; SELECT value::jsonb INTO STRICT v FROM public.integration_config WHERE key='seat_health_summary'; IF v IS NULL THEN RAISE EXCEPTION 'no seat health summary'; END IF; result:=result||jsonb_build_object('health',jsonb_build_object('value',v,'error',NULL)); EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_object('health',jsonb_build_object('value',NULL,'error',SQLERRM)); END;
BEGIN v:=NULL; SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) INTO v FROM public.inbox_campaign_perf_v g; result:=result||jsonb_build_object('perf',jsonb_build_object('value',v,'error',NULL)); EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_object('perf',jsonb_build_object('value',NULL,'error',SQLERRM)); END;
BEGIN v:=NULL; SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) INTO v FROM public.inbox_pipeline_v g; result:=result||jsonb_build_object('pipeline',jsonb_build_object('value',v,'error',NULL)); EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_object('pipeline',jsonb_build_object('value',NULL,'error',SQLERRM)); END;
BEGIN v:=NULL; SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) INTO v FROM public.inbox_replacement_v g; result:=result||jsonb_build_object('replacement',jsonb_build_object('value',v,'error',NULL)); EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_object('replacement',jsonb_build_object('value','[]'::jsonb,'error',NULL)); END;
RETURN result; END; $r2$;

REVOKE ALL ON FUNCTION public.inbox_phone_lanes_summary_r2() FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION public.inbox_phone_lanes_summary_r2() TO authenticated;

CREATE FUNCTION public.inbox_phone_lanes_quick_r2() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $r2$
DECLARE s jsonb; v jsonb;
BEGIN
 s:=public.inbox_phone_lanes_summary_r2();
 IF s->'cc'->>'error' IS NULL AND jsonb_typeof(s#>'{cc,value,ranges,rows}')='array' THEN
  SELECT coalesce(jsonb_agg(r - 'rule_changes'),'[]'::jsonb) INTO v FROM jsonb_array_elements(s#>'{cc,value,ranges,rows}') r;
  s:=jsonb_set(s,'{cc,value,ranges,rows}',v);
 END IF;
 RETURN s;
END $r2$;

REVOKE ALL ON FUNCTION public.inbox_phone_lanes_quick_r2() FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION public.inbox_phone_lanes_quick_r2() TO authenticated;

CREATE FUNCTION public.inbox_phone_first_rows_r2() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $r2$
WITH ids AS MATERIALIZED (
 SELECT DISTINCT prospect_id FROM public.outreach_messages
 WHERE (created_at >= now()-interval '15 days' AND (direction='inbound' OR (direction='outbound' AND sent_at IS NULL AND approved_at IS NULL)))
 OR (direction='outbound' AND sent_at IS NULL AND approved_at IS NULL AND send_blocked_reason IN ('owner_confirmation','reply_retry_pending'))
 OR snoozed_until IS NOT NULL
 UNION SELECT id FROM public.outreach_prospects WHERE next_touch_after <= now()+interval '72 hours'

), rows AS (SELECT r.* FROM public.inbox_phone_rows_r2(ARRAY(SELECT prospect_id FROM ids)) r)
SELECT coalesce(jsonb_agg(to_jsonb(rows) ORDER BY created_at,id),'[]'::jsonb) FROM rows;
$r2$;

REVOKE ALL ON FUNCTION public.inbox_phone_first_rows_r2() FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION public.inbox_phone_first_rows_r2() TO authenticated;

CREATE TABLE public.inbox_phone_ideas_cache_r2 (client_id text PRIMARY KEY CHECK(client_id IN ('ivan','risedtc','arch')),payload jsonb NOT NULL,ranked_at timestamptz NOT NULL);

ALTER TABLE public.inbox_phone_ideas_cache_r2 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.inbox_phone_ideas_cache_r2 FROM PUBLIC,anon,authenticated;

GRANT ALL ON public.inbox_phone_ideas_cache_r2 TO service_role;

CREATE FUNCTION public.inbox_phone_refresh_ideas_r2(p_client text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET statement_timeout='60s' AS $r2$ DECLARE seat text; result jsonb='{}'; val jsonb; BEGIN FOR seat IN SELECT unnest(CASE WHEN p_client IS NULL THEN ARRAY['ivan','risedtc','arch'] ELSE ARRAY[p_client] END) LOOP val:=public.operator_ranked_ideas('clientops',seat); INSERT INTO public.inbox_phone_ideas_cache_r2 VALUES(seat,val,now()) ON CONFLICT(client_id) DO UPDATE SET payload=excluded.payload,ranked_at=excluded.ranked_at; result:=result||jsonb_build_object(seat,jsonb_array_length(val->'rows')); END LOOP;RETURN result; END;$r2$;

REVOKE ALL ON FUNCTION public.inbox_phone_refresh_ideas_r2(text) FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.inbox_phone_refresh_ideas_r2(text) TO service_role;

CREATE FUNCTION public.inbox_phone_ranked_ideas_r2(p_gate text,p_client text,p_fresh boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET statement_timeout='20s' AS $r2$ DECLARE hit public.inbox_phone_ideas_cache_r2; val jsonb; BEGIN IF NOT public.operator_gate_ok(p_gate) THEN RAISE EXCEPTION 'unauthorized'; END IF; IF p_client IS NULL OR p_client NOT IN ('ivan','risedtc','arch') OR NOT public.lane_allowed(p_client) THEN RAISE EXCEPTION 'unknown seat'; END IF; SELECT * INTO hit FROM public.inbox_phone_ideas_cache_r2 WHERE client_id=p_client; IF p_fresh OR hit.ranked_at IS NULL OR hit.ranked_at<now()-interval '1 hour' THEN val:=public.operator_ranked_ideas(p_gate,p_client); RETURN val||jsonb_build_object('ranked_at',now(),'from_cache',false); END IF; RETURN hit.payload||jsonb_build_object('ranked_at',hit.ranked_at,'from_cache',true); END;$r2$;

REVOKE ALL ON FUNCTION public.inbox_phone_ranked_ideas_r2(text,text,boolean) FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.inbox_phone_ranked_ideas_r2(text,text,boolean) TO authenticated;

CREATE TABLE public.inbox_phone_brief_cache_r2 (mode text NOT NULL CHECK(mode IN ('full','counts','spoken')),hour timestamptz NOT NULL,payload jsonb NOT NULL,generated_at timestamptz NOT NULL,PRIMARY KEY(mode,hour));

ALTER TABLE public.inbox_phone_brief_cache_r2 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.inbox_phone_brief_cache_r2 FROM PUBLIC,anon,authenticated;

GRANT ALL ON public.inbox_phone_brief_cache_r2 TO service_role;

SELECT cron.schedule('inbox-phone-ideas-r2','*/5 * * * *',$$SELECT public.inbox_phone_refresh_ideas_r2();$$);

CREATE FUNCTION public.inbox_phone_lanes_pick_r2(p_keys text[] DEFAULT ARRAY['cc','gov','outcomes','health','perf','pipeline','replacement']) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $r2$ DECLARE result jsonb:='{}'::jsonb; v jsonb; BEGIN 
IF 'cc'=ANY(p_keys) THEN BEGIN v:=NULL; BEGIN SELECT payload INTO v FROM public.campaign_control_latest_v WHERE kind='operator' LIMIT 1; EXCEPTION WHEN OTHERS THEN v:=NULL; END; IF v IS NULL THEN SELECT payload INTO v FROM public.campaign_control_snapshots WHERE kind='operator' ORDER BY generated_at DESC LIMIT 1; END IF; IF v IS NULL THEN RAISE EXCEPTION 'no snapshot row'; END IF; IF jsonb_typeof(v#>'{ranges,rows}')='array' THEN v:=jsonb_set(v,'{ranges,rows}',(SELECT coalesce(jsonb_agg(r-'rule_changes'),'[]'::jsonb) FROM jsonb_array_elements(v#>'{ranges,rows}')r)); END IF; result:=result||jsonb_build_object('cc',jsonb_build_object('value',v,'error',NULL)); EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_object('cc',jsonb_build_object('value',NULL,'error',SQLERRM)); END; END IF;
IF 'gov'=ANY(p_keys) THEN BEGIN v:=NULL; SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) INTO v FROM public.inbox_governor() g; result:=result||jsonb_build_object('gov',jsonb_build_object('value',v,'error',NULL)); EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_object('gov',jsonb_build_object('value',NULL,'error',SQLERRM)); END; END IF;
IF 'outcomes'=ANY(p_keys) THEN BEGIN v:=NULL; SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) INTO v FROM public.inbox_outcomes_v g; result:=result||jsonb_build_object('outcomes',jsonb_build_object('value',v,'error',NULL)); EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_object('outcomes',jsonb_build_object('value',NULL,'error',SQLERRM)); END; END IF;
IF 'health'=ANY(p_keys) THEN BEGIN v:=NULL; SELECT value::jsonb INTO STRICT v FROM public.integration_config WHERE key='seat_health_summary'; IF v IS NULL THEN RAISE EXCEPTION 'no seat health summary'; END IF; result:=result||jsonb_build_object('health',jsonb_build_object('value',v,'error',NULL)); EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_object('health',jsonb_build_object('value',NULL,'error',SQLERRM)); END; END IF;
IF 'perf'=ANY(p_keys) THEN BEGIN v:=NULL; SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) INTO v FROM public.inbox_campaign_perf_v g; result:=result||jsonb_build_object('perf',jsonb_build_object('value',v,'error',NULL)); EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_object('perf',jsonb_build_object('value',NULL,'error',SQLERRM)); END; END IF;
IF 'pipeline'=ANY(p_keys) THEN BEGIN v:=NULL; SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) INTO v FROM public.inbox_pipeline_v g; result:=result||jsonb_build_object('pipeline',jsonb_build_object('value',v,'error',NULL)); EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_object('pipeline',jsonb_build_object('value',NULL,'error',SQLERRM)); END; END IF;
IF 'replacement'=ANY(p_keys) THEN BEGIN v:=NULL; SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) INTO v FROM public.inbox_replacement_v g; result:=result||jsonb_build_object('replacement',jsonb_build_object('value',v,'error',NULL)); EXCEPTION WHEN OTHERS THEN result:=result||jsonb_build_object('replacement',jsonb_build_object('value','[]'::jsonb,'error',NULL)); END; END IF;
RETURN result; END; $r2$;

REVOKE ALL ON FUNCTION public.inbox_phone_lanes_pick_r2(text[]) FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION public.inbox_phone_lanes_pick_r2(text[]) TO authenticated;

SELECT public.inbox_phone_refresh_ideas_r2();
