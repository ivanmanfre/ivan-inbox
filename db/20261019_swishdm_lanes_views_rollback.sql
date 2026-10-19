-- Rollback of 20261019_swishdm_lanes_views.sql: the three definitions exactly as read live on 2026-10-19 before it ran.
BEGIN;
CREATE OR REPLACE VIEW public.inbox_outcomes_v WITH (security_invoker=on) AS
WITH convos AS (
         SELECT COALESCE(c.client_id, 'ivan'::text) AS client_id,
            m.prospect_id,
            min(COALESCE(m.sent_at, m.created_at)) AS first_reply_at
           FROM outreach_messages m
             JOIN outreach_prospects p ON p.id = m.prospect_id
             JOIN outreach_campaigns c ON c.id = p.campaign_id
          WHERE m.direction = 'inbound'::text AND COALESCE(p.blacklisted, false) = false
          GROUP BY (COALESCE(c.client_id, 'ivan'::text)), m.prospect_id
        ), convos_era AS (
         SELECT convos.client_id,
            convos.prospect_id,
            convos.first_reply_at
           FROM convos
          WHERE NOT (convos.client_id = 'ivan'::text AND convos.first_reply_at < '2026-07-11 00:00:00+00'::timestamp with time zone)
        ), calls AS (
         SELECT COALESCE(c.client_id, 'ivan'::text) AS client_id,
            p.call_booked_at
           FROM outreach_prospects p
             JOIN outreach_campaigns c ON c.id = p.campaign_id
          WHERE p.call_booked_at IS NOT NULL
        )
 SELECT COALESCE(cv.client_id, ca.client_id) AS client_id,
    COALESCE(cv.convos_7d, 0::bigint) AS convos_7d,
    COALESCE(cv.convos_30d, 0::bigint) AS convos_30d,
    COALESCE(cv.convos_total, 0::bigint) AS convos_total,
    COALESCE(ca.calls_7d, 0::bigint) AS calls_7d,
    COALESCE(ca.calls_30d, 0::bigint) AS calls_30d,
    COALESCE(ca.calls_total, 0::bigint) AS calls_total
   FROM ( SELECT convos_era.client_id,
            count(*) FILTER (WHERE convos_era.first_reply_at >= (now() - '7 days'::interval)) AS convos_7d,
            count(*) FILTER (WHERE convos_era.first_reply_at >= (now() - '30 days'::interval)) AS convos_30d,
            count(*) AS convos_total
           FROM convos_era
          GROUP BY convos_era.client_id) cv
     FULL JOIN ( SELECT calls.client_id,
            count(*) FILTER (WHERE calls.call_booked_at >= (now() - '7 days'::interval)) AS calls_7d,
            count(*) FILTER (WHERE calls.call_booked_at >= (now() - '30 days'::interval)) AS calls_30d,
            count(*) AS calls_total
           FROM calls
          GROUP BY calls.client_id) ca USING (client_id);

