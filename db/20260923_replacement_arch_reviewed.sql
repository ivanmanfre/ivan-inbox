-- 2026-09-23: ARCH readiness moved to the leads-page approval (reviewed_ok/reviewed_at) with the 09-16
-- qualification release; promoted_at stopped at 2026-09-10. ARCH inflow dates a ready lead by
-- COALESCE(promoted_at, reviewed_at when reviewed_ok='true'). Ivan and RISE branches unchanged.
CREATE OR REPLACE VIEW public.inbox_replacement_v AS
WITH inflow AS (
         SELECT COALESCE(c.client_id, 'ivan'::text) AS client_id,
            lane_of(c.name) AS lane,
                CASE
                    WHEN (COALESCE(c.client_id, 'ivan'::text) = 'arch'::text) THEN ((COALESCE((pr.enrichment_data ->> 'promoted_at'::text), CASE WHEN ((pr.enrichment_data ->> 'reviewed_ok'::text) = 'true'::text) THEN (pr.enrichment_data ->> 'reviewed_at'::text) ELSE NULL::text END))::timestamp with time zone)::date
                    ELSE (pr.scored_at)::date
                END AS day,
            count(*) AS qualified_in
           FROM (outreach_prospects pr
             JOIN outreach_campaigns c ON ((c.id = pr.campaign_id)))
          WHERE ((COALESCE(pr.blacklisted, false) = false) AND
                CASE
                    WHEN (COALESCE(c.client_id, 'ivan'::text) = 'ivan'::text) THEN ((pr.scored_at IS NOT NULL) AND (pr.scored_at >= (now() - '30 days'::interval)) AND (pr.icp_score >=
                    CASE
                        WHEN (lane_of(c.name) = 'cold'::text) THEN 7
                        ELSE 6
                    END))
                    WHEN (COALESCE(c.client_id, 'ivan'::text) = 'arch'::text) THEN ((COALESCE((pr.enrichment_data ->> 'promoted_at'::text), CASE WHEN ((pr.enrichment_data ->> 'reviewed_ok'::text) = 'true'::text) THEN (pr.enrichment_data ->> 'reviewed_at'::text) ELSE NULL::text END) IS NOT NULL) AND ((COALESCE((pr.enrichment_data ->> 'promoted_at'::text), CASE WHEN ((pr.enrichment_data ->> 'reviewed_ok'::text) = 'true'::text) THEN (pr.enrichment_data ->> 'reviewed_at'::text) ELSE NULL::text END))::timestamp with time zone >= (now() - '30 days'::interval)) AND (pr.skip_state IS NULL) AND ((pr.enrichment_data ->> 'lane'::text) IS NOT NULL))
                    ELSE ((pr.scored_at IS NOT NULL) AND (pr.scored_at >= (now() - '30 days'::interval)) AND ((pr.enrichment_data ->> 'rise_note_final'::text) IS NOT NULL) AND ((COALESCE(((pr.enrichment_data -> 'name_gate'::text) ->> 'status'::text), ''::text) = ANY (ARRAY['auto_armed'::text, 'armed_by_ivan'::text])) OR (COALESCE((((pr.enrichment_data -> 'name_gate'::text) -> 'prior'::text) ->> 'status'::text), ''::text) = ANY (ARRAY['auto_armed'::text, 'armed_by_ivan'::text])) OR (pr.stage = ANY (ARRAY['connection_sent'::text, 'connected'::text, 'dm_sent'::text, 'replied'::text]))))
                END)
          GROUP BY COALESCE(c.client_id, 'ivan'::text), (lane_of(c.name)),
                CASE
                    WHEN (COALESCE(c.client_id, 'ivan'::text) = 'arch'::text) THEN ((COALESCE((pr.enrichment_data ->> 'promoted_at'::text), CASE WHEN ((pr.enrichment_data ->> 'reviewed_ok'::text) = 'true'::text) THEN (pr.enrichment_data ->> 'reviewed_at'::text) ELSE NULL::text END))::timestamp with time zone)::date
                    ELSE (pr.scored_at)::date
                END
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