CREATE OR REPLACE VIEW public.inbox_phone_replacement_r3 WITH (security_invoker=true) AS
WITH ivan_candidates AS MATERIALIZED (
         SELECT pr.scored_at,
            pr.icp_score,
            c.name
           FROM outreach_prospects pr
             JOIN outreach_campaigns c ON c.id = pr.campaign_id
          WHERE COALESCE(c.client_id, 'ivan'::text) = 'ivan'::text AND NOT COALESCE(pr.blacklisted, false) AND pr.scored_at >= (now() - '30 days'::interval)
        ), rise_candidates AS MATERIALIZED (
         SELECT pr.scored_at,
            pr.enrichment_data,
            pr.stage,
            c.name,
            COALESCE(c.client_id, 'ivan'::text) AS client_id
           FROM outreach_prospects pr
             JOIN outreach_campaigns c ON c.id = pr.campaign_id
          WHERE (COALESCE(c.client_id, 'ivan'::text) <> ALL (ARRAY['ivan'::text, 'arch'::text])) AND NOT COALESCE(pr.blacklisted, false) AND pr.scored_at >= (now() - '30 days'::interval)
        ), arch_candidates AS MATERIALIZED (
         SELECT e.promoted_at,
            e.reviewed_ok,
            e.reviewed_at,
            e.lane,
            pr.skip_state,
            c.name
           FROM outreach_prospects pr
             JOIN outreach_campaigns c ON c.id = pr.campaign_id
             CROSS JOIN LATERAL jsonb_to_record(pr.enrichment_data) e(promoted_at text, reviewed_ok text, reviewed_at text, lane text)
          WHERE c.client_id = 'arch'::text AND NOT COALESCE(pr.blacklisted, false) AND pr.skip_state IS NULL
        ), qualified AS (
         SELECT 'ivan'::text AS client_id,
            lane_of(ivan_candidates.name) AS lane,
            ivan_candidates.scored_at::date AS day
           FROM ivan_candidates
          WHERE ivan_candidates.icp_score >=
                CASE
                    WHEN lane_of(ivan_candidates.name) = 'cold'::text THEN 7
                    ELSE 6
                END
        UNION ALL
         SELECT rise_candidates.client_id,
            lane_of(rise_candidates.name) AS lane_of,
            rise_candidates.scored_at::date AS scored_at
           FROM rise_candidates
          WHERE (rise_candidates.enrichment_data ->> 'rise_note_final'::text) IS NOT NULL AND ((COALESCE((rise_candidates.enrichment_data -> 'name_gate'::text) ->> 'status'::text, ''::text) = ANY (ARRAY['auto_armed'::text, 'armed_by_ivan'::text])) OR (COALESCE(((rise_candidates.enrichment_data -> 'name_gate'::text) -> 'prior'::text) ->> 'status'::text, ''::text) = ANY (ARRAY['auto_armed'::text, 'armed_by_ivan'::text])) OR (rise_candidates.stage = ANY (ARRAY['connection_sent'::text, 'connected'::text, 'dm_sent'::text, 'replied'::text])))
        UNION ALL
         SELECT 'arch'::text,
            lane_of(arch_candidates.name) AS lane_of,
            COALESCE(arch_candidates.promoted_at,
                CASE
                    WHEN arch_candidates.reviewed_ok = 'true'::text THEN arch_candidates.reviewed_at
                    ELSE NULL::text
                END)::timestamp with time zone::date AS "coalesce"
           FROM arch_candidates
          WHERE arch_candidates.lane IS NOT NULL AND COALESCE(arch_candidates.promoted_at,
                CASE
                    WHEN arch_candidates.reviewed_ok = 'true'::text THEN arch_candidates.reviewed_at
                    ELSE NULL::text
                END) IS NOT NULL AND COALESCE(arch_candidates.promoted_at,
                CASE
                    WHEN arch_candidates.reviewed_ok = 'true'::text THEN arch_candidates.reviewed_at
                    ELSE NULL::text
                END)::timestamp with time zone >= (now() - '30 days'::interval)
        ), inflow AS (
         SELECT qualified.client_id,
            qualified.lane,
            qualified.day,
            count(*) AS qualified_in
           FROM qualified
          GROUP BY qualified.client_id, qualified.lane, qualified.day
        ), outflow AS (
         SELECT COALESCE(c.client_id, 'ivan'::text) AS client_id,
            lane_of(c.name) AS lane,
            s.sent_at::date AS day,
            count(*) AS sent_out
           FROM ( SELECT DISTINCT ON (m.prospect_id, m.message_text, m.sent_at) m.prospect_id,
                    m.sent_at
                   FROM outreach_messages m
                  WHERE m.direction = 'outbound'::text AND m.message_type = 'connection_note'::text AND m.sent_at IS NOT NULL AND m.sent_at >= (now() - '30 days'::interval)
                  ORDER BY m.prospect_id, m.message_text, m.sent_at, m.id) s
             JOIN outreach_prospects pr ON pr.id = s.prospect_id
             JOIN outreach_campaigns c ON c.id = pr.campaign_id
          GROUP BY (COALESCE(c.client_id, 'ivan'::text)), (lane_of(c.name)), (s.sent_at::date)
        )
 SELECT COALESCE(i.client_id, o.client_id) AS client_id,
    COALESCE(i.lane, o.lane) AS lane,
    COALESCE(i.day, o.day) AS day,
    COALESCE(i.qualified_in, 0::bigint) AS qualified_in,
    COALESCE(o.sent_out, 0::bigint) AS sent_out
   FROM inflow i
     FULL JOIN outflow o ON i.client_id = o.client_id AND i.lane = o.lane AND i.day = o.day;

CREATE OR REPLACE VIEW public.inbox_replacement_v AS
WITH inflow AS (
         SELECT COALESCE(c.client_id, 'ivan'::text) AS client_id,
            lane_of(c.name) AS lane,
                CASE
                    WHEN COALESCE(c.client_id, 'ivan'::text) = 'arch'::text THEN COALESCE(pr.enrichment_data ->> 'promoted_at'::text,
                    CASE
                        WHEN (pr.enrichment_data ->> 'reviewed_ok'::text) = 'true'::text THEN pr.enrichment_data ->> 'reviewed_at'::text
                        ELSE NULL::text
                    END)::timestamp with time zone::date
                    ELSE pr.scored_at::date
                END AS day,
            count(*) AS qualified_in
           FROM outreach_prospects pr
             JOIN outreach_campaigns c ON c.id = pr.campaign_id
          WHERE COALESCE(pr.blacklisted, false) = false AND
                CASE
                    WHEN COALESCE(c.client_id, 'ivan'::text) = 'ivan'::text THEN pr.scored_at IS NOT NULL AND pr.scored_at >= (now() - '30 days'::interval) AND pr.icp_score >=
                    CASE
                        WHEN lane_of(c.name) = 'cold'::text THEN 7
                        ELSE 6
                    END
                    WHEN COALESCE(c.client_id, 'ivan'::text) = 'arch'::text THEN COALESCE(pr.enrichment_data ->> 'promoted_at'::text,
                    CASE
                        WHEN (pr.enrichment_data ->> 'reviewed_ok'::text) = 'true'::text THEN pr.enrichment_data ->> 'reviewed_at'::text
                        ELSE NULL::text
                    END) IS NOT NULL AND COALESCE(pr.enrichment_data ->> 'promoted_at'::text,
                    CASE
                        WHEN (pr.enrichment_data ->> 'reviewed_ok'::text) = 'true'::text THEN pr.enrichment_data ->> 'reviewed_at'::text
                        ELSE NULL::text
                    END)::timestamp with time zone >= (now() - '30 days'::interval) AND pr.skip_state IS NULL AND (pr.enrichment_data ->> 'lane'::text) IS NOT NULL
                    ELSE pr.scored_at IS NOT NULL AND pr.scored_at >= (now() - '30 days'::interval) AND (pr.enrichment_data ->> 'rise_note_final'::text) IS NOT NULL AND ((COALESCE((pr.enrichment_data -> 'name_gate'::text) ->> 'status'::text, ''::text) = ANY (ARRAY['auto_armed'::text, 'armed_by_ivan'::text])) OR (COALESCE(((pr.enrichment_data -> 'name_gate'::text) -> 'prior'::text) ->> 'status'::text, ''::text) = ANY (ARRAY['auto_armed'::text, 'armed_by_ivan'::text])) OR (pr.stage = ANY (ARRAY['connection_sent'::text, 'connected'::text, 'dm_sent'::text, 'replied'::text])))
                END
          GROUP BY (COALESCE(c.client_id, 'ivan'::text)), (lane_of(c.name)), (
                CASE
                    WHEN COALESCE(c.client_id, 'ivan'::text) = 'arch'::text THEN COALESCE(pr.enrichment_data ->> 'promoted_at'::text,
                    CASE
                        WHEN (pr.enrichment_data ->> 'reviewed_ok'::text) = 'true'::text THEN pr.enrichment_data ->> 'reviewed_at'::text
                        ELSE NULL::text
                    END)::timestamp with time zone::date
                    ELSE pr.scored_at::date
                END)
        ), outflow AS (
         SELECT COALESCE(c.client_id, 'ivan'::text) AS client_id,
            lane_of(c.name) AS lane,
            s.sent_at::date AS day,
            count(*) AS sent_out
           FROM ( SELECT DISTINCT ON (m.prospect_id, m.message_text, m.sent_at) m.prospect_id,
                    m.sent_at
                   FROM outreach_messages m
                  WHERE m.direction = 'outbound'::text AND m.message_type = 'connection_note'::text AND m.sent_at IS NOT NULL AND m.sent_at >= (now() - '30 days'::interval)
                  ORDER BY m.prospect_id, m.message_text, m.sent_at, m.id) s
             JOIN outreach_prospects pr ON pr.id = s.prospect_id
             JOIN outreach_campaigns c ON c.id = pr.campaign_id
          GROUP BY (COALESCE(c.client_id, 'ivan'::text)), (lane_of(c.name)), (s.sent_at::date)
        )
 SELECT COALESCE(i.client_id, o.client_id) AS client_id,
    COALESCE(i.lane, o.lane) AS lane,
    COALESCE(i.day, o.day) AS day,
    COALESCE(i.qualified_in, 0::bigint) AS qualified_in,
    COALESCE(o.sent_out, 0::bigint) AS sent_out
   FROM inflow i
     FULL JOIN outflow o ON i.client_id = o.client_id AND i.lane = o.lane AND i.day = o.day;

COMMIT;
